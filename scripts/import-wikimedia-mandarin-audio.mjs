import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT_DIR = path.join(ROOT, 'public', 'audio', 'wikimedia', 'zh')
const MANIFEST_PATH = path.join(ROOT, 'src', 'wikimedia-mandarin-audio.json')
const ATTRIBUTION_PATH = path.join(OUTPUT_DIR, 'attribution.json')
const SOURCE_PATH = path.join(OUTPUT_DIR, 'source.json')
const WIKTIONARY_API = 'https://zh.wiktionary.org/w/api.php'
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const USER_AGENT = 'GRERootsMandarinPronunciationImport/1.0 (https://kenneth-gre-roots.wy-lee9591.chatgpt.site)'
const ACCEPTED_LICENSES = new Set([
  'CC BY-SA 4.0',
  'CC BY-SA 3.0',
  'CC BY-SA 3.0 us',
  'CC BY 4.0',
  'CC BY 3.0',
  'CC BY 2.5',
  'CC BY 2.0',
  'CC BY 2.0 fr',
  'CC0',
  'Public domain',
])

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function fetchWithRetry(url, options = {}) {
  let lastError
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)
    try {
      const response = await fetch(url, {
        ...options,
        headers: { 'user-agent': USER_AGENT, ...(options.headers ?? {}) },
        signal: controller.signal,
      })
      if (response.ok) return response
      if (![429, 500, 502, 503, 504].includes(response.status)) {
        throw new Error(`${response.status} ${response.statusText}: ${url}`)
      }
      lastError = new Error(`${response.status} ${response.statusText}: ${url}`)
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after'))
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 15_000 * attempt)
        continue
      }
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timeout)
    }
    await sleep(1_000 * attempt)
  }
  throw lastError
}

async function api(endpoint, parameters) {
  const url = new URL(endpoint)
  for (const [key, value] of Object.entries({ format: 'json', formatversion: '2', origin: '*', ...parameters })) {
    url.searchParams.set(key, value)
  }
  const response = await fetchWithRetry(url)
  return response.json()
}

function batches(items, size) {
  const result = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

function primaryMeaning(value) {
  return String(value).split(/\s*\[(?:類|反|記)\]\s*/, 1)[0].replace(/\|\s*$/, '').trim()
}

function mandarinSpeechText(value) {
  return value
    .replace(/[^\p{Script=Han}0-9，。；、：！？（）\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function mandarinSegments(value) {
  return mandarinSpeechText(value)
    .split(/[，。；、：！？（）\s]+/u)
    .map((segment) => segment.trim())
    .filter((segment) => /\p{Script=Han}/u.test(segment))
}

function chineseSection(wikitext) {
  const heading = /^==(?:漢語|汉语|Chinese)==\s*$/m.exec(wikitext)
  if (!heading) return ''
  const remainder = wikitext.slice(heading.index + heading[0].length)
  const nextLanguage = /^==[^=\n]+==\s*$/m.exec(remainder)
  return nextLanguage ? remainder.slice(0, nextLanguage.index) : remainder
}

function plainText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function mandarinAudioCandidates(wikitext) {
  const candidates = []
  const section = chineseSection(wikitext)
  for (const match of section.matchAll(/\{\{zh-pron\b([\s\S]*?)\}\}/gi)) {
    const mandarin = /(?:^|\|)\s*m\s*=\s*([^|}\n]+)/im.exec(match[1])?.[1]
    if (!mandarin) continue
    const pinyin = mandarin
      .split(/,(?:tl|ma|er|audio|cat)=/i, 1)[0]
      .split(/[\/;]/, 1)[0]
      .replace(/\{\{[^}]+\}\}/g, '')
      .replace(/\s+/g, '')
      .trim()
    if (!pinyin || /[=|{}]/.test(pinyin)) continue
    candidates.push({ pinyin, filename: `Zh-${pinyin}.ogg` })
  }
  return [...new Map(candidates.map((candidate) => [candidate.filename.toLocaleLowerCase(), candidate])).values()]
}

function fileKey(filename) {
  return filename.replace(/_/g, ' ').trim().toLocaleLowerCase()
}

function accentLabel(metadata) {
  const description = plainText(metadata.description)
  if (/Taiwan|Taipei|Taiwanese|臺灣|台灣/i.test(description)) return '臺灣華語'
  if (/Pekin|Beijing|China|中國|中国/i.test(description)) return '普通話（中國）'
  return '現代標準漢語'
}

function metadataFromPage(page, rejectedLicenses) {
  const info = page.videoinfo?.[0]
  const license = info?.extmetadata?.LicenseShortName?.value ?? info?.extmetadata?.UsageTerms?.value
  const mp3 = info?.derivatives?.find((derivative) => derivative.transcodekey === 'mp3')
  if (!info || !mp3?.src || !license || !ACCEPTED_LICENSES.has(license)) {
    if (license && !ACCEPTED_LICENSES.has(license)) rejectedLicenses.add(license)
    return null
  }
  const metadata = {
    filename: page.title.replace(/^File:/, ''),
    audioUrl: mp3.src,
    sourceUrl: info.descriptionurl,
    license,
    licenseUrl: info.extmetadata?.LicenseUrl?.value,
    artist: plainText(info.extmetadata?.Artist?.value) || 'Wikimedia Commons contributor',
    description: info.extmetadata?.ImageDescription?.value ?? '',
    categories: (page.categories ?? []).map((category) => category.title.replace(/^Category:/, '')),
  }
  return metadata.licenseUrl ? metadata : null
}

function describedMandarinTerms(description) {
  const plainDescription = plainText(description)
  const terms = new Set()
  for (const match of plainDescription.matchAll(/[（(]([^()（）]*\p{Script=Han}[^()（）]*)[）)]/gu)) {
    for (const term of match[1].match(/\p{Script=Han}+/gu) ?? []) terms.add(term)
  }
  for (const pattern of [
    /(?:word|term)\s+[「『“"]?(\p{Script=Han}+)[」』”"]?/giu,
    /[「『“"](\p{Script=Han}+)[」』”"]/gu,
  ]) {
    for (const match of plainDescription.matchAll(pattern)) terms.add(match[1])
  }
  return [...terms]
}

async function main() {
  const meaningsByDeck = new Map()
  const allSegments = new Set()
  for (const [deckId, relativePath] of [
    ['words1000', 'data/vocabulary-1000.json'],
    ['words2000', 'data/vocabulary.json'],
  ]) {
    const deck = JSON.parse(await fs.readFile(path.join(ROOT, relativePath), 'utf8'))
    const meanings = [...new Set(deck.words.map((item) => primaryMeaning(item.meaning)).filter(Boolean))]
    meaningsByDeck.set(deckId, meanings)
    for (const meaning of meanings) {
      for (const segment of mandarinSegments(meaning)) allSegments.add(segment)
    }
  }

  const candidatesBySegment = new Map([...allSegments].map((segment) => [segment, []]))
  for (const batch of batches([...allSegments], 50)) {
    const payload = await api(WIKTIONARY_API, {
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      redirects: '1',
      titles: batch.join('|'),
    })
    for (const page of payload.query?.pages ?? []) {
      if (page.missing) continue
      const source = page.revisions?.[0]?.slots?.main?.content ?? ''
      const recordings = mandarinAudioCandidates(source)
      const aliases = [
        page.title,
        ...(payload.query?.redirects ?? []).filter((redirect) => redirect.to === page.title).map((redirect) => redirect.from),
      ]
      for (const alias of aliases) {
        if (candidatesBySegment.has(alias)) candidatesBySegment.set(alias, recordings)
      }
    }
    await sleep(100)
  }

  const filenames = [...new Set([...candidatesBySegment.values()].flat().map((recording) => recording.filename))]
  const metadataByFilename = new Map()
  const rejectedLicenses = new Set()
  for (const batch of batches(filenames, 50)) {
    const payload = await api(COMMONS_API, {
      action: 'query',
      prop: 'videoinfo|categories',
      viprop: 'url|mime|size|derivatives|extmetadata',
      cllimit: 'max',
      redirects: '1',
      titles: batch.map((filename) => `File:${filename}`).join('|'),
    })
    for (const page of payload.query?.pages ?? []) {
      if (page.missing) continue
      const metadata = metadataFromPage(page, rejectedLicenses)
      if (!metadata) continue
      metadataByFilename.set(fileKey(metadata.filename), metadata)
      for (const redirect of payload.query?.redirects ?? []) {
        if (redirect.to === page.title) metadataByFilename.set(fileKey(redirect.from.replace(/^File:/, '')), metadata)
      }
      for (const normalized of payload.query?.normalized ?? []) {
        if (normalized.to === page.title) metadataByFilename.set(fileKey(normalized.from.replace(/^File:/, '')), metadata)
      }
    }
    await sleep(100)
  }

  const entries = {}
  for (const [segment, candidates] of [...candidatesBySegment].sort(([left], [right]) => left.localeCompare(right, 'zh-Hant'))) {
    const selection = candidates
      .map((candidate) => ({ ...candidate, metadata: metadataByFilename.get(fileKey(candidate.filename)) }))
      .find((candidate) => candidate.metadata)
    if (!selection) continue
    entries[segment] = {
      url: selection.metadata.audioUrl,
      accentLabel: accentLabel(selection.metadata),
      pinyin: selection.pinyin,
      filename: selection.metadata.filename,
      sourceUrl: selection.metadata.sourceUrl,
      artist: selection.metadata.artist,
      license: selection.metadata.license,
      licenseUrl: selection.metadata.licenseUrl,
      note: 'Wikimedia Commons MP3 transcode of an unmodified recorded Mandarin pronunciation.',
    }
  }

  let categoryFilesScanned = 0
  const categorySelections = new Map()
  let categoryContinuation = {}
  const scanFullCommonsCategory = process.argv.includes('--scan-category')
  while (scanFullCommonsCategory && categoryContinuation) {
    const payload = await api(COMMONS_API, {
      action: 'query',
      generator: 'categorymembers',
      gcmtitle: 'Category:Chinese pronunciation',
      gcmnamespace: '6',
      gcmlimit: 'max',
      prop: 'videoinfo|categories',
      viprop: 'url|mime|size|derivatives|extmetadata',
      cllimit: 'max',
      ...categoryContinuation,
    })
    for (const page of payload.query?.pages ?? []) {
      categoryFilesScanned += 1
      const metadata = metadataFromPage(page, rejectedLicenses)
      if (!metadata) continue
      for (const term of describedMandarinTerms(metadata.description)) {
        if (!allSegments.has(term) || entries[term]) continue
        const previous = categorySelections.get(term)
        const score = accentLabel(metadata) === '臺灣華語' ? 100 : 0
        if (!previous || score > previous.score) categorySelections.set(term, { metadata, score })
      }
    }
    categoryContinuation = payload.continue
      ? Object.fromEntries(Object.entries(payload.continue).filter(([key]) => key !== 'continue'))
      : null
    if (categoryContinuation) await sleep(250)
  }

  for (const [segment, selection] of [...categorySelections].sort(([left], [right]) => left.localeCompare(right, 'zh-Hant'))) {
    entries[segment] = {
      url: selection.metadata.audioUrl,
      accentLabel: accentLabel(selection.metadata),
      pinyin: '',
      filename: selection.metadata.filename,
      sourceUrl: selection.metadata.sourceUrl,
      artist: selection.metadata.artist,
      license: selection.metadata.license,
      licenseUrl: selection.metadata.licenseUrl,
      note: 'Wikimedia Commons MP3 transcode of an unmodified recorded Mandarin pronunciation.',
    }
  }

  const moeManifest = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'moe-mandarin-audio.json'), 'utf8'))
  const deckCoverage = {}
  for (const [deckId, meanings] of meaningsByDeck) {
    let moeHumanMeanings = 0
    let wikimediaOnlyHumanMeanings = 0
    let mixedMeanings = 0
    let aiOnlyMeanings = 0
    for (const meaning of meanings) {
      if (moeManifest.recordings[meaning]) {
        moeHumanMeanings += 1
        continue
      }
      const segments = mandarinSegments(meaning)
      const humanCount = segments.filter((segment) => entries[segment]).length
      if (humanCount === 0) aiOnlyMeanings += 1
      else if (humanCount === segments.length) wikimediaOnlyHumanMeanings += 1
      else mixedMeanings += 1
    }
    deckCoverage[deckId] = {
      uniqueMeanings: meanings.length,
      moeHumanMeanings,
      wikimediaOnlyHumanMeanings,
      mixedMeanings,
      aiOnlyMeanings,
    }
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  for (const existing of await fs.readdir(OUTPUT_DIR)) {
    if (existing.endsWith('.mp3')) await fs.unlink(path.join(OUTPUT_DIR, existing))
  }

  const manifest = {
    title: 'Chinese Wiktionary Mandarin pronunciation recordings hosted by Wikimedia Commons',
    retrievedOn: new Date().toISOString().slice(0, 10),
    sourcePage: 'https://zh.wiktionary.org/wiki/Wiktionary:%E6%BC%A2%E8%AA%9E%E7%99%BC%E9%9F%B3%E8%A1%A8%E8%A8%98',
    licensePolicy: 'https://commons.wikimedia.org/wiki/Commons:Licensing',
    recordingCount: Object.keys(entries).length,
    taiwanRecordingCount: Object.values(entries).filter((entry) => entry.accentLabel === '臺灣華語').length,
    otherMandarinRecordingCount: Object.values(entries).filter((entry) => entry.accentLabel !== '臺灣華語').length,
    categoryFilesScanned,
    deckCoverage,
    categoryFilesScanned,
    recordings: entries,
  }
  const output = `${JSON.stringify(manifest, null, 2)}\n`
  await fs.writeFile(MANIFEST_PATH, output, 'utf8')
  await fs.writeFile(ATTRIBUTION_PATH, output, 'utf8')
  await fs.writeFile(SOURCE_PATH, `${JSON.stringify({ ...manifest, recordings: undefined }, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    uniqueMandarinSegments: allSegments.size,
    ...Object.fromEntries(Object.entries(manifest).filter(([key]) => key.endsWith('Count'))),
    deckCoverage,
    rejectedLicenses: [...rejectedLicenses].sort(),
  }, null, 2))
}

await main()
