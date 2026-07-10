import { describe, expect, test } from 'bun:test'

import {
  isKimiAlwaysOnThinkingModel,
  shouldOmitDisabledThinkingForModel,
  shouldOmitThinkingParamForModel,
} from './kimi.js'

describe('Kimi model rules', () => {
  test('treats Kimi K2.7 Code variants as always-on thinking models', () => {
    const kimiCode = 'https://api.kimi.com/coding/'
    expect(isKimiAlwaysOnThinkingModel('kimi-k2.7-code', kimiCode)).toBe(true)
    expect(isKimiAlwaysOnThinkingModel('kimi-k2.7-code-highspeed', kimiCode)).toBe(true)
    expect(isKimiAlwaysOnThinkingModel('openrouter/kimi-k2.7-code', kimiCode)).toBe(true)
    expect(isKimiAlwaysOnThinkingModel('kimi-for-coding', kimiCode)).toBe(true)
    expect(isKimiAlwaysOnThinkingModel('kimi-k2.7-code', 'https://openrouter.ai')).toBe(false)
  })

  test('keeps Kimi K2.6 able to use explicit disabled thinking', () => {
    expect(isKimiAlwaysOnThinkingModel('kimi-k2.6')).toBe(false)
    expect(shouldOmitDisabledThinkingForModel('kimi-k2.6')).toBe(false)
    expect(shouldOmitThinkingParamForModel('kimi-k2.6')).toBe(false)
  })

  test('does not send disabled thinking for models that require enabled thinking', () => {
    const kimiCode = 'https://api.kimi.com/coding/'
    expect(shouldOmitDisabledThinkingForModel('kimi-k2.7-code', kimiCode)).toBe(true)
    expect(shouldOmitThinkingParamForModel('kimi-k2.7-code-highspeed', kimiCode)).toBe(false)
    expect(shouldOmitDisabledThinkingForModel('kimi-for-coding', kimiCode)).toBe(true)
  })

  test('omits disabled thinking for MiMo models without blocking enabled thinking', () => {
    const mimo = 'https://api.xiaomimimo.com/anthropic'
    expect(shouldOmitDisabledThinkingForModel('mimo-v2.5-pro', mimo)).toBe(true)
    expect(shouldOmitDisabledThinkingForModel('mimo-v2.5', mimo)).toBe(true)
    expect(shouldOmitThinkingParamForModel('mimo-v2.5-pro')).toBe(false)
    expect(shouldOmitDisabledThinkingForModel('mimo-v2.5', 'https://example.com')).toBe(false)
  })
})
