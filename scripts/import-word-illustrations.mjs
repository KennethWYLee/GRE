import assert from 'node:assert/strict'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'

const root = new URL('../', import.meta.url)
const args = process.argv.slice(2)
const completingBook = args[0] === '--parts1-3'
if (completingBook) args.shift()
const suffix = completingBook ? 'parts1-3' : 'parts4-5'
const exportName = completingBook ? 'PARTS_1_2_3_ILLUSTRATIONS' : 'PARTS_4_5_ILLUSTRATIONS'
const recordUrl = new URL(`docs/word-illustrations-${suffix}.json`, root)
const words = JSON.parse(await readFile(new URL('data/vocabulary-1000.json', root))).words
const existing = completingBook
  ? (await Promise.all(['first10', 'parts4-5'].map(async (name) => JSON.parse(await readFile(new URL(`docs/word-illustrations-${name}.json`, root))).assets))).flat()
  : []
const existingIds = new Set(existing.map((asset) => asset.wordId))
const expected = words.filter((word) => completingBook ? word.part <= 3 && !existingIds.has(word.id) : [4, 5].includes(word.part))
  .sort((a, b) => a.part - b.part || a.deckPosition - b.deckPosition)
const checksum = (buffer) => createHash('sha256').update(buffer).digest('hex')
const [preparedPath, decisionsPath] = args
let record

if (preparedPath) {
  assert.ok(decisionsPath, 'Provide both the prepared manifest and reviewed reuse decisions')
  const prepared = JSON.parse(await readFile(preparedPath))
  const decisions = JSON.parse(await readFile(decisionsPath))
  const byId = new Map(prepared.map((asset) => [asset.wordId, asset]))
  assert.equal(byId.size, prepared.length, 'Duplicate prepared word ID')
  for (const asset of existing) {
    assert.ok(!byId.has(asset.wordId), `Do not replace an existing card: ${asset.wordId}`)
    byId.set(asset.wordId, { ...asset, preparedPath: new URL(`public${asset.output}`, root) })
  }
  const reuse = new Map(decisions.reuse.map((asset) => [asset.wordId, asset]))
  const assets = []
  const copies = new Map()
  for (const word of expected) {
    const reuseDecision = reuse.get(word.id)
    const asset = byId.get(reuseDecision?.fromWordId ?? word.id)
    assert.ok(asset, `Missing reviewed image: ${word.id} ${word.word}`)
    assert.notEqual(asset.usable, false, `Rejected image: ${word.id}`)
    assert.ok(asset.prompt && asset.inspection && asset.alt, `Missing review: ${word.id}`)
    if (!reuseDecision) {
      assert.equal(asset.word, word.word)
      assert.equal(asset.part, word.part)
      assert.equal(asset.deckPosition, word.deckPosition)
    }
    assert.match(asset.output, /^\/images\/words\/[a-z-]+(?:-word1000-\d+)?-v1\.webp$/)
    const buffer = await readFile(asset.preparedPath)
    assert.equal(checksum(buffer), asset.sha256, `Changed prepared asset: ${word.id}`)
    assert.equal(buffer.length, asset.bytes)
    assert.ok(buffer.length < 100_000)
    assert.equal(asset.width, 480)
    assert.equal(asset.height, 480)
    copies.set(asset.output, { source: asset.preparedPath, sha256: asset.sha256 })
    const publicAsset = { ...asset }
    delete publicAsset.sourcePath
    delete publicAsset.preparedPath
    delete publicAsset.usable
    assets.push({
      ...publicAsset,
      wordId: word.id,
      word: word.word,
      part: word.part,
      deckPosition: word.deckPosition,
      ...(reuseDecision ? {
        alt: reuseDecision.alt ?? asset.alt,
        meaningShown: reuseDecision.meaningShown ?? asset.meaningShown,
        reusedFromWordId: reuseDecision.fromWordId,
        reuseReason: reuseDecision.reason,
      } : {}),
    })
  }
  assert.equal(expected.length, completingBook ? 641 : 434)
  // Validate every destination before copying; existing assets are never overwritten.
  for (const [output, asset] of copies) {
    const destination = new URL(`public${output}`, root)
    const existing = await readFile(destination).catch((error) => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    if (existing) assert.equal(checksum(existing), asset.sha256, `Existing asset differs: ${output}`)
  }
  for (const [output, asset] of copies) {
    await copyFile(asset.source, new URL(`public${output}`, root), constants.COPYFILE_EXCL).catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
  }
  record = {
    version: 1,
    createdAt: '2026-09-09',
    scope: completingBook
      ? '補齊 1000 字 Part 1、Part 2、Part 3 共 641 張字卡；保留 Part 1 前 10 字及 Part 4、Part 5 的全部原圖，不改動 2000 字書。'
      : '1000 字 Part 4 與 Part 5，每份 217 張字卡；保留 Part 1 前 10 字原圖，不改動其他單字。',
    generation: {
      tool: 'built-in image_gen',
      mode: 'generate',
      retries: 0,
      description: 'AI 生成的虛構場景。圖片只輔助其中一個意思，不能取代完整解釋；相同或相近意思的共用圖片逐筆記錄。',
    },
    preparation: { format: 'WebP', width: 480, height: 480, quality: 78, effort: 6, alterations: '僅縮小與壓縮，未裁切或改動畫面內容。' },
    verification: {
      coverage: completingBook ? '依 word ID 及固定 deckPosition 核對全部 1085 張字卡，每份 217 張。' : '依 word ID 及固定 deckPosition 核對兩份全部單字。',
      assets: '生成代理檢視原圖；主代理另檢視選用圖片與縮圖，排除明顯人物瑕疵。',
      performance: '以模擬下載卡住、失敗、切換與逾時驗證連播獨立性，未執行 Android Firefox 實機效能量測。',
    },
    assets,
  }
  await writeFile(recordUrl, `${JSON.stringify(record, null, 2)}\n`)
} else {
  record = JSON.parse(await readFile(recordUrl))
}

assert.deepEqual(record.assets.map((asset) => asset.wordId), expected.map((word) => word.id))
const mapping = Object.fromEntries(record.assets.map((asset) => [asset.wordId, { word: asset.word, src: asset.output, alt: asset.alt }]))
await writeFile(new URL(`src/word-illustrations-${suffix}.ts`, root), `// Generated from docs/word-illustrations-${suffix}.json by scripts/import-word-illustrations.mjs.\nexport const ${exportName} = ${JSON.stringify(mapping, null, 2)} as const\n`)
console.log(JSON.stringify({ cards: record.assets.length, uniqueImages: new Set(record.assets.map((asset) => asset.output)).size }))
