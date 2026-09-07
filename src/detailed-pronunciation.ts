export type PronunciationMode = 'general' | 'detailed'

export const LETTER_GAP_SECONDS = 0.1
export const WORD_GAP_MS = 300

export function spellingLetters(word: string) {
  return [...word.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()]
    .filter((letter) => /^[A-Z]$/.test(letter))
}

export function letterTimeline(letters: string[], durations: Record<string, number>) {
  let start = 0
  return letters.map((letter) => {
    const duration = durations[letter]
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Missing letter audio: ${letter}`)
    const entry = { letter, start, duration }
    start += duration + LETTER_GAP_SECONDS
    return entry
  })
}

export async function runEnglishPronunciation({
  word, mode, speak, spell, wait, isActive,
}: {
  word: string
  mode: PronunciationMode
  speak: (text: string) => Promise<boolean>
  spell: (letters: string[]) => Promise<boolean>
  wait: (milliseconds: number) => Promise<void>
  isActive: () => boolean
}) {
  if (!isActive() || !await speak(word) || !isActive()) return false
  if (mode === 'general') return true
  await wait(WORD_GAP_MS)
  if (!isActive() || !await spell(spellingLetters(word)) || !isActive()) return false
  await wait(WORD_GAP_MS)
  if (!isActive() || !await speak(word) || !isActive()) return false
  return true
}
