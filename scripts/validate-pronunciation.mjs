import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { selectMandarinVoice } from '../src/speech-voices.ts'
import { pronunciationSteps, runEnglishPronunciation } from '../src/detailed-pronunciation.ts'
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

assert.deepEqual(pronunciationSteps('apple', 'general'), [{ text: 'apple', letter: null }])
assert.deepEqual(pronunciationSteps('apple', 'detailed').map(({ text }) => text),
  ['apple', 'ay', 'pee', 'pee', 'ell', 'ee', 'apple'])
assert.deepEqual(pronunciationSteps('co-operate', 'detailed').map(({ letter }) => letter).filter(Boolean),
  [...'COOPERATE'])
assert.deepEqual(pronunciationSteps('naïve', 'detailed').map(({ letter }) => letter).filter(Boolean), [...'NAIVE'])
assert.equal(pronunciationSteps('Z', 'detailed')[1].text, 'zee')
assert.equal(pronunciationSteps('W', 'detailed')[1].text, 'double you')

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
  }),
  showMeaning: () => events.push('flip'),
  playMandarin: async () => { clock += 2000; events.push('蘋果'); return true },
  wait: async (ms) => { clock += ms },
  now: () => clock,
})
assert.equal(completed, true)
assert.deepEqual(events, ['apple', 'ay', 'pee', 'pee', 'ell', 'ee', 'apple', 'flip', '蘋果'])
assert.equal(clock, 11000, 'The selected 3 seconds is a minimum, never a speech cutoff')

// Cancellation at every stage must prevent subsequent letters and final word.
for (let stopAt = 1; stopAt <= 7; stopAt += 1) {
  let active = true
  let calls = 0
  assert.equal(await runEnglishPronunciation({
    word: 'apple', mode: 'detailed', isActive: () => active,
    speak: async () => { calls += 1; if (calls === stopAt) active = false; return true },
  }), false)
  assert.equal(calls, stopAt)
}
let failureCalls = 0
assert.equal(await runEnglishPronunciation({
  word: 'apple', mode: 'detailed', isActive: () => true,
  speak: async () => { failureCalls += 1; return false },
}), false)
assert.equal(failureCalls, 1)

let releaseLetter
const pendingEvents = []
const pendingSequence = runEnglishPronunciation({
  word: 'a', mode: 'detailed', isActive: () => true,
  speak: async (text, letter) => {
    pendingEvents.push(text)
    if (letter) await new Promise((resolve) => { releaseLetter = resolve })
    return true
  },
})
await new Promise((resolve) => setImmediate(resolve))
assert.deepEqual(pendingEvents, ['a', 'ay'], 'Final word must wait for the letter to finish')
releaseLetter()
assert.equal(await pendingSequence, true)
assert.deepEqual(pendingEvents, ['a', 'ay', 'a'])

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
}), true)
assert.equal(longWordSteps, longWord.length + 2)

console.log(JSON.stringify({
  valid: true,
  englishAiOnly: true,
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
}, null, 2))
