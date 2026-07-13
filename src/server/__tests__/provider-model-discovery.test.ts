import { beforeEach, describe, expect, test } from 'bun:test'

import {
  clearProviderModelDiscoveryCache,
  discoverProviderModels,
} from '../services/providerModelDiscovery.js'

describe('provider model discovery', () => {
  beforeEach(() => {
    clearProviderModelDiscoveryCache()
  })

  test('discovers OpenAI-compatible model IDs and metadata', async () => {
    const urls: string[] = []
    const headers: Headers[] = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input))
      headers.push(new Headers(init?.headers))
      return Response.json({
        data: [
          {
            id: 'vision-model',
            display_name: 'Vision Model',
            context_window: 262144,
            capabilities: ['tools', 'vision'],
          },
          { id: 'text-model' },
        ],
      })
    }) as typeof fetch

    const result = await discoverProviderModels({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret-key',
      apiFormat: 'openai_chat',
    }, { fetchImpl })

    expect(urls).toEqual(['https://api.example.com/v1/models'])
    expect(headers[0]?.get('authorization')).toBe('Bearer secret-key')
    expect(result.models).toEqual([
      { id: 'text-model' },
      {
        id: 'vision-model',
        label: 'Vision Model',
        contextWindow: 262144,
        supportsImages: true,
      },
    ])
  })

  test('uses Ollama tags and show metadata without requiring an API key', async () => {
    const urls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      if (url.endsWith('/api/tags')) {
        return Response.json({ models: [{ name: 'qwen3.5:0.8b' }] })
      }
      return Response.json({
        capabilities: ['completion', 'tools', 'vision'],
        model_info: { 'qwen3.context_length': 131072 },
      })
    }) as typeof fetch

    const result = await discoverProviderModels({
      baseUrl: 'http://localhost:11434',
      apiFormat: 'anthropic',
      presetId: 'ollama',
    }, { fetchImpl })

    expect(urls).toEqual([
      'http://localhost:11434/api/tags',
      'http://localhost:11434/api/show',
    ])
    expect(result.models).toEqual([{
      id: 'qwen3.5:0.8b',
      contextWindow: 131072,
      supportsImages: true,
    }])
  })

  test('reads image support from common input modality metadata shapes', async () => {
    const fetchImpl = (async () => Response.json({
      data: [
        { id: 'array-vision', input_modalities: ['text', 'image'] },
        { id: 'camel-vision', inputModalities: ['text', 'input_image'] },
        { id: 'nested-vision', modalities: { input: ['text', 'vision'], output: ['text'] } },
        { id: 'explicit-text', capabilities: { completion_chat: true, vision: false } },
      ],
    })) as typeof fetch

    const result = await discoverProviderModels({
      baseUrl: 'https://api.example.com/v1',
      apiFormat: 'openai_chat',
    }, { fetchImpl })

    expect(result.models).toEqual([
      { id: 'array-vision', supportsImages: true },
      { id: 'camel-vision', supportsImages: true },
      { id: 'explicit-text', supportsImages: false },
      { id: 'nested-vision', supportsImages: true },
    ])
  })

  test('caches successful discovery briefly unless force refresh is requested', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return Response.json({ data: [{ id: `model-${calls}` }] })
    }) as typeof fetch
    const input = {
      baseUrl: 'https://cache.example.com',
      apiFormat: 'openai_responses' as const,
    }

    const first = await discoverProviderModels(input, { fetchImpl })
    const cached = await discoverProviderModels(input, { fetchImpl })
    const refreshed = await discoverProviderModels(input, { fetchImpl, force: true })

    expect(first.models[0]?.id).toBe('model-1')
    expect(cached.cached).toBe(true)
    expect(cached.models[0]?.id).toBe('model-1')
    expect(refreshed.models[0]?.id).toBe('model-2')
    expect(calls).toBe(2)
  })
})
