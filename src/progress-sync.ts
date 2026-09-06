import { emptyMemory, loadMemory, mergeMemory, normalizeMemory, saveMemory, type DeckId, type MemoryStore } from './study-memory.ts'

export type SyncStatus = 'loading' | 'synced' | 'offline' | 'blocked'
type DeckState = { memory: MemoryStore; status: SyncStatus; loaded: boolean; localSaved: boolean }
type Snapshot = Record<DeckId, DeckState>
type ProgressPayload = { progress?: unknown; revision: number; error?: string }
type SyncOptions = {
  fetch: typeof fetch
  read?: (deck: DeckId, email: string) => MemoryStore
  write?: (deck: DeckId, memory: MemoryStore, email: string) => boolean
  debounceMs?: number
  retryMs?: number
  requestTimeoutMs?: number
}
const DECKS: DeckId[] = ['words1000', 'words2000']

export function createProgressSync(email: string, options: SyncOptions) {
  const read = options.read ?? loadMemory
  const write = options.write ?? saveMemory
  const initial = (deck: DeckId): DeckState => ({ memory: read(deck, email), status: 'loading', loaded: false, localSaved: true })
  let snapshot: Snapshot = { words1000: initial('words1000'), words2000: initial('words2000') }
  const listeners = new Set<() => void>()
  const lanes = Object.fromEntries(DECKS.map((deck) => [deck, {
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    controller: null as AbortController | null,
    failures: 0,
    dirty: false,
  }])) as Record<DeckId, { timer?: ReturnType<typeof setTimeout>; controller: AbortController | null; failures: number; dirty: boolean }>
  let running = false
  let generation = 0

  function publish(deck: DeckId, state: Partial<DeckState>) {
    snapshot = { ...snapshot, [deck]: { ...snapshot[deck], ...state } }
    listeners.forEach((listener) => listener())
  }

  function persist(deck: DeckId, memory: MemoryStore) {
    const localSaved = write(deck, memory, email)
    publish(deck, { memory, localSaved })
  }

  function schedule(deck: DeckId, delay = options.debounceMs ?? 650) {
    const lane = lanes[deck]
    clearTimeout(lane.timer)
    if (!running || snapshot[deck].status === 'blocked') return
    lane.timer = setTimeout(() => void sync(deck), delay)
  }

  async function sync(deck: DeckId) {
    const lane = lanes[deck]
    if (!running || snapshot[deck].status === 'blocked') return
    if (lane.controller) { lane.dirty = true; return }
    clearTimeout(lane.timer)
    lane.dirty = false
    const controller = new AbortController()
    lane.controller = controller
    const run = generation
    const active = () => running && generation === run
    const blocked = () => snapshot[deck].status === 'blocked'
    const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs ?? 15_000)
    publish(deck, { status: 'loading' })
    try {
      const request = async (init: RequestInit = {}) => {
        const response = await options.fetch(`/api/progress?deck=${deck}`, {
          ...init,
          signal: controller.signal,
          headers: { 'x-gre-account-email': email, ...init.headers },
        })
        if (response.status === 401 || response.status === 403) {
          if (active()) publish(deck, { status: 'blocked' })
          throw new Error('Account is no longer authorized')
        }
        return response
      }
      const response = await request()
      if (!response.ok) throw new Error(`Progress load failed: ${response.status}`)
      const remote = await response.json() as ProgressPayload
      if (!active()) return
      // Read the latest in-memory value after the request: study actions made
      // while the initial GET was pending must not be overwritten.
      const merged = mergeMemory(mergeMemory(snapshot[deck].memory, read(deck, email)), remote.progress)
      persist(deck, merged)
      publish(deck, { loaded: true })
      const serialized = JSON.stringify(merged)
      if (serialized !== JSON.stringify(normalizeMemory(remote.progress))) {
        const saved = await request({
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ progress: merged, baseRevision: Number(remote.revision) || 0 }),
        })
        if (!active()) return
        if (saved.status === 409) {
          const conflict = await saved.json() as ProgressPayload
          if (!active()) return
          persist(deck, mergeMemory(snapshot[deck].memory, conflict.progress))
          lane.dirty = true
        } else {
          if (!saved.ok) throw new Error(`Progress save failed: ${saved.status}`)
          if (serialized !== JSON.stringify(snapshot[deck].memory)) lane.dirty = true
        }
      }
      lane.failures = 0
      publish(deck, { status: lane.dirty ? 'loading' : 'synced' })
    } catch {
      if (!active() || blocked()) return
      lane.failures += 1
      publish(deck, { status: 'offline' })
    } finally {
      clearTimeout(timeout)
      if (active()) {
        lane.controller = null
        if (snapshot[deck].status === 'offline') schedule(deck, Math.min(30_000, (options.retryMs ?? 2_000) * 2 ** Math.min(lane.failures - 1, 4)))
        else if (lane.dirty) schedule(deck, 0)
      }
    }
  }

  function refresh() { DECKS.forEach((deck) => void sync(deck)) }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    start() { running = true; generation += 1; refresh() },
    stop() {
      running = false
      generation += 1
      DECKS.forEach((deck) => {
        clearTimeout(lanes[deck].timer)
        lanes[deck].controller?.abort()
        lanes[deck].controller = null
      })
    },
    refresh,
    update(deck: DeckId, change: (current: MemoryStore) => MemoryStore) {
      persist(deck, change(snapshot[deck].memory))
      if (lanes[deck].controller) lanes[deck].dirty = true
      if (snapshot[deck].status !== 'blocked') publish(deck, { status: 'loading' })
      schedule(deck)
    },
  }
}

export const EMPTY_PROGRESS = emptyMemory()
