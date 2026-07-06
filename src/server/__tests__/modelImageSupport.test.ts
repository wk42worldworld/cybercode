import { describe, expect, test } from 'bun:test'

import {
  inferModelSupportsImages,
  resolveProviderImageSupport,
} from '../services/modelImageSupport.js'
import type { SavedProvider } from '../types/provider.js'

function provider(overrides: Partial<SavedProvider>): SavedProvider {
  return {
    id: 'provider-1',
    presetId: 'custom',
    name: 'Custom',
    apiKey: 'sk-test',
    baseUrl: 'https://example.com',
    apiFormat: 'anthropic',
    models: {
      main: 'unknown-model',
      haiku: 'unknown-model',
      sonnet: 'unknown-model',
      opus: 'unknown-model',
    },
    ...overrides,
  }
}

describe('model image support', () => {
  test('allows official provider sessions by default', () => {
    expect(resolveProviderImageSupport(null, 'claude-sonnet-4').supportsImages).toBe(true)
  })

  test('uses explicit saved provider image setting first', () => {
    expect(resolveProviderImageSupport(provider({ supportsImages: true })).supportsImages).toBe(true)
    expect(resolveProviderImageSupport(provider({ supportsImages: false })).supportsImages).toBe(false)
  })

  test('uses preset defaults for known text-only and vision providers', () => {
    expect(resolveProviderImageSupport(provider({
      presetId: 'deepseek',
      name: 'DeepSeek',
      models: {
        main: 'deepseek-v4-pro[1m]',
        haiku: 'deepseek-v4-flash',
        sonnet: 'deepseek-v4-pro[1m]',
        opus: 'deepseek-v4-pro[1m]',
      },
    })).supportsImages).toBe(false)

    expect(resolveProviderImageSupport(provider({
      presetId: 'google',
      name: 'Google Gemini',
      apiFormat: 'openai_chat',
      models: {
        main: 'gemini-3.5-flash',
        haiku: 'gemini-3.1-flash-lite',
        sonnet: 'gemini-3.5-flash',
        opus: 'gemini-3.1-pro-preview',
      },
    })).supportsImages).toBe(true)
  })

  test('infers common vision and text-only model ids', () => {
    expect(inferModelSupportsImages('gpt-4o')).toBe(true)
    expect(inferModelSupportsImages('qwen-vl-plus')).toBe(true)
    expect(inferModelSupportsImages('openai/gpt-oss-20b')).toBe(false)
    expect(inferModelSupportsImages('deepseek-v4-pro[1m]')).toBe(false)
  })

  test('defaults unknown custom providers to text-only', () => {
    expect(resolveProviderImageSupport(provider({ models: {
      main: 'my-private-model',
      haiku: 'my-private-model',
      sonnet: 'my-private-model',
      opus: 'my-private-model',
    } })).supportsImages).toBe(false)
  })
})
