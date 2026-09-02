import { createHash } from 'node:crypto'
import fs from 'node:fs'

const manifest = JSON.parse(fs.readFileSync(new URL('../src/moe-mandarin-audio.json', import.meta.url), 'utf8'))
const sourceFiles = [
  new URL('../data/vocabulary-1000.json', import.meta.url),
  new URL('../data/vocabulary.json', import.meta.url),
]

const primaryMeaning = (value) => value.split(/\s*\[(?:類|反|記)\]\s*/, 1)[0].trim()
const meanings = new Set()
for (const sourceFile of sourceFiles) {
  const data = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
  for (const word of data.words) meanings.add(primaryMeaning(word.meaning))
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

console.log(JSON.stringify({
  valid: true,
  uniqueMeanings: meanings.size,
  moeRecordings: manifest.recordingCount,
  deviceSpeechFallbacks: meanings.size - manifest.recordingCount,
  totalWavBytes: totalBytes,
}, null, 2))
