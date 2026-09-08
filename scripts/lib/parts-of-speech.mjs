import partsOfSpeech from '../../data/parts-of-speech.json' with { type: 'json' }

export function getPartOfSpeech(word) {
  const label = partsOfSpeech.words[String(word).trim().toLowerCase()]
  if (!label) throw new Error(`Missing verified part of speech: ${word}`)
  return label
}
