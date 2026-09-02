import { DatabaseSync } from 'node:sqlite'
import worker, { ADMIN_EMAILS, resolveAccess } from '../sites-worker/index.js'
import { emptyMemory, mergeMemory, recordReview, toggleFavorite } from '../src/study-memory.ts'

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

  async run() {
    const result = this.db.database.prepare(this.sql).run(...this.values)
    return { meta: { changes: Number(result.changes) } }
  }

  async first() {
    return this.db.database.prepare(this.sql).get(...this.values) ?? null
  }

  async all() {
    return { results: this.db.database.prepare(this.sql).all(...this.values) }
  }
}

class FakeD1 {
  constructor() {
    this.database = new DatabaseSync(':memory:')
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()))
  }

  close() {
    this.database.close()
  }
}

function signedRequest(path, email, options = {}) {
  const sessionId = `session-${email.replace(/[^a-z0-9]/gi, '-')}`
  return new Request(`https://gre.example.test${path}`, {
    ...options,
    headers: {
      'oai-authenticated-user-email': email,
      'oai-authenticated-user-id': `id-${email}`,
      'x-gre-session-id': sessionId,
      ...options.headers,
    },
  })
}

const DB = new FakeD1()
const env = { DB }

try {
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
  const initialProgressPayload = await initialProgress.json()
  if (initialProgress.status !== 200 || initialProgressPayload.progress !== null || initialProgressPayload.revision !== 0) {
    throw new Error('Initial progress was not empty')
  }

  let firstDeviceProgress = recordReview(emptyMemory(), 'word1000-1', 'known', undefined, 456, 'device-a')
  firstDeviceProgress = toggleFavorite(firstDeviceProgress, 'word1000-2', 457)
  const firstSave = await worker.fetch(signedRequest('/api/progress?deck=words1000', adminEmail, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: 'https://gre.example.test' },
    body: JSON.stringify({ progress: firstDeviceProgress, baseRevision: 0 }),
  }), env)
  const firstSavePayload = await firstSave.json()
  if (firstSave.status !== 200 || firstSavePayload.revision !== 1) throw new Error('Initial progress save failed')

  const secondDeviceProgress = recordReview(emptyMemory(), 'word1000-3', 'hard', 'correct', 500, 'device-b')
  const conflictingSave = await worker.fetch(signedRequest('/api/progress?deck=words1000', adminEmail, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      origin: 'https://gre.example.test',
      'x-gre-session-id': 'session-second-device-0002',
    },
    body: JSON.stringify({ progress: secondDeviceProgress, baseRevision: 0 }),
  }), env)
  const conflictPayload = await conflictingSave.json()
  if (conflictingSave.status !== 409 || conflictPayload.revision !== 1) {
    throw new Error('Concurrent progress update was not detected')
  }

  const mergedProgress = mergeMemory(secondDeviceProgress, conflictPayload.progress)
  if (!mergedProgress.schedule['word1000-1'] || !mergedProgress.schedule['word1000-3']) {
    throw new Error('Concurrent word progress was not merged')
  }
  if (mergedProgress.activity['1970-01-01'].reviews !== 2) {
    throw new Error('Concurrent activity totals were not merged')
  }
  const retrySave = await worker.fetch(signedRequest('/api/progress?deck=words1000', adminEmail, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: 'https://gre.example.test' },
    body: JSON.stringify({ progress: mergedProgress, baseRevision: conflictPayload.revision }),
  }), env)
  const retryPayload = await retrySave.json()
  if (retrySave.status !== 200 || retryPayload.revision !== 2) throw new Error('Merged progress retry failed')

  const loadedProgress = await worker.fetch(signedRequest('/api/progress?deck=words1000', adminEmail), env)
  const loadedProgressPayload = await loadedProgress.json()
  if (
    loadedProgressPayload.progress?.favorites?.['word1000-2'] !== true ||
    !loadedProgressPayload.progress?.schedule?.['word1000-3'] ||
    loadedProgressPayload.revision !== 2
  ) {
    throw new Error('Merged progress did not round-trip')
  }

  const approval = await worker.fetch(signedRequest(`/api/admin/accounts/${encodeURIComponent(pendingEmail)}`, adminEmail, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://gre.example.test' },
    body: JSON.stringify({ status: 'approved' }),
  }), env)
  if (approval.status !== 200) throw new Error(`Approval failed: ${approval.status}`)

  const learnerVocabulary = await worker.fetch(signedRequest('/api/vocabulary', pendingEmail), env)
  if (learnerVocabulary.status !== 200) throw new Error(`Approved learner remained blocked: ${learnerVocabulary.status}`)
  const learnerProgress = await worker.fetch(signedRequest('/api/progress?deck=words1000', pendingEmail), env)
  if ((await learnerProgress.json()).progress !== null) throw new Error('Progress leaked between email accounts')

  await worker.fetch(signedRequest('/api/session', adminEmail, {
    headers: { 'x-gre-session-id': 'session-second-device-0002' },
  }), env)
  const accountsResponse = await worker.fetch(signedRequest('/api/admin/accounts', adminEmail), env)
  const accountsPayload = await accountsResponse.json()
  const adminAccount = accountsPayload.accounts.find((account) => account.email === adminEmail)
  if (!adminAccount || adminAccount.session_count < 2 || !adminAccount.last_login_at || !adminAccount.last_seen_at) {
    throw new Error('Login session summary is incomplete')
  }
  if (
    adminAccount.progress.words1000?.studied !== 2 ||
    adminAccount.progress.words1000?.known !== 1 ||
    adminAccount.progress.words1000?.reviews !== 2
  ) {
    throw new Error('Admin progress summary is incorrect')
  }

  console.log(JSON.stringify({
    valid: true,
    admins: ADMIN_EMAILS,
    anonymous: 'blocked',
    pending: 'blocked',
    approved: 'allowed',
    progressSync: 'email-isolated, revision-checked, and mergeable',
    sessions: 'recorded without device fingerprints',
    adminProgressSummary: true,
  }, null, 2))
} finally {
  DB.close()
}
