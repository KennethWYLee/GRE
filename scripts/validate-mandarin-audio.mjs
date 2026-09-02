import { createHash } from 'node:crypto'
import fs from 'node:fs'

const manifest = JSON.parse(fs.readFileSync(new URL('../src/moe-mandarin-audio.json', import.meta.url), 'utf8'))
const wikimediaManifest = JSON.parse(fs.readFileSync(new URL('../src/wikimedia-mandarin-audio.json', import.meta.url), 'utf8'))
const sourceFiles = [
  { id: 'words1000', url: new URL('../data/vocabulary-1000.json', import.meta.url) },
  { id: 'words2000', url: new URL('../data/vocabulary.json', import.meta.url) },
]

const acceptedLicenses = new Set([
  'CC BY-SA 4.0',
  'CC BY-SA 3.0',
  'CC BY-SA 3.0 us',
  'CC BY 4.0',
  'CC BY 3.0',
  'CC BY 2.5',
  'CC BY 2.0',
  'CC BY 2.0 fr',
  'CC0',
  'Public domain',
])

const primaryMeaning = (value) => value.split(/\s*\[(?:類|反|記)\]\s*/, 1)[0].trim()
const mandarinSpeechText = (value) => value
  .replace(/[^\p{Script=Han}0-9，。；、：！？（）\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
const mandarinSegments = (value) => mandarinSpeechText(value)
  .split(/[，。；、：！？（）\s]+/u)
  .map((segment) => segment.trim())
  .filter((segment) => /\p{Script=Han}/u.test(segment))
const meanings = new Set()
const meaningsByDeck = new Map()
const segments = new Set()
for (const sourceFile of sourceFiles) {
  const data = JSON.parse(fs.readFileSync(sourceFile.url, 'utf8'))
  const deckMeanings = new Set()
  for (const word of data.words) {
    const meaning = primaryMeaning(word.meaning).replace(/\|\s*$/, '').trim()
    meanings.add(meaning)
    deckMeanings.add(meaning)
    for (const segment of mandarinSegments(meaning)) segments.add(segment)
  }
  meaningsByDeck.set(sourceFile.id, deckMeanings)
}

if (manifest.license !== 'CC BY-ND 3.0 TW') throw new Error('Unexpected MOE license metadata')
if (manifest.note !== '詞目全文聲音檔；原始 WAV 未修改。') throw new Error('MOE source note is missing')
if (!fs.existsSync(new URL('../public/audio/moe/conciseddict_10312.pdf', import.meta.url))) {
  throw new Error('MOE usage notice PDF is missing')
}

let totalBytes = 0
for (const [meaning, recording] of Object.entries(manifest.recordings)) {
  if (!meanings.has(meaning)) throw new Error(`MOE recording has no exact GRE meaning match: ${meaning}`)
  if (recording.url !== `/audio/moe/${recording.entryId}.wav`) {
    throw new Error(`Unexpected MOE recording URL for ${meaning}`)
  }
  const wavUrl = new URL(`../public${recording.url}`, import.meta.url)
  const wav = fs.readFileSync(wavUrl)
  if (wav.subarray(0, 4).toString('ascii') !== 'RIFF' || wav.subarray(8, 12).toString('ascii') !== 'WAVE') {
    throw new Error(`Invalid WAV header for ${meaning}`)
  }
  if (wav.length !== recording.bytes) throw new Error(`WAV size mismatch for ${meaning}`)
  const sha256 = createHash('sha256').update(wav).digest('hex')
  if (sha256 !== recording.sha256) throw new Error(`WAV hash mismatch for ${meaning}`)
  totalBytes += wav.length
}

if (manifest.recordingCount !== Object.keys(manifest.recordings).length) {
  throw new Error('MOE recording count does not match the manifest')
}
if (manifest.recordingCount === 0) throw new Error('No MOE recordings were imported')

for (const [segment, recording] of Object.entries(wikimediaManifest.recordings)) {
  if (!segments.has(segment)) throw new Error(`Wikimedia recording has no exact GRE Mandarin segment match: ${segment}`)
  if (!acceptedLicenses.has(recording.license)) {
    throw new Error(`Unapproved Wikimedia Mandarin audio license for ${segment}: ${recording.license}`)
  }
  if (!recording.artist || !recording.sourceUrl || !recording.licenseUrl || !recording.accentLabel) {
    throw new Error(`Incomplete Wikimedia Mandarin attribution for ${segment}`)
  }
  if (!recording.sourceUrl.startsWith('https://commons.wikimedia.org/')) {
    throw new Error(`Non-Commons Mandarin source for ${segment}`)
  }
  if (!recording.url.startsWith('https://upload.wikimedia.org/wikipedia/commons/transcoded/')) {
    throw new Error(`Unexpected Wikimedia Mandarin MP3 URL for ${segment}`)
  }
}

if (wikimediaManifest.recordingCount !== Object.keys(wikimediaManifest.recordings).length) {
  throw new Error('Wikimedia Mandarin recording count mismatch')
}
if (wikimediaManifest.taiwanRecordingCount + wikimediaManifest.otherMandarinRecordingCount !== wikimediaManifest.recordingCount) {
  throw new Error('Wikimedia Mandarin accent counts do not match the recording count')
}
if (wikimediaManifest.recordingCount < 100) {
  throw new Error(`Unexpectedly low Wikimedia Mandarin human recording coverage: ${wikimediaManifest.recordingCount}`)
}
for (const relativePath of [
  '../public/audio/wikimedia/zh/attribution.json',
  '../public/audio/wikimedia/zh/source.json',
]) {
  if (!fs.existsSync(new URL(relativePath, import.meta.url))) throw new Error(`Missing Mandarin source file: ${relativePath}`)
}

const deckCoverage = {}
for (const [deckId, deckMeanings] of meaningsByDeck) {
  const coverage = {
    uniqueMeanings: deckMeanings.size,
    moeHumanMeanings: 0,
    wikimediaOnlyHumanMeanings: 0,
    mixedMeanings: 0,
    aiOnlyMeanings: 0,
  }
  for (const meaning of deckMeanings) {
    if (manifest.recordings[meaning]) {
      coverage.moeHumanMeanings += 1
      continue
    }
    const meaningSegments = mandarinSegments(meaning)
    const humanCount = meaningSegments.filter((segment) => wikimediaManifest.recordings[segment]).length
    if (!humanCount) coverage.aiOnlyMeanings += 1
    else if (humanCount === meaningSegments.length) coverage.wikimediaOnlyHumanMeanings += 1
    else coverage.mixedMeanings += 1
  }
  if (JSON.stringify(coverage) !== JSON.stringify(wikimediaManifest.deckCoverage[deckId])) {
    throw new Error(`${deckId} Mandarin coverage does not match the manifest`)
  }
  deckCoverage[deckId] = coverage
}

console.log(JSON.stringify({
  valid: true,
  uniqueMeanings: meanings.size,
  moeRecordings: manifest.recordingCount,
  wikimediaHumanRecordings: wikimediaManifest.recordingCount,
  uniqueMandarinSegments: segments.size,
  deckCoverage,
  totalWavBytes: totalBytes,
}, null, 2))
