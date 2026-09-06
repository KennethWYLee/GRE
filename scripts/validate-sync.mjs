import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { createProgressSync } from '../src/progress-sync.ts'
import { claimLegacyMemory, emptyMemory, hasUnclaimedLegacyMemory, loadMemory, recordReview, saveMemory } from '../src/study-memory.ts'

const storage = new Map()
globalThis.window = { localStorage: {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
} }
const a = 'a@example.com'
const b = 'b@example.com'
const reviewed = (id, time = 100) => recordReview(emptyMemory(), id, 'known', undefined, time, 'test-device')
saveMemory('words1000', reviewed('a-only'), a)
assert.equal(loadMemory('words1000', ' A@EXAMPLE.COM ').recall['a-only'], 'known')
assert.deepEqual(loadMemory('words1000', b).recall, {})
assert.deepEqual(loadMemory('words2000', a).recall, {})
storage.set('gre-roots-progress-v2-words1000', JSON.stringify(reviewed('unowned')))
assert.equal(hasUnclaimedLegacyMemory(), true)
assert.deepEqual(loadMemory('words1000', b).recall, {}, 'Never automatically merge an unowned legacy record')
const claimed = claimLegacyMemory(a)
assert.equal(claimed.words1000.recall.unowned, 'known')
assert.equal(hasUnclaimedLegacyMemory(), false)
assert.equal(claimLegacyMemory(b), null)
assert.equal(storage.has('gre-roots-progress-v2-words1000'), true, 'Original legacy progress must remain intact')

async function until(predicate, message) {
  const deadline = Date.now() + 2500
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message)
    await delay(2)
  }
}

const server = new Map()
const requests = []
let failNetwork = false
let forbidden = false
let conflictOnce = false
let holdNextGet = null
let releasePut = null
let holdNextPut = false
async function fetchProgress(url, init = {}) {
  const deck = new URL(url, 'https://gre.test').searchParams.get('deck')
  const email = new Headers(init.headers).get('x-gre-account-email')
  const key = `${email}/${deck}`
  const method = init.method ?? 'GET'
  requests.push({ key, method })
  if (failNetwork) throw new TypeError('offline')
  if (forbidden) return Response.json({ error: 'account_changed' }, { status: 403 })
  const row = server.get(key) ?? { progress: null, revision: 0 }
  if (method === 'GET') {
    const captured = structuredClone(row)
    if (holdNextGet && deck === 'words1000') {
      const hold = holdNextGet
      holdNextGet = null
      await hold()
    }
    return Response.json(captured)
  }
  const payload = JSON.parse(init.body)
  if (holdNextPut && deck === 'words1000') {
    holdNextPut = false
    await new Promise((resolve) => { releasePut = resolve })
  }
  if (conflictOnce && deck === 'words1000') {
    conflictOnce = false
    const competing = { progress: reviewed('other-device', 1000), revision: row.revision + 1 }
    server.set(key, competing)
    return Response.json(competing, { status: 409 })
  }
  if (payload.baseRevision !== row.revision) return Response.json(row, { status: 409 })
  server.set(key, { progress: payload.progress, revision: row.revision + 1 })
  return Response.json({ ok: true, revision: row.revision + 1 })
}

const stores = []
const make = (email, extra = {}) => {
  const store = createProgressSync(email, { fetch: fetchProgress, debounceMs: 1, retryMs: 5, requestTimeoutMs: 1000, ...extra })
  stores.push(store)
  return store
}
try {
  // Both summaries must load before the user chooses either deck.
  server.set(`${b}/words2000`, { progress: reviewed('cloud-only'), revision: 1 })
  const store = make(b)
  store.start()
  await until(() => Object.values(store.getSnapshot()).every((deck) => deck.status === 'synced'), 'Initial sync did not finish')
  assert.equal(store.getSnapshot().words2000.memory.recall['cloud-only'], 'known')
  assert.deepEqual(store.getSnapshot().words1000.memory.recall, {})

  // Network recovery must upload pending progress without another study action.
  failNetwork = true
  store.update('words1000', () => reviewed('offline-word'))
  await until(() => store.getSnapshot().words1000.status === 'offline', 'Failure was not shown')
  failNetwork = false
  await until(() => server.get(`${b}/words1000`)?.progress.recall['offline-word'] === 'known', 'No automatic retry after recovery')
  await until(() => store.getSnapshot().words1000.status === 'synced', 'Retry did not finish')

  // A revision conflict must preserve the updates from both devices.
  conflictOnce = true
  store.update('words1000', (current) => recordReview(current, 'my-second-word', 'known', undefined, 2000))
  await until(() => {
    const memory = server.get(`${b}/words1000`)?.progress
    return memory?.recall['my-second-word'] && memory?.recall['other-device']
  }, 'Conflict resolution discarded a device update')
  store.stop()

  // A slow initial GET must not overwrite study actions made while loading.
  let releaseGet
  holdNextGet = () => new Promise((resolve) => { releaseGet = resolve })
  const slow = make('slow@example.com')
  slow.start()
  await until(() => Boolean(releaseGet), 'GET did not start')
  slow.update('words1000', () => reviewed('during-load'))
  releaseGet()
  await until(() => server.get('slow@example.com/words1000')?.progress.recall['during-load'], 'Loading replaced a local update')
  await until(() => slow.getSnapshot().words1000.status === 'synced', 'Slow load never settled')

  // A study action during an in-flight PUT must cause a second upload.
  holdNextPut = true
  slow.update('words1000', (current) => recordReview(current, 'first-save', 'known', undefined, 3000))
  await until(() => Boolean(releasePut), 'PUT was not held')
  slow.update('words1000', (current) => recordReview(current, 'during-save', 'known', undefined, 4000))
  releasePut()
  await until(() => server.get('slow@example.com/words1000')?.progress.recall['during-save'], 'Update during PUT was never saved')
  slow.stop()

  // Responses to an unmounted account cannot publish or upload anything later.
  releaseGet = null
  holdNextGet = () => new Promise((resolve) => { releaseGet = resolve })
  const stopped = make('old-account@example.com')
  stopped.start()
  await until(() => Boolean(releaseGet), 'Old-account request did not start')
  stopped.stop()
  const before = stopped.getSnapshot()
  releaseGet()
  await delay(10)
  assert.equal(stopped.getSnapshot(), before)

  forbidden = true
  const blocked = make('changed@example.com')
  blocked.start()
  await until(() => blocked.getSnapshot().words1000.status === 'blocked', 'Changed account was not blocked')
  const count = requests.filter((r) => r.key.startsWith('changed@')).length
  blocked.update('words1000', () => reviewed('must-not-upload'))
  blocked.refresh()
  await delay(20)
  assert.equal(requests.filter((r) => r.key.startsWith('changed@')).length, count)
  blocked.stop()
  forbidden = false

  // Cloud persistence must still work when localStorage is unavailable/full.
  const noStorage = make('no-storage@example.com', { read: () => emptyMemory(), write: () => false })
  noStorage.start()
  noStorage.update('words1000', () => reviewed('cloud-save'))
  await until(() => server.get('no-storage@example.com/words1000')?.progress.recall['cloud-save'], 'Storage failure prevented cloud saving')
  assert.equal(noStorage.getSnapshot().words1000.localSaved, false)
} finally {
  stores.forEach((store) => store.stop())
  delete globalThis.window
}
console.log(JSON.stringify({ valid: true, accountIsolation: true, explicitLegacyClaim: true, homeSummaries: true, offlineRetry: true, concurrentMerge: true, updatesDuringRequests: true, staleAccountResponsesIgnored: true, storageFailureTolerated: true }))
