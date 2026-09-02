import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT_DIR = path.join(ROOT, 'public', 'audio', 'wikimedia', 'en')
const MANIFEST_PATH = path.join(ROOT, 'src', 'wikimedia-english-audio.json')
const ATTRIBUTION_PATH = path.join(OUTPUT_DIR, 'attribution.json')
const SOURCE_PATH = path.join(OUTPUT_DIR, 'source.json')
const WIKTIONARY_API = 'https://en.wiktionary.org/w/api.php'
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const USER_AGENT = 'GRERootsPronunciationImport/1.0 (https://kenneth-gre-roots.wy-lee9591.chatgpt.site)'
const ACCEPTED_LICENSES = new Set([
  'CC BY-SA 4.0',
  'CC BY-SA 3.0',
  'CC BY 4.0',
  'CC BY 3.0',
  'CC BY 3.0 US',
  'CC BY 2.5',
  'CC0',
  'Public domain',
])
const LICENSE_URLS = {
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
  'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC BY 3.0 US': 'https://creativecommons.org/licenses/by/3.0/us/',
  'CC BY 2.5': 'https://creativecommons.org/licenses/by/2.5/',
  CC0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  'Public domain': 'https://creativecommons.org/publicdomain/mark/1.0/',
}

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

function englishSection(wikitext) {
  const heading = /^==English==\s*$/m.exec(wikitext)
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

function audioTemplates(section) {
  const recordings = []
  const pattern = /\{\{audio(?:-IPA)?\s*\|\s*en(?:-[a-z]+)?\s*\|\s*([^|}\n]+)([^}\n]*)\}\}/gi
  for (const match of section.matchAll(pattern)) {
    const filename = match[1].trim().replace(/^File:/i, '')
    if (!filename || filename.includes('{{')) continue
    const template = match[0]
    const accentMatch = /\|\s*(?:a|accent)\s*=\s*([^|}]+)/i.exec(template)
    const accent = plainText(accentMatch?.[1])
    const us =
      /^(?:en[-_ ]?us|en-us-|am(?:e|erican)[-_ ])/i.test(filename) ||
      /^(?:US|U\.S\.|United States|American|General American|California|Midwestern US|New England)$/i.test(accent)
    recordings.push({ filename, accent, us })
  }
  return recordings
}

function fileKey(filename) {
  return filename.replace(/_/g, ' ').trim().toLocaleLowerCase('en-US')
}

function accentLabel(recording) {
  if (recording.us) return '美式英語'
  if (/^(?:CA|Canada|Canadian)$/i.test(recording.accent)) return '加拿大英語'
  if (/^(?:UK|United Kingdom|British)$/i.test(recording.accent)) return '英式英語'
  if (/^(?:AU|Australia|Australian)$/i.test(recording.accent)) return '澳洲英語'
  if (/^(?:NZ|New Zealand)$/i.test(recording.accent)) return '紐西蘭英語'
  if (recording.accent) return recording.accent
  if (/^en[-_ ]?uk/i.test(recording.filename)) return '英式英語'
  if (/^en[-_ ]?au/i.test(recording.filename)) return '澳洲英語'
  if (/^en[-_ ]?ca/i.test(recording.filename)) return '加拿大英語'
  if (/^en[-_ ]?nz/i.test(recording.filename)) return '紐西蘭英語'
  return '英語（口音未標示）'
}

function recordingScore(recording) {
  let score = recording.us ? 1_000 : 0
  if (recording.metadata.categories.includes('U.S. English pronunciation')) score += 200
  if (/^en[-_ ]?us/i.test(recording.filename)) score += 100
  else if (/^en[-_ ]?(?:uk|au|ca|nz)/i.test(recording.filename)) score += 50
  if (/^LL-Q\d+ \(eng\)-/i.test(recording.filename)) score += 20
  return score
}

async function main() {
  const words = new Map()
  for (const relativePath of ['data/vocabulary-1000.json', 'data/vocabulary.json']) {
    const deck = JSON.parse(await fs.readFile(path.join(ROOT, relativePath), 'utf8'))
    for (const item of deck.words) {
      const key = item.word.trim().toLocaleLowerCase('en-US')
      if (!words.has(key)) words.set(key, item.word.trim())
    }
  }

  const candidatesByWord = new Map([...words].map(([key]) => [key, []]))
  for (const batch of batches([...words.values()], 50)) {
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
      const recordings = audioTemplates(englishSection(source))
      const aliases = [
        page.title,
        ...(payload.query?.redirects ?? []).filter((redirect) => redirect.to === page.title).map((redirect) => redirect.from),
      ]
      for (const alias of aliases) {
        const key = alias.trim().toLocaleLowerCase('en-US')
        if (candidatesByWord.has(key)) candidatesByWord.set(key, recordings)
      }
    }
    await sleep(100)
  }

  const filenames = [...new Set([...candidatesByWord.values()].flat().map((recording) => recording.filename))]
  const metadataByFilename = new Map()
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
      const info = page.videoinfo?.[0]
      const license = info?.extmetadata?.LicenseShortName?.value ?? info?.extmetadata?.UsageTerms?.value
      const mp3 = info?.derivatives?.find((derivative) => derivative.transcodekey === 'mp3')
      if (!info || !mp3?.src || !ACCEPTED_LICENSES.has(license)) continue
      const metadata = {
        filename: page.title.replace(/^File:/, ''),
        audioUrl: mp3.src,
        sourceUrl: info.descriptionurl,
        license,
        licenseUrl: LICENSE_URLS[license],
        artist: plainText(info.extmetadata?.Artist?.value) || 'Wikimedia Commons contributor',
        categories: (page.categories ?? []).map((category) => category.title.replace(/^Category:/, '')),
      }
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

  const selectedByWord = new Map()
  for (const [key, recordings] of candidatesByWord) {
    const candidates = recordings
      .map((recording) => ({ ...recording, metadata: metadataByFilename.get(fileKey(recording.filename)) }))
      .filter((recording) => recording.metadata)
      .sort((left, right) => recordingScore(right) - recordingScore(left))
    if (candidates[0]) selectedByWord.set(key, candidates[0])
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  const entries = {}
  for (const [key, selection] of [...selectedByWord].sort(([left], [right]) => left.localeCompare(right))) {
    entries[key] = {
      url: selection.metadata.audioUrl,
      accent: selection.us ? 'en-US' : 'en',
      accentLabel: accentLabel(selection),
      filename: selection.metadata.filename,
      sourceUrl: selection.metadata.sourceUrl,
      artist: selection.metadata.artist,
      license: selection.metadata.license,
      licenseUrl: selection.metadata.licenseUrl,
      note: 'Wikimedia Commons MP3 transcode of the recorded pronunciation.',
    }
  }

  for (const existing of await fs.readdir(OUTPUT_DIR)) {
    if (existing.endsWith('.mp3')) await fs.unlink(path.join(OUTPUT_DIR, existing))
  }

  const manifest = {
    title: 'Wiktionary English pronunciation recordings hosted by Wikimedia Commons',
    retrievedOn: new Date().toISOString().slice(0, 10),
    sourcePage: 'https://en.wiktionary.org/wiki/Help:Audio',
    licensePolicy: 'https://commons.wikimedia.org/wiki/Commons:Licensing',
    recordingCount: Object.keys(entries).length,
    usRecordingCount: Object.values(entries).filter((entry) => entry.accent === 'en-US').length,
    otherEnglishRecordingCount: Object.values(entries).filter((entry) => entry.accent !== 'en-US').length,
    recordings: entries,
  }
  const output = `${JSON.stringify(manifest, null, 2)}\n`
  await fs.writeFile(MANIFEST_PATH, output, 'utf8')
  await fs.writeFile(ATTRIBUTION_PATH, output, 'utf8')
  await fs.writeFile(SOURCE_PATH, `${JSON.stringify({ ...manifest, recordings: undefined }, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    uniqueGreWords: words.size,
    ...Object.fromEntries(Object.entries(manifest).filter(([key]) => key.endsWith('Count'))),
  }, null, 2))
}

await main()
