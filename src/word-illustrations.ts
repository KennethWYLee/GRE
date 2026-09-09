import { PARTS_1_2_3_ILLUSTRATIONS } from './word-illustrations-parts1-3.ts'
import { PARTS_4_5_ILLUSTRATIONS } from './word-illustrations-parts4-5.ts'

type WordIllustration = {
  word: string
  src: string
  alt: string
}

export const WORD_ILLUSTRATIONS: Readonly<Record<string, WordIllustration>> = {
  'word1000-124': { word: 'prodigal', src: '/images/words/prodigal-v1.webp', alt: '揮霍：一個人任意撒錢，身旁堆滿過量購物袋與物品' },
  'word1000-171': { word: 'exigent', src: '/images/words/exigent-v1.webp', alt: '緊急：水管破裂噴水，一個人立即關閉水閥' },
  'word1000-529': { word: 'agitated', src: '/images/words/agitated-v1.webp', alt: '不安：一個人皺眉、緊握雙手，焦躁地踱步' },
  'word1000-537': { word: 'perennial', src: '/images/words/perennial-v1.webp', alt: '長久持續：同一棵常綠樹經歷四季仍然屹立' },
  'word1000-19': { word: 'belie', src: '/images/words/belie-v1.webp', alt: '表象與事實不一致：外皮漂亮的蘋果切開後，露出腐壞的果心' },
  'word1000-89': { word: 'deft', src: '/images/words/deft-v1.webp', alt: '靈巧：雙手俐落地綁出整齊的小蝴蝶結' },
  'word1000-219': { word: 'inept', src: '/images/words/inept-v1.webp', alt: '不熟練：新手做出的蛋糕歪斜倒塌，糖霜散落在桌面' },
  'word1000-224': { word: 'apt', src: '/images/words/apt-v1.webp', alt: '適合：選對尺寸的扳手，恰好扣住螺栓' },
  'word1000-393': { word: 'adaptive', src: '/images/words/adaptive-v1.webp', alt: '適應：登山者遇到天氣轉雨，換上雨衣並撐傘繼續前進' },
  'word1000-520': { word: 'adept', src: '/images/words/adept-v1.webp', alt: '熟練：專業廚師穩定完成一排精緻而整齊的料理' },
  ...PARTS_1_2_3_ILLUSTRATIONS,
  ...PARTS_4_5_ILLUSTRATIONS,
}

export function getWordIllustration(wordId: string) {
  return WORD_ILLUSTRATIONS[wordId] ?? null
}

type PreloadedImage = {
  image: HTMLImageElement
  loading: boolean
  timeout: ReturnType<typeof setTimeout> | null
}

const preloadedImages = new Map<string, PreloadedImage>()
const PRELOAD_LIMIT = 11
const PRELOAD_CONCURRENCY = 2
const PRELOAD_TIMEOUT_MS = 8_000
let pendingSources: string[] = []
let startTimer: ReturnType<typeof setTimeout> | null = null

function detachPreload(entry: PreloadedImage) {
  if (entry.timeout !== null) clearTimeout(entry.timeout)
  entry.timeout = null
  entry.image.onload = null
  entry.image.onerror = null
}

function pumpPreloads() {
  let loading = [...preloadedImages.values()].filter((entry) => entry.loading).length
  while (pendingSources.length && loading < PRELOAD_CONCURRENCY) {
    const src = pendingSources.shift()!
    if (preloadedImages.has(src)) continue
    const image = new Image()
    const entry: PreloadedImage = { image, loading: true, timeout: null }
    preloadedImages.set(src, entry)
    image.decoding = 'async'
    image.fetchPriority = 'low'
    const finish = (loaded: boolean) => {
      if (preloadedImages.get(src) !== entry) return
      detachPreload(entry)
      entry.loading = false
      if (!loaded) {
        preloadedImages.delete(src)
        image.removeAttribute('src')
      }
      pumpPreloads()
    }
    image.onload = () => finish(true)
    image.onerror = () => finish(false)
    entry.timeout = setTimeout(() => finish(false), PRELOAD_TIMEOUT_MS)
    loading += 1
    image.src = src
  }
}

export function preloadWordIllustrations(wordIds: readonly string[]) {
  if (typeof Image === 'undefined') return
  const sources = new Set(wordIds.slice(0, PRELOAD_LIMIT)
    .map((wordId) => getWordIllustration(wordId)?.src)
    .filter((src): src is string => Boolean(src)))
  // Retain only the current card and its lookahead, not every decoded image visited.
  for (const [src, entry] of preloadedImages) {
    if (sources.has(src)) continue
    detachPreload(entry)
    if (entry.loading) entry.image.removeAttribute('src')
    preloadedImages.delete(src)
  }
  pendingSources = [...sources].filter((src) => !preloadedImages.has(src))
  if (startTimer !== null) clearTimeout(startTimer)
  startTimer = null
  if (pendingSources.length) {
    // Let card text and speech start first; never join image work to autoplay.
    startTimer = setTimeout(() => {
      startTimer = null
      pumpPreloads()
    }, 200)
  }
}
