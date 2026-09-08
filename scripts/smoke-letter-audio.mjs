import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const base = process.argv[2]
assert.ok(base && /^https?:\/\//.test(base), 'Supply the local or deployed site URL')
const recordings = JSON.parse(readFileSync(new URL('../public/audio/letters-v2/attribution.json', import.meta.url)))
let bytes = 0
for (const [letter, recording] of Object.entries(recordings)) {
  const response = await fetch(new URL(`/audio/letters-v2/${letter}.wav`, base), { signal: AbortSignal.timeout(15000) })
  assert.equal(response.status, 200, `${letter}: HTTP ${response.status}`)
  const wav = Buffer.from(await response.arrayBuffer())
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF', `${letter}: must be audio, not an HTML login page`)
  assert.equal(createHash('sha256').update(wav).digest('hex'), recording.sha256, `${letter}: unexpected audio bytes`)
  bytes += wav.length
}
console.log(JSON.stringify({ valid: true, letters: 26, bytes, servedAudioMatchesVerifiedFiles: true }))
