import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BarChart3,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  CircleHelp,
  Cloud,
  CloudOff,
  Flame,
  Keyboard,
  Languages,
  LoaderCircle,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  Search,
  Shuffle,
  ShieldCheck,
  Sprout,
  Star,
  Timer,
  Volume2,
  X,
} from 'lucide-react'
import { Button } from './components/ui/button'
import { AccountAccess, type ApprovedSession } from './AccountAccess'
import { apiFetch } from './api-client'
import { runAutoplayCard } from './autoplay'
import wikimediaEnglishAudio from './wikimedia-english-audio.json'
import {
  advanceQuiz,
  buildQuizOptions,
  calculateStreak,
  dueWordIds,
  emptyMemory,
  getOrCreateDeviceId,
  loadMemory,
  localDateKey,
  mergeMemory,
  normalizeMemory,
  normalizeSpelling,
  quizValue,
  recordReview,
  saveMemory,
  setPosition,
  toggleFavorite,
  type DeckId,
  type MemoryStore,
  type QuizKind,
  type RecallState,
} from './study-memory'
import './App.css'

type StudyMode = 'all' | 'review' | 'known' | 'favorites'
type PronunciationStatus = 'idle' | 'loading' | 'human-us' | 'human-other' | 'ai' | 'unavailable'
type MandarinStatus = 'idle' | 'loading' | 'ai' | 'unavailable'
type SequenceMode = 'fixed' | 'random'
type CardMode = 'flashcard' | 'quiz'
type SyncStatus = 'idle' | 'loading' | 'synced' | 'offline'

type ProgressResponse = {
  progress: unknown
  revision: number
}

type SaveProgressResponse = {
  ok?: boolean
  progress?: unknown
  revision: number
}

type PlaybackEntry = {
  wordId: string
  promise: Promise<boolean>
  completed: boolean
}

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
  meta: { deckId: DeckId; title: string; totalWords: number; totalRootGroups: number; totalSWords: number }
  parts: PartSummary[]
  rootGroups: RootGroup[]
  words: VocabularyWord[]
}

const SEQUENCE_MODE_KEY = 'gre-roots-sequence-mode-v1'
const AUTOPLAY_SECONDS_KEY = 'gre-roots-autoplay-seconds-v1'
const MANDARIN_AUTOPLAY_KEY = 'gre-roots-mandarin-autoplay-v1'
const AUTOPLAY_OPTIONS = [3, 5, 8, 10, 15, 20, 30] as const
const PRONUNCIATION_LOOKAHEAD = 20
const HUMAN_RECORDING_START_WAIT_MS = 2_500
const SPEECH_COMPLETION_TIMEOUT_MS = 15_000
const PAUSE_AFTER_SPEECH_MS = 1_000
const SPEECH_VOLUME = 1
const WIKIMEDIA_ENGLISH_RECORDINGS = wikimediaEnglishAudio.recordings as Record<string, {
  url: string
  accent: 'en-US' | 'en'
  accentLabel: string
  filename: string
  sourceUrl: string
  artist: string
  license: string
  licenseUrl: string
  note: string
}>
const SILENT_AUDIO =
  'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQIAAACAgA=='

function loadSequenceMode(): SequenceMode {
  return window.localStorage.getItem(SEQUENCE_MODE_KEY) === 'random' ? 'random' : 'fixed'
}

function shuffledWordIds(words: VocabularyWord[]) {
  const shuffled = words.map((word) => word.id)
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]]
  }
  return shuffled
}

function loadAutoplaySeconds() {
  const saved = Number(window.localStorage.getItem(AUTOPLAY_SECONDS_KEY))
  return AUTOPLAY_OPTIONS.includes(saved as (typeof AUTOPLAY_OPTIONS)[number]) ? saved : 8
}

function loadMandarinAutoplay() {
  return window.localStorage.getItem(MANDARIN_AUTOPLAY_KEY) === 'on'
}

type MeaningSections = {
  primary: string
  synonyms: string[]
  antonyms: string[]
  memoryNotes: string[]
}

function splitMeaningSections(value: string): MeaningSections {
  const matches = [...value.matchAll(/\[(類|反|記)\]\s*/g)]
  if (!matches.length) return { primary: value.trim(), synonyms: [], antonyms: [], memoryNotes: [] }

  const sections: MeaningSections = {
    primary: value.slice(0, matches[0].index).trim(),
    synonyms: [],
    antonyms: [],
    memoryNotes: [],
  }

  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? value.length
    const content = value.slice(start, end).trim()
    if (!content) return
    if (match[1] === '類') sections.synonyms.push(content)
    if (match[1] === '反') sections.antonyms.push(content)
    if (match[1] === '記') sections.memoryNotes.push(content)
  })

  return sections
}

function mandarinSpeechText(value: string) {
  return value
    .replace(/[^\p{Script=Han}0-9，。；、：！？（）\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function selectMandarinVoice(voices: SpeechSynthesisVoice[]) {
  const candidates = voices.filter((voice) => {
    const language = voice.lang.toLocaleLowerCase()
    return language === 'zh-tw' || language.startsWith('zh-hant') || language.startsWith('zh')
  })
  return candidates.find((voice) => /natural|premium|enhanced|online|hsiaochen|hanhan|yating|meijia|google/i.test(voice.name)) ??
    candidates.find((voice) => voice.lang.toLocaleLowerCase() === 'zh-tw') ??
    candidates[0] ??
    null
}

function StudyApp({
  onManageAccounts,
  session,
}: {
  onManageAccounts: () => void
  session: ApprovedSession
}) {
  const [data, setData] = useState<VocabularyData | null>(null)
  const [selectedDeck, setSelectedDeck] = useState<DeckId | null>(null)
  const [sequenceMode, setSequenceMode] = useState<SequenceMode>(loadSequenceMode)
  const [selectedPart, setSelectedPart] = useState<number | null>(null)
  const [dailyReview, setDailyReview] = useState(false)
  const [dailyReviewIds, setDailyReviewIds] = useState<string[]>([])
  const [favoriteReview, setFavoriteReview] = useState(false)
  const [cardIndex, setCardIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [studyMode, setStudyMode] = useState<StudyMode>('all')
  const [rootFilter, setRootFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [shuffleOrder, setShuffleOrder] = useState<string[]>([])
  const [memory, setMemory] = useState<MemoryStore>(emptyMemory)
  const [syncReady, setSyncReady] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [cardMode, setCardMode] = useState<CardMode>('flashcard')
  const [quizKind, setQuizKind] = useState<QuizKind>('meaning')
  const [quizQueue, setQuizQueue] = useState<string[]>([])
  const [quizAnswer, setQuizAnswer] = useState('')
  const [quizFeedback, setQuizFeedback] = useState<{ correct: boolean; correctValue: string } | null>(null)
  const [quizComplete, setQuizComplete] = useState(false)
  const [sessionReviewedIds, setSessionReviewedIds] = useState<string[]>([])
  const [roundComplete, setRoundComplete] = useState(false)
  const [error, setError] = useState('')
  const [pronunciationStatus, setPronunciationStatus] = useState<PronunciationStatus>('idle')
  const [mandarinStatus, setMandarinStatus] = useState<MandarinStatus>('idle')
  const [mandarinAutoplay, setMandarinAutoplay] = useState(loadMandarinAutoplay)
  const [autoPlay, setAutoPlay] = useState(false)
  const [cardDuration, setCardDuration] = useState(loadAutoplaySeconds)
  const deviceId = useMemo(() => getOrCreateDeviceId(), [])
  const touchStartX = useRef<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUnlockedRef = useRef(false)
  const pronunciationRequestRef = useRef(0)
  const mandarinRequestRef = useRef(0)
  const syncRevisionRef = useRef(0)
  const lastSyncedMemoryRef = useRef('')
  const syncRequestRef = useRef(0)
  const pronunciationPreloadRef = useRef(new Map<string, HTMLAudioElement>())
  const englishPlaybackRef = useRef<PlaybackEntry | null>(null)
  const mandarinPlaybackRef = useRef<PlaybackEntry | null>(null)

  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return
    const silent = new Audio(SILENT_AUDIO)
    silent.volume = 0.01
    void silent.play()
      .then(() => { audioUnlockedRef.current = true })
      .catch(() => undefined)
  }, [])

  const preloadRecording = useCallback((word: string) => {
    const key = word.toLocaleLowerCase()
    const recording = WIKIMEDIA_ENGLISH_RECORDINGS[key]
    if (!recording) return
    if (pronunciationPreloadRef.current.has(key)) return

    const audio = new Audio(recording.url)
    audio.preload = 'auto'
    audio.volume = SPEECH_VOLUME
    audio.load()
    pronunciationPreloadRef.current.set(key, audio)

    while (pronunciationPreloadRef.current.size > PRONUNCIATION_LOOKAHEAD * 2) {
      const oldestKey = pronunciationPreloadRef.current.keys().next().value
      if (typeof oldestKey !== 'string') break
      const oldestAudio = pronunciationPreloadRef.current.get(oldestKey)
      oldestAudio?.pause()
      oldestAudio?.removeAttribute('src')
      pronunciationPreloadRef.current.delete(oldestKey)
    }
  }, [])

  const speakWithDevice = useCallback((word: string, requestId: number) => (
    new Promise<boolean>((resolve) => {
      if (!('speechSynthesis' in window)) {
        if (requestId === pronunciationRequestRef.current) setPronunciationStatus('unavailable')
        resolve(false)
        return
      }

      const synth = window.speechSynthesis
      synth.cancel()
      const utterance = new SpeechSynthesisUtterance(word)
      const voices = synth.getVoices().filter((voice) => voice.lang.toLocaleLowerCase().startsWith('en-us'))
      let settled = false
      const finish = (played: boolean) => {
        if (settled) return
        settled = true
        window.clearTimeout(completionTimer)
        utterance.onstart = null
        utterance.onend = null
        utterance.onerror = null
        resolve(played)
      }
      const completionTimer = window.setTimeout(() => {
        synth.cancel()
        finish(false)
      }, SPEECH_COMPLETION_TIMEOUT_MS)
      utterance.voice =
        voices.find((voice) => /samantha|ava|jenny|aria|joanna|natural|google us english/i.test(voice.name)) ??
        voices[0] ??
        null
      utterance.lang = 'en-US'
      utterance.rate = 0.88
      utterance.pitch = 1
      utterance.volume = SPEECH_VOLUME
      utterance.onstart = () => {
        if (requestId === pronunciationRequestRef.current) setPronunciationStatus('ai')
      }
      utterance.onend = () => finish(true)
      utterance.onerror = (event) => {
        if (requestId === pronunciationRequestRef.current && event.error !== 'canceled') {
          setPronunciationStatus('unavailable')
        }
        finish(false)
      }
      synth.speak(utterance)
      if (requestId === pronunciationRequestRef.current) setPronunciationStatus('ai')
    })
  ), [])

  const playPronunciation = useCallback(async (word: string) => {
    const requestId = pronunciationRequestRef.current + 1
    pronunciationRequestRef.current = requestId
    setPronunciationStatus('loading')
    mandarinRequestRef.current += 1
    setMandarinStatus('idle')

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    window.speechSynthesis?.cancel()

    const key = word.toLocaleLowerCase()
    const recording = WIKIMEDIA_ENGLISH_RECORDINGS[key]

    if (recording) {
      const played = await new Promise<boolean>((resolve) => {
        const preloadedAudio = pronunciationPreloadRef.current.get(key)
        const audio = preloadedAudio ?? new Audio(recording.url)
        pronunciationPreloadRef.current.delete(key)
        audio.volume = SPEECH_VOLUME
        audioRef.current = audio
        let settled = false
        const finish = (completed: boolean) => {
          if (settled) return
          settled = true
          window.clearTimeout(startTimer)
          window.clearTimeout(completionTimer)
          audio.onplay = null
          audio.onended = null
          audio.onerror = null
          audio.onpause = null
          resolve(completed)
        }
        const startTimer = window.setTimeout(() => {
          audio.pause()
          finish(false)
        }, HUMAN_RECORDING_START_WAIT_MS)
        const completionTimer = window.setTimeout(() => {
          audio.pause()
          finish(false)
        }, SPEECH_COMPLETION_TIMEOUT_MS)
        audio.onplay = () => {
          window.clearTimeout(startTimer)
          if (requestId === pronunciationRequestRef.current) {
            setPronunciationStatus(recording.accent === 'en-US' ? 'human-us' : 'human-other')
          }
        }
        audio.onended = () => finish(true)
        audio.onerror = () => finish(false)
        audio.onpause = () => {
          if (!audio.ended) finish(false)
        }
        void audio.play().catch(() => finish(false))
      })
      if (requestId !== pronunciationRequestRef.current) return false
      if (played) return true
    }

    return speakWithDevice(word, requestId)
  }, [speakWithDevice])

  const speakMandarinWithDevice = useCallback((text: string, requestId: number) => (
    new Promise<boolean>((resolve) => {
      if (!('speechSynthesis' in window)) {
        if (requestId === mandarinRequestRef.current) setMandarinStatus('unavailable')
        resolve(false)
        return
      }

      const synth = window.speechSynthesis
      const utterance = new SpeechSynthesisUtterance(text)
      let settled = false
      const finish = (played: boolean) => {
        if (settled) return
        settled = true
        window.clearTimeout(completionTimer)
        utterance.onstart = null
        utterance.onend = null
        utterance.onerror = null
        resolve(played)
      }
      const completionTimer = window.setTimeout(() => {
        synth.cancel()
        finish(false)
      }, SPEECH_COMPLETION_TIMEOUT_MS)
      utterance.lang = 'zh-TW'
      utterance.voice = selectMandarinVoice(synth.getVoices())
      utterance.rate = 0.9
      utterance.pitch = 1
      utterance.volume = SPEECH_VOLUME
      utterance.onstart = () => {
        if (requestId === mandarinRequestRef.current) setMandarinStatus('ai')
      }
      utterance.onend = () => finish(true)
      utterance.onerror = (event) => {
        if (requestId === mandarinRequestRef.current && event.error !== 'canceled') {
          setMandarinStatus('unavailable')
        }
        finish(false)
      }
      synth.speak(utterance)
    })
  ), [])

  const speakMandarin = useCallback(async (meaning: string) => {
    const requestId = mandarinRequestRef.current + 1
    mandarinRequestRef.current = requestId
    pronunciationRequestRef.current += 1
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    setPronunciationStatus('idle')
    window.speechSynthesis?.cancel()

    const text = mandarinSpeechText(meaning)
    if (!text) {
      setMandarinStatus('unavailable')
      return false
    }
    setMandarinStatus('loading')
    return speakMandarinWithDevice(text, requestId)
  }, [speakMandarinWithDevice])

  const startEnglishPlayback = useCallback((wordId: string, word: string) => {
    mandarinPlaybackRef.current = null
    const promise = playPronunciation(word)
    const entry: PlaybackEntry = { wordId, promise, completed: false }
    englishPlaybackRef.current = entry
    void promise.then(
      () => { entry.completed = true },
      () => { entry.completed = true },
    )
    return entry
  }, [playPronunciation])

  const startMandarinPlayback = useCallback((wordId: string, meaning: string) => {
    const promise = speakMandarin(meaning)
    const entry: PlaybackEntry = { wordId, promise, completed: false }
    mandarinPlaybackRef.current = entry
    void promise.then(
      () => { entry.completed = true },
      () => { entry.completed = true },
    )
    return entry
  }, [speakMandarin])

  const stopPronunciation = useCallback(() => {
    pronunciationRequestRef.current += 1
    mandarinRequestRef.current += 1
    englishPlaybackRef.current = null
    mandarinPlaybackRef.current = null
    audioRef.current?.pause()
    window.speechSynthesis?.cancel()
    setPronunciationStatus('idle')
    setMandarinStatus('idle')
  }, [])

  useEffect(() => {
    if (!selectedDeck) return
    const controller = new AbortController()
    apiFetch(`/api/vocabulary?deck=${selectedDeck}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<VocabularyData>
      })
      .then((payload) => {
        if (payload.meta.deckId !== selectedDeck) throw new Error('Unexpected vocabulary deck')
        setData(payload)
      })
      .catch((fetchError) => {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
        setError('單字資料載入失敗，請重新選擇單字書。')
      })
    return () => controller.abort()
  }, [selectedDeck])

  useEffect(() => {
    if (!selectedDeck) return
    const controller = new AbortController()
    syncRequestRef.current += 1
    syncRevisionRef.current = 0
    lastSyncedMemoryRef.current = ''
    apiFetch(`/api/progress?deck=${selectedDeck}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<ProgressResponse>
      })
      .then((payload) => {
        const normalizedRemote = normalizeMemory(payload.progress)
        const merged = mergeMemory(loadMemory(selectedDeck), payload.progress)
        syncRevisionRef.current = Number(payload.revision) || 0
        lastSyncedMemoryRef.current = JSON.stringify(normalizedRemote)
        saveMemory(selectedDeck, merged)
        setMemory(merged)
        setSyncReady(true)
        setSyncStatus('synced')
      })
      .catch((syncError) => {
        if (syncError instanceof DOMException && syncError.name === 'AbortError') return
        setSyncReady(true)
        setSyncStatus('offline')
      })
    return () => controller.abort()
  }, [selectedDeck])

  useEffect(() => {
    if (!selectedDeck) return
    saveMemory(selectedDeck, memory)
    if (!syncReady) return
    const serializedMemory = JSON.stringify(memory)
    if (serializedMemory === lastSyncedMemoryRef.current) return
    const timeout = window.setTimeout(() => {
      const requestId = syncRequestRef.current + 1
      syncRequestRef.current = requestId
      setSyncStatus('loading')
      apiFetch(`/api/progress?deck=${selectedDeck}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ progress: memory, baseRevision: syncRevisionRef.current }),
      })
        .then(async (response) => {
          const payload = await response.json() as SaveProgressResponse
          if (requestId !== syncRequestRef.current) return
          if (response.status === 409 && payload.progress) {
            syncRevisionRef.current = Number(payload.revision) || 0
            lastSyncedMemoryRef.current = ''
            setMemory((current) => mergeMemory(current, payload.progress))
            return
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          syncRevisionRef.current = Number(payload.revision) || syncRevisionRef.current
          lastSyncedMemoryRef.current = serializedMemory
          setSyncStatus('synced')
        })
        .catch(() => {
          if (requestId === syncRequestRef.current) setSyncStatus('offline')
        })
    }, 650)
    return () => window.clearTimeout(timeout)
  }, [memory, selectedDeck, syncReady])

  useEffect(() => {
    window.localStorage.setItem(AUTOPLAY_SECONDS_KEY, String(cardDuration))
  }, [cardDuration])

  const dueIds = useMemo(() => dueWordIds(memory), [memory])
  const partWords = useMemo(() => {
    if (!data) return []
    if (dailyReview) {
      const reviewSet = new Set(dailyReviewIds)
      return data.words.filter((word) => reviewSet.has(word.id))
    }
    if (favoriteReview) return data.words.filter((word) => memory.favorites[word.id])
    return data.words.filter((word) => word.part === selectedPart)
  }, [dailyReview, dailyReviewIds, data, favoriteReview, memory.favorites, selectedPart])

  const filteredWords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const orderMap = new Map(shuffleOrder.map((id, index) => [id, index]))
    return partWords
      .filter((word) => {
        const recall = memory.recall[word.id]
        const matchesMode =
          studyMode === 'all' ||
          (studyMode === 'review' && dueIds.has(word.id)) ||
          (studyMode === 'known' && recall === 'known') ||
          (studyMode === 'favorites' && memory.favorites[word.id])
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
        if (sequenceMode === 'fixed' || !shuffleOrder.length) return a.deckPosition - b.deckPosition
        return (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0)
      })
  }, [dueIds, memory.favorites, memory.recall, partWords, query, rootFilter, sequenceMode, shuffleOrder, studyMode])

  const wordsById = useMemo(() => new Map(data?.words.map((word) => [word.id, word]) ?? []), [data])
  const studyWords = useMemo(
    () => cardMode === 'quiz'
      ? quizQueue.map((id) => wordsById.get(id)).filter((word): word is VocabularyWord => Boolean(word))
      : filteredWords,
    [cardMode, filteredWords, quizQueue, wordsById],
  )
  const activeWord = studyWords[cardIndex]
  const activeMeaningSections = useMemo(
    () => activeWord ? splitMeaningSections(activeWord.meaning) : null,
    [activeWord],
  )
  const quizOptions = useMemo(
    () => activeWord && quizKind !== 'spelling' ? buildQuizOptions(activeWord, partWords, quizKind) : [],
    [activeWord, partWords, quizKind],
  )

  useEffect(() => {
    if (!activeWord) return
    const timeout = window.setTimeout(() => {
      if (englishPlaybackRef.current?.wordId !== activeWord.id) {
        startEnglishPlayback(activeWord.id, activeWord.word)
      }
    }, 80)
    return () => window.clearTimeout(timeout)
  }, [activeWord, startEnglishPlayback])

  useEffect(() => {
    if (!activeWord || !activeMeaningSections || !flipped || !mandarinAutoplay || cardMode !== 'flashcard') return
    const timeout = window.setTimeout(() => {
      if (!autoPlay || mandarinPlaybackRef.current?.wordId !== activeWord.id) {
        startMandarinPlayback(activeWord.id, activeMeaningSections.primary)
      }
    }, 80)
    return () => window.clearTimeout(timeout)
  }, [activeMeaningSections, activeWord, autoPlay, cardMode, flipped, mandarinAutoplay, startMandarinPlayback])

  useEffect(() => {
    if (!activeWord) return
    preloadRecording(activeWord.word)
    const upcomingWords = studyWords.slice(
      cardIndex + 1,
      cardIndex + 1 + PRONUNCIATION_LOOKAHEAD,
    )
    for (const word of upcomingWords) preloadRecording(word.word)
  }, [activeWord, cardIndex, preloadRecording, studyWords])

  useEffect(() => {
    if (!activeWord) return
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices()
  }, [activeWord])

  useEffect(() => stopPronunciation, [stopPronunciation])

  useEffect(() => {
    if (!autoPlay || !activeWord) return
    let cancelled = false
    const pendingWaits = new Set<{ timer: number; resolve: () => void }>()
    const wait = (milliseconds: number) => new Promise<void>((resolve) => {
      if (cancelled) {
        resolve()
        return
      }
      const pending = {
        timer: 0,
        resolve: () => {
          pendingWaits.delete(pending)
          resolve()
        },
      }
      pending.timer = window.setTimeout(pending.resolve, milliseconds)
      pendingWaits.add(pending)
    })
    const isActive = () => !cancelled
    const awaitLatestPlayback = async (
      playbackRef: { current: PlaybackEntry | null },
      startPlayback: () => PlaybackEntry,
    ) => {
      let entry = playbackRef.current
      if (!entry || entry.wordId !== activeWord.id || entry.completed) entry = startPlayback()
      while (entry) {
        await entry.promise
        if (!isActive()) return
        const latest = playbackRef.current
        if (!latest || latest.wordId !== activeWord.id || latest.promise === entry.promise) return
        entry = latest
      }
    }

    void runAutoplayCard({
      minimumDurationMs: cardDuration * 1000,
      isActive,
      playEnglish: () => awaitLatestPlayback(
        englishPlaybackRef,
        () => startEnglishPlayback(activeWord.id, activeWord.word),
      ),
      showMeaning: () => setFlipped(true),
      playMandarin: mandarinAutoplay && activeMeaningSections?.primary
        ? () => awaitLatestPlayback(
            mandarinPlaybackRef,
            () => startMandarinPlayback(activeWord.id, activeMeaningSections.primary),
          )
        : undefined,
      wait,
      pauseAfterSpeechMs: PAUSE_AFTER_SPEECH_MS,
    }).then((shouldAdvance) => {
      if (!shouldAdvance) return
      if (cardIndex >= studyWords.length - 1) {
        setAutoPlay(false)
        setFlipped(true)
        return
      }

      const nextIndex = cardIndex + 1
      setCardIndex(nextIndex)
      setFlipped(false)
      if (!dailyReview && !favoriteReview && cardMode === 'flashcard' && sequenceMode === 'fixed' && selectedPart !== null && studyMode === 'all' && rootFilter === 'all' && !query) {
        setMemory((current) => setPosition(current, String(selectedPart), nextIndex))
      }
    })

    return () => {
      cancelled = true
      for (const pending of pendingWaits) {
        window.clearTimeout(pending.timer)
        pending.resolve()
      }
    }
  }, [
    activeMeaningSections,
    activeWord,
    autoPlay,
    cardDuration,
    cardIndex,
    cardMode,
    dailyReview,
    favoriteReview,
    mandarinAutoplay,
    query,
    rootFilter,
    selectedPart,
    sequenceMode,
    startEnglishPlayback,
    startMandarinPlayback,
    studyMode,
    studyWords.length,
  ])

  const rootsForPart = useMemo(
    () => data?.rootGroups.filter((group) => dailyReview || favoriteReview
      ? partWords.some((word) => word.root === group.root)
      : group.part === selectedPart) ?? [],
    [dailyReview, data, favoriteReview, partWords, selectedPart],
  )

  const knownCountForPart = (part: number) =>
    data?.words.filter((word) => word.part === part && memory.recall[word.id] === 'known').length ?? 0

  const totalFavorites = Object.values(memory.favorites).filter(Boolean).length
  const streak = calculateStreak(memory)
  const todayActivity = memory.activity[localDateKey()] ??
    { reviews: 0, known: 0, quizCorrect: 0, quizWrong: 0 }
  const weakRoots = useMemo(() => {
    if (!data) return []
    const scores = new Map<string, { root: string; score: number; difficult: number }>()
    for (const word of data.words) {
      if (word.root === 'S') continue
      const recall = memory.recall[word.id]
      if (recall !== 'again' && recall !== 'hard') continue
      const current = scores.get(word.root) ?? { root: word.root, score: 0, difficult: 0 }
      current.score += recall === 'again' ? 3 : 2
      current.difficult += 1
      scores.set(word.root, current)
    }
    return [...scores.values()].sort((a, b) => b.score - a.score || b.difficult - a.difficult).slice(0, 3)
  }, [data, memory.recall])

  const resetQuiz = () => {
    setCardMode('flashcard')
    setQuizQueue([])
    setQuizAnswer('')
    setQuizFeedback(null)
    setQuizComplete(false)
    setRoundComplete(false)
  }

  const chooseDeck = (deckId: DeckId) => {
    stopPronunciation()
    setAutoPlay(false)
    setData(null)
    setError('')
    setSelectedPart(null)
    setDailyReview(false)
    setDailyReviewIds([])
    setFavoriteReview(false)
    setShuffleOrder([])
    setCardIndex(0)
    setFlipped(false)
    setMemory(loadMemory(deckId))
    setSyncReady(false)
    setSyncStatus('loading')
    resetQuiz()
    setSelectedDeck(deckId)
  }

  const applySequenceMode = (mode: SequenceMode) => {
    unlockAudio()
    setAutoPlay(false)
    setSequenceMode(mode)
    window.localStorage.setItem(SEQUENCE_MODE_KEY, mode)
    setShuffleOrder(mode === 'random' ? shuffledWordIds(partWords) : [])
    setCardIndex(0)
    setFlipped(false)
    setSessionReviewedIds([])
    resetQuiz()
  }

  const openPart = (part: number) => {
    unlockAudio()
    setAutoPlay(false)
    setSelectedPart(part)
    setDailyReview(false)
    setDailyReviewIds([])
    setFavoriteReview(false)
    setStudyMode('all')
    setRootFilter('all')
    setQuery('')
    const wordsForPart = data?.words.filter((word) => word.part === part) ?? []
    setShuffleOrder(sequenceMode === 'random' ? shuffledWordIds(wordsForPart) : [])
    setCardIndex(sequenceMode === 'fixed' ? Math.max(0, memory.positions[String(part)] ?? 0) : 0)
    setFlipped(false)
    setSessionReviewedIds([])
    resetQuiz()
  }

  const openDailyReview = () => {
    unlockAudio()
    setAutoPlay(false)
    setSelectedPart(0)
    setDailyReview(true)
    setFavoriteReview(false)
    setStudyMode('all')
    setRootFilter('all')
    setQuery('')
    const dueWords = data?.words.filter((word) => dueIds.has(word.id)) ?? []
    setDailyReviewIds(dueWords.map((word) => word.id))
    setShuffleOrder(shuffledWordIds(dueWords))
    setCardIndex(0)
    setFlipped(false)
    setSessionReviewedIds([])
    resetQuiz()
  }

  const openFavorites = () => {
    unlockAudio()
    setAutoPlay(false)
    setSelectedPart(0)
    setDailyReview(false)
    setDailyReviewIds([])
    setFavoriteReview(true)
    setStudyMode('all')
    setRootFilter('all')
    setQuery('')
    const favoriteWords = data?.words.filter((word) => memory.favorites[word.id]) ?? []
    setShuffleOrder(sequenceMode === 'random' ? shuffledWordIds(favoriteWords) : [])
    setCardIndex(0)
    setFlipped(false)
    setSessionReviewedIds([])
    resetQuiz()
  }

  const moveCard = (direction: -1 | 1) => {
    if (!studyWords.length) return
    unlockAudio()
    const next = Math.min(Math.max(cardIndex + direction, 0), studyWords.length - 1)
    setCardIndex(next)
    setFlipped(false)
    if (!dailyReview && !favoriteReview && cardMode === 'flashcard' && sequenceMode === 'fixed' && selectedPart !== null && studyMode === 'all' && rootFilter === 'all' && !query) {
      setMemory((current) => setPosition(current, String(selectedPart), next))
    }
  }

  const markRecall = (recall: RecallState) => {
    if (!activeWord) return
    setMemory((current) => recordReview(current, activeWord.id, recall, undefined, Date.now(), deviceId))
    setSessionReviewedIds((current) => current.includes(activeWord.id) ? current : [...current, activeWord.id])
    if (cardIndex < studyWords.length - 1) {
      window.setTimeout(() => moveCard(1), 100)
    } else if (dailyReview) {
      window.setTimeout(() => setRoundComplete(true), 180)
    }
  }

  const toggleActiveFavorite = () => {
    if (!activeWord) return
    setMemory((current) => toggleFavorite(current, activeWord.id))
  }

  const applyMode = (mode: StudyMode) => {
    unlockAudio()
    setAutoPlay(false)
    setStudyMode(mode)
    setCardIndex(0)
    setFlipped(false)
    resetQuiz()
  }

  const applyRoot = (root: string) => {
    unlockAudio()
    setAutoPlay(false)
    setRootFilter(root)
    setCardIndex(0)
    setFlipped(false)
    resetQuiz()
  }

  const shuffleDeck = () => {
    unlockAudio()
    setAutoPlay(false)
    setSequenceMode('random')
    window.localStorage.setItem(SEQUENCE_MODE_KEY, 'random')
    setShuffleOrder(shuffledWordIds(partWords))
    setCardIndex(0)
    setFlipped(false)
  }

  const returnHome = () => {
    stopPronunciation()
    setAutoPlay(false)
    setSelectedPart(null)
    setDailyReview(false)
    setDailyReviewIds([])
    setFavoriteReview(false)
    resetQuiz()
  }

  const changeDeck = () => {
    stopPronunciation()
    setAutoPlay(false)
    setData(null)
    setSelectedDeck(null)
    setSelectedPart(null)
    setDailyReview(false)
    setDailyReviewIds([])
    setFavoriteReview(false)
    setShuffleOrder([])
    setCardIndex(0)
    setFlipped(false)
    setError('')
    setSyncReady(false)
    setSyncStatus('idle')
    resetQuiz()
  }

  const startQuiz = (kind: QuizKind) => {
    unlockAudio()
    setAutoPlay(false)
    setCardMode('quiz')
    setQuizKind(kind)
    setQuizQueue(filteredWords.map((word) => word.id))
    setQuizAnswer('')
    setQuizFeedback(null)
    setQuizComplete(false)
    setCardIndex(0)
    setFlipped(false)
  }

  const showFlashcards = () => {
    resetQuiz()
    setCardIndex(0)
    setFlipped(false)
  }

  const submitQuizAnswer = (answer: string) => {
    if (!activeWord || quizFeedback) return
    const correctValue = quizValue(activeWord, quizKind)
    const correct = quizKind === 'spelling'
      ? normalizeSpelling(answer) === normalizeSpelling(correctValue)
      : answer === correctValue
    setQuizFeedback({ correct, correctValue })
    setMemory((current) => recordReview(
      current,
      activeWord.id,
      correct ? 'known' : 'again',
      correct ? 'correct' : 'wrong',
      Date.now(),
      deviceId,
    ))
    setSessionReviewedIds((current) => current.includes(activeWord.id) ? current : [...current, activeWord.id])
    const nextQuiz = advanceQuiz(quizQueue, cardIndex, activeWord.id, correct)
    setQuizQueue(nextQuiz.queue)

    window.setTimeout(() => {
      if (nextQuiz.complete) {
        setQuizComplete(true)
      } else {
        setCardIndex(nextQuiz.nextIndex)
      }
      setQuizAnswer('')
      setQuizFeedback(null)
    }, 850)
  }

  const toggleAutoPlay = () => {
    unlockAudio()
    stopPronunciation()
    if (autoPlay) {
      setAutoPlay(false)
      return
    }
    if (activeWord) setFlipped(false)
    setAutoPlay(true)
  }

  const toggleMandarinAutoplay = () => {
    unlockAudio()
    const nextValue = !mandarinAutoplay
    setMandarinAutoplay(nextValue)
    window.localStorage.setItem(MANDARIN_AUTOPLAY_KEY, nextValue ? 'on' : 'off')
    if (!nextValue) {
      mandarinRequestRef.current += 1
      audioRef.current?.pause()
      window.speechSynthesis?.cancel()
      setMandarinStatus('idle')
    }
  }

  const returnToFirstCard = () => {
    if (!studyWords.length) return
    stopPronunciation()
    setAutoPlay(false)
    setCardIndex(0)
    setFlipped(false)
    if (!dailyReview && !favoriteReview && cardMode === 'flashcard' && sequenceMode === 'fixed' && selectedPart !== null && studyMode === 'all' && rootFilter === 'all' && !query) {
      setMemory((current) => setPosition(current, String(selectedPart), 0))
    }
  }

  const changeCardDuration = (seconds: number) => {
    setCardDuration(seconds)
    if (autoPlay) setFlipped(false)
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT') return
      if (cardMode === 'quiz') return
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

  if (!selectedDeck) {
    const deckOptions: Array<{ id: DeckId; title: string; count: number; description: string }> = [
      { id: 'words1000', title: '1000 字', count: 1085, description: '份量精簡，五份各 217 張字卡' },
      { id: 'words2000', title: '2000 字', count: 2078, description: '完整字庫，五份各約 415 張字卡' },
    ]
    return (
      <main className="app-shell home-shell deck-picker-shell">
        <header className="brand-bar">
          <a className="brand" href="/" aria-label="GRE Roots 首頁">
            <span className="brand-mark"><Sprout size={18} /></span>
            GRE ROOTS
          </a>
          <div className="brand-actions">
            {session.isAdmin && (
              <button aria-label="帳號審核" className="account-review-button" onClick={onManageAccounts} type="button">
                <ShieldCheck size={15} /><span>帳號審核</span>
              </button>
            )}
            <a aria-label="登出" className="account-signout" href="/signout-with-chatgpt?return_to=/" target="_top">
              <LogOut size={16} />
            </a>
          </div>
        </header>

        <section className="intro deck-intro">
          <p className="eyebrow">CHOOSE A WORD BOOK</p>
          <h1>今天要念<br />1000 字，還是 2000 字？</h1>
          <p className="intro-copy">兩套單字書分開記錄進度；選好後，再決定要依字根固定排列或隨機出題。</p>
        </section>

        <section className="deck-choice-grid" aria-label="選擇單字書">
          {deckOptions.map((option) => {
            const deckMemory = loadMemory(option.id)
            const known = Object.values(deckMemory.recall).filter((recall) => recall === 'known').length
            return (
              <button className="deck-choice-card" key={option.id} onClick={() => chooseDeck(option.id)} type="button">
                <span className="deck-choice-label">WORD BOOK</span>
                <strong>{option.title}</strong>
                <span>{option.description}</span>
                <small>已背 {known.toLocaleString()} · 剩 {(option.count - known).toLocaleString()}</small>
                <ChevronRight aria-hidden="true" size={22} />
              </button>
            )
          })}
        </section>
      </main>
    )
  }

  if (error) {
    return (
      <main className="status-screen status-screen-column">
        <span>{error}</span>
        <Button onClick={changeDeck} variant="outline">重新選擇單字書</Button>
      </main>
    )
  }

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
          <div className="brand-actions">
            <button className="change-deck-button" onClick={changeDeck} type="button">{data.meta.title}</button>
            <span className="word-total">已背 {totalKnown.toLocaleString()} · 剩 {totalRemaining.toLocaleString()}</span>
            <span className={`sync-indicator sync-${syncStatus}`} title={syncStatus === 'offline' ? '目前離線，進度已保存在本機' : '學習進度會同步到你的帳號'}>
              {syncStatus === 'offline' ? <CloudOff size={14} /> : <Cloud size={14} />}
              <span>{syncStatus === 'loading' ? '同步中' : syncStatus === 'offline' ? '本機保存' : '已同步'}</span>
            </span>
            {session.isAdmin && (
              <button aria-label="帳號審核" className="account-review-button" onClick={onManageAccounts} type="button">
                <ShieldCheck size={15} /><span>帳號審核</span>
              </button>
            )}
            <a aria-label="登出" className="account-signout" href="/signout-with-chatgpt?return_to=/" target="_top">
              <LogOut size={16} />
            </a>
          </div>
        </header>

        <section className="intro">
          <p className="eyebrow">{data.meta.title}</p>
          <h1>選一份，開始把字<br />連成有意義的家族。</h1>
          <p className="intro-copy">
            全部 {data.meta.totalWords.toLocaleString()} 張字卡分成五份；同字根不拆散。學習進度會跟著登入帳號跨裝置同步。
          </p>
        </section>

        <section className="learning-dashboard" aria-labelledby="daily-review-heading">
          <button className="daily-review-card" disabled={dueIds.size === 0} onClick={openDailyReview} type="button">
            <span className="dashboard-icon"><Brain size={22} /></span>
            <span>
              <small>SPACED REVIEW</small>
              <strong id="daily-review-heading">今天待複習 {dueIds.size} 字</strong>
              <em>{dueIds.size ? '依照你的記憶程度安排，現在開始複習' : '今天已完成；繼續背新字就會建立複習排程'}</em>
            </span>
            <ChevronRight size={20} />
          </button>
          <div className="stat-grid" aria-label="學習統計">
            <div><BarChart3 size={17} /><span>今日練習</span><strong>{todayActivity.reviews}</strong><small>字</small></div>
            <div><Flame size={17} /><span>連續學習</span><strong>{streak}</strong><small>天</small></div>
            <button disabled={totalFavorites === 0} onClick={openFavorites} type="button"><Star size={17} /><span>收藏難字</span><strong>{totalFavorites}</strong><small>字</small></button>
          </div>
          <div className="weak-roots">
            <span>需要加強的字根</span>
            {weakRoots.length ? weakRoots.map((root) => (
              <small key={root.root}>{root.root} · {root.difficult} 字</small>
            )) : <small>完成幾張字卡後，這裡會找出最弱的字根</small>}
          </div>
        </section>

        <section className="sequence-picker" aria-labelledby="sequence-heading">
          <div className="sequence-copy">
            <p className="section-kicker">WORD ORDER</p>
            <h2 id="sequence-heading">單字要怎麼出現？</h2>
          </div>
          <div className="sequence-options">
            <button aria-pressed={sequenceMode === 'fixed'} className={sequenceMode === 'fixed' ? 'is-active' : ''} onClick={() => applySequenceMode('fixed')} type="button">
              <span>固定順序</span><small>相同字根連續出現</small>
            </button>
            <button aria-pressed={sequenceMode === 'random'} className={sequenceMode === 'random' ? 'is-active' : ''} onClick={() => applySequenceMode('random')} type="button">
              <span>隨機順序</span><small>每個單字重新打散</small>
            </button>
          </div>
        </section>

        <section className="part-section" aria-labelledby="part-heading">
          <div className="section-heading">
            <div>
              <p className="section-kicker">TODAY'S DECK</p>
              <h2 id="part-heading">今天想背哪一份？</h2>
            </div>
            <p>進度會同步至目前登入帳號</p>
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
  const partKnown = dailyReview
    ? sessionReviewedIds.length
    : favoriteReview
      ? partWords.filter((word) => memory.recall[word.id] === 'known').length
      : knownCountForPart(selectedPart)
  const partTotal = dailyReview ? dailyReviewIds.length : favoriteReview ? partWords.length : partSummary?.totalWordCount ?? 0
  const partRemaining = partTotal - partKnown
  const partKnownPercent = partTotal ? Math.round((partKnown / partTotal) * 100) : 0
  const currentRecall = activeWord ? memory.recall[activeWord.id] : undefined
  const activeEnglishRecording = activeWord
    ? WIKIMEDIA_ENGLISH_RECORDINGS[activeWord.word.toLocaleLowerCase()]
    : undefined
  const pronunciationLabel =
    pronunciationStatus === 'human-us' ? '美式真人發音' :
    pronunciationStatus === 'human-other' ? `${activeEnglishRecording?.accentLabel ?? '英語'}真人發音` :
    pronunciationStatus === 'ai' ? 'AI／裝置合成發音' :
    pronunciationStatus === 'loading' ? '載入真人發音' :
    pronunciationStatus === 'unavailable' ? '重新播放發音' :
    activeEnglishRecording
      ? `播放${activeEnglishRecording.accent === 'en-US' ? '美式' : activeEnglishRecording.accentLabel}真人發音`
      : '播放 AI／裝置合成發音'
  const mandarinLabel =
    mandarinStatus === 'ai' ? 'AI／裝置合成中文發音' :
    mandarinStatus === 'loading' ? '準備 AI 中文發音' :
    mandarinStatus === 'unavailable' ? '此裝置無法播放中文語音' :
      '播放 AI／裝置合成中文發音'

  return (
    <main className="app-shell study-shell">
      <header className="study-header">
        <Button aria-label="回到選份頁" className="icon-button" onClick={returnHome} size="icon" variant="ghost">
          <ArrowLeft size={20} />
        </Button>
        <div className="study-title">
          <span>{data.meta.title} · {dailyReview ? '今日複習' : favoriteReview ? '收藏難字' : `PART ${selectedPart}`}</span>
          <strong>{studyWords.length ? `${Math.min(cardIndex + 1, studyWords.length)} / ${studyWords.length}` : quizComplete ? '本輪完成' : '沒有符合的字卡'}</strong>
        </div>
        {cardMode === 'flashcard' && sequenceMode === 'random' ? (
          <Button aria-label="重新打亂目前這份" className="icon-button" onClick={shuffleDeck} size="icon" variant="ghost">
            <Shuffle size={18} />
          </Button>
        ) : <span className="header-icon-spacer" aria-hidden="true" />}
      </header>

      <div className="progress-track" aria-label="目前卡組進度">
        <span style={{ width: studyWords.length ? `${Math.min(100, ((cardIndex + 1) / studyWords.length) * 100)}%` : quizComplete ? '100%' : '0%' }} />
      </div>

      <section className="memory-progress" aria-labelledby="memory-progress-heading">
        <div className="memory-progress-heading">
          <span id="memory-progress-heading">{dailyReview ? '今日複習進度' : favoriteReview ? '收藏熟悉度' : '本份背誦進度'}</span>
          <strong>{partKnownPercent}%</strong>
        </div>
        <div className="memory-progress-track" aria-hidden="true">
          <span style={{ width: `${partKnownPercent}%` }} />
        </div>
        <table className="memory-progress-table">
          <thead>
            <tr><th scope="col">{dailyReview ? '已複習' : '已背'}</th><th scope="col">還剩</th><th scope="col">全部</th></tr>
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
        <div className="practice-tabs" aria-label="學習方式">
          <button aria-pressed={cardMode === 'flashcard'} className={cardMode === 'flashcard' ? 'is-active' : ''} onClick={showFlashcards} type="button">
            <RotateCcw size={15} /><span>字卡</span>
          </button>
          <button aria-pressed={cardMode === 'quiz' && quizKind === 'meaning'} className={cardMode === 'quiz' && quizKind === 'meaning' ? 'is-active' : ''} onClick={() => startQuiz('meaning')} type="button">
            <Languages size={15} /><span>意思</span>
          </button>
          <button aria-pressed={cardMode === 'quiz' && quizKind === 'root'} className={cardMode === 'quiz' && quizKind === 'root' ? 'is-active' : ''} onClick={() => startQuiz('root')} type="button">
            <Sprout size={15} /><span>字根</span>
          </button>
          <button aria-pressed={cardMode === 'quiz' && quizKind === 'spelling'} className={cardMode === 'quiz' && quizKind === 'spelling' ? 'is-active' : ''} onClick={() => startQuiz('spelling')} type="button">
            <Keyboard size={15} /><span>拼字</span>
          </button>
        </div>
        <div className="study-sequence-tabs" aria-label="單字順序">
          <button aria-pressed={sequenceMode === 'fixed'} className={sequenceMode === 'fixed' ? 'is-active' : ''} onClick={() => applySequenceMode('fixed')} type="button">
            固定 · 同字根連續
          </button>
          <button aria-pressed={sequenceMode === 'random'} className={sequenceMode === 'random' ? 'is-active' : ''} onClick={() => applySequenceMode('random')} type="button">
            隨機 · 全部打散
          </button>
        </div>
        <div className="mode-tabs">
          {([
            ['all', '全部'],
            ['review', '待複習'],
            ['known', '已記住'],
            ['favorites', '收藏'],
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
              onChange={(event) => { setAutoPlay(false); setQuery(event.target.value); setCardIndex(0); setFlipped(false); resetQuiz() }}
              placeholder="搜尋單字或意思"
              value={query}
            />
            {query && (
              <button aria-label="清除搜尋" onClick={() => { setAutoPlay(false); setQuery(''); resetQuiz() }} type="button"><X size={15} /></button>
            )}
          </label>
          <select aria-label="選擇字根家族" onChange={(event) => applyRoot(event.target.value)} value={rootFilter}>
            <option value="all">全部字根</option>
            {rootsForPart.map((group) => (
              <option key={group.rootNo} value={group.rootNo}>#{group.rootNo} · {group.root}</option>
            ))}
            <option value="S">S · 無字根（{partWords.filter((word) => word.root === 'S').length}）</option>
          </select>
        </div>
        {cardMode === 'flashcard' && <div className={`autoplay-panel ${autoPlay ? 'is-playing' : ''}`}>
          <button aria-pressed={autoPlay} className="autoplay-toggle" onClick={toggleAutoPlay} type="button">
            {autoPlay ? <Pause size={18} /> : <Play size={18} />}
            <span>
              <strong>{autoPlay ? '暫停自動連播' : '開始自動連播'}</strong>
              <small>英文、中文播完後各停 1 秒</small>
            </span>
          </button>
          <label className="duration-control">
            <Timer size={17} aria-hidden="true" />
            <span>每字至少</span>
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
        </div>}
        {cardMode === 'flashcard' && (
          <div className={`mandarin-audio-panel ${mandarinAutoplay ? 'is-enabled' : ''}`}>
            <button aria-pressed={mandarinAutoplay} onClick={toggleMandarinAutoplay} type="button">
              <Volume2 size={18} aria-hidden="true" />
              <span>
                <strong>中文發音</strong>
                <small>全部使用 AI／裝置合成中文語音</small>
              </span>
              <b>{mandarinAutoplay ? '開' : '關'}</b>
            </button>
          </div>
        )}
        {cardMode === 'flashcard' && autoPlay && activeWord && (
          <div className="autoplay-timeline" aria-label={`這張字卡至少停留 ${cardDuration} 秒`}>
            <span key={`${activeWord.id}-${cardDuration}`} style={{ animationDuration: `${cardDuration}s` }} />
          </div>
        )}
      </section>

      {roundComplete ? (
        <section className="empty-state quiz-complete">
          <Check size={30} />
          <h2>今天的複習完成</h2>
          <p>新的複習日期已依照「還不熟／有點模糊／記住了」自動安排。</p>
          <Button onClick={returnHome}>回到學習首頁</Button>
        </section>
      ) : quizComplete ? (
        <section className="empty-state quiz-complete">
          <Check size={30} />
          <h2>這輪測驗完成</h2>
          <p>答錯的單字都已回到隊列再次作答，並排入今天的複習。</p>
          <div className="completion-actions">
            <Button onClick={() => startQuiz(quizKind)}>再測一次</Button>
            <Button onClick={showFlashcards} variant="outline">回到字卡</Button>
          </div>
        </section>
      ) : activeWord ? (cardMode === 'quiz' ? (
        <section className="study-stage quiz-stage">
          <div className={`quiz-card ${quizFeedback ? (quizFeedback.correct ? 'is-correct' : 'is-wrong') : ''}`}>
            <div className="quiz-topline">
              <span>{quizKind === 'meaning' ? '選出中文意思' : quizKind === 'root' ? '選出正確字根' : '聽發音／看意思拼出單字'}</span>
              <button aria-label={memory.favorites[activeWord.id] ? '取消收藏' : '收藏這個單字'} className={`favorite-button ${memory.favorites[activeWord.id] ? 'is-favorite' : ''}`} onClick={toggleActiveFavorite} type="button">
                <Star fill={memory.favorites[activeWord.id] ? 'currentColor' : 'none'} size={18} />
              </button>
            </div>

            {quizKind === 'spelling' ? (
              <div className="quiz-prompt spelling-prompt">
                <p>{activeWord.meaning}</p>
                <button className={`pronounce-button status-${pronunciationStatus}`} onClick={() => startEnglishPlayback(activeWord.id, activeWord.word)} type="button">
                  {pronunciationStatus === 'loading' ? <LoaderCircle className="pronounce-spinner" size={17} /> : <Volume2 size={17} />}
                  再聽一次發音
                </button>
                {activeEnglishRecording ? (
                  <p className="english-source-note">
                    真人錄音：{activeEnglishRecording.artist} · {activeEnglishRecording.accentLabel} ·{' '}
                    <a href={activeEnglishRecording.sourceUrl} rel="noreferrer" target="_blank">來源</a>
                    {' · '}<a href={activeEnglishRecording.licenseUrl} rel="noreferrer" target="_blank">{activeEnglishRecording.license}</a>
                  </p>
                ) : (
                  <p className="english-source-note">未找到授權清楚的真人錄音，使用 AI／裝置合成語音。</p>
                )}
              </div>
            ) : (
              <div className="quiz-prompt">
                <h2>{activeWord.word}</h2>
                {activeWord.pronunciation && <p>/{activeWord.pronunciation}/</p>}
              </div>
            )}

            {quizKind === 'spelling' ? (
              <form className="spelling-form" onSubmit={(event) => { event.preventDefault(); submitQuizAnswer(quizAnswer) }}>
                <input autoCapitalize="none" autoComplete="off" autoCorrect="off" disabled={Boolean(quizFeedback)} onChange={(event) => setQuizAnswer(event.target.value)} placeholder="輸入英文單字" spellCheck="false" value={quizAnswer} />
                <Button disabled={!quizAnswer.trim() || Boolean(quizFeedback)} type="submit">送出答案</Button>
              </form>
            ) : (
              <div className="quiz-options">
                {quizOptions.map((option) => {
                  const isCorrectOption = option === quizValue(activeWord, quizKind)
                  const selectedWrong = quizFeedback && !quizFeedback.correct && option !== quizFeedback.correctValue
                  return (
                    <button
                      className={quizFeedback ? (isCorrectOption ? 'is-answer' : selectedWrong ? 'is-muted' : '') : ''}
                      disabled={Boolean(quizFeedback)}
                      key={option}
                      onClick={() => submitQuizAnswer(option)}
                      type="button"
                    >{option}</button>
                  )
                })}
              </div>
            )}

            {quizFeedback && (
              <p className="quiz-feedback" aria-live="polite">
                {quizFeedback.correct ? '答對了，繼續下一題' : `答錯了；正確答案是：${quizFeedback.correctValue}`}
              </p>
            )}
          </div>
        </section>
      ) : (
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
                  <span className="card-top-actions">
                    <button aria-label={memory.favorites[activeWord.id] ? '取消收藏' : '收藏這個單字'} className={`favorite-button ${memory.favorites[activeWord.id] ? 'is-favorite' : ''}`} onClick={(event) => { event.stopPropagation(); toggleActiveFavorite() }} type="button">
                      <Star fill={memory.favorites[activeWord.id] ? 'currentColor' : 'none'} size={16} />
                    </button>
                    <span className={`recall-dot recall-${currentRecall ?? 'new'}`}>
                      {currentRecall === 'known' ? '已記住' : currentRecall === 'hard' ? '模糊' : currentRecall === 'again' ? '待複習' : `FREQ ${activeWord.frequency}`}
                    </span>
                  </span>
                </div>
                <div className="word-block">
                  <h2>{activeWord.word}</h2>
                  {activeWord.pronunciation && <p>/{activeWord.pronunciation}/</p>}
                  <button
                    aria-label={`重播 ${activeWord.word} 的${activeEnglishRecording ? '真人' : 'AI／裝置合成'}發音`}
                    className={`pronounce-button status-${pronunciationStatus}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      unlockAudio()
                      startEnglishPlayback(activeWord.id, activeWord.word)
                    }}
                    type="button"
                  >
                    {pronunciationStatus === 'loading' ?
                      <LoaderCircle className="pronounce-spinner" size={17} /> :
                      <Volume2 size={17} />}
                    <span aria-live="polite">{pronunciationLabel}</span>
                  </button>
                  {activeEnglishRecording ? (
                    <p className="english-source-note" onClick={(event) => event.stopPropagation()}>
                      真人錄音：{activeEnglishRecording.artist} · {activeEnglishRecording.accentLabel} ·{' '}
                      <a href={activeEnglishRecording.sourceUrl} rel="noreferrer" target="_blank">來源</a>
                      {' · '}<a href={activeEnglishRecording.licenseUrl} rel="noreferrer" target="_blank">{activeEnglishRecording.license}</a>
                    </p>
                  ) : (
                    <p className="english-source-note">未找到授權清楚的真人錄音，使用 AI／裝置合成語音。</p>
                  )}
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
                  <h2>{activeMeaningSections?.primary ?? activeWord.meaning}</h2>
                  <button
                    className={`mandarin-pronounce-button status-${mandarinStatus}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      unlockAudio()
                      startMandarinPlayback(activeWord.id, activeMeaningSections?.primary ?? activeWord.meaning)
                    }}
                    type="button"
                  >
                    {mandarinStatus === 'loading' ?
                      <LoaderCircle className="pronounce-spinner" size={16} /> :
                      <Volume2 size={16} aria-hidden="true" />}
                    <span aria-live="polite">{mandarinLabel}</span>
                  </button>
                  <p className="mandarin-source-note">中文一律使用此裝置提供的 AI／合成語音。</p>
                </div>
                {activeMeaningSections?.synonyms.length ? (
                  <div className="detail-block synonym-block">
                    <span>同義字</span>
                    <p>{activeMeaningSections.synonyms.join('；')}</p>
                  </div>
                ) : null}
                {activeMeaningSections?.antonyms.length ? (
                  <div className="detail-block antonym-block">
                    <span>反義字</span>
                    <p>{activeMeaningSections.antonyms.join('；')}</p>
                  </div>
                ) : null}
                {activeMeaningSections?.memoryNotes.length ? (
                  <div className="detail-block memory-note-block">
                    <span>記憶提示</span>
                    <p>{activeMeaningSections.memoryNotes.join('；')}</p>
                  </div>
                ) : null}
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
              <Button disabled={cardIndex === 0} onClick={returnToFirstCard} size="lg" variant="outline">
                <ChevronsLeft size={18} /> 第一張
              </Button>
              <Button disabled={cardIndex === 0} onClick={() => moveCard(-1)} size="lg" variant="outline">
                <ChevronLeft size={18} /> 上一張
              </Button>
              <Button onClick={() => setFlipped(true)} size="lg">
                查看答案 <ChevronRight size={18} />
              </Button>
            </nav>
          )}
        </section>
      )) : (
        <section className="empty-state">
          <Check size={26} />
          <h2>{dailyReview ? '今天的複習已完成' : favoriteReview || studyMode === 'favorites' ? '目前還沒有收藏單字' : studyMode === 'review' ? '目前沒有到期的複習' : '找不到符合條件的字卡'}</h2>
          <p>可以切回「全部」，或清除搜尋與字根篩選。</p>
          <Button onClick={() => { applyMode('all'); applyRoot('all'); setQuery('') }} variant="outline">顯示全部字卡</Button>
        </section>
      )}
    </main>
  )
}

function App() {
  return (
    <AccountAccess>
      {({ session, openAdmin }) => <StudyApp onManageAccounts={openAdmin} session={session} />}
    </AccountAccess>
  )
}

export default App
