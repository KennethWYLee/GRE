import vocabulary1000Data from '../data/vocabulary-1000.json' with { type: 'json' }
import vocabulary2000Data from '../data/vocabulary.json' with { type: 'json' }

export const ADMIN_EMAILS = ['wy.lee@ntub.edu.tw', 'kenneth.wy.lee21@gmail.com']
export const ACCESS_STATUSES = ['pending', 'approved', 'rejected', 'revoked']

const VOCABULARY_JSON_BY_DECK = {
  words1000: JSON.stringify(vocabulary1000Data),
  words2000: JSON.stringify(vocabulary2000Data),
}
let schemaReadyPromise = null

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url)

    try {
      if (requestUrl.pathname === '/api/session') {
        return json(await getSession(request, env))
      }

      if (
        requestUrl.pathname === '/api/vocabulary' ||
        requestUrl.pathname === '/data/vocabulary.json' ||
        requestUrl.pathname === '/data/vocabulary-1000.json'
      ) {
        const requestedDeck = requestUrl.pathname === '/data/vocabulary-1000.json'
          ? 'words1000'
          : requestUrl.searchParams.get('deck') ?? 'words2000'
        return serveVocabulary(request, env, requestedDeck)
      }

      if (requestUrl.pathname === '/api/pronunciation') {
        const access = await requireApproved(request, env)
        if (access.response) return access.response
        return getPronunciation(requestUrl)
      }

      if (requestUrl.pathname === '/api/admin/accounts' && request.method === 'GET') {
        return listAccounts(request, env)
      }

      const accountMatch = requestUrl.pathname.match(/^\/api\/admin\/accounts\/([^/]+)$/)
      if (accountMatch && request.method === 'POST') {
        return updateAccount(request, env, decodeURIComponent(accountMatch[1]))
      }
    } catch (error) {
      console.error('GRE Roots request failed', error)
      return json({ error: 'service_unavailable', message: '服務暫時無法使用，請稍後再試。' }, 503)
    }

    if (!env.ASSETS?.fetch) {
      return new Response('Static asset binding is unavailable.', { status: 500 })
    }

    const response = await env.ASSETS.fetch(request)
    if (response.status !== 404 || request.method !== 'GET') return response

    const accept = request.headers.get('accept') ?? ''
    if (!accept.includes('text/html')) return response

    const indexUrl = new URL('/index.html', request.url)
    return env.ASSETS.fetch(new Request(indexUrl, request))
  },
}

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLocaleLowerCase()
}

export function resolveAccess(email, storedStatus = 'pending') {
  const normalizedEmail = normalizeEmail(email)
  const isAdmin = ADMIN_EMAILS.includes(normalizedEmail)
  return {
    email: normalizedEmail,
    isAdmin,
    role: isAdmin ? 'admin' : 'member',
    status: isAdmin ? 'approved' : ACCESS_STATUSES.includes(storedStatus) ? storedStatus : 'pending',
  }
}

async function getSession(request, env) {
  const identity = readIdentity(request)
  if (!identity) return { authenticated: false }

  await ensureAccountSchema(env)
  const access = resolveAccess(identity.email)

  if (access.isAdmin) {
    await env.DB.prepare(
      `INSERT INTO account_access (
        email, user_id, full_name, status, role, requested_at, reviewed_at, reviewed_by, last_seen_at
      ) VALUES (?, ?, ?, 'approved', 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'system', CURRENT_TIMESTAMP)
      ON CONFLICT(email) DO UPDATE SET
        user_id = excluded.user_id,
        full_name = excluded.full_name,
        status = 'approved',
        role = 'admin',
        last_seen_at = CURRENT_TIMESTAMP`,
    ).bind(access.email, identity.userId, identity.fullName).run()
  } else {
    await env.DB.prepare(
      `INSERT INTO account_access (
        email, user_id, full_name, status, role, requested_at, last_seen_at
      ) VALUES (?, ?, ?, 'pending', 'member', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(email) DO UPDATE SET
        user_id = excluded.user_id,
        full_name = excluded.full_name,
        last_seen_at = CURRENT_TIMESTAMP`,
    ).bind(access.email, identity.userId, identity.fullName).run()
  }

  const account = await env.DB.prepare(
    `SELECT email, full_name, status, role, requested_at, reviewed_at, reviewed_by
     FROM account_access WHERE email = ?`,
  ).bind(access.email).first()

  const resolved = resolveAccess(account?.email ?? access.email, account?.status)
  return {
    authenticated: true,
    email: resolved.email,
    fullName: account?.full_name || identity.fullName || resolved.email,
    status: resolved.status,
    isAdmin: resolved.isAdmin,
    role: resolved.role,
    requestedAt: account?.requested_at ?? null,
    reviewedAt: account?.reviewed_at ?? null,
  }
}

async function requireApproved(request, env) {
  const session = await getSession(request, env)
  if (!session.authenticated) {
    return { response: json({ error: 'sign_in_required', session }, 401) }
  }
  if (session.status !== 'approved') {
    return { response: json({ error: 'approval_required', session }, 403) }
  }
  return { session }
}

async function requireAdmin(request, env) {
  const access = await requireApproved(request, env)
  if (access.response) return access
  if (!access.session.isAdmin) {
    return { response: json({ error: 'admin_required' }, 403) }
  }
  return access
}

async function serveVocabulary(request, env, deckId) {
  const access = await requireApproved(request, env)
  if (access.response) return access.response
  const payload = VOCABULARY_JSON_BY_DECK[deckId]
  if (!payload) return json({ error: 'invalid_deck' }, 400)
  return new Response(payload, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  })
}

async function listAccounts(request, env) {
  const access = await requireAdmin(request, env)
  if (access.response) return access.response

  const result = await env.DB.prepare(
    `SELECT email, full_name, status, role, requested_at, reviewed_at, reviewed_by, last_seen_at
     FROM account_access
     ORDER BY
       CASE role WHEN 'admin' THEN 0 ELSE 1 END,
       CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
       requested_at DESC`,
  ).all()

  return json({ accounts: result.results ?? [] })
}

async function updateAccount(request, env, rawEmail) {
  const access = await requireAdmin(request, env)
  if (access.response) return access.response
  if (!isTrustedOrigin(request)) return json({ error: 'invalid_origin' }, 403)
  if (!(request.headers.get('content-type') ?? '').toLocaleLowerCase().includes('application/json')) {
    return json({ error: 'json_required' }, 415)
  }

  const email = normalizeEmail(rawEmail)
  if (!email || ADMIN_EMAILS.includes(email)) return json({ error: 'protected_admin' }, 400)

  const payload = await request.json().catch(() => null)
  const status = payload?.status
  if (!ACCESS_STATUSES.includes(status) || status === 'pending') {
    return json({ error: 'invalid_status' }, 400)
  }

  const result = await env.DB.prepare(
    `UPDATE account_access
     SET status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?
     WHERE email = ? AND role = 'member'`,
  ).bind(status, access.session.email, email).run()

  if (!result.meta?.changes) return json({ error: 'account_not_found' }, 404)
  return json({ ok: true, email, status })
}

function readIdentity(request) {
  const email = normalizeEmail(request.headers.get('oai-authenticated-user-email'))
  const userId = (request.headers.get('oai-authenticated-user-id') ?? '').trim()
  if (!email || !userId) return null

  const encodedName = request.headers.get('oai-authenticated-user-full-name') ?? ''
  const encoding = request.headers.get('oai-authenticated-user-full-name-encoding')
  let fullName = encodedName
  if (encodedName && encoding === 'percent-encoded-utf-8') {
    try {
      fullName = decodeURIComponent(encodedName)
    } catch {
      fullName = ''
    }
  }

  return { email, userId, fullName: fullName.trim() }
}

async function ensureAccountSchema(env) {
  if (!env.DB?.prepare) throw new Error('D1 binding DB is unavailable')
  if (!schemaReadyPromise) schemaReadyPromise = initializeAccountSchema(env.DB)
  try {
    await schemaReadyPromise
  } catch (error) {
    schemaReadyPromise = null
    throw error
  }
}

async function initializeAccountSchema(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS account_access (
      email TEXT PRIMARY KEY COLLATE NOCASE,
      user_id TEXT,
      full_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      reviewed_by TEXT,
      last_seen_at TEXT
    )`,
  ).run()

  await db.batch([
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_account_access_status_requested
       ON account_access(status, requested_at)`,
    ),
    ...ADMIN_EMAILS.map((email) =>
      db.prepare(
        `INSERT INTO account_access (
          email, status, role, requested_at, reviewed_at, reviewed_by
        ) VALUES (?, 'approved', 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'system')
        ON CONFLICT(email) DO UPDATE SET status = 'approved', role = 'admin'`,
      ).bind(email),
    ),
  ])
}

function isTrustedOrigin(request) {
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}

async function getPronunciation(requestUrl) {
  const word = (requestUrl.searchParams.get('word') ?? '').trim()
  if (!word || word.length > 80 || !/^[a-zA-ZÀ-ž' -]+$/.test(word)) {
    return json({ audio: null, accent: null, source: null }, 400)
  }

  const edgeCache = globalThis.caches?.default
  const cacheKey = new Request(requestUrl.toString(), {
    headers: { accept: 'application/json' },
  })
  let cached = null
  try {
    cached = await edgeCache?.match(cacheKey)
  } catch {
    // Continue with the live lookup if the optional edge cache is unavailable.
  }
  if (cached) return browserCachedPronunciation(cached)

  try {
    const directUsRecording = await findGoogleDictionaryUsRecording(word)
    if (directUsRecording) {
      return cachePronunciation(edgeCache, cacheKey, {
        audio: directUsRecording,
        accent: 'en-US',
        phonetic: null,
        source: 'google-dictionary',
      })
    }

    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(2200),
      },
    )
    if (!response.ok) {
      return cachePronunciation(edgeCache, cacheKey, { audio: null, accent: null, source: null }, 86400)
    }

    const entries = await response.json()
    const candidates = entries
      .flatMap((entry) => entry.phonetics ?? [])
      .filter((phonetic) => typeof phonetic.audio === 'string' && phonetic.audio)
      .map((phonetic) => ({
        audio: normalizeAudioUrl(phonetic.audio),
        text: typeof phonetic.text === 'string' ? phonetic.text : null,
      }))
      .filter((phonetic) => phonetic.audio)
      .sort((a, b) => audioScore(b.audio) - audioScore(a.audio))

    const selected = candidates[0]
    if (!selected) {
      return cachePronunciation(edgeCache, cacheKey, { audio: null, accent: null, source: null }, 86400)
    }

    return cachePronunciation(edgeCache, cacheKey, {
      audio: selected.audio,
      accent: isUsAudio(selected.audio) ? 'en-US' : 'en',
      phonetic: selected.text,
      source: 'dictionaryapi.dev',
    })
  } catch {
    return cachePronunciation(edgeCache, cacheKey, { audio: null, accent: null, source: null }, 3600)
  }
}

async function cachePronunciation(edgeCache, cacheKey, payload, maxAge = 2592000) {
  const edgeResponse = new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
      'x-content-type-options': 'nosniff',
    },
  })
  if (edgeCache) {
    try {
      await edgeCache.put(cacheKey, edgeResponse.clone())
    } catch {
      // Pronunciation still works when the optional edge cache is unavailable.
    }
  }
  return browserCachedPronunciation(edgeResponse, maxAge)
}

function browserCachedPronunciation(response, maxAge) {
  const headers = new Headers(response.headers)
  const existingCacheControl = headers.get('cache-control')
  headers.set(
    'cache-control',
    existingCacheControl?.replace(/^public/i, 'private') ?? `private, max-age=${maxAge ?? 2592000}`,
  )
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function findGoogleDictionaryUsRecording(word) {
  const normalized = word.toLocaleLowerCase().replace(/\s+/g, '_')
  const candidates = [1, 2, 3].map(
    (index) =>
      `https://ssl.gstatic.com/dictionary/static/sounds/20200429/${encodeURIComponent(normalized)}--_us_${index}.mp3`,
  )
  const checks = await Promise.allSettled(
    candidates.map((audio) =>
      fetch(audio, {
        method: 'HEAD',
        signal: AbortSignal.timeout(1800),
      }),
    ),
  )

  for (let index = 0; index < checks.length; index += 1) {
    const check = checks[index]
    if (
      check.status === 'fulfilled' &&
      check.value.ok &&
      (check.value.headers.get('content-type') ?? '').startsWith('audio/')
    ) {
      return candidates[index]
    }
  }
  return null
}

function normalizeAudioUrl(value) {
  if (value.startsWith('//')) return `https:${value}`
  return value.startsWith('https://') ? value : ''
}

function isUsAudio(url) {
  return /(?:[-_/](?:us|usa)(?:[-_.\/]|$)|_us_)/i.test(url)
}

function audioScore(url) {
  if (isUsAudio(url)) return 100
  if (/(?:[-_/](?:uk|gb)(?:[-_.\/]|$)|_gb_)/i.test(url)) return 10
  return 50
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
