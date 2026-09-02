import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

console.log(JSON.stringify({
  valid: true,
  englishAiOnly: true,
  mandarinAiOnly: true,
  highQualityEnglishVoicePreferred: true,
  sharedPlaybackVolume: true,
  returnToFirstCard: true,
}, null, 2))
