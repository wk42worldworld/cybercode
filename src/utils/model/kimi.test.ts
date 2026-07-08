import { describe, expect, test } from 'bun:test'

import {
  isKimiAlwaysOnThinkingModel,
  shouldOmitDisabledThinkingForModel,
  shouldOmitThinkingParamForModel,
} from './kimi.js'

describe('Kimi model rules', () => {
  test('treats Kimi K2.7 Code variants as always-on thinking models', () => {
    expect(isKimiAlwaysOnThinkingModel('kimi-k2.7-code')).toBe(true)
    expect(isKimiAlwaysOnThinkingModel('kimi-k2.7-code-highspeed')).toBe(true)
    expect(isKimiAlwaysOnThinkingModel('openrouter/kimi-k2.7-code')).toBe(true)
    expect(isKimiAlwaysOnThinkingModel('kimi-for-coding')).toBe(true)
  })

  test('keeps Kimi K2.6 able to use explicit disabled thinking', () => {
    expect(isKimiAlwaysOnThinkingModel('kimi-k2.6')).toBe(false)
    expect(shouldOmitDisabledThinkingForModel('kimi-k2.6')).toBe(false)
    expect(shouldOmitThinkingParamForModel('kimi-k2.6')).toBe(false)
  })

  test('omits thinking params for models that reject disabled thinking', () => {
    expect(shouldOmitDisabledThinkingForModel('kimi-k2.7-code')).toBe(true)
    expect(shouldOmitThinkingParamForModel('kimi-k2.7-code-highspeed')).toBe(true)
    expect(shouldOmitDisabledThinkingForModel('kimi-for-coding')).toBe(true)
  })

  test('omits disabled thinking for MiMo models without blocking enabled thinking', () => {
    expect(shouldOmitDisabledThinkingForModel('mimo-v2.5-pro')).toBe(true)
    expect(shouldOmitDisabledThinkingForModel('mimo-v2.5')).toBe(true)
    expect(shouldOmitThinkingParamForModel('mimo-v2.5-pro')).toBe(false)
  })
})
