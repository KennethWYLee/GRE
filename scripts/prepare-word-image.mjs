import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getWordIllustration } from '../src/word-illustrations.ts'

const [wordId, sourcePath, sharpModule = 'sharp'] = process.argv.slice(2)
const illustration = getWordIllustration(wordId)
if (!illustration || !sourcePath) throw new Error('Usage: node scripts/prepare-word-image.mjs WORD_ID SOURCE_IMAGE [SHARP_MODULE_PATH]')
const sharp = createRequire(import.meta.url)(sharpModule)
const root = fileURLToPath(new URL('..', import.meta.url))
const outputPath = resolve(root, 'public', illustration.src.slice(1))
const exists = await access(outputPath).then(() => true, () => false)
if (exists) throw new Error(`Refusing to replace existing image: ${outputPath}`)
await mkdir(dirname(outputPath), { recursive: true })
const result = await sharp(sourcePath)
  .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
  .webp({ quality: 78, effort: 6 })
  .toFile(outputPath)
const checksum = async (path) => createHash('sha256').update(await readFile(path)).digest('hex')
console.log(JSON.stringify({
  wordId,
  word: illustration.word,
  output: illustration.src,
  width: result.width,
  height: result.height,
  bytes: result.size,
  sourceSha256: await checksum(sourcePath),
  sha256: await checksum(outputPath),
}, null, 2))
