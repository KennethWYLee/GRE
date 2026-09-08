import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const directory = process.argv[2]
assert(directory, 'Usage: node scripts/import-parts-of-speech.mjs PATH_TO_EXTRACTED_WORDNET')
const lexicon = new Map()
const indexHashes = {}
for (const [category, label] of [['noun', 'n.'], ['verb', 'v.'], ['adj', 'adj.'], ['adv', 'adv.']]) {
  const filename = `index.${category}`
  const contents = await readFile(path.join(directory, filename), 'utf8')
  indexHashes[filename] = createHash('sha256').update(contents).digest('hex')
  for (const line of contents.split('\n')) {
    if (!line || line.startsWith(' ')) continue
    const lemma = line.split(' ')[0]
    lexicon.set(lemma, [...(lexicon.get(lemma) ?? []), label])
  }
}

const supplement = JSON.parse(await readFile(new URL('../data/parts-of-speech-supplement.json', import.meta.url), 'utf8'))
const spellings = new Set()
for (const filename of ['vocabulary.json', 'vocabulary-1000.json']) {
  const deck = JSON.parse(await readFile(new URL(`../data/${filename}`, import.meta.url), 'utf8'))
  for (const word of deck.words) spellings.add(word.word.trim().toLowerCase())
}

const words = {}
const missing = []
for (const word of [...spellings].sort()) {
  // WordNet uses ASCII lemmas and underscores for spaces; never stem words.
  const lemma = word.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, '_')
  const label = lexicon.get(lemma)?.join('/') ?? supplement.entries[word]?.label
  if (!label) missing.push(word)
  else words[word] = label
}
assert.equal(missing.length, 0, `Verify missing entries before writing: ${missing.join(', ')}`)

const result = {
  source: 'Princeton WordNet 3.0, exact lemma parts of speech; documented supplements for missing entries',
  sourceUrl: 'https://wordnet.princeton.edu/',
  downloadUrl: 'https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/wordnet.zip',
  downloadSha256: 'cbda5ea6eef7f36a97a43d4a75f85e07fccbb4f23657d27b4ccbc93e2646ab59',
  retrievedAt: '2026-09-08',
  indexHashes,
  license: '../public/licenses/wordnet.txt',
  words,
}
await writeFile(new URL('../data/parts-of-speech.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`)
await writeFile(new URL('../public/licenses/wordnet.txt', import.meta.url), await readFile(path.join(directory, 'LICENSE')))
console.log(JSON.stringify({ words: spellings.size, supplements: Object.keys(supplement.entries).length, missing }))
