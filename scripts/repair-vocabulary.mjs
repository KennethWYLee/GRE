import { readFile, writeFile } from 'node:fs/promises'
import { parseDetails, correctKnownTypos } from './lib/vocabulary-details.mjs'

for (const filename of ['vocabulary-1000.json', 'vocabulary.json']) {
  const file = new URL(`../data/${filename}`, import.meta.url)
  const data = JSON.parse(await readFile(file, 'utf8'))
  let corrected = 0
  data.words = data.words.map((word) => {
    const fixed = { ...word, root: correctKnownTypos(word.root), ...parseDetails(word.raw) }
    if (JSON.stringify(word) !== JSON.stringify(fixed)) corrected += 1
    return fixed
  })
  data.rootGroups = data.rootGroups.map((group) => ({ ...group, root: correctKnownTypos(group.root) }))
  await writeFile(file, `${JSON.stringify(data)}\n`)
  console.log(JSON.stringify({ deck: data.meta.title, corrected, totalWords: data.words.length }))
}
