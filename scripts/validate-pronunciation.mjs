import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { selectMandarinVoice } from '../src/speech-voices.ts'
import { createHash } from 'node:crypto'
import { spellingLetters, letterTimeline, runEnglishPronunciation } from '../src/detailed-pronunciation.ts'
import { createLetterAudioPlayer } from '../src/letter-audio.ts'
import { runAutoplayCard } from '../src/autoplay.ts'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

assert.equal(appSource.includes('wikimediaEnglishAudio'), false, 'English must not use Wikimedia recordings')
assert.equal(appSource.includes('WIKIMEDIA_ENGLISH_RECORDINGS'), false, 'English recording lookup must be disabled')
assert.equal(appSource.includes("'human-us'"), false, 'English must not expose a human-recording state')
assert.equal(appSource.includes("'human-other'"), false, 'English must not expose a human-recording state')
assert.equal(appSource.includes('moeMandarinAudio'), false, 'Mandarin must not use MOE recordings')
assert.equal(appSource.includes('wikimediaMandarinAudio'), false, 'Mandarin must not use Wikimedia recordings')
assert.match(appSource, /function selectEnglishVoice\(voices: SpeechSynthesisVoice\[\]\)/)
assert.match(appSource, /natural\|neural\|premium\|enhanced\|online/i)
assert.match(appSource, /utterance\.lang = 'en-US'/)
assert.match(appSource, /utterance\.lang = 'zh-TW'/)
assert.match(appSource, /const SPEECH_VOLUME = 1/)
assert.equal((appSource.match(/new SpeechSynthesisUtterance/g) ?? []).length, 2)
assert.equal((appSource.match(/utterance\.volume = SPEECH_VOLUME/g) ?? []).length, 2)
assert.match(appSource, /const returnToFirstCard = \(\) =>/)
assert.match(appSource, /<ChevronsLeft size=\{18\} \/> 第一張/)

const cn = { name: 'Google 普通话（中国大陆）', lang: 'zh-CN' }
const tw = { name: 'Microsoft Hanhan', lang: 'zh-TW' }
const enhancedTw = { name: 'HsiaoChen Natural', lang: 'zh_TW' }
assert.equal(selectMandarinVoice([cn, tw]), tw, 'Locale must outrank the Google quality hint')
assert.equal(selectMandarinVoice([tw, cn, enhancedTw]), enhancedTw)
assert.equal(selectMandarinVoice([cn]), cn, 'Keep a usable fallback if Taiwan voices are unavailable')
assert.equal(selectMandarinVoice([]), null)
assert.equal(selectMandarinVoice([{ name: 'Google English', lang: 'en-US' }]), null)
assert.equal(selectMandarinVoice([cn, { name: 'Traditional', lang: 'zh-Hant' }]).lang, 'zh-Hant')

assert.deepEqual(spellingLetters('apple'), [...'APPLE'])
assert.deepEqual(spellingLetters('co-operate'), [...'COOPERATE'])
assert.deepEqual(spellingLetters('naïve'), [...'NAIVE'])
const recordings = JSON.parse(readFileSync(new URL('../public/audio/letters-v2/attribution.json', import.meta.url)))
const audioVerification = JSON.parse(readFileSync(new URL('../docs/letter-audio-verification.json', import.meta.url)))
const audioCleanup = JSON.parse(readFileSync(new URL('../docs/letter-audio-cleanup.json', import.meta.url)))
assert.ok(audioVerification.results.every((result) => result.matches))
assert.equal(Object.keys(recordings).join(''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
for (const [letter, recording] of Object.entries(recordings)) {
  const wav = readFileSync(new URL(`../public/audio/letters-v2/${letter}.wav`, import.meta.url))
  assert.equal(createHash('sha256').update(wav).digest('hex'), recording.sha256)
  assert.equal(recording.sha256, audioVerification.recordingHashes[letter], 'Ship only the independently verified audio bytes')
  assert.equal(recording.sha256, audioCleanup.letters[letter].sha256)
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  assert.equal(wav.readUInt32LE(24), 24000)
  assert.equal(recording.duration, .5, `${letter}: equal letter duration`)
  // The generator emits canonical mono 16-bit PCM: check the actual samples.
  assert.equal(wav.readUInt16LE(22), 1)
  assert.equal(wav.readUInt16LE(34), 16)
  assert.equal(wav.toString('ascii', 36, 40), 'data')
  assert.equal(wav.readUInt32LE(40), 24000 * .5 * 2)
  let squareSum = 0
  for (let offset = 44; offset < wav.length; offset += 2) {
    assert.ok(Math.abs(wav.readInt16LE(offset)) < 32767, `${letter}: no clipping`)
    squareSum += (wav.readInt16LE(offset) / 32768) ** 2
  }
  assert.ok(Math.abs(Math.sqrt(squareSum / 12000) - .13 * Math.sqrt(.96)) < .001, `${letter}: consistent RMS level`)
  for (let index = 0; index < 240; index += 1) {
    assert.equal(wav.readInt16LE(44 + index * 2), 0, `${letter}: quiet onset`)
    assert.equal(wav.readInt16LE(wav.length - (index + 1) * 2), 0, `${letter}: quiet end`)
  }
  assert.ok(recording.author && recording.licenseUrl && recording.source)
}
const durations = Object.fromEntries(Object.entries(recordings).map(([c, r]) => [c, r.duration]))
const timeline = letterTimeline([...'APPLE'], durations)
assert.deepEqual(timeline.map((step) => step.letter), [...'APPLE'])
for (let index = 1; index < timeline.length; index += 1) {
  const previous = timeline[index - 1]
  assert.ok(Math.abs(timeline[index].start - previous.start - previous.duration - .1) < 1e-9)
}
assert.throws(() => letterTimeline(['A'], {}), /Missing letter audio/)
assert.ok(audioCleanup.letters.N.leadInNoiseBeforeDbfs - audioCleanup.letters.N.leadInNoiseAfterFilteringDbfs >= 10)

// Every stage is awaited: English (including repeated letters and final word)
// must finish before the card flips, and Chinese must finish before advancing.
let clock = 0
const events = []
const completed = await runAutoplayCard({
  minimumDurationMs: 3000,
  isActive: () => true,
  playEnglish: () => runEnglishPronunciation({
    word: 'apple', mode: 'detailed', isActive: () => true,
    speak: async (text) => { clock += 1000; events.push(text); return true },
    spell: async (letters) => { clock += 3000; events.push(...letters); return true },
    wait: async (ms) => { clock += ms },
  }),
  showMeaning: () => events.push('flip'),
  playMandarin: async () => { clock += 2000; events.push('蘋果'); return true },
  wait: async (ms) => { clock += ms },
  now: () => clock,
})
assert.equal(completed, true)
assert.deepEqual(events, ['apple', 'A', 'P', 'P', 'L', 'E', 'apple', 'flip', '蘋果'])
assert.equal(clock, 9600, 'The selected 3 seconds is a minimum, never a speech cutoff')

// Cancel the first word, either pause, spelling or final word.
for (let stopAt = 1; stopAt <= 5; stopAt += 1) {
  let active = true
  let calls = 0
  const stage = async () => { calls += 1; if (calls === stopAt) active = false; return true }
  assert.equal(await runEnglishPronunciation({
    word: 'apple', mode: 'detailed', isActive: () => active,
    speak: stage, spell: stage, wait: stage,
  }), false)
  assert.equal(calls, stopAt)
}
let failureCalls = 0
assert.equal(await runEnglishPronunciation({
  word: 'apple', mode: 'detailed', isActive: () => true,
  speak: async () => { failureCalls += 1; return false },
  spell: async () => { assert.fail('Spelling must not start after failure') },
  wait: async () => undefined,
}), false)
assert.equal(failureCalls, 1)

let releaseLetter
const pendingEvents = []
const pendingSequence = runEnglishPronunciation({
  word: 'a', mode: 'detailed', isActive: () => true,
  speak: async (text) => { pendingEvents.push(text); return true },
  spell: async (letters) => {
    pendingEvents.push(...letters)
    await new Promise((resolve) => { releaseLetter = resolve })
    return true
  },
  wait: async () => undefined,
})
await new Promise((resolve) => setImmediate(resolve))
assert.deepEqual(pendingEvents, ['a', 'A'], 'Final word must wait for the letter to finish')
releaseLetter()
assert.equal(await pendingSequence, true)
assert.deepEqual(pendingEvents, ['a', 'A', 'a'])

for (const failedStage of ['english', 'mandarin']) {
  const failureEvents = []
  assert.equal(await runAutoplayCard({
    minimumDurationMs: 0, isActive: () => true,
    playEnglish: async () => failedStage !== 'english',
    showMeaning: () => failureEvents.push('flip'),
    playMandarin: async () => false,
    wait: async () => undefined,
  }), false, 'Failed audio must not silently advance to the next card')
  assert.deepEqual(failureEvents, failedStage === 'english' ? [] : ['flip'])
}
assert.match(appSource, /pronunciationMode === 'detailed' && cardMode === 'flashcard' && meaning && !autoPlayRef.current/)
assert.match(appSource, /meaning && !autoPlayRef.current\) \{\s+setFlipped\(true\)/)
assert.match(appSource, /if \(englishPlaybackRef.current !== entry\) return/)
assert.match(appSource, /cancelSpeechRef.current\?\.\(\)/)
let longWordSteps = 0
const longWord = 'antidisestablishmentarianism'
assert.equal(await runEnglishPronunciation({
  word: longWord, mode: 'detailed', isActive: () => true,
  speak: async () => { longWordSteps += 1; return true },
  spell: async (letters) => { longWordSteps += letters.length; return true },
  wait: async () => undefined,
}), true)
assert.equal(longWordSteps, longWord.length + 2)

assert.equal(await runEnglishPronunciation({
  word: 'apple', mode: 'general', isActive: () => true,
  speak: async () => true,
  spell: async () => { assert.fail('General mode must not spell') },
  wait: async () => { assert.fail('General mode must not add a pause') },
}), true)

let fetches = 0
let sources = []
const fakeContext = {
  state: 'running', currentTime: 10, destination: {},
  decodeAudioData: async () => ({ duration: .5 }),
  resume: async () => undefined, close: async () => undefined,
  createBufferSource: () => {
    const source = { onended: null, stopped: false, connect() {}, disconnect() {},
      start(when) { this.when = when }, stop() { this.stopped = true } }
    sources.push(source)
    return source
  },
}
const player = createLetterAudioPlayer(() => fakeContext, async () => { fetches += 1; return new ArrayBuffer(0) })
await Promise.all([player.preload(), player.preload()])
assert.equal(fetches, 26, 'One shared preload, no per-letter network request')
let playback = player.play([...'APPLE'], () => undefined)
await new Promise((resolve) => setImmediate(resolve))
assert.equal(sources.length, 5, 'Repeated P uses two independent sources')
sources.forEach((source, index) => assert.ok(Math.abs(source.when - (10.02 + index * .6)) < 1e-9))
sources.at(-1).onended()
assert.equal(await playback, true)
for (let stopAt = 0; stopAt < 5; stopAt += 1) {
  sources = []
  playback = player.play([...'APPLE'], () => undefined)
  await new Promise((resolve) => setImmediate(resolve))
  fakeContext.currentTime = sources[stopAt].when + .1
  player.stop()
  assert.equal(await playback, false)
  assert.ok(sources.every((source) => source.stopped), 'Cancel stops both current and future scheduled letters')
}
assert.equal(fetches, 26)
player.dispose()

let resolveBytes
const bytes = new Promise((resolve) => { resolveBytes = resolve })
const canceledLoader = createLetterAudioPlayer(() => fakeContext, () => bytes)
const beforeLoad = canceledLoader.play(['A'], () => undefined)
canceledLoader.stop()
resolveBytes(new ArrayBuffer(0))
assert.equal(await beforeLoad, false)
canceledLoader.dispose()

let rejectLoad = true
const retryPlayer = createLetterAudioPlayer(() => fakeContext, async () => {
  if (rejectLoad) throw new Error('offline')
  return new ArrayBuffer(0)
})
assert.equal(await retryPlayer.play(['A'], () => undefined), false)
rejectLoad = false
await retryPlayer.preload()
retryPlayer.dispose()

console.log(JSON.stringify({
  valid: true,
  englishWholeWordsAiOnly: true,
  mandarinAiOnly: true,
  highQualityEnglishVoicePreferred: true,
  sharedPlaybackVolume: true,
  returnToFirstCard: true,
  taiwanVoiceBeforeQuality: true,
  detailedLetterNames: true,
  detailedPlaybackOrder: true,
  cancellationAtEveryStage: true,
  autoplayWaitsForSpellingAndMandarin: true,
  failedSpeechStopsAutoplay: true,
  recordedLetters: 26,
  uniformLetterDurationSeconds: .5,
  noClippedSamplesOrBoundaryClicks: true,
  preloadedLetters: true,
  letterGapSeconds: .1,
  separateRepeatedLetters: true,
}, null, 2))
