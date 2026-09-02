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
  version: 4
  recall: Record<string, RecallState>
  positions: Record<string, number>
  positionUpdatedAt: Record<string, number>
  schedule: Record<string, ReviewSchedule>
  favorites: Record<string, boolean>
  favoriteUpdatedAt: Record<string, number>
  activity: Record<string, ActivityDay>
  activityDevices: Record<string, Record<string, ActivityDay>>
  updatedAt: number
}

const LEGACY_STORAGE_KEY = 'gre-roots-progress-v1'
const STORAGE_KEY_PREFIX = 'gre-roots-progress-v2'
const DEVICE_STORAGE_KEY = 'gre-roots-device-id-v1'
const DAY_MS = 86_400_000
let fallbackDeviceId = ''

export function emptyMemory(): MemoryStore {
  return {
    version: 4,
    recall: {},
    positions: {},
    positionUpdatedAt: {},
    schedule: {},
    favorites: {},
    favoriteUpdatedAt: {},
    activity: {},
    activityDevices: {},
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
  const rawPositionUpdatedAt = isRecord(value.positionUpdatedAt) ? value.positionUpdatedAt as Record<string, number> : {}
  const schedule = isRecord(value.schedule) ? value.schedule as Record<string, ReviewSchedule> : {}
  const favorites = isRecord(value.favorites) ? value.favorites as Record<string, boolean> : {}
  const rawFavoriteUpdatedAt = isRecord(value.favoriteUpdatedAt) ? value.favoriteUpdatedAt as Record<string, number> : {}
  const legacyActivity = isRecord(value.activity) ? value.activity as Record<string, ActivityDay> : {}
  const rawActivityDevices = isRecord(value.activityDevices)
    ? value.activityDevices as Record<string, Record<string, ActivityDay>>
    : {}
  const updatedAt = Number(value.updatedAt)
  const safeUpdatedAt = Number.isFinite(updatedAt) && updatedAt >= 0 ? updatedAt : 0
  const positionUpdatedAt = Object.fromEntries(
    Object.keys(positions).map((key) => [key, safeTimestamp(rawPositionUpdatedAt[key], safeUpdatedAt)]),
  )
  const favoriteUpdatedAt = Object.fromEntries(
    Object.keys(favorites).map((key) => [key, safeTimestamp(rawFavoriteUpdatedAt[key], safeUpdatedAt)]),
  )
  const activityDevices = Object.keys(rawActivityDevices).length
    ? normalizeActivityDevices(rawActivityDevices)
    : Object.keys(legacyActivity).length
      ? { legacy: normalizeActivity(legacyActivity) }
      : {}
  return {
    version: 4,
    recall,
    positions,
    positionUpdatedAt,
    schedule,
    favorites,
    favoriteUpdatedAt,
    activity: aggregateActivity(activityDevices),
    activityDevices,
    updatedAt: safeUpdatedAt,
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

export function mergeMemory(local: MemoryStore, remote: unknown): MemoryStore {
  const normalizedLocal = normalizeMemory(local)
  const normalizedRemote = normalizeMemory(remote)
  const positions: Record<string, number> = {}
  const positionUpdatedAt: Record<string, number> = {}
  for (const key of new Set([...Object.keys(normalizedLocal.positions), ...Object.keys(normalizedRemote.positions)])) {
    const localTimestamp = normalizedLocal.positionUpdatedAt[key] ?? 0
    const remoteTimestamp = normalizedRemote.positionUpdatedAt[key] ?? 0
    const useRemote = remoteTimestamp > localTimestamp || (
      remoteTimestamp === localTimestamp && normalizedRemote.updatedAt > normalizedLocal.updatedAt
    )
    positions[key] = useRemote ? normalizedRemote.positions[key] : normalizedLocal.positions[key]
    positionUpdatedAt[key] = Math.max(localTimestamp, remoteTimestamp)
  }

  const favorites: Record<string, boolean> = {}
  const favoriteUpdatedAt: Record<string, number> = {}
  for (const key of new Set([...Object.keys(normalizedLocal.favorites), ...Object.keys(normalizedRemote.favorites)])) {
    const localTimestamp = normalizedLocal.favoriteUpdatedAt[key] ?? 0
    const remoteTimestamp = normalizedRemote.favoriteUpdatedAt[key] ?? 0
    const useRemote = remoteTimestamp > localTimestamp || (
      remoteTimestamp === localTimestamp && normalizedRemote.updatedAt > normalizedLocal.updatedAt
    )
    favorites[key] = useRemote ? Boolean(normalizedRemote.favorites[key]) : Boolean(normalizedLocal.favorites[key])
    favoriteUpdatedAt[key] = Math.max(localTimestamp, remoteTimestamp)
  }

  const recall: Record<string, RecallState> = {}
  const schedule: Record<string, ReviewSchedule> = {}
  const wordIds = new Set([
    ...Object.keys(normalizedLocal.recall),
    ...Object.keys(normalizedRemote.recall),
    ...Object.keys(normalizedLocal.schedule),
    ...Object.keys(normalizedRemote.schedule),
  ])
  for (const wordId of wordIds) {
    const localSchedule = normalizedLocal.schedule[wordId]
    const remoteSchedule = normalizedRemote.schedule[wordId]
    const localReviewedAt = Number(localSchedule?.lastReviewedAt) || 0
    const remoteReviewedAt = Number(remoteSchedule?.lastReviewedAt) || 0
    const useRemote = remoteReviewedAt > localReviewedAt || (
      remoteReviewedAt === localReviewedAt && Number(remoteSchedule?.repetitions ?? 0) > Number(localSchedule?.repetitions ?? 0)
    ) || (
      remoteReviewedAt === localReviewedAt && Number(remoteSchedule?.repetitions ?? 0) === Number(localSchedule?.repetitions ?? 0) &&
      normalizedRemote.updatedAt > normalizedLocal.updatedAt
    )
    const selectedSchedule = useRemote ? remoteSchedule : localSchedule
    const selectedRecall = useRemote ? normalizedRemote.recall[wordId] : normalizedLocal.recall[wordId]
    if (selectedSchedule) schedule[wordId] = selectedSchedule
    if (selectedRecall) recall[wordId] = selectedRecall
  }

  const activityDevices = mergeActivityDevices(normalizedLocal.activityDevices, normalizedRemote.activityDevices)
  return {
    version: 4,
    recall,
    positions,
    positionUpdatedAt,
    schedule,
    favorites,
    favoriteUpdatedAt,
    activity: aggregateActivity(activityDevices),
    activityDevices,
    updatedAt: Math.max(normalizedLocal.updatedAt, normalizedRemote.updatedAt),
  }
}

export function getOrCreateDeviceId() {
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(DEVICE_STORAGE_KEY)
      if (saved) return saved
      const created = createDeviceId()
      window.localStorage.setItem(DEVICE_STORAGE_KEY, created)
      return created
    } catch {
      // Fall through to an in-memory identifier when browser storage is unavailable.
    }
  }
  if (!fallbackDeviceId) fallbackDeviceId = createDeviceId()
  return fallbackDeviceId
}

export function setPosition(memory: MemoryStore, partId: string, position: number, now = Date.now()): MemoryStore {
  return {
    ...memory,
    positions: { ...memory.positions, [partId]: position },
    positionUpdatedAt: { ...memory.positionUpdatedAt, [partId]: now },
    updatedAt: now,
  }
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
  deviceId = 'legacy',
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
  const deviceActivity = memory.activityDevices[deviceId]?.[today] ?? {
    reviews: 0,
    known: 0,
    quizCorrect: 0,
    quizWrong: 0,
  }
  const nextDeviceActivity = incrementActivity(deviceActivity, recall, quizResult)

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
      [today]: incrementActivity(activity, recall, quizResult),
    },
    activityDevices: {
      ...memory.activityDevices,
      [deviceId]: {
        ...memory.activityDevices[deviceId],
        [today]: nextDeviceActivity,
      },
    },
    updatedAt: now,
  }
}

export function toggleFavorite(memory: MemoryStore, wordId: string, now = Date.now()): MemoryStore {
  return {
    ...memory,
    favorites: { ...memory.favorites, [wordId]: !memory.favorites[wordId] },
    favoriteUpdatedAt: { ...memory.favoriteUpdatedAt, [wordId]: now },
    updatedAt: now,
  }
}

function createDeviceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function safeTimestamp(value: unknown, fallback: number) {
  const timestamp = Number(value)
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : fallback
}

function normalizeActivity(activity: Record<string, ActivityDay>) {
  return Object.fromEntries(
    Object.entries(activity).map(([date, day]) => [date, normalizeActivityDay(day)]),
  )
}

function normalizeActivityDevices(value: Record<string, Record<string, ActivityDay>>) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, activity]) => isRecord(activity))
      .map(([deviceId, activity]) => [deviceId, normalizeActivity(activity)]),
  )
}

function normalizeActivityDay(value: unknown): ActivityDay {
  const day = isRecord(value) ? value : {}
  return {
    reviews: nonNegativeInteger(day.reviews),
    known: nonNegativeInteger(day.known),
    quizCorrect: nonNegativeInteger(day.quizCorrect),
    quizWrong: nonNegativeInteger(day.quizWrong),
  }
}

function nonNegativeInteger(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
}

function incrementActivity(day: ActivityDay, recall: RecallState, quizResult?: 'correct' | 'wrong') {
  return {
    reviews: day.reviews + 1,
    known: day.known + (recall === 'known' ? 1 : 0),
    quizCorrect: day.quizCorrect + (quizResult === 'correct' ? 1 : 0),
    quizWrong: day.quizWrong + (quizResult === 'wrong' ? 1 : 0),
  }
}

function mergeActivityDevices(
  local: Record<string, Record<string, ActivityDay>>,
  remote: Record<string, Record<string, ActivityDay>>,
) {
  const merged: Record<string, Record<string, ActivityDay>> = {}
  for (const deviceId of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const localActivity = local[deviceId] ?? {}
    const remoteActivity = remote[deviceId] ?? {}
    merged[deviceId] = {}
    for (const date of new Set([...Object.keys(localActivity), ...Object.keys(remoteActivity)])) {
      const localDay = normalizeActivityDay(localActivity[date])
      const remoteDay = normalizeActivityDay(remoteActivity[date])
      merged[deviceId][date] = {
        reviews: Math.max(localDay.reviews, remoteDay.reviews),
        known: Math.max(localDay.known, remoteDay.known),
        quizCorrect: Math.max(localDay.quizCorrect, remoteDay.quizCorrect),
        quizWrong: Math.max(localDay.quizWrong, remoteDay.quizWrong),
      }
    }
  }
  return merged
}

function aggregateActivity(activityDevices: Record<string, Record<string, ActivityDay>>) {
  const aggregate: Record<string, ActivityDay> = {}
  for (const deviceActivity of Object.values(activityDevices)) {
    for (const [date, rawDay] of Object.entries(deviceActivity)) {
      const day = normalizeActivityDay(rawDay)
      const current = aggregate[date] ?? { reviews: 0, known: 0, quizCorrect: 0, quizWrong: 0 }
      aggregate[date] = {
        reviews: current.reviews + day.reviews,
        known: current.known + day.known,
        quizCorrect: current.quizCorrect + day.quizCorrect,
        quizWrong: current.quizWrong + day.quizWrong,
      }
    }
  }
  return aggregate
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
