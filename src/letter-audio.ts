import { letterTimeline } from './detailed-pronunciation.ts'

export function createLetterAudioPlayer(
  createContext: () => AudioContext = () => new window.AudioContext(),
  fetchAudio: (url: string) => Promise<ArrayBuffer> = async (url) => {
    const response = await fetch(url, { cache: 'force-cache', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`Letter audio HTTP ${response.status}`)
    return response.arrayBuffer()
  },
) {
  let context: AudioContext | null = null
  let loading: Promise<Map<string, AudioBuffer>> | null = null
  let generation = 0
  let cancelPlaying: (() => void) | null = null
  const getContext = () => context ??= createContext()
  const preload = async () => {
    if (!loading) {
      const audioContext = getContext()
      loading = Promise.all([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(async (letter) => {
        const bytes = await fetchAudio(`/audio/letters-v2/${letter}.wav`)
        return [letter, await audioContext.decodeAudioData(bytes)] as const
      })).then((entries) => new Map(entries)).catch((error) => {
        loading = null
        throw error
      })
    }
    return loading
  }
  const stop = () => {
    generation += 1
    cancelPlaying?.()
    cancelPlaying = null
  }
  return {
    preload,
    // Resume synchronously from a user gesture, before network/await boundaries.
    unlock: async () => { await getContext().resume() },
    stop,
    dispose: () => { stop(); void context?.close().catch(() => undefined) },
    async play(letters: string[], onLetter: (letter: string | null) => void): Promise<boolean> {
      stop()
      const request = generation
      try {
        const buffers = await preload()
        if (request !== generation) return false
        const audioContext = getContext()
        if (audioContext.state !== 'running') return false
        if (!letters.length) return true
        const timeline = letterTimeline(letters, Object.fromEntries([...buffers].map(([letter, buffer]) => [letter, buffer.duration])))
        return await new Promise<boolean>((resolve) => {
          const sources: AudioBufferSourceNode[] = []
          const timers: ReturnType<typeof setTimeout>[] = []
          let settled = false
          const finish = (played: boolean) => {
            if (settled) return
            settled = true
            for (const timer of timers) clearTimeout(timer)
            for (const source of sources) {
              source.onended = null
              try { source.stop() } catch { /* Already stopped. */ }
              source.disconnect()
            }
            cancelPlaying = null
            onLetter(null)
            resolve(played)
          }
          cancelPlaying = () => finish(false)
          try {
            const startsAt = audioContext.currentTime + .02
            timeline.forEach(({ letter, start }, index) => {
              const source = audioContext.createBufferSource()
              sources.push(source)
              source.buffer = buffers.get(letter)!
              source.connect(audioContext.destination)
              if (index === timeline.length - 1) source.onended = () => finish(true)
              // Separate scheduled recordings, including repeated letters.
              source.start(startsAt + start)
              timers.push(setTimeout(() => onLetter(letter), (start + .02) * 1000))
            })
            const last = timeline[timeline.length - 1]
            timers.push(setTimeout(() => finish(false), (last.start + last.duration + 5) * 1000))
          } catch {
            finish(false)
          }
        })
      } catch {
        return false
      }
    },
  }
}
