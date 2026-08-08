import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_COMPLETION_SOUND,
  completionSoundSetting,
  playCompletionSound,
  previewCompletionSound,
  readAudioFileAsDataUrl,
  resolveCompletionSoundSrc,
} from './completionSound'

const playMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.stubGlobal('Audio', class {
  currentTime = 0
  constructor(public src: string) {}
  play() { return playMock() }
})

describe('completionSound', () => {
  it('resolves built-in sound sources and falls back to the default', () => {
    expect(resolveCompletionSoundSrc({ completionSoundId: 'ding' })).toBe('/sounds/ding.wav')
    expect(resolveCompletionSoundSrc({ completionSoundId: 'bell' })).toBe('/sounds/bell.wav')
    expect(resolveCompletionSoundSrc({ completionSoundId: 'knock' })).toBe('/sounds/knock.wav')
    expect(resolveCompletionSoundSrc({ completionSoundId: 'nope' }))
      .toBe(`/sounds/${DEFAULT_COMPLETION_SOUND}.wav`)
    expect(resolveCompletionSoundSrc({})).toBe(`/sounds/${DEFAULT_COMPLETION_SOUND}.wav`)
  })

  it('resolves custom sounds only from audio data urls', () => {
    expect(resolveCompletionSoundSrc({
      completionSoundId: 'custom',
      completionSoundCustomData: 'data:audio/mpeg;base64,AAAA',
    })).toBe('data:audio/mpeg;base64,AAAA')
    expect(resolveCompletionSoundSrc({ completionSoundId: 'custom' })).toBeNull()
    expect(resolveCompletionSoundSrc({
      completionSoundId: 'custom',
      completionSoundCustomData: 'https://evil.example/x.mp3',
    })).toBeNull()
  })

  it('normalizes unknown setting values', () => {
    expect(completionSoundSetting('custom')).toBe('custom')
    expect(completionSoundSetting('bell')).toBe('bell')
    expect(completionSoundSetting(42)).toBe(DEFAULT_COMPLETION_SOUND)
  })

  it('plays only when enabled and caches the audio element', () => {
    playMock.mockClear()
    playCompletionSound({ completionSoundEnabled: false, completionSoundId: 'ding' })
    expect(playMock).not.toHaveBeenCalled()

    playCompletionSound({ completionSoundEnabled: true, completionSoundId: 'ding' })
    playCompletionSound({ completionSoundEnabled: true, completionSoundId: 'ding' })
    expect(playMock).toHaveBeenCalledTimes(2)
  })

  it('previews a chosen sound regardless of the enabled flag', () => {
    playMock.mockClear()
    previewCompletionSound('knock')
    expect(playMock).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized audio files', async () => {
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'big.mp3', { type: 'audio/mpeg' })
    await expect(readAudioFileAsDataUrl(big)).rejects.toThrow(/5MB/)
  })
})
