import { describe, expect, test } from 'bun:test'

import {
  isZhipuGlmEnabledThinkingModel,
  requiresEnabledThinkingParamForModel,
  shouldOmitDisabledThinkingForModel,
  shouldOmitThinkingParamForModel,
} from './thinkingPolicy.js'

describe('thinking policy', () => {
  test('requires enabled thinking for GLM 5 models', () => {
    expect(isZhipuGlmEnabledThinkingModel('glm-5.2')).toBe(true)
    expect(isZhipuGlmEnabledThinkingModel('glm-5.2[1m]')).toBe(true)
    expect(isZhipuGlmEnabledThinkingModel('z-ai/glm-5.2')).toBe(true)
    expect(isZhipuGlmEnabledThinkingModel('glm-4.7')).toBe(false)
  })

  test('uses enabled thinking instead of omitting thinking for enabled-only models', () => {
    expect(requiresEnabledThinkingParamForModel('glm-5.2[1m]')).toBe(true)
    expect(shouldOmitDisabledThinkingForModel('glm-5.2[1m]')).toBe(true)
    expect(shouldOmitThinkingParamForModel('glm-5.2[1m]')).toBe(false)
  })
})
