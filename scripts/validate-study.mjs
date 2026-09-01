import assert from 'node:assert/strict'
import {
  advanceQuiz,
  buildQuizOptions,
  calculateStreak,
  dueWordIds,
  emptyMemory,
  mergeMemory,
  normalizeSpelling,
  recordReview,
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
assert.equal(memory.favorites['word-2'], undefined)

let streakMemory = recordReview(emptyMemory(), 'yesterday', 'known', undefined, now - dayMs)
streakMemory = recordReview(streakMemory, 'today', 'known', 'correct', now)
assert.equal(calculateStreak(streakMemory, now), 2)
assert.equal(streakMemory.activity['2026-09-01'].quizCorrect, 1)

const remote = { ...memory, updatedAt: memory.updatedAt + 100, favorites: { remote: true } }
assert.equal(mergeMemory(memory, remote).favorites.remote, true)
assert.equal(mergeMemory(remote, memory).favorites.remote, true)

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

console.log(JSON.stringify({
  valid: true,
  spacedReview: true,
  favorites: true,
  streaks: true,
  quizChoices: true,
  wrongAnswersReturnToQueue: true,
}, null, 2))
