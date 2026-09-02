export type AutoplayCardOptions = {
  minimumDurationMs: number
  isActive: () => boolean
  playEnglish: () => Promise<unknown>
  showMeaning: () => void
  playMandarin?: () => Promise<unknown>
  wait: (milliseconds: number) => Promise<void>
  now?: () => number
  pauseAfterSpeechMs?: number
}

export async function runAutoplayCard({
  minimumDurationMs,
  isActive,
  playEnglish,
  showMeaning,
  playMandarin,
  wait,
  now = Date.now,
  pauseAfterSpeechMs = 1_000,
}: AutoplayCardOptions) {
  const startedAt = now()
  await playEnglish()
  if (!isActive()) return false

  await wait(pauseAfterSpeechMs)
  if (!isActive()) return false
  showMeaning()

  if (playMandarin) await playMandarin()
  if (!isActive()) return false

  await wait(pauseAfterSpeechMs)
  if (!isActive()) return false

  const remaining = Math.max(0, minimumDurationMs - (now() - startedAt))
  if (remaining) await wait(remaining)
  return isActive()
}
