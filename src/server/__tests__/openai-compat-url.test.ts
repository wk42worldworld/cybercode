import { describe, expect, test } from 'bun:test'

import { buildOpenAICompatibleUrl } from '../proxy/openaiCompatUrl.js'

describe('buildOpenAICompatibleUrl', () => {
  test('adds /v1 for provider roots', () => {
    expect(buildOpenAICompatibleUrl('https://api.openai.com', 'responses'))
      .toBe('https://api.openai.com/v1/responses')
    expect(buildOpenAICompatibleUrl('https://api.openai.com/', 'chat/completions'))
      .toBe('https://api.openai.com/v1/chat/completions')
  })

  test('does not duplicate /v1 for already-versioned OpenAI-compatible bases', () => {
    expect(buildOpenAICompatibleUrl('https://api.openai.com/v1', 'responses'))
      .toBe('https://api.openai.com/v1/responses')
    expect(buildOpenAICompatibleUrl('https://api.example.com/v1/', 'chat/completions'))
      .toBe('https://api.example.com/v1/chat/completions')
  })

  test('supports Gemini OpenAI compatibility base URLs', () => {
    expect(buildOpenAICompatibleUrl(
      'https://generativelanguage.googleapis.com/v1beta/openai',
      'chat/completions',
    )).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
  })
})
