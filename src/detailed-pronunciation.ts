export type PronunciationMode = 'general' | 'detailed'

// Speak letter names, not phonics. Explicit names avoid reading isolated A as
// the article "a" or I as part of the surrounding word. US English uses "zee".
const LETTER_NAMES: Record<string, string> = {
  A: 'ay', B: 'bee', C: 'see', D: 'dee', E: 'ee', F: 'eff', G: 'jee',
  H: 'aitch', I: 'eye', J: 'jay', K: 'kay', L: 'ell', M: 'em', N: 'en',
  O: 'oh', P: 'pee', Q: 'cue', R: 'ar', S: 'ess', T: 'tee', U: 'you',
  V: 'vee', W: 'double you', X: 'ex', Y: 'why', Z: 'zee',
}

export function pronunciationSteps(word: string, mode: PronunciationMode) {
  const fullWord = { text: word, letter: null as string | null }
  if (mode === 'general') return [fullWord]
  const letters = [...word.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()]
    .filter((letter) => /^[A-Z]$/.test(letter))
    .map((letter) => ({ text: LETTER_NAMES[letter], letter }))
  return [fullWord, ...letters, fullWord]
}

export async function runEnglishPronunciation({
  word, mode, speak, isActive,
}: {
  word: string
  mode: PronunciationMode
  speak: (text: string, letter: string | null) => Promise<boolean>
  isActive: () => boolean
}) {
  for (const step of pronunciationSteps(word, mode)) {
    if (!isActive()) return false
    if (!await speak(step.text, step.letter) || !isActive()) return false
  }
  return true
}
