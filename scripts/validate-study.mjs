import assert from 'node:assert/strict'
import { runAutoplayCard } from '../src/autoplay.ts'
import {
  advanceQuiz,
  buildQuizOptions,
  calculateStreak,
  dueWordIds,
  emptyMemory,
  mergeMemory,
  normalizeMemory,
  normalizeSpelling,
  recordReview,
  setPosition,
  toggleFavorite,
} from '../src/study-memory.ts'

const dayMs = 86_400_000
const now = new Date(2026, 8, 1, 12, 0, 0).getTime()

let memory = emptyMemory()
memory = recordReview(memory, 'word-1', 'known', undefined, now)
assert.equal(memory.schedule['word-1'].intervalDays, 7)
assert.equal(memory.schedule['word-1'].dueAt, now + 7 * dayMs)
assert.equal(dueWordIds(memory, now).has('word-1'), false)

memory = recordReview(memory, 'word-2', 'again', undefined, now)
assert.equal(dueWordIds(memory, now).has('word-2'), true)
memory = recordReview(memory, 'word-3', 'hard', undefined, now)
assert.equal(memory.schedule['word-3'].intervalDays, 2)

memory = toggleFavorite(memory, 'word-2', now + 1)
assert.equal(memory.favorites['word-2'], true)
memory = toggleFavorite(memory, 'word-2', now + 2)
assert.equal(memory.favorites['word-2'], false)

let streakMemory = recordReview(emptyMemory(), 'yesterday', 'known', undefined, now - dayMs)
streakMemory = recordReview(streakMemory, 'today', 'known', 'correct', now)
assert.equal(calculateStreak(streakMemory, now), 2)
assert.equal(streakMemory.activity['2026-09-01'].quizCorrect, 1)

const remote = { ...memory, updatedAt: memory.updatedAt + 100, favorites: { remote: true } }
assert.equal(mergeMemory(memory, remote).favorites.remote, true)
assert.equal(mergeMemory(remote, memory).favorites.remote, true)

let deviceA = recordReview(emptyMemory(), 'device-a-word', 'known', undefined, now + 200, 'device-a')
deviceA = setPosition(deviceA, '1', 7, now + 201)
deviceA = toggleFavorite(deviceA, 'shared-favorite', now + 202)
let deviceB = recordReview(emptyMemory(), 'device-b-word', 'hard', 'correct', now + 300, 'device-b')
deviceB = setPosition(deviceB, '2', 9, now + 301)
deviceB = toggleFavorite(deviceB, 'shared-favorite', now + 302)
const concurrent = mergeMemory(deviceA, deviceB)
assert.equal(concurrent.schedule['device-a-word'].repetitions, 1)
assert.equal(concurrent.schedule['device-b-word'].repetitions, 1)
assert.equal(concurrent.positions['1'], 7)
assert.equal(concurrent.positions['2'], 9)
assert.equal(concurrent.favorites['shared-favorite'], true)
assert.equal(concurrent.activity['2026-09-01'].reviews, 2)
const favoriteRemoval = toggleFavorite(concurrent, 'shared-favorite', now + 400)
assert.equal(mergeMemory(concurrent, favoriteRemoval).favorites['shared-favorite'], false)

const migratedLegacy = normalizeMemory({
  version: 3,
  recall: {},
  positions: { '1': 2 },
  schedule: {},
  favorites: { legacy: true },
  activity: { '2026-08-31': { reviews: 4, known: 2, quizCorrect: 1, quizWrong: 1 } },
  updatedAt: now,
})
assert.equal(migratedLegacy.version, 4)
assert.equal(migratedLegacy.activity['2026-08-31'].reviews, 4)
assert.equal(migratedLegacy.positionUpdatedAt['1'], now)

const quizWords = [
  { sourceNo: 1, word: 'abate', meaning: '減弱', root: 'bate 減少' },
  { sourceNo: 2, word: 'acerbic', meaning: '尖酸的', root: 'acerb 尖酸' },
  { sourceNo: 3, word: 'benevolent', meaning: '仁慈的', root: 'ben 好' },
  { sourceNo: 4, word: 'vacuous', meaning: '空洞的', root: 'vacu 空' },
]
const meaningOptions = buildQuizOptions(quizWords[0], quizWords, 'meaning')
assert.equal(meaningOptions.length, 4)
assert.equal(new Set(meaningOptions).size, 4)
assert.equal(meaningOptions.includes('減弱'), true)
assert.equal(normalizeSpelling(' Abate '), 'abate')

const wrongAdvance = advanceQuiz(['word-1', 'word-2'], 0, 'word-1', false)
assert.deepEqual(wrongAdvance, { queue: ['word-1', 'word-2', 'word-1'], nextIndex: 1, complete: false })
const finalAdvance = advanceQuiz(['word-1', 'word-2'], 1, 'word-2', true)
assert.equal(finalAdvance.complete, true)

let autoplayClock = 0
const autoplayEvents = []
const autoplayAdvanced = await runAutoplayCard({
  minimumDurationMs: 5_000,
  isActive: () => true,
  playEnglish: async () => { autoplayClock += 800; autoplayEvents.push('english-ended') },
  showMeaning: () => autoplayEvents.push('meaning-shown'),
  playMandarin: async () => { autoplayClock += 700; autoplayEvents.push('mandarin-ended') },
  wait: async (milliseconds) => { autoplayClock += milliseconds; autoplayEvents.push(`wait-${milliseconds}`) },
  now: () => autoplayClock,
})
assert.equal(autoplayAdvanced, true)
assert.equal(autoplayClock, 5_000)
assert.deepEqual(autoplayEvents, [
  'english-ended',
  'wait-1000',
  'meaning-shown',
  'mandarin-ended',
  'wait-1000',
  'wait-1500',
])

let delayedClock = 0
const delayedAdvanced = await runAutoplayCard({
  minimumDurationMs: 5_000,
  isActive: () => true,
  playEnglish: async () => { delayedClock += 3_000 },
  showMeaning: () => undefined,
  playMandarin: async () => { delayedClock += 2_500 },
  wait: async (milliseconds) => { delayedClock += milliseconds },
  now: () => delayedClock,
})
assert.equal(delayedAdvanced, true)
assert.equal(delayedClock, 7_500)

let active = true
let meaningShownAfterCancel = false
const canceledAdvance = await runAutoplayCard({
  minimumDurationMs: 5_000,
  isActive: () => active,
  playEnglish: async () => { active = false },
  showMeaning: () => { meaningShownAfterCancel = true },
  wait: async () => undefined,
  now: () => 0,
})
assert.equal(canceledAdvance, false)
assert.equal(meaningShownAfterCancel, false)

console.log(JSON.stringify({
  valid: true,
  spacedReview: true,
  favorites: true,
  streaks: true,
  quizChoices: true,
  wrongAnswersReturnToQueue: true,
  concurrentDeviceMerge: true,
  legacyProgressMigration: true,
  autoplayWaitsForSpeech: true,
  autoplayMinimumDuration: true,
  autoplayCancellation: true,
}, null, 2))
