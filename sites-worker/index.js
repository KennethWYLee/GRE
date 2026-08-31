export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url)
    if (requestUrl.pathname === '/api/pronunciation') {
      return getPronunciation(requestUrl)
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

async function getPronunciation(requestUrl) {
  const word = (requestUrl.searchParams.get('word') ?? '').trim()
  if (!word || word.length > 80 || !/^[a-zA-ZÀ-ž' -]+$/.test(word)) {
    return json({ audio: null, accent: null, source: null }, 400)
  }

  try {
    const directUsRecording = await findGoogleDictionaryUsRecording(word)
    if (directUsRecording) {
      return json({
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
    if (!response.ok) return json({ audio: null, accent: null, source: null })

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
    if (!selected) return json({ audio: null, accent: null, source: null })

    return json({
      audio: selected.audio,
      accent: isUsAudio(selected.audio) ? 'en-US' : 'en',
      phonetic: selected.text,
      source: 'dictionaryapi.dev',
    })
  } catch {
    return json({ audio: null, accent: null, source: null })
  }
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
      'cache-control': 'public, max-age=604800',
    },
  })
}
