type Voice = { name: string; lang: string }

export function selectMandarinVoice<T extends Voice>(voices: T[]): T | null {
  const language = (voice: T) => voice.lang.toLowerCase().replaceAll('_', '-')
  const taiwan = voices.filter((voice) => language(voice) === 'zh-tw' || /^zh-hant(?:-tw)?$/.test(language(voice)))
  // Prefer the requested locale before comparing voice quality. In particular,
  // a Google zh-CN voice must not outrank an installed Taiwanese voice.
  const candidates = taiwan.length ? taiwan : voices.filter((voice) => /^zh(?:-|$)/.test(language(voice)))
  return candidates.find((voice) => /natural|neural|premium|enhanced|online/i.test(voice.name)) ??
    candidates.find((voice) => /hsiaochen|hanhan|yating|meijia|google/i.test(voice.name)) ??
    candidates[0] ?? null
}
