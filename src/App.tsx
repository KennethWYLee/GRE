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
import { runEnglishPronunciation, type PronunciationMode } from './detailed-pronunciation'
import { createLetterAudioPlayer } from './letter-audio'
import { selectMandarinVoice } from './speech-voices'
import { EMPTY_PROGRESS } from './progress-sync'
import { useProgress } from './use-progress'
import {
  advanceQuiz,
  buildQuizOptions,
  calculateStreak,
  dueWordIds,
  claimLegacyMemory,
  hasUnclaimedLegacyMemory,
  getOrCreateDeviceId,
  localDateKey,
  mergeMemory,
  nextReviewIndex,
  normalizeSpelling,
  recordListeningCompletion,
  quizValue,
  recordReview,
  setPosition,
  toggleFavorite,
  type DeckId,
  type MemoryStore,
  type QuizKind,
  type RecallState,
} from './study-memory'
import './App.css'

type StudyMode = 'all' | 'review' | 'known' | 'favorites'
type PronunciationStatus = 'idle' | 'loading' | 'ai' | 'unavailable'
type MandarinStatus = 'idle' | 'loading' | 'ai' | 'unavailable'
type SequenceMode = 'fixed' | 'random'
type CardMode = 'flashcard' | 'quiz'
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
  memoryNotes?: string
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
const PRONUNCIATION_MODE_KEY = 'gre-roots-pronunciation-mode-v1'
const AUTOPLAY_OPTIONS = [3, 5, 8, 10, 15, 20, 30] as const
const SPEECH_COMPLETION_TIMEOUT_MS = 15_000
const PAUSE_AFTER_SPEECH_MS = 1_000
const SPEECH_VOLUME = 1
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

function selectEnglishVoice(voices: SpeechSynthesisVoice[]) {
  const candidates = voices.filter((voice) => voice.lang.toLocaleLowerCase().startsWith('en-us'))
  return candidates.find((voice) => /natural|neural|premium|enhanced|online/i.test(voice.name)) ??
    candidates.find((voice) => /google us english|samantha|ava|jenny|aria|joanna/i.test(voice.name)) ??
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
  const [requestedCardIndex, setCardIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [studyMode, setStudyMode] = useState<StudyMode>('all')
  const [rootFilter, setRootFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [shuffleOrder, setShuffleOrder] = useState<string[]>([])
  const { decks, update: updateProgress } = useProgress(session.email)
  const memory = selectedDeck ? decks[selectedDeck].memory : EMPTY_PROGRESS
  const syncStatus = selectedDeck ? decks[selectedDeck].status : 'loading'
  const localSaved = selectedDeck ? decks[selectedDeck].localSaved : true
  const [legacyAvailable, setLegacyAvailable] = useState(hasUnclaimedLegacyMemory)
  const [legacyConfirmed, setLegacyConfirmed] = useState(false)
  const [legacyError, setLegacyError] = useState('')
  const setMemory = useCallback((change: (current: MemoryStore) => MemoryStore) => {
    if (selectedDeck) updateProgress(selectedDeck, change)
  }, [selectedDeck, updateProgress])
  const [cardMode, setCardMode] = useState<CardMode>('flashcard')
  const [quizKind, setQuizKind] = useState<QuizKind>('meaning')
  const [quizQueue, setQuizQueue] = useState<string[]>([])
  const [quizAnswer, setQuizAnswer] = useState('')
  const [quizFeedback, setQuizFeedback] = useState<{ correct: boolean; correctValue: string } | null>(null)
  const [quizComplete, setQuizComplete] = useState(false)
  const [sessionReviewedIds, setSessionReviewedIds] = useState<string[]>([])
  const [roundComplete, setRoundComplete] = useState(false)
  const [sessionListenedIds, setSessionListenedIds] = useState<string[]>([])
  const [listeningComplete, setListeningComplete] = useState(false)
  const [error, setError] = useState('')
  const [pronunciationStatus, setPronunciationStatus] = useState<PronunciationStatus>('idle')
  const [mandarinStatus, setMandarinStatus] = useState<MandarinStatus>('idle')
  const [mandarinAutoplay, setMandarinAutoplay] = useState(loadMandarinAutoplay)
  const [pronunciationMode, setPronunciationMode] = useState<PronunciationMode>(() => {
    try { return window.localStorage.getItem(PRONUNCIATION_MODE_KEY) === 'detailed' ? 'detailed' : 'general' }
    catch { return 'general' }
  })
  const [spellingLetter, setSpellingLetter] = useState<string | null>(null)
  const [autoPlay, setAutoPlay] = useState(false)
  const autoPlayRef = useRef(false)
  useEffect(() => { autoPlayRef.current = autoPlay }, [autoPlay])
  const [cardDuration, setCardDuration] = useState(loadAutoplaySeconds)
  const deviceId = useMemo(() => getOrCreateDeviceId(), [])
  const touchStartX = useRef<number | null>(null)
  const audioUnlockedRef = useRef(false)
  const pronunciationRequestRef = useRef(0)
  const mandarinRequestRef = useRef(0)
  const englishPlaybackRef = useRef<PlaybackEntry | null>(null)
  const mandarinPlaybackRef = useRef<PlaybackEntry | null>(null)
  const cancelSpeechRef = useRef<(() => void) | null>(null)
  const letterAudioRef = useRef<ReturnType<typeof createLetterAudioPlayer> | null>(null)
  const getLetterAudio = useCallback(() => letterAudioRef.current ??= createLetterAudioPlayer(), [])
  const cancelSpeech = useCallback(() => {
    cancelSpeechRef.current?.()
    cancelSpeechRef.current = null
    window.speechSynthesis?.cancel()
    letterAudioRef.current?.stop()
  }, [])

  const unlockAudio = useCallback(() => {
    void getLetterAudio().unlock().catch(() => undefined)
    if (audioUnlockedRef.current) return
    const silent = new Audio(SILENT_AUDIO)
    silent.volume = 0.01
    void silent.play()
      .then(() => { audioUnlockedRef.current = true })
      .catch(() => undefined)
  }, [getLetterAudio])

  useEffect(() => {
    if (pronunciationMode === 'detailed') void getLetterAudio().preload().catch(() => undefined)
  }, [getLetterAudio, pronunciationMode])

  useEffect(() => () => {
    letterAudioRef.current?.dispose()
    letterAudioRef.current = null
  }, [])

  const speakWithDevice = useCallback((word: string, requestId: number) => (
    new Promise<boolean>((resolve) => {
      if (!('speechSynthesis' in window)) {
        if (requestId === pronunciationRequestRef.current) setPronunciationStatus('unavailable')
        resolve(false)
        return
      }

      const synth = window.speechSynthesis
      const utterance = new SpeechSynthesisUtterance(word)
      let settled = false
      const finish = (played: boolean) => {
        if (settled) return
        settled = true
        window.clearTimeout(completionTimer)
        if (cancelSpeechRef.current === cancel) cancelSpeechRef.current = null
        utterance.onstart = null
        utterance.onend = null
        utterance.onerror = null
        resolve(played)
      }
      const cancel = () => finish(false)
      cancelSpeechRef.current = cancel
      const completionTimer = window.setTimeout(() => {
        finish(false)
        synth.cancel()
        if (requestId === pronunciationRequestRef.current) setPronunciationStatus('unavailable')
      }, SPEECH_COMPLETION_TIMEOUT_MS)
      utterance.voice = selectEnglishVoice(synth.getVoices())
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

    cancelSpeech()
    if (pronunciationMode === 'detailed' && cardMode === 'flashcard') {
      try { await getLetterAudio().preload() }
      catch {
        if (requestId === pronunciationRequestRef.current) setPronunciationStatus('unavailable')
        return false
      }
    }
    const played = await runEnglishPronunciation({
      word,
      mode: cardMode === 'flashcard' ? pronunciationMode : 'general',
      isActive: () => requestId === pronunciationRequestRef.current,
      speak: (text) => speakWithDevice(text, requestId),
      spell: (letters) => getLetterAudio().play(letters, setSpellingLetter),
      wait: (milliseconds) => new Promise<void>((resolve) => {
        const cancel = () => { window.clearTimeout(timer); resolve() }
        const timer = window.setTimeout(() => {
          if (cancelSpeechRef.current === cancel) cancelSpeechRef.current = null
          resolve()
        }, milliseconds)
        cancelSpeechRef.current = cancel
      }),
    })
    if (requestId === pronunciationRequestRef.current) {
      setSpellingLetter(null)
      if (!played) setPronunciationStatus('unavailable')
    }
    return played
  }, [cancelSpeech, cardMode, getLetterAudio, pronunciationMode, speakWithDevice])

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
        if (cancelSpeechRef.current === cancel) cancelSpeechRef.current = null
        utterance.onstart = null
        utterance.onend = null
        utterance.onerror = null
        resolve(played)
      }
      const cancel = () => finish(false)
      cancelSpeechRef.current = cancel
      const completionTimer = window.setTimeout(() => {
        finish(false)
        synth.cancel()
        if (requestId === mandarinRequestRef.current) setMandarinStatus('unavailable')
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
    setPronunciationStatus('idle')
    cancelSpeech()
    setSpellingLetter(null)

    const text = mandarinSpeechText(meaning)
    if (!text) {
      setMandarinStatus('unavailable')
      return false
    }
    setMandarinStatus('loading')
    return speakMandarinWithDevice(text, requestId)
  }, [cancelSpeech, speakMandarinWithDevice])

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

  const startEnglishPlayback = useCallback((wordId: string, word: string, meaning?: string) => {
    mandarinPlaybackRef.current = null
    const promise = playPronunciation(word)
    const entry: PlaybackEntry = { wordId, promise, completed: false }
    englishPlaybackRef.current = entry
    void promise.then(
      (played) => {
        entry.completed = true
        if (!played) return
        if (englishPlaybackRef.current !== entry) return
        const completedAt = Date.now()
        setMemory((current) => recordListeningCompletion(current, wordId, completedAt))
        setSessionListenedIds((current) => current.includes(wordId) ? current : [...current, wordId])
        if (pronunciationMode === 'detailed' && cardMode === 'flashcard' && meaning && !autoPlayRef.current) {
          setFlipped(true)
        }
      },
      () => { entry.completed = true },
    )
    return entry
  }, [cardMode, playPronunciation, pronunciationMode, setMemory])

  const stopPronunciation = useCallback(() => {
    pronunciationRequestRef.current += 1
    mandarinRequestRef.current += 1
    englishPlaybackRef.current = null
    mandarinPlaybackRef.current = null
    cancelSpeech()
    setSpellingLetter(null)
    setPronunciationStatus('idle')
    setMandarinStatus('idle')
  }, [cancelSpeech])

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
  const cardIndex = Math.max(0, Math.min(requestedCardIndex, studyWords.length - 1))
  const activeWord = studyWords[cardIndex]
  const activeMeaningSections = useMemo(
    () => {
      if (!activeWord) return null
      const sections = splitMeaningSections(activeWord.meaning)
      if (activeWord.memoryNotes) sections.memoryNotes.push(activeWord.memoryNotes)
      return sections
    },
    [activeWord],
  )
  const quizOptions = useMemo(
    () => activeWord && quizKind !== 'spelling' ? buildQuizOptions(activeWord, partWords, quizKind) : [],
    [activeWord, partWords, quizKind],
  )

  useEffect(() => {
    if (!activeWord) return
    const requestId = pronunciationRequestRef.current
    const timeout = window.setTimeout(() => {
      if (requestId !== pronunciationRequestRef.current) return
      if (englishPlaybackRef.current?.wordId !== activeWord.id) {
        startEnglishPlayback(activeWord.id, activeWord.word, activeMeaningSections?.primary)
      }
    }, 80)
    return () => window.clearTimeout(timeout)
  }, [activeMeaningSections, activeWord, startEnglishPlayback])

  useEffect(() => {
    if (!activeWord || !activeMeaningSections || !flipped || !(mandarinAutoplay || pronunciationMode === 'detailed') || cardMode !== 'flashcard') return
    const requestId = mandarinRequestRef.current
    const timeout = window.setTimeout(() => {
      if (requestId !== mandarinRequestRef.current) return
      // Autoplay owns its entire sequence, including pausing on the back face.
      if (autoPlayRef.current) return
      if (pronunciationMode === 'general' || mandarinPlaybackRef.current?.wordId !== activeWord.id) {
        startMandarinPlayback(activeWord.id, activeMeaningSections.primary)
      }
    }, 80)
    return () => window.clearTimeout(timeout)
  }, [activeMeaningSections, activeWord, cardMode, flipped, mandarinAutoplay, pronunciationMode, startMandarinPlayback])

  useEffect(() => {
    if (!activeWord) return
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices()
  }, [activeWord])

  useEffect(() => stopPronunciation, [activeWord?.id, cardMode, stopPronunciation])

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
        const played = await entry.promise
        if (!isActive()) return false
        const latest = playbackRef.current
        if (!latest || latest.wordId !== activeWord.id || latest.promise === entry.promise) return played
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
      playMandarin: (mandarinAutoplay || pronunciationMode === 'detailed') && activeMeaningSections?.primary
        ? () => awaitLatestPlayback(
            mandarinPlaybackRef,
            () => startMandarinPlayback(activeWord.id, activeMeaningSections.primary),
          )
        : undefined,
      wait,
      pauseAfterSpeechMs: PAUSE_AFTER_SPEECH_MS,
    }).then((shouldAdvance) => {
      if (!shouldAdvance) {
        if (isActive()) setAutoPlay(false)
        return
      }
      if (cardIndex >= studyWords.length - 1) {
        setAutoPlay(false)
        setFlipped(true)
        setListeningComplete(true)
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
    pronunciationMode,
    query,
    rootFilter,
    selectedPart,
    sequenceMode,
    setMemory,
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

  const listenedCountForPart = (part: number) =>
    data?.words.filter((word) => word.part === part && memory.listeningCompletedAt[word.id]).length ?? 0

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
    setListeningComplete(false)
  }

  const resetPagePosition = () => {
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }))
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
    setSessionListenedIds([])
    resetQuiz()
    setSelectedDeck(deckId)
    resetPagePosition()
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
    setSessionListenedIds([])
    resetQuiz()
    resetPagePosition()
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
    setSessionListenedIds([])
    resetQuiz()
    resetPagePosition()
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
    setSessionListenedIds([])
    resetQuiz()
    resetPagePosition()
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
    setSessionListenedIds([])
    resetQuiz()
  }

  const moveCard = (direction: -1 | 1) => {
    if (!studyWords.length) return
    unlockAudio()
    const next = Math.min(Math.max(cardIndex + direction, 0), studyWords.length - 1)
    setListeningComplete(false)
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
    const removed = (studyMode === 'review' && recall !== 'again') || (studyMode === 'known' && recall !== 'known')
    const nextIndex = nextReviewIndex(studyWords.length, cardIndex, removed)
    setCardIndex(nextIndex)
    setFlipped(false)
    if (!dailyReview && !favoriteReview && sequenceMode === 'fixed' && selectedPart !== null && studyMode === 'all' && rootFilter === 'all' && !query) {
      setMemory((current) => setPosition(current, String(selectedPart), nextIndex))
    }
    if (dailyReview && cardIndex === studyWords.length - 1) setRoundComplete(true)
  }

  const toggleActiveFavorite = () => {
    if (!activeWord) return
    if (memory.favorites[activeWord.id] && (favoriteReview || studyMode === 'favorites') && cardMode === 'flashcard') {
      setCardIndex(nextReviewIndex(studyWords.length, cardIndex, true))
      setFlipped(false)
    }
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
    setSessionListenedIds([])
    resetQuiz()
    resetPagePosition()
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
    setSessionListenedIds([])
    setError('')
    resetQuiz()
    resetPagePosition()
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
    setListeningComplete(false)
    if (autoPlay) {
      setAutoPlay(false)
      return
    }
    if (activeWord) setFlipped(false)
    setAutoPlay(true)
  }

  const changePronunciationMode = (mode: PronunciationMode) => {
    if (mode === pronunciationMode) return
    unlockAudio()
    stopPronunciation()
    setFlipped(false)
    setListeningComplete(false)
    setPronunciationMode(mode)
    try { window.localStorage.setItem(PRONUNCIATION_MODE_KEY, mode) } catch { /* Device preference is optional. */ }
  }

  const toggleMandarinAutoplay = () => {
    unlockAudio()
    const nextValue = !mandarinAutoplay
    setMandarinAutoplay(nextValue)
    window.localStorage.setItem(MANDARIN_AUTOPLAY_KEY, nextValue ? 'on' : 'off')
    if (!nextValue) {
      mandarinRequestRef.current += 1
      cancelSpeech()
      setMandarinStatus('idle')
    }
  }

  const returnToFirstCard = () => {
    if (!studyWords.length) return
    stopPronunciation()
    setAutoPlay(false)
    setListeningComplete(false)
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
      if (target?.closest('input, select, button, textarea, summary')) return
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
          <h1>今天要念<br />1000 字，還是 2000 字？</h1>
        </section>

        <section className="deck-choice-grid" aria-label="選擇單字書">
          {deckOptions.map((option) => {
            const deckMemory = decks[option.id].memory
            const known = Object.values(deckMemory.recall).filter((recall) => recall === 'known').length
            return (
              <button className="deck-choice-card" key={option.id} onClick={() => chooseDeck(option.id)} type="button">
                <strong>{option.title}</strong>
                <span>{option.description}</span>
                <small>{!decks[option.id].loaded
                  ? decks[option.id].status === 'offline' ? '等待連線，暫用本機進度' : decks[option.id].status === 'blocked' ? '請重新登入' : '正在同步進度…'
                  : `已背 ${known.toLocaleString()} · 剩 ${(option.count - known).toLocaleString()}`}</small>
                <ChevronRight aria-hidden="true" size={22} />
              </button>
            )
          })}
        </section>
        {legacyAvailable && (
          <details className="legacy-progress">
            <summary>匯入此裝置的舊版進度</summary>
            <p>舊版紀錄沒有帳號標記。只在確認這些紀錄屬於你時，才匯入至 {session.email}。</p>
            <label><input type="checkbox" checked={legacyConfirmed} onChange={(event) => setLegacyConfirmed(event.target.checked)} />我確認舊版進度屬於目前帳號</label>
            <Button disabled={!legacyConfirmed} onClick={() => {
              const imported = claimLegacyMemory(session.email)
              if (!imported) { setLegacyError('無法匯入，請確認瀏覽器允許儲存資料。'); return }
              for (const deck of ['words1000', 'words2000'] as const) updateProgress(deck, (current) => mergeMemory(current, imported[deck]))
              setLegacyAvailable(false)
            }}>匯入我的舊版進度</Button>
            {legacyError && <p role="alert">{legacyError}</p>}
          </details>
        )}
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
    const totalListened = data.words.filter((word) => memory.listeningCompletedAt[word.id]).length
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
            <span className={`sync-indicator sync-${syncStatus}`} title={syncStatus === 'offline' ? localSaved ? '連線恢復後會自動同步，進度已保存在本機' : '進度尚未儲存，請保持網頁開啟並恢復連線' : '學習進度會同步到你的帳號'}>
              {syncStatus === 'offline' ? <CloudOff size={14} /> : <Cloud size={14} />}
              <span>{syncStatus === 'loading' ? '同步中' : syncStatus === 'blocked' ? '請重新登入' : syncStatus === 'offline' ? localSaved ? '本機保存' : '尚未同步' : '已同步'}</span>
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
          <h1>選一份，開始背單字。</h1>
          <p className="intro-copy">
            共 {data.meta.totalWords.toLocaleString()} 字，分成五份；同字根不拆散。
          </p>
        </section>

        <section className="learning-dashboard" aria-labelledby="daily-review-heading">
          <button className="daily-review-card" disabled={dueIds.size === 0} onClick={openDailyReview} type="button">
            <span className="dashboard-icon"><Brain size={22} /></span>
            <span>
              <strong id="daily-review-heading">今天待複習 {dueIds.size} 字</strong>
              <em>{dueIds.size ? '現在開始' : '今天已完成'}</em>
            </span>
            <ChevronRight size={20} />
          </button>
          <div className="stat-grid" aria-label="學習統計">
            <div><BarChart3 size={17} /><span>今日練習</span><strong>{todayActivity.reviews}</strong><small>字</small></div>
            <div><Flame size={17} /><span>連續學習</span><strong>{streak}</strong><small>天</small></div>
            <button disabled={totalFavorites === 0} onClick={openFavorites} type="button"><Star size={17} /><span>收藏難字</span><strong>{totalFavorites}</strong><small>字</small></button>
          </div>
          <details className="weak-roots-details">
            <summary>查看需要加強的字根</summary>
            <div className="weak-roots">
              {weakRoots.length ? weakRoots.map((root) => (
                <small key={root.root}>{root.root} · {root.difficult} 字</small>
              )) : <small>完成幾張字卡後，這裡會找出最弱的字根</small>}
            </div>
          </details>
        </section>

        <section className="sequence-picker" aria-labelledby="sequence-heading">
          <div className="sequence-copy">
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
              <h2 id="part-heading">今天想背哪一份？</h2>
            </div>
          </div>

          <div className="part-grid">
            {data.parts.map((part) => {
              const known = knownCountForPart(part.id)
              const remaining = part.totalWordCount - known
              const percent = Math.round((known / part.totalWordCount) * 100)
              return (
                  <button className="part-card" disabled={!decks[selectedDeck].loaded && syncStatus === 'loading'} key={part.id} onClick={() => openPart(part.id)} type="button">
                  <span className="part-number">0{part.id}</span>
                  <span className="part-title">第 {part.id} 份</span>
                  <span className="part-meta">{part.totalWordCount} 字</span>
                  <span className="part-counts">已背 {known} · 剩 {remaining}</span>
                  <span className="part-progress"><i style={{ width: `${percent}%` }} /></span>
                  <span className="part-arrow"><ChevronRight size={18} /></span>
                </button>
              )
            })}
          </div>
        </section>

        <details className="listening-progress-details">
          <summary>
            <span>查看聆聽進度</span>
            <small>已聽 {totalListened.toLocaleString()} / {data.meta.totalWords.toLocaleString()}</small>
          </summary>
          <div className="listening-progress-list">
            {data.parts.map((part) => {
              const listened = listenedCountForPart(part.id)
              const percent = Math.round((listened / part.totalWordCount) * 100)
              return (
                <div className="listening-progress-row" key={part.id}>
                  <span>第 {part.id} 份</span>
                  <strong>已聽 {listened} / {part.totalWordCount}</strong>
                  <i aria-hidden="true"><b style={{ width: `${percent}%` }} /></i>
                </div>
              )
            })}
          </div>
        </details>
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
  const currentRecall = activeWord ? memory.recall[activeWord.id] : undefined
  const pronunciationLabel =
    pronunciationStatus === 'loading' ? '準備中' :
    pronunciationStatus === 'unavailable' ? '再試一次' :
      '英文發音'
  const mandarinLabel =
    mandarinStatus === 'loading' ? '準備中' :
    mandarinStatus === 'unavailable' ? '再試一次' :
      '中文發音'

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

      <div className="study-progress-summary" aria-label={dailyReview ? '今日複習進度' : favoriteReview ? '收藏熟悉度' : '本份背誦進度'}>
        <span>{dailyReview ? '今日複習' : favoriteReview ? '收藏熟悉度' : '本份進度'}</span>
        <strong>{dailyReview ? '已複習' : '已背'} {partKnown} · 剩 {partRemaining}</strong>
      </div>

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
        <details className="study-options">
          <summary>篩選與順序</summary>
          <div className="study-options-content">
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
          </div>
        </details>
        {cardMode === 'flashcard' && (
          <div className="pronunciation-mode-panel">
            <div className="study-sequence-tabs" role="group" aria-label="發音模式">
              <button type="button" aria-pressed={pronunciationMode === 'general'} className={pronunciationMode === 'general' ? 'is-active' : ''} onClick={() => changePronunciationMode('general')}>一般發音</button>
              <button type="button" aria-pressed={pronunciationMode === 'detailed'} className={pronunciationMode === 'detailed' ? 'is-active' : ''} onClick={() => changePronunciationMode('detailed')}>詳細發音</button>
            </div>
            {pronunciationMode === 'detailed' && <p>單字 → 逐字母拼讀 → 單字 → 翻面念中文<br /><a href="/audio/letters-v2/attribution.json" target="_blank" rel="noreferrer">字母錄音來源與授權</a></p>}
          </div>
        )}
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
        {cardMode === 'flashcard' && pronunciationMode === 'general' && (
          <div className={`mandarin-audio-panel ${mandarinAutoplay ? 'is-enabled' : ''}`}>
            <button aria-pressed={mandarinAutoplay} onClick={toggleMandarinAutoplay} type="button">
              <Volume2 size={18} aria-hidden="true" />
              <strong>中文發音</strong>
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
                      {currentRecall === 'known' ? '已記住' : currentRecall === 'hard' ? '模糊' : currentRecall === 'again' ? '待複習' : '新單字'}
                    </span>
                  </span>
                </div>
                <div className="word-block">
                  <h2>{activeWord.word}</h2>
                  {activeWord.pronunciation && <p>/{activeWord.pronunciation}/</p>}
                  <button
                    aria-label={`播放 ${activeWord.word} 的英文發音`}
                    className={`pronounce-button status-${pronunciationStatus}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      unlockAudio()
                      startEnglishPlayback(activeWord.id, activeWord.word, activeMeaningSections?.primary)
                    }}
                    type="button"
                  >
                    {pronunciationStatus === 'loading' ?
                      <LoaderCircle className="pronounce-spinner" size={17} /> :
                      <Volume2 size={17} />}
                    <span aria-live="polite">{spellingLetter ? `拼讀 ${spellingLetter}` : pronunciationLabel}</span>
                  </button>
                </div>
                <p className="flip-hint"><RotateCcw size={14} /> 輕觸翻面 · 左右滑動換字</p>
              </div>
            ) : (
              <div className="card-back">
                <h2 className="card-back-word" lang="en">{activeWord.word}</h2>
                <div className="detail-block meaning-block">
                  <span>中文意思</span>
                  <h3>{activeMeaningSections?.primary ?? activeWord.meaning}</h3>
                  <button
                    aria-label="播放中文發音"
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
                </div>
                <div className="detail-block root-label">
                  <span>字根</span>
                  <strong>{activeWord.root === 'S' ? 'S · 無字根' : activeWord.root}</strong>
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
          {listeningComplete && (
            <p className="listening-complete-summary" role="status" aria-live="polite">
              本次聽完 {sessionListenedIds.length} 字
              {selectedPart > 0 && ` · 本份累計已聽 ${listenedCountForPart(selectedPart)} / ${partTotal}`}
            </p>
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
      {({ session, openAdmin }) => <StudyApp key={session.email.trim().toLowerCase()} onManageAccounts={openAdmin} session={session} />}
    </AccountAccess>
  )
}

export default App
