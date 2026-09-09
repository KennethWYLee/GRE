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
}

export function getWordIllustration(wordId: string) {
  return WORD_ILLUSTRATIONS[wordId] ?? null
}

const preloadedImages = new Map<string, HTMLImageElement>()

export function preloadWordIllustrations(wordIds: readonly string[]) {
  if (typeof Image === 'undefined') return
  for (const wordId of wordIds) {
    const illustration = getWordIllustration(wordId)
    if (!illustration || preloadedImages.has(illustration.src)) continue
    const image = new Image()
    preloadedImages.set(illustration.src, image)
    image.decoding = 'async'
    image.onerror = () => { preloadedImages.delete(illustration.src) }
    image.src = illustration.src
  }
}
