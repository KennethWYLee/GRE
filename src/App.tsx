import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Search,
  Shuffle,
  Sprout,
  Timer,
  Volume2,
  X,
} from 'lucide-react'
import { Button } from './components/ui/button'
import './App.css'

type RecallState = 'again' | 'hard' | 'known'
type StudyMode = 'all' | 'review' | 'known'
type PronunciationStatus = 'idle' | 'loading' | 'recording' | 'device' | 'unavailable'

type PartSummary = {
  id: number
  rootGroupCount: number
  rootedWordCount: number
  sWordCount: number
  totalWordCount: number
}

type RootGroup = {
  rootNo: number
  root: string
  part: number
  wordCount: number
}

type VocabularyWord = {
  id: string
  sourceNo: number
  part: number
  deckPosition: number
  rootNo: number | null
  root: string
  frequency: string
  word: string
  pronunciation: string
  meaning: string
  example: string
  definition: string
}

type VocabularyData = {
  meta: { totalWords: number; totalRootGroups: number; totalSWords: number }
  parts: PartSummary[]
  rootGroups: RootGroup[]
  words: VocabularyWord[]
}

type MemoryStore = {
  recall: Record<string, RecallState>
  positions: Record<string, number>
}

const STORAGE_KEY = 'gre-roots-progress-v1'
const AUTOPLAY_SECONDS_KEY = 'gre-roots-autoplay-seconds-v1'
const AUTOPLAY_OPTIONS = [3, 5, 8, 10, 15, 20, 30] as const
const SILENT_AUDIO =
  'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQIAAACAgA=='

function loadMemory(): MemoryStore {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return { recall: {}, positions: {} }
    const parsed = JSON.parse(saved) as Partial<MemoryStore>
    return { recall: parsed.recall ?? {}, positions: parsed.positions ?? {} }
  } catch {
    return { recall: {}, positions: {} }
  }
}

function loadAutoplaySeconds() {
  const saved = Number(window.localStorage.getItem(AUTOPLAY_SECONDS_KEY))
  return AUTOPLAY_OPTIONS.includes(saved as (typeof AUTOPLAY_OPTIONS)[number]) ? saved : 8
}

function App() {
  const [data, setData] = useState<VocabularyData | null>(null)
  const [selectedPart, setSelectedPart] = useState<number | null>(null)
  const [cardIndex, setCardIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [studyMode, setStudyMode] = useState<StudyMode>('all')
  const [rootFilter, setRootFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [shuffleOrder, setShuffleOrder] = useState<string[]>([])
  const [memory, setMemory] = useState<MemoryStore>(loadMemory)
  const [error, setError] = useState('')
  const [pronunciationStatus, setPronunciationStatus] = useState<PronunciationStatus>('idle')
  const [autoPlay, setAutoPlay] = useState(false)
  const [cardDuration, setCardDuration] = useState(loadAutoplaySeconds)
  const touchStartX = useRef<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUnlockedRef = useRef(false)
  const pronunciationRequestRef = useRef(0)
  const pronunciationCacheRef = useRef(new Map<string, Promise<string | null>>())

  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return
    const silent = new Audio(SILENT_AUDIO)
    silent.volume = 0.01
    void silent.play()
      .then(() => { audioUnlockedRef.current = true })
      .catch(() => undefined)
  }, [])

  const findRecording = useCallback((word: string) => {
    const key = word.toLocaleLowerCase()
    const cached = pronunciationCacheRef.current.get(key)
    if (cached) return cached

    const request = fetch(`/api/pronunciation?word=${encodeURIComponent(word)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => typeof payload?.audio === 'string' ? payload.audio : null)
      .catch(() => null)
    pronunciationCacheRef.current.set(key, request)
    return request
  }, [])

  const speakWithDevice = useCallback((word: string, requestId: number) => {
    if (!('speechSynthesis' in window)) {
      if (requestId === pronunciationRequestRef.current) setPronunciationStatus('unavailable')
      return
    }

    const synth = window.speechSynthesis
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(word)
    const voices = synth.getVoices().filter((voice) => voice.lang.toLocaleLowerCase().startsWith('en-us'))
    utterance.voice =
      voices.find((voice) => /samantha|ava|jenny|aria|joanna|natural|google us english/i.test(voice.name)) ??
      voices[0] ??
      null
    utterance.lang = 'en-US'
    utterance.rate = 0.88
    utterance.pitch = 1
    utterance.onstart = () => {
      if (requestId === pronunciationRequestRef.current) setPronunciationStatus('device')
    }
    utterance.onerror = () => {
      if (requestId === pronunciationRequestRef.current) setPronunciationStatus('unavailable')
    }
    synth.speak(utterance)
    if (requestId === pronunciationRequestRef.current) setPronunciationStatus('device')
  }, [])

  const playPronunciation = useCallback(async (word: string) => {
    const requestId = pronunciationRequestRef.current + 1
    pronunciationRequestRef.current = requestId
    setPronunciationStatus('loading')

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    window.speechSynthesis?.cancel()

    const recording = await findRecording(word)
    if (requestId !== pronunciationRequestRef.current) return

    if (recording) {
      try {
        const audio = audioRef.current ?? new Audio()
        audioRef.current = audio
        audio.src = recording
        audio.preload = 'auto'
        audio.playbackRate = 0.96
        audio.onplay = () => {
          if (requestId === pronunciationRequestRef.current) setPronunciationStatus('recording')
        }
        audio.onerror = () => speakWithDevice(word, requestId)
        await audio.play()
        return
      } catch {
        // A missing recording or an autoplay restriction falls back to the device's US voice.
      }
    }

    speakWithDevice(word, requestId)
  }, [findRecording, speakWithDevice])

  const stopPronunciation = useCallback(() => {
    pronunciationRequestRef.current += 1
    audioRef.current?.pause()
    window.speechSynthesis?.cancel()
    setPronunciationStatus('idle')
  }, [])

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/vocabulary.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<VocabularyData>
      })
      .then(setData)
      .catch(() => setError('單字資料載入失敗，請重新整理頁面。'))
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
  }, [memory])

  useEffect(() => {
    window.localStorage.setItem(AUTOPLAY_SECONDS_KEY, String(cardDuration))
  }, [cardDuration])

  const partWords = useMemo(
    () => data?.words.filter((word) => word.part === selectedPart) ?? [],
    [data, selectedPart],
  )

  const filteredWords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const orderMap = new Map(shuffleOrder.map((id, index) => [id, index]))
    return partWords
      .filter((word) => {
        const recall = memory.recall[word.id]
        const matchesMode =
          studyMode === 'all' ||
          (studyMode === 'review' && recall !== 'known') ||
          (studyMode === 'known' && recall === 'known')
        const matchesRoot =
          rootFilter === 'all' ||
          (rootFilter === 'S' ? word.root === 'S' : String(word.rootNo) === rootFilter)
        const matchesQuery =
          !normalizedQuery ||
          word.word.toLocaleLowerCase().includes(normalizedQuery) ||
          word.meaning.toLocaleLowerCase().includes(normalizedQuery) ||
          word.root.toLocaleLowerCase().includes(normalizedQuery)
        return matchesMode && matchesRoot && matchesQuery
      })
      .sort((a, b) => {
        if (!shuffleOrder.length) return a.deckPosition - b.deckPosition
        return (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0)
      })
  }, [memory.recall, partWords, query, rootFilter, shuffleOrder, studyMode])

  const activeWord = filteredWords[cardIndex]

  useEffect(() => {
    if (!data) return
    for (const part of data.parts) {
      const firstWord = data.words.find((word) => word.part === part.id)
      if (firstWord) void findRecording(firstWord.word)
    }
  }, [data, findRecording])

  useEffect(() => {
    if (!activeWord) return
    const timeout = window.setTimeout(() => {
      void playPronunciation(activeWord.word)
    }, 80)
    return () => window.clearTimeout(timeout)
  }, [activeWord, playPronunciation])

  useEffect(() => stopPronunciation, [stopPronunciation])

  useEffect(() => {
    if (!autoPlay || !activeWord) return

    const totalMilliseconds = cardDuration * 1000
    const resetTimer = window.setTimeout(() => setFlipped(false), 0)
    const flipTimer = window.setTimeout(() => setFlipped(true), totalMilliseconds / 2)
    const nextTimer = window.setTimeout(() => {
      if (cardIndex >= filteredWords.length - 1) {
        setAutoPlay(false)
        setFlipped(true)
        return
      }

      const nextIndex = cardIndex + 1
      setCardIndex(nextIndex)
      setFlipped(false)
      if (selectedPart !== null && studyMode === 'all' && rootFilter === 'all' && !query) {
        setMemory((current) => ({
          ...current,
          positions: { ...current.positions, [String(selectedPart)]: nextIndex },
        }))
      }
    }, totalMilliseconds)

    return () => {
      window.clearTimeout(resetTimer)
      window.clearTimeout(flipTimer)
      window.clearTimeout(nextTimer)
    }
  }, [activeWord, autoPlay, cardDuration, cardIndex, filteredWords.length, query, rootFilter, selectedPart, studyMode])

  const rootsForPart = useMemo(
    () => data?.rootGroups.filter((group) => group.part === selectedPart) ?? [],
    [data, selectedPart],
  )

  const knownCountForPart = (part: number) =>
    data?.words.filter((word) => word.part === part && memory.recall[word.id] === 'known').length ?? 0

  const openPart = (part: number) => {
    unlockAudio()
    setAutoPlay(false)
    setSelectedPart(part)
    setStudyMode('all')
    setRootFilter('all')
    setQuery('')
    setShuffleOrder([])
    setCardIndex(Math.max(0, memory.positions[String(part)] ?? 0))
    setFlipped(false)
  }

  const moveCard = (direction: -1 | 1) => {
    if (!filteredWords.length) return
    unlockAudio()
    const next = Math.min(Math.max(cardIndex + direction, 0), filteredWords.length - 1)
    setCardIndex(next)
    setFlipped(false)
    if (selectedPart !== null && studyMode === 'all' && rootFilter === 'all' && !query) {
      setMemory((current) => ({
        ...current,
        positions: { ...current.positions, [String(selectedPart)]: next },
      }))
    }
  }

  const markRecall = (recall: RecallState) => {
    if (!activeWord) return
    setMemory((current) => ({
      ...current,
      recall: { ...current.recall, [activeWord.id]: recall },
    }))
    if (cardIndex < filteredWords.length - 1) {
      window.setTimeout(() => moveCard(1), 100)
    }
  }

  const applyMode = (mode: StudyMode) => {
    unlockAudio()
    setAutoPlay(false)
    setStudyMode(mode)
    setCardIndex(0)
    setFlipped(false)
  }

  const applyRoot = (root: string) => {
    unlockAudio()
    setAutoPlay(false)
    setRootFilter(root)
    setCardIndex(0)
    setFlipped(false)
  }

  const shuffleDeck = () => {
    unlockAudio()
    setAutoPlay(false)
    const shuffled = [...partWords.map((word) => word.id)]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1))
      ;[shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]]
    }
    setShuffleOrder(shuffled)
    setCardIndex(0)
    setFlipped(false)
  }

  const returnHome = () => {
    stopPronunciation()
    setAutoPlay(false)
    setSelectedPart(null)
  }

  const toggleAutoPlay = () => {
    unlockAudio()
    if (!autoPlay && activeWord) {
      setFlipped(false)
      void playPronunciation(activeWord.word)
    }
    setAutoPlay((playing) => !playing)
  }

  const changeCardDuration = (seconds: number) => {
    setCardDuration(seconds)
    if (autoPlay) setFlipped(false)
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT') return
      if (event.key === 'ArrowLeft') moveCard(-1)
      if (event.key === 'ArrowRight') moveCard(1)
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        setFlipped((value) => !value)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  if (error) return <main className="status-screen">{error}</main>

  if (!data) {
    return (
      <main className="status-screen">
        <Sprout className="loading-mark" aria-hidden="true" />
        正在整理今天的字卡…
      </main>
    )
  }

  if (selectedPart === null) {
    const totalKnown = Object.values(memory.recall).filter((recall) => recall === 'known').length
    const totalRemaining = data.meta.totalWords - totalKnown
    return (
      <main className="app-shell home-shell">
        <header className="brand-bar">
          <a className="brand" href="/" aria-label="GRE Roots 首頁">
            <span className="brand-mark"><Sprout size={18} /></span>
            GRE ROOTS
          </a>
          <span className="word-total">已背 {totalKnown.toLocaleString()} · 剩 {totalRemaining.toLocaleString()}</span>
        </header>

        <section className="intro">
          <p className="eyebrow">MASON 2000 · ROOT DECK</p>
          <h1>選一份，開始把字<br />連成有意義的家族。</h1>
          <p className="intro-copy">
            五份各約 415 字；同字根不拆散，無字根字平均穿插。進入每張卡會自動播放美式發音。
          </p>
        </section>

        <section className="part-section" aria-labelledby="part-heading">
          <div className="section-heading">
            <div>
              <p className="section-kicker">TODAY'S DECK</p>
              <h2 id="part-heading">今天想背哪一份？</h2>
            </div>
            <p>App 不另設帳號，進度只存在這支裝置</p>
          </div>

          <div className="part-grid">
            {data.parts.map((part) => {
              const known = knownCountForPart(part.id)
              const remaining = part.totalWordCount - known
              const percent = Math.round((known / part.totalWordCount) * 100)
              return (
                <button className="part-card" key={part.id} onClick={() => openPart(part.id)} type="button">
                  <span className="part-number">0{part.id}</span>
                  <span className="part-title">第 {part.id} 份</span>
                  <span className="part-meta">{part.rootGroupCount} 字根 · {part.totalWordCount} 字</span>
                  <span className="part-counts">已背 {known} · 剩 {remaining}</span>
                  <span className="part-progress"><i style={{ width: `${percent}%` }} /></span>
                  <span className="part-known">{percent}%</span>
                  <span className="part-arrow"><ChevronRight size={18} /></span>
                </button>
              )
            })}
          </div>
        </section>
      </main>
    )
  }

  const partSummary = data.parts.find((part) => part.id === selectedPart)
  const partKnown = knownCountForPart(selectedPart)
  const partTotal = partSummary?.totalWordCount ?? 0
  const partRemaining = partTotal - partKnown
  const partKnownPercent = partTotal ? Math.round((partKnown / partTotal) * 100) : 0
  const currentRecall = activeWord ? memory.recall[activeWord.id] : undefined
  const pronunciationLabel =
    pronunciationStatus === 'recording' ? '美式真人發音' :
    pronunciationStatus === 'device' ? '美式裝置發音' :
    pronunciationStatus === 'loading' ? '載入美式發音' :
    pronunciationStatus === 'unavailable' ? '重新播放發音' :
    '播放美式發音'

  return (
    <main className="app-shell study-shell">
      <header className="study-header">
        <Button aria-label="回到選份頁" className="icon-button" onClick={returnHome} size="icon" variant="ghost">
          <ArrowLeft size={20} />
        </Button>
        <div className="study-title">
          <span>PART {selectedPart}</span>
          <strong>{filteredWords.length ? `${cardIndex + 1} / ${filteredWords.length}` : '沒有符合的字卡'}</strong>
        </div>
        <Button aria-label="打亂目前這份" className="icon-button" onClick={shuffleDeck} size="icon" variant="ghost">
          <Shuffle size={18} />
        </Button>
      </header>

      <div className="progress-track" aria-label="目前卡組進度">
        <span style={{ width: filteredWords.length ? `${((cardIndex + 1) / filteredWords.length) * 100}%` : '0%' }} />
      </div>

      <section className="memory-progress" aria-labelledby="memory-progress-heading">
        <div className="memory-progress-heading">
          <span id="memory-progress-heading">本份背誦進度</span>
          <strong>{partKnownPercent}%</strong>
        </div>
        <div className="memory-progress-track" aria-hidden="true">
          <span style={{ width: `${partKnownPercent}%` }} />
        </div>
        <table className="memory-progress-table">
          <thead>
            <tr><th scope="col">已背</th><th scope="col">還剩</th><th scope="col">全部</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>{partKnown}</strong><span> 字</span></td>
              <td><strong>{partRemaining}</strong><span> 字</span></td>
              <td><strong>{partTotal}</strong><span> 字</span></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="study-toolbar" aria-label="篩選字卡">
        <div className="mode-tabs">
          {([
            ['all', '全部'],
            ['review', '待複習'],
            ['known', '已記住'],
          ] as const).map(([mode, label]) => (
            <button className={studyMode === mode ? 'is-active' : ''} key={mode} onClick={() => applyMode(mode)} type="button">
              {label}
            </button>
          ))}
        </div>
        <div className="filter-row">
          <label className="search-box">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="搜尋單字、字根或意思"
              onChange={(event) => { setAutoPlay(false); setQuery(event.target.value); setCardIndex(0); setFlipped(false) }}
              placeholder="搜尋單字或意思"
              value={query}
            />
            {query && (
              <button aria-label="清除搜尋" onClick={() => { setAutoPlay(false); setQuery('') }} type="button"><X size={15} /></button>
            )}
          </label>
          <select aria-label="選擇字根家族" onChange={(event) => applyRoot(event.target.value)} value={rootFilter}>
            <option value="all">全部字根</option>
            {rootsForPart.map((group) => (
              <option key={group.rootNo} value={group.rootNo}>#{group.rootNo} · {group.root}</option>
            ))}
            <option value="S">S · 無字根（{partSummary?.sWordCount ?? 0}）</option>
          </select>
        </div>
        <div className={`autoplay-panel ${autoPlay ? 'is-playing' : ''}`}>
          <button aria-pressed={autoPlay} className="autoplay-toggle" onClick={toggleAutoPlay} type="button">
            {autoPlay ? <Pause size={18} /> : <Play size={18} />}
            <span>
              <strong>{autoPlay ? '暫停自動連播' : '開始自動連播'}</strong>
              <small>先看單字，後半自動翻到解釋</small>
            </span>
          </button>
          <label className="duration-control">
            <Timer size={17} aria-hidden="true" />
            <span>每字</span>
            <select
              aria-label="選擇每個單字停留秒數"
              onChange={(event) => changeCardDuration(Number(event.target.value))}
              value={cardDuration}
            >
              {AUTOPLAY_OPTIONS.map((seconds) => (
                <option key={seconds} value={seconds}>{seconds} 秒</option>
              ))}
            </select>
          </label>
        </div>
        {autoPlay && activeWord && (
          <div className="autoplay-timeline" aria-label={`這張字卡停留 ${cardDuration} 秒`}>
            <span key={`${activeWord.id}-${cardDuration}`} style={{ animationDuration: `${cardDuration}s` }} />
          </div>
        )}
      </section>

      {activeWord ? (
        <section className="study-stage">
          <div
            aria-label={flipped ? '查看單字正面' : '查看單字解釋'}
            className={`flashcard ${flipped ? 'is-flipped' : ''}`}
            onClick={() => setFlipped((value) => !value)}
            onTouchEnd={(event) => {
              if (touchStartX.current === null) return
              const distance = event.changedTouches[0].clientX - touchStartX.current
              if (Math.abs(distance) > 55) moveCard(distance > 0 ? -1 : 1)
              touchStartX.current = null
            }}
            onTouchStart={(event) => { touchStartX.current = event.touches[0].clientX }}
            role="group"
          >
            {!flipped ? (
              <div className="card-front">
                <div className="card-topline">
                  <span>{activeWord.root === 'S' ? 'NO ROOT' : `ROOT ${activeWord.rootNo}`}</span>
                  <span className={`recall-dot recall-${currentRecall ?? 'new'}`}>
                    {currentRecall === 'known' ? '已記住' : currentRecall === 'hard' ? '模糊' : currentRecall === 'again' ? '待複習' : `FREQ ${activeWord.frequency}`}
                  </span>
                </div>
                <div className="word-block">
                  <h2>{activeWord.word}</h2>
                  {activeWord.pronunciation && <p>/{activeWord.pronunciation}/</p>}
                  <button
                    aria-label={`重播 ${activeWord.word} 的美式發音`}
                    className={`pronounce-button status-${pronunciationStatus}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      unlockAudio()
                      void playPronunciation(activeWord.word)
                    }}
                    type="button"
                  >
                    {pronunciationStatus === 'loading' ?
                      <LoaderCircle className="pronounce-spinner" size={17} /> :
                      <Volume2 size={17} />}
                    <span aria-live="polite">{pronunciationLabel}</span>
                  </button>
                </div>
                <p className="flip-hint"><RotateCcw size={14} /> 輕觸翻面 · 左右滑動換字</p>
              </div>
            ) : (
              <div className="card-back">
                <div className="root-label">
                  <span>字根</span>
                  <strong>{activeWord.root === 'S' ? 'S · 無字根' : activeWord.root}</strong>
                </div>
                <div className="detail-block meaning-block">
                  <span>中文意思</span>
                  <h2>{activeWord.meaning}</h2>
                </div>
                {activeWord.definition && (
                  <div className="detail-block">
                    <span>ENGLISH</span>
                    <p>{activeWord.definition}</p>
                  </div>
                )}
                {activeWord.example && (
                  <div className="detail-block example-block">
                    <span>EXAMPLE</span>
                    <p>{activeWord.example}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {flipped ? (
            <div className="recall-actions" aria-label="評估記憶程度">
              <button className="again-action" onClick={() => markRecall('again')} type="button">
                <X size={18} /><span>還不熟<small>待會再看</small></span>
              </button>
              <button className="hard-action" onClick={() => markRecall('hard')} type="button">
                <CircleHelp size={18} /><span>有點模糊<small>需要複習</small></span>
              </button>
              <button className="known-action" onClick={() => markRecall('known')} type="button">
                <Check size={18} /><span>記住了<small>完成這張</small></span>
              </button>
            </div>
          ) : (
            <nav className="card-nav" aria-label="切換字卡">
              <Button disabled={cardIndex === 0} onClick={() => moveCard(-1)} size="lg" variant="outline">
                <ChevronLeft size={18} /> 上一張
              </Button>
              <Button onClick={() => setFlipped(true)} size="lg">
                查看答案 <ChevronRight size={18} />
              </Button>
            </nav>
          )}
        </section>
      ) : (
        <section className="empty-state">
          <Check size={26} />
          <h2>{studyMode === 'review' ? '目前沒有待複習的字卡' : '找不到符合條件的字卡'}</h2>
          <p>可以切回「全部」，或清除搜尋與字根篩選。</p>
          <Button onClick={() => { applyMode('all'); applyRoot('all'); setQuery('') }} variant="outline">顯示全部字卡</Button>
        </section>
      )}
    </main>
  )
}

export default App
