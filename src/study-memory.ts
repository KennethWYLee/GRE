export type RecallState = 'again' | 'hard' | 'known'
export type DeckId = 'words1000' | 'words2000'
export type QuizKind = 'meaning' | 'root' | 'spelling'

export type QuizWord = {
  sourceNo: number
  word: string
  meaning: string
  root: string
}

export type ReviewSchedule = {
  dueAt: number
  intervalDays: number
  lastReviewedAt: number
  repetitions: number
}

export type ActivityDay = {
  reviews: number
  known: number
  quizCorrect: number
  quizWrong: number
}

export type MemoryStore = {
  version: 3
  recall: Record<string, RecallState>
  positions: Record<string, number>
  schedule: Record<string, ReviewSchedule>
  favorites: Record<string, boolean>
  activity: Record<string, ActivityDay>
  updatedAt: number
}

const LEGACY_STORAGE_KEY = 'gre-roots-progress-v1'
const STORAGE_KEY_PREFIX = 'gre-roots-progress-v2'
const DAY_MS = 86_400_000

export function emptyMemory(): MemoryStore {
  return {
    version: 3,
    recall: {},
    positions: {},
    schedule: {},
    favorites: {},
    activity: {},
    updatedAt: 0,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeMemory(value: unknown): MemoryStore {
  if (!isRecord(value)) return emptyMemory()
  const recall = isRecord(value.recall) ? value.recall as Record<string, RecallState> : {}
  const positions = isRecord(value.positions) ? value.positions as Record<string, number> : {}
  const schedule = isRecord(value.schedule) ? value.schedule as Record<string, ReviewSchedule> : {}
  const favorites = isRecord(value.favorites) ? value.favorites as Record<string, boolean> : {}
  const activity = isRecord(value.activity) ? value.activity as Record<string, ActivityDay> : {}
  const updatedAt = Number(value.updatedAt)
  return {
    version: 3,
    recall,
    positions,
    schedule,
    favorites,
    activity,
    updatedAt: Number.isFinite(updatedAt) && updatedAt >= 0 ? updatedAt : 0,
  }
}

export function loadMemory(deckId: DeckId): MemoryStore {
  try {
    const storageKey = `${STORAGE_KEY_PREFIX}-${deckId}`
    const saved = window.localStorage.getItem(storageKey) ??
      (deckId === 'words2000' ? window.localStorage.getItem(LEGACY_STORAGE_KEY) : null)
    return saved ? normalizeMemory(JSON.parse(saved)) : emptyMemory()
  } catch {
    return emptyMemory()
  }
}

export function saveMemory(deckId: DeckId, memory: MemoryStore) {
  window.localStorage.setItem(`${STORAGE_KEY_PREFIX}-${deckId}`, JSON.stringify(memory))
}

export function mergeMemory(local: MemoryStore, remote: unknown) {
  const normalizedRemote = normalizeMemory(remote)
  return normalizedRemote.updatedAt > local.updatedAt ? normalizedRemote : local
}

export function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function recordReview(
  memory: MemoryStore,
  wordId: string,
  recall: RecallState,
  quizResult?: 'correct' | 'wrong',
  now = Date.now(),
): MemoryStore {
  const previous = memory.schedule[wordId]
  const previousInterval = previous?.intervalDays ?? 0
  const intervalDays = recall === 'again'
    ? 0
    : recall === 'hard'
      ? Math.max(2, Math.round(previousInterval * 1.5))
      : Math.min(60, previousInterval ? Math.max(7, previousInterval * 2) : 7)
  const today = localDateKey(now)
  const activity = memory.activity[today] ?? { reviews: 0, known: 0, quizCorrect: 0, quizWrong: 0 }

  return {
    ...memory,
    recall: { ...memory.recall, [wordId]: recall },
    schedule: {
      ...memory.schedule,
      [wordId]: {
        dueAt: recall === 'again' ? now : now + intervalDays * DAY_MS,
        intervalDays,
        lastReviewedAt: now,
        repetitions: (previous?.repetitions ?? 0) + 1,
      },
    },
    activity: {
      ...memory.activity,
      [today]: {
        reviews: activity.reviews + 1,
        known: activity.known + (recall === 'known' ? 1 : 0),
        quizCorrect: activity.quizCorrect + (quizResult === 'correct' ? 1 : 0),
        quizWrong: activity.quizWrong + (quizResult === 'wrong' ? 1 : 0),
      },
    },
    updatedAt: now,
  }
}

export function toggleFavorite(memory: MemoryStore, wordId: string, now = Date.now()): MemoryStore {
  const favorites = { ...memory.favorites }
  if (favorites[wordId]) delete favorites[wordId]
  else favorites[wordId] = true
  return { ...memory, favorites, updatedAt: now }
}

export function dueWordIds(memory: MemoryStore, now = Date.now()) {
  return new Set(
    Object.entries(memory.schedule)
      .filter(([, schedule]) => Number(schedule?.dueAt) <= now)
      .map(([wordId]) => wordId),
  )
}

export function calculateStreak(memory: MemoryStore, now = Date.now()) {
  const activeDates = new Set(
    Object.entries(memory.activity)
      .filter(([, activity]) => Number(activity?.reviews) > 0)
      .map(([date]) => date),
  )
  if (!activeDates.size) return 0

  const cursor = new Date(now)
  if (!activeDates.has(localDateKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (activeDates.has(localDateKey(cursor.getTime()))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export function quizValue(word: QuizWord, kind: QuizKind) {
  if (kind === 'meaning') return word.meaning
  if (kind === 'root') return word.root === 'S' ? 'S · 無字根' : word.root
  return word.word
}

export function buildQuizOptions(activeWord: QuizWord, pool: QuizWord[], kind: Exclude<QuizKind, 'spelling'>) {
  const correct = quizValue(activeWord, kind)
  const candidates = [...new Set(pool.map((word) => quizValue(word, kind)).filter((value) => value !== correct))]
  let seed = activeWord.sourceNo * 31 + (kind === 'meaning' ? 7 : 13)
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const target = seed % (index + 1)
    ;[candidates[index], candidates[target]] = [candidates[target], candidates[index]]
  }
  const options = [correct, ...candidates.slice(0, 3)]
  return options.sort((a, b) => {
    const aScore = [...a].reduce((sum, character) => sum + character.charCodeAt(0), seed)
    const bScore = [...b].reduce((sum, character) => sum + character.charCodeAt(0), seed)
    return aScore - bScore
  })
}

export function normalizeSpelling(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[’‘]/g, "'")
}

export function advanceQuiz(queue: string[], index: number, wordId: string, correct: boolean) {
  if (correct && index >= queue.length - 1) return { queue, nextIndex: index, complete: true }
  return {
    queue: correct ? queue : [...queue, wordId],
    nextIndex: index + 1,
    complete: false,
  }
}
