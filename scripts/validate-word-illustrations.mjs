import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { WORD_ILLUSTRATIONS, getWordIllustration, preloadWordIllustrations } from '../src/word-illustrations.ts'

const deck = JSON.parse(readFileSync(new URL('../data/vocabulary-1000.json', import.meta.url)))
const firstTen = deck.words.filter((word) => word.part === 1).sort((a, b) => a.deckPosition - b.deckPosition).slice(0, 10)
assert.deepEqual(Object.keys(WORD_ILLUSTRATIONS), firstTen.map((word) => word.id))
let totalBytes = 0
for (const word of firstTen) {
  const illustration = getWordIllustration(word.id)
  assert.equal(illustration.word, word.word, 'Each image must follow its word ID, including after shuffling')
  assert.ok(illustration.alt.length > 10, 'Images need a meaningful Chinese description')
  assert.match(illustration.src, /^\/images\/words\/[a-z]+-v1\.webp$/)
  const image = readFileSync(new URL(`../public${illustration.src}`, import.meta.url))
  assert.equal(image.toString('ascii', 0, 4), 'RIFF')
  assert.equal(image.toString('ascii', 8, 12), 'WEBP')
  assert.ok(image.length < 150_000, 'Keep each thumbnail small for mobile loading')
  totalBytes += image.length
}
assert.equal(getWordIllustration(deck.words.find((word) => word.part === 1 && word.deckPosition === 11).id), null)
assert.equal(getWordIllustration('word-124'), null, 'The 2000-word book is outside this image sample')

const originalImage = globalThis.Image
const requestedImages = []
globalThis.Image = class {
  constructor() { requestedImages.push(this) }
}
try {
  const ids = firstTen.map((word) => word.id)
  preloadWordIllustrations([...ids, 'unknown-word'])
  assert.equal(requestedImages.length, 10)
  preloadWordIllustrations([...ids].reverse())
  assert.equal(requestedImages.length, 10, 'Repeated preloading must not issue duplicate requests')
  requestedImages[0].onerror()
  preloadWordIllustrations([ids[0]])
  assert.equal(requestedImages.length, 11, 'Failed preloading must allow a later retry')
  assert.ok(requestedImages.every((image) => image.decoding === 'async'))
} finally {
  if (originalImage === undefined) delete globalThis.Image
  else globalThis.Image = originalImage
}

console.log(JSON.stringify({ valid: true, images: firstTen.length, totalBytes, limitedToFirstTen: true, preloadDeduplication: true, retryAfterFailure: true }, null, 2))
