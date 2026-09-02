import fs from 'node:fs'

const manifest = JSON.parse(fs.readFileSync(new URL('../src/wikimedia-english-audio.json', import.meta.url), 'utf8'))
const recordings = Object.entries(manifest.recordings)
const sampleCount = Math.min(20, recordings.length)
const samples = Array.from({ length: sampleCount }, (_, index) => recordings[Math.floor(index * recordings.length / sampleCount)])

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
for (const [word, recording] of samples) {
  let response
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    response = await fetch(recording.url, {
      headers: {
        range: 'bytes=0-2047',
        'user-agent': 'GRERootsPronunciationSmokeTest/1.0 (https://kenneth-gre-roots.wy-lee9591.chatgpt.site)',
      },
    })
    if (response.ok) break
    if (response.status !== 429) throw new Error(`${response.status} ${response.statusText} for ${word}`)
    await sleep(5_000 * attempt)
  }
  if (!response?.ok) throw new Error(`Wikimedia rate limit persisted for ${word}`)
  const contentType = response.headers.get('content-type') ?? ''
  const bytes = Buffer.from(await response.arrayBuffer())
  const hasId3 = bytes.subarray(0, 3).toString('ascii') === 'ID3'
  const hasFrameSync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
  if (!contentType.startsWith('audio/mpeg') || (!hasId3 && !hasFrameSync)) {
    throw new Error(`Invalid live MP3 response for ${word}`)
  }
  await sleep(250)
}

console.log(JSON.stringify({ valid: true, checkedLiveRecordings: samples.length }, null, 2))
