import { describe, expect, test } from 'bun:test'

import {
  isKimiAlwaysOnThinkingModel,
  isKimiK3ModelId,
  isKimiModel,
  shouldOmitDisabledThinkingForModel,
  shouldOmitThinkingParamForModel,
} from './kimi.js'

describe('Kimi model rules', () => {
  test('recognizes both official K3 model ids', () => {
    expect(isKimiModel('k3')).toBe(true)
    expect(isKimiModel('k3[1m]')).toBe(true)
    expect(isKimiModel('kimi-k3')).toBe(true)
    expect(isKimiK3ModelId('k3[1m]')).toBe(true)
    expect(isKimiK3ModelId('kimi-k3')).toBe(true)
  })

  test('treats K3 as always-on thinking only on its official endpoint', () => {
    const kimiCode = 'https://api.kimi.com/coding/'
    const kimiApi = 'https://api.moonshot.cn'

    expect(isKimiAlwaysOnThinkingModel('k3', kimiCode)).toBe(true)
    expect(isKimiAlwaysOnThinkingModel('k3[1m]', kimiCode)).toBe(true)
    expect(isKimiAlwaysOnThinkingModel('kimi-k3', kimiApi)).toBe(true)
    expect(isKimiAlwaysOnThinkingModel('k3', 'https://openrouter.ai')).toBe(false)
    expect(isKimiAlwaysOnThinkingModel('kimi-k3', 'https://openrouter.ai')).toBe(false)
  })

  test('treats Kimi K2.7 Code variants as always-on thinking models', () => {
    const kimiCode = 'https://api.kimi.com/coding/'
    const kimiApi = 'https://api.moonshot.cn'

    expect(isKimiAlwaysOnThinkingModel('kimi-k2.7-code', kimiCode)).toBe(true)
    expect(isKimiAlwaysOnThinkingModel('kimi-k2.7-code-highspeed', kimiCode)).toBe(true)
    expect(isKimiAlwaysOnThinkingModel('openrouter/kimi-k2.7-code', kimiCode)).toBe(true)
    expect(isKimiAlwaysOnThinkingModel('kimi-for-coding', kimiCode)).toBe(true)
    expect(isKimiAlwaysOnThinkingModel('kimi-for-coding-highspeed', kimiCode)).toBe(true)
    expect(isKimiAlwaysOnThinkingModel('kimi-k2.7-code', kimiApi)).toBe(true)
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
