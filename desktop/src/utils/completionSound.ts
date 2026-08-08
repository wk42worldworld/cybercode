export const COMPLETION_SOUND_IDS = ['ding', 'bell', 'knock'] as const
export type CompletionSoundId = (typeof COMPLETION_SOUND_IDS)[number]
export type CompletionSoundSetting = CompletionSoundId | 'custom'

export const DEFAULT_COMPLETION_SOUND: CompletionSoundSetting = 'ding'

const BUILTIN_SRC: Record<CompletionSoundId, string> = {
  ding: '/sounds/ding.wav',
  bell: '/sounds/bell.wav',
  knock: '/sounds/knock.wav',
}

export function completionSoundSetting(
  value: unknown,
): CompletionSoundSetting {
  return value === 'custom' || COMPLETION_SOUND_IDS.includes(value as CompletionSoundId)
    ? value as CompletionSoundSetting
    : DEFAULT_COMPLETION_SOUND
}

export function resolveCompletionSoundSrc(settings: {
  completionSoundId?: unknown
  completionSoundCustomData?: unknown
}): string | null {
  const id = completionSoundSetting(settings.completionSoundId)
  if (id === 'custom') {
    const data = settings.completionSoundCustomData
    return typeof data === 'string' && data.startsWith('data:audio/') ? data : null
  }
  return BUILTIN_SRC[id]
}

const audioCache = new Map<string, HTMLAudioElement>()

function play(src: string) {
  let audio = audioCache.get(src)
  if (!audio) {
    audio = new Audio(src)
    audioCache.set(src, audio)
  }
  audio.currentTime = 0
  // Autoplay policies may reject before the first user interaction; a missed
  // chime is fine, an unhandled rejection is not.
  void audio.play().catch(() => {})
}

export function playCompletionSound(settings: {
  completionSoundEnabled?: unknown
  completionSoundId?: unknown
  completionSoundCustomData?: unknown
}) {
  if (settings.completionSoundEnabled !== true) return
  const src = resolveCompletionSoundSrc(settings)
  if (src) play(src)
}

export function previewCompletionSound(
  soundId: CompletionSoundSetting,
  customData?: unknown,
) {
  const src = resolveCompletionSoundSrc({
    completionSoundId: soundId,
    completionSoundCustomData: customData,
  })
  if (src) play(src)
}

export function readAudioFileAsDataUrl(
  file: File,
  maxBytes = 5 * 1024 * 1024,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error(`Audio file is larger than ${Math.round(maxBytes / 1024 / 1024)}MB`))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read audio file'))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string' || !result.startsWith('data:')) {
        reject(new Error('Unsupported audio file'))
        return
      }
      resolve(result)
    }
    reader.readAsDataURL(file)
  })
}
