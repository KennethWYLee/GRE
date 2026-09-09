import assert from 'node:assert/strict'
import { runAutoplayCard } from '../src/autoplay.ts'
import { WORD_ILLUSTRATIONS, preloadWordIllustrations } from '../src/word-illustrations.ts'

const ids = Object.keys(WORD_ILLUSTRATIONS)
const original = { Image: globalThis.Image, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
const timers = new Map()
const requested = []
let nextTimer = 0
let clock = 0
let peakDownloads = 0
const activeImages = () => requested.filter((image) => image.active)
globalThis.setTimeout = (callback, delay) => {
  const id = ++nextTimer
  timers.set(id, { callback, at: clock + delay })
  return id
}
globalThis.clearTimeout = (id) => timers.delete(id)
globalThis.Image = class {
  active = false
  set src(value) {
    this.url = value
    this.active = true
    requested.push(this)
    peakDownloads = Math.max(peakDownloads, activeImages().length)
  }
  removeAttribute(name) {
    assert.equal(name, 'src')
    this.active = false
  }
}

function runNextTimer() {
  const [id, task] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] ?? []
  assert.ok(task, 'Expected a pending preload timer')
  timers.delete(id)
  clock = task.at
  task.callback()
}

function finishImage(image, success = true) {
  image.active = false
  image[success ? 'onload' : 'onerror']?.()
}

function finishWindow() {
  let completed = 0
  while (activeImages().length) {
    assert.ok(++completed <= 11, 'Only the current and next ten images may load')
    finishImage(activeImages()[0])
  }
}

try {
  preloadWordIllustrations([...ids, 'unknown-word'])
  assert.equal(requested.length, 0, 'Rendering and speech must get a head start before background requests')
  runNextTimer()
  assert.equal(clock, 200)
  assert.equal(activeImages().length, 2, 'Background image downloads must be limited to two at once')

  // Intentionally never complete either image: speech and card timing still advance.
  let speechClock = 0
  const events = []
  assert.equal(await runAutoplayCard({
    minimumDurationMs: 5_000,
    isActive: () => true,
    playEnglish: async () => { events.push('english'); speechClock += 800 },
    showMeaning: () => { events.push('meaning') },
    playMandarin: async () => { events.push('mandarin'); speechClock += 700 },
    wait: async (milliseconds) => { speechClock += milliseconds },
    now: () => speechClock,
  }), true)
  assert.deepEqual(events, ['english', 'meaning', 'mandarin'])
  assert.equal(speechClock, 5_000)
  assert.equal(activeImages().length, 2, 'Autoplay completed while both images were still stalled')

  finishWindow()
  assert.equal(requested.length, Math.min(11, ids.length), 'Never download the whole book at once')
  preloadWordIllustrations(ids.slice(0, 11).reverse())
  assert.equal(timers.size, 0, 'Already loaded images in the same window must not be requested again')

  // Leaving flashcards releases the window. Failures, timeouts and stale callbacks are safe.
  preloadWordIllustrations([])
  preloadWordIllustrations(ids.slice(0, 3))
  runNextTimer()
  const failed = activeImages()[0]
  finishImage(failed, false)
  assert.equal(activeImages().length, 2, 'A failed image must not block the next request')
  const staleFailure = activeImages()[0].onerror
  preloadWordIllustrations([])
  assert.equal(activeImages().length, 0, 'Switching lists must cancel obsolete background requests')
  assert.equal(timers.size, 0)
  preloadWordIllustrations(ids.slice(0, 1))
  runNextTimer()
  staleFailure()
  assert.equal(activeImages().length, 1, 'An old event must not delete a newer request')
  runNextTimer()
  assert.equal(activeImages().length, 0, 'A stalled request must be abandoned after eight seconds')
  preloadWordIllustrations(ids.slice(0, 1))
  runNextTimer()
  assert.equal(activeImages().length, 1, 'A timed-out image must allow a later retry')
  finishWindow()

  // Walk all available cards, then return: old image objects must not remain retained.
  preloadWordIllustrations([])
  const beforeWalk = requested.length
  for (let offset = 0; offset < ids.length; offset += 11) {
    preloadWordIllustrations(ids.slice(offset, offset + 11))
    runNextTimer()
    finishWindow()
  }
  assert.equal(requested.length - beforeWalk, ids.length)
  if (ids.length > 11) {
    const beforeReturn = requested.length
    preloadWordIllustrations(ids.slice(0, 1))
    runNextTimer()
    assert.equal(requested.length, beforeReturn + 1, 'Old decoded image references must be released, not retained for the whole book')
    finishWindow()
  }
  assert.equal(peakDownloads, 2)
  assert.ok(requested.every((image) => image.decoding === 'async' && image.fetchPriority === 'low'))
  preloadWordIllustrations([])
  assert.equal(timers.size, 0)
} finally {
  preloadWordIllustrations([])
  if (original.Image === undefined) delete globalThis.Image
  else globalThis.Image = original.Image
  globalThis.setTimeout = original.setTimeout
  globalThis.clearTimeout = original.clearTimeout
}

console.log(JSON.stringify({ valid: true, preloadWindow: 11, concurrentDownloads: peakDownloads, autoplayWithStalledImages: true, obsoleteRequestsCanceled: true, timeoutAndRetry: true }))
