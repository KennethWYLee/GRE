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
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()))
  }

  async run(sql, values) {
    if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) return { meta: { changes: 0 } }

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
const env = {
  DB,
  ASSETS: {
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/data/vocabulary.json') {
        return new Response(JSON.stringify({ meta: { totalWords: 2078 } }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    },
  },
}

for (const email of ADMIN_EMAILS) {
  const access = resolveAccess(email)
  if (!access.isAdmin || access.status !== 'approved') throw new Error(`${email} is not an approved admin`)
}
if (resolveAccess('kenneth.wy.lee21@gamil.com').isAdmin) throw new Error('Misspelled email must not be an admin')

const anonymousSession = await worker.fetch(new Request('https://gre.example.test/api/session'), env)
if ((await anonymousSession.json()).authenticated !== false) throw new Error('Anonymous session was not rejected')

const pendingEmail = 'learner@example.com'
const pendingSession = await worker.fetch(signedRequest('/api/session', pendingEmail), env)
const pendingPayload = await pendingSession.json()
if (pendingPayload.status !== 'pending' || pendingPayload.isAdmin) throw new Error('New learner was not queued')

const blockedVocabulary = await worker.fetch(signedRequest('/api/vocabulary', pendingEmail), env)
if (blockedVocabulary.status !== 403) throw new Error(`Pending learner got vocabulary: ${blockedVocabulary.status}`)

const adminEmail = ADMIN_EMAILS[0]
const approvedVocabulary = await worker.fetch(signedRequest('/api/vocabulary', adminEmail), env)
if (approvedVocabulary.status !== 200) throw new Error(`Admin vocabulary failed: ${approvedVocabulary.status}`)

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
}, null, 2))
