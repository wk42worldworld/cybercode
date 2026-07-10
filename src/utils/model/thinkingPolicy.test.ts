import { describe, expect, test } from 'bun:test'

import {
  isZhipuGlmEnabledThinkingModel,
  requiresEnabledThinkingParamForModel,
  shouldOmitDisabledThinkingForModel,
  shouldOmitThinkingParamForModel,
} from './thinkingPolicy.js'

describe('thinking policy', () => {
  test('requires enabled thinking for GLM 5 models', () => {
    const zhipu = 'https://open.bigmodel.cn/api/anthropic'
    expect(isZhipuGlmEnabledThinkingModel('glm-5.2', zhipu)).toBe(true)
    expect(isZhipuGlmEnabledThinkingModel('glm-5.2[1m]', zhipu)).toBe(true)
    expect(isZhipuGlmEnabledThinkingModel('z-ai/glm-5.2', zhipu)).toBe(true)
    expect(isZhipuGlmEnabledThinkingModel('glm-4.7', zhipu)).toBe(false)
    expect(isZhipuGlmEnabledThinkingModel('glm-5.2', 'https://ark.cn-beijing.volces.com')).toBe(false)
  })

  test('uses enabled thinking instead of omitting thinking for enabled-only models', () => {
    const zhipu = 'https://open.bigmodel.cn/api/anthropic'
    expect(requiresEnabledThinkingParamForModel('glm-5.2', zhipu)).toBe(true)
    expect(shouldOmitDisabledThinkingForModel('glm-5.2', zhipu)).toBe(true)
    expect(shouldOmitThinkingParamForModel('glm-5.2', zhipu)).toBe(false)
  })
})
