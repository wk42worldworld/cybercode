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

  test('uses image support mode overrides before legacy settings', () => {
    const forcedOn = resolveProviderImageSupport(provider({
      imageSupportMode: 'enabled',
      supportsImages: false,
    }))
    expect(forcedOn.supportsImages).toBe(true)
    expect(forcedOn.source).toBe('provider-forced')

    const forcedOff = resolveProviderImageSupport(provider({
      imageSupportMode: 'disabled',
      supportsImages: true,
    }))
    expect(forcedOff.supportsImages).toBe(false)
    expect(forcedOff.source).toBe('provider-forced')
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

    expect(resolveProviderImageSupport(provider({
      presetId: 'kimi',
      name: 'Kimi API',
      baseUrl: 'https://api.moonshot.cn/anthropic',
      models: {
        main: 'kimi-k2.6',
        haiku: 'kimi-k2.6',
        sonnet: 'kimi-k2.6',
        opus: 'kimi-k2.6',
      },
    })).supportsImages).toBe(true)
  })

  test('infers common vision and text-only model ids', () => {
    expect(inferModelSupportsImages('gpt-4o')).toBe(true)
    expect(inferModelSupportsImages('qwen-vl-plus')).toBe(true)
    expect(inferModelSupportsImages('k3')).toBe(true)
    expect(inferModelSupportsImages('kimi-k3')).toBe(true)
    expect(inferModelSupportsImages('kimi-k2.6')).toBe(true)
    expect(inferModelSupportsImages('kimi-k2.7-code')).toBe(true)
    expect(inferModelSupportsImages('kimi-for-coding')).toBe(true)
    expect(inferModelSupportsImages('qwen3.5:0.8b')).toBe(true)
    expect(inferModelSupportsImages('qwen3.6')).toBe(true)
    expect(inferModelSupportsImages('qwen3.7-plus')).toBe(true)
    expect(inferModelSupportsImages('qwen3.7-plus-2026-05-26')).toBe(true)
    expect(inferModelSupportsImages('gemma3:4b')).toBe(true)
    expect(inferModelSupportsImages('gemma3:1b')).toBeUndefined()
    expect(inferModelSupportsImages('pixtral-large-2411')).toBe(true)
    expect(inferModelSupportsImages('grok-4.5')).toBe(true)
    expect(inferModelSupportsImages('minicpm-v:8b')).toBe(true)
    expect(inferModelSupportsImages('mimo-v2.5')).toBe(true)
    expect(inferModelSupportsImages('mimo-v2.5-pro')).toBe(false)
    expect(inferModelSupportsImages('openai/gpt-oss-20b')).toBe(false)
    expect(inferModelSupportsImages('deepseek-v4-pro[1m]')).toBe(false)
  })

  test('routes custom Qwen 3.7 providers through vision input', () => {
    const resolved = resolveProviderImageSupport(provider({
      apiFormat: 'openai_responses',
      models: {
        main: 'qwen3.7-plus',
        haiku: 'qwen3.7-plus',
        sonnet: 'qwen3.7-plus',
        opus: 'qwen3.7-plus',
      },
    }))
    expect(resolved.supportsImages).toBe(true)
    expect(resolved.status).toBe('supported')
    expect(resolved.source).toBe('model-id')
  })

  test('keeps unknown custom providers safe until dynamic detection completes', () => {
    const resolved = resolveProviderImageSupport(provider({ models: {
      main: 'my-private-model',
      haiku: 'my-private-model',
      sonnet: 'my-private-model',
      opus: 'my-private-model',
    } }))
    expect(resolved.supportsImages).toBe(false)
    expect(resolved.status).toBe('unknown')
    expect(resolved.source).toBe('default')
  })
})
