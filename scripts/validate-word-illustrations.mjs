import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { WORD_ILLUSTRATIONS, getWordIllustration } from '../src/word-illustrations.ts'
import './validate-image-loading.mjs'

const deck = JSON.parse(readFileSync(new URL('../data/vocabulary-1000.json', import.meta.url)))
const expected = [...deck.words].sort((a, b) => a.part - b.part || a.deckPosition - b.deckPosition)
assert.equal(expected.length, 1085)
for (const part of [1, 2, 3, 4, 5]) assert.equal(expected.filter((word) => word.part === part).length, 217)
assert.deepEqual(Object.keys(WORD_ILLUSTRATIONS).sort(), expected.map((word) => word.id).sort())
const records = ['first10', 'parts4-5', 'parts1-3'].flatMap((name) => JSON.parse(readFileSync(new URL(`../docs/word-illustrations-${name}.json`, import.meta.url))).assets)
assert.equal(records.length, expected.length)
const byId = new Map(records.map((asset) => [asset.wordId, asset]))
assert.equal(byId.size, expected.length)
const uniqueImages = new Map()
let totalBytes = 0
for (const word of expected) {
  const illustration = getWordIllustration(word.id)
  const record = byId.get(word.id)
  assert.equal(illustration.word, word.word, 'Each image must follow its word ID, including after shuffling')
  assert.equal(record.word, word.word)
  assert.equal(illustration.src, record.output)
  assert.ok(illustration.alt.length > 10, 'Images need a meaningful Chinese description')
  assert.match(illustration.src, /^\/images\/words\/[a-z-]+(?:-word1000-\d+)?-v1\.webp$/)
  const image = readFileSync(new URL(`../public${illustration.src}`, import.meta.url))
  assert.equal(image.toString('ascii', 0, 4), 'RIFF')
  assert.equal(image.toString('ascii', 8, 12), 'WEBP')
  assert.ok(image.length < 100_000, 'Keep each thumbnail below 100 KB for mobile loading')
  assert.equal(record.width, 480)
  assert.equal(record.height, 480)
  assert.equal(image.length, record.bytes)
  assert.equal(createHash('sha256').update(image).digest('hex'), record.sha256)
  assert.ok(record.prompt && record.inspection)
  if (!(word.part === 1 && word.deckPosition <= 10)) {
    assert.equal(illustration.alt, record.alt)
    assert.equal(record.part, word.part)
    assert.equal(record.deckPosition, word.deckPosition)
    assert.equal(record.sourcePath, undefined, 'Do not publish private absolute paths')
    assert.equal(record.preparedPath, undefined)
    if (record.reusedFromWordId) {
      assert.ok(record.reuseReason)
      assert.equal(record.output, byId.get(record.reusedFromWordId).output)
    }
  }
  if (!uniqueImages.has(illustration.src)) totalBytes += image.length
  uniqueImages.set(illustration.src, image.length)
}
const otherDeck = JSON.parse(readFileSync(new URL('../data/vocabulary.json', import.meta.url)))
for (const word of otherDeck.words) assert.equal(getWordIllustration(word.id), null, 'The 2000-word book remains outside the illustration scope')
assert.equal(getWordIllustration('unknown-word'), null)

console.log(JSON.stringify({ valid: true, illustratedCards: expected.length, cardsPerPart: [217, 217, 217, 217, 217], uniqueImages: uniqueImages.size, totalBytes, maxImageBytes: Math.max(...uniqueImages.values()) }, null, 2))
