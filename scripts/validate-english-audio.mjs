import fs from 'node:fs'

const manifest = JSON.parse(fs.readFileSync(new URL('../src/wikimedia-english-audio.json', import.meta.url), 'utf8'))
const acceptedLicenses = new Set([
  'CC BY-SA 4.0',
  'CC BY-SA 3.0',
  'CC BY 4.0',
  'CC BY 3.0',
  'CC BY 3.0 US',
  'CC BY 2.5',
  'CC0',
  'Public domain',
])
const words = new Set()
const deckWords = new Map()
for (const [deckId, relativePath] of [
  ['words1000', '../data/vocabulary-1000.json'],
  ['words2000', '../data/vocabulary.json'],
]) {
  const deck = JSON.parse(fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'))
  const currentWords = new Set()
  for (const word of deck.words) {
    const key = word.word.trim().toLocaleLowerCase('en-US')
    words.add(key)
    currentWords.add(key)
  }
  deckWords.set(deckId, currentWords)
}

for (const [word, recording] of Object.entries(manifest.recordings)) {
  if (!words.has(word)) throw new Error(`English recording has no exact GRE word match: ${word}`)
  if (!acceptedLicenses.has(recording.license)) throw new Error(`Unapproved audio license for ${word}: ${recording.license}`)
  if (!recording.artist || !recording.sourceUrl || !recording.licenseUrl) throw new Error(`Incomplete attribution for ${word}`)
  if (!recording.sourceUrl.startsWith('https://commons.wikimedia.org/')) throw new Error(`Non-Commons source for ${word}`)
  if (!recording.url.startsWith('https://upload.wikimedia.org/wikipedia/commons/transcoded/')) {
    throw new Error(`Unexpected Wikimedia MP3 URL for ${word}`)
  }
}

if (manifest.recordingCount !== Object.keys(manifest.recordings).length) throw new Error('English recording count mismatch')
if (manifest.usRecordingCount + manifest.otherEnglishRecordingCount !== manifest.recordingCount) {
  throw new Error('English accent counts do not match the recording count')
}
if (manifest.recordingCount < 1_000) throw new Error(`Unexpectedly low human recording coverage: ${manifest.recordingCount}`)
if (!fs.existsSync(new URL('../public/audio/wikimedia/en/attribution.json', import.meta.url))) {
  throw new Error('English recording attribution file is missing')
}

const deckCoverage = Object.fromEntries([...deckWords].map(([deckId, currentWords]) => {
  const humanRecordings = [...currentWords].filter((word) => manifest.recordings[word]).length
  return [deckId, {
    uniqueWords: currentWords.size,
    humanRecordings,
    aiFallbackWords: currentWords.size - humanRecordings,
  }]
}))

console.log(JSON.stringify({
  valid: true,
  uniqueGreWords: words.size,
  humanRecordings: manifest.recordingCount,
  usHumanRecordings: manifest.usRecordingCount,
  otherEnglishHumanRecordings: manifest.otherEnglishRecordingCount,
  aiFallbackWords: words.size - manifest.recordingCount,
  deckCoverage,
}, null, 2))
