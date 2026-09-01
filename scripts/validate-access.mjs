import worker, { ADMIN_EMAILS, resolveAccess } from '../sites-worker/index.js'

class FakeStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = sql
    this.values = []
  }

  bind(...values) {
    this.values = values
    return this
  }

  run() {
    return this.db.run(this.sql, this.values)
  }

  first() {
    if (this.sql.includes('study_progress')) {
      const key = `${String(this.values[0] ?? '').toLocaleLowerCase()}|${this.values[1] ?? ''}`
      return Promise.resolve(this.db.progress.get(key) ?? null)
    }
    const email = String(this.values[0] ?? '').toLocaleLowerCase()
    return Promise.resolve(this.db.accounts.get(email) ?? null)
  }

  all() {
    return Promise.resolve({ results: [...this.db.accounts.values()] })
  }
}

class FakeD1 {
  constructor() {
    this.accounts = new Map()
    this.progress = new Map()
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()))
  }

  async run(sql, values) {
    if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) return { meta: { changes: 0 } }

    if (sql.includes('INSERT INTO study_progress')) {
      const [rawEmail, deckId, progressJson, clientUpdatedAt] = values
      const key = `${String(rawEmail).toLocaleLowerCase()}|${deckId}`
      const existing = this.progress.get(key)
      if (!existing || Number(clientUpdatedAt) >= Number(existing.client_updated_at)) {
        this.progress.set(key, {
          progress_json: progressJson,
          client_updated_at: Number(clientUpdatedAt),
          updated_at: '2026-09-01 00:02:00',
        })
      }
      return { meta: { changes: 1 } }
    }

    if (sql.includes('INSERT INTO account_access')) {
      const email = String(values[0] ?? '').toLocaleLowerCase()
      const existing = this.accounts.get(email)
      const admin = ADMIN_EMAILS.includes(email)
      this.accounts.set(email, {
        email,
        user_id: values[1] ?? existing?.user_id ?? null,
        full_name: values[2] ?? existing?.full_name ?? null,
        status: admin ? 'approved' : existing?.status ?? 'pending',
        role: admin ? 'admin' : 'member',
        requested_at: existing?.requested_at ?? '2026-09-01 00:00:00',
        reviewed_at: admin ? '2026-09-01 00:00:00' : existing?.reviewed_at ?? null,
        reviewed_by: admin ? 'system' : existing?.reviewed_by ?? null,
        last_seen_at: '2026-09-01 00:00:00',
      })
      return { meta: { changes: 1 } }
    }

    if (sql.includes('UPDATE account_access')) {
      const [status, reviewer, rawEmail] = values
      const email = String(rawEmail).toLocaleLowerCase()
      const account = this.accounts.get(email)
      if (!account || account.role !== 'member') return { meta: { changes: 0 } }
      account.status = status
      account.reviewed_by = reviewer
      account.reviewed_at = '2026-09-01 00:01:00'
      return { meta: { changes: 1 } }
    }

    return { meta: { changes: 0 } }
  }
}

function signedRequest(path, email, options = {}) {
  return new Request(`https://gre.example.test${path}`, {
    ...options,
    headers: {
      'oai-authenticated-user-email': email,
      'oai-authenticated-user-id': `id-${email}`,
      ...options.headers,
    },
  })
}

const DB = new FakeD1()
const env = { DB }

for (const email of ADMIN_EMAILS) {
  const access = resolveAccess(email)
  if (!access.isAdmin || access.status !== 'approved') throw new Error(`${email} is not an approved admin`)
}
if (resolveAccess('kenneth.wy.lee21@gamil.com').isAdmin) throw new Error('Misspelled email must not be an admin')

const anonymousSession = await worker.fetch(new Request('https://gre.example.test/api/session'), env)
if ((await anonymousSession.json()).authenticated !== false) throw new Error('Anonymous session was not rejected')
const anonymousDirectData = await worker.fetch(new Request('https://gre.example.test/data/vocabulary.json'), env)
if (anonymousDirectData.status !== 401) throw new Error('Direct vocabulary URL bypassed sign-in')

const pendingEmail = 'learner@example.com'
const pendingSession = await worker.fetch(signedRequest('/api/session', pendingEmail), env)
const pendingPayload = await pendingSession.json()
if (pendingPayload.status !== 'pending' || pendingPayload.isAdmin) throw new Error('New learner was not queued')

const blockedVocabulary = await worker.fetch(signedRequest('/api/vocabulary', pendingEmail), env)
if (blockedVocabulary.status !== 403) throw new Error(`Pending learner got vocabulary: ${blockedVocabulary.status}`)
const blockedProgress = await worker.fetch(signedRequest('/api/progress?deck=words1000', pendingEmail), env)
if (blockedProgress.status !== 403) throw new Error(`Pending learner got progress: ${blockedProgress.status}`)

const adminEmail = ADMIN_EMAILS[0]
const approvedVocabulary = await worker.fetch(signedRequest('/api/vocabulary', adminEmail), env)
if (approvedVocabulary.status !== 200) throw new Error(`Admin vocabulary failed: ${approvedVocabulary.status}`)
if ((await approvedVocabulary.json()).meta.totalWords !== 2078) throw new Error('Approved vocabulary payload is invalid')

const approvedVocabulary1000 = await worker.fetch(signedRequest('/api/vocabulary?deck=words1000', adminEmail), env)
if (approvedVocabulary1000.status !== 200) throw new Error(`Admin 1000-word vocabulary failed: ${approvedVocabulary1000.status}`)
const approvedVocabulary1000Payload = await approvedVocabulary1000.json()
if (approvedVocabulary1000Payload.meta.totalWords !== 1085 || approvedVocabulary1000Payload.meta.deckId !== 'words1000') {
  throw new Error('Approved 1000-word vocabulary payload is invalid')
}

const invalidDeck = await worker.fetch(signedRequest('/api/vocabulary?deck=unknown', adminEmail), env)
if (invalidDeck.status !== 400) throw new Error(`Unknown deck was not rejected: ${invalidDeck.status}`)

const initialProgress = await worker.fetch(signedRequest('/api/progress?deck=words1000', adminEmail), env)
if (initialProgress.status !== 200 || (await initialProgress.json()).progress !== null) throw new Error('Initial progress was not empty')
const progressSnapshot = {
  version: 3,
  recall: { 'word1000-1': 'known' },
  positions: { '1': 4 },
  schedule: { 'word1000-1': { dueAt: 123, intervalDays: 7, lastReviewedAt: 100, repetitions: 1 } },
  favorites: { 'word1000-2': true },
  activity: { '2026-09-01': { reviews: 1, known: 1, quizCorrect: 0, quizWrong: 0 } },
  updatedAt: 456,
}
const savedProgress = await worker.fetch(signedRequest('/api/progress?deck=words1000', adminEmail, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', origin: 'https://gre.example.test' },
  body: JSON.stringify({ progress: progressSnapshot }),
}), env)
if (savedProgress.status !== 200) throw new Error(`Progress save failed: ${savedProgress.status}`)
const loadedProgress = await worker.fetch(signedRequest('/api/progress?deck=words1000', adminEmail), env)
const loadedProgressPayload = await loadedProgress.json()
if (loadedProgressPayload.progress?.favorites?.['word1000-2'] !== true) throw new Error('Progress did not round-trip')

const approval = await worker.fetch(signedRequest(`/api/admin/accounts/${encodeURIComponent(pendingEmail)}`, adminEmail, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://gre.example.test' },
  body: JSON.stringify({ status: 'approved' }),
}), env)
if (approval.status !== 200) throw new Error(`Approval failed: ${approval.status}`)

const learnerVocabulary = await worker.fetch(signedRequest('/api/vocabulary', pendingEmail), env)
if (learnerVocabulary.status !== 200) throw new Error(`Approved learner remained blocked: ${learnerVocabulary.status}`)

console.log(JSON.stringify({
  valid: true,
  admins: ADMIN_EMAILS,
  anonymous: 'blocked',
  pending: 'blocked',
  approved: 'allowed',
  progressSync: 'isolated and persistent',
}, null, 2))
