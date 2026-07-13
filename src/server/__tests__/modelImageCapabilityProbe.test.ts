import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SavedProvider } from '../types/provider.js'
import {
  isImageInputUnsupportedError,
  probeProviderImageSupport,
  resolveProviderImageSupportDynamically,
} from '../services/modelImageCapabilityProbe.js'
import {
  getLearnedImageSupport,
  resetImageCapabilityRegistryCacheForTests,
} from '../../utils/model/imageCapabilityRegistry.js'
import { modelSupportsImages } from '../../utils/model/imageSupport.js'

function provider(overrides: Partial<SavedProvider> = {}): SavedProvider {
  return {
    id: 'provider-probe',
    presetId: 'custom',
    name: 'Probe Provider',
    apiKey: 'sk-test',
    baseUrl: 'https://example.com/anthropic',
    apiFormat: 'anthropic',
    models: {
      main: 'private-model',
      haiku: 'private-model',
      sonnet: 'private-model',
      opus: 'private-model',
    },
    ...overrides,
  }
}

let cacheDir = ''

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'cybercode-image-capability-'))
  process.env.CYBERCODE_IMAGE_CAPABILITY_CACHE_PATH = join(cacheDir, 'capabilities.json')
  resetImageCapabilityRegistryCacheForTests()
})

afterEach(() => {
  delete process.env.CYBERCODE_IMAGE_CAPABILITY_CACHE_PATH
  delete process.env.CYBERCODE_PROVIDER_BASE_URL
  delete process.env.ANTHROPIC_BASE_URL
  resetImageCapabilityRegistryCacheForTests()
  rmSync(cacheDir, { recursive: true, force: true })
})

describe('dynamic model image capability', () => {
  test('recognizes image-specific rejection without confusing an unsupported model id', () => {
    expect(isImageInputUnsupportedError('This model does not support image input.')).toBe(true)
    expect(isImageInputUnsupportedError('当前模型不支持图片输入')).toBe(true)
    expect(isImageInputUnsupportedError('Unsupported model mimo-v2.5-flash')).toBe(false)
  })

  test('probes Anthropic-compatible custom models with a generated image', async () => {
    let requestBody: any
    let requestUrl = ''
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(url)
      requestBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        type: 'message',
        content: [{ type: 'text', text: '7' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const result = await probeProviderImageSupport(
      provider({ baseUrl: 'https://example.com/v1' }),
      'private-model',
      { fetchImpl },
    )

    expect(result.status).toBe('supported')
    expect(requestUrl).toBe('https://example.com/v1/messages')
    expect(requestBody.model).toBe('private-model')
    expect(requestBody.messages[0].content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png' },
    })
  })

  test('keeps unrelated provider errors inconclusive', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      error: { message: 'invalid thinking: only type=enabled is allowed for this model' },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })) as typeof fetch

    const result = await probeProviderImageSupport(provider(), 'private-model', { fetchImpl })
    expect(result.status).toBe('unknown')
  })

  test('does not mistake a successful text-only response for vision support', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'OK' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch

    const result = await probeProviderImageSupport(provider({
      apiFormat: 'openai_chat',
    }), 'private-model', { fetchImpl })

    expect(result.status).toBe('unknown')
    expect(result.detail).toContain('unexpected answer')
  })

  test('verifies name-inferred vision support through custom gateways', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response(JSON.stringify({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const result = await resolveProviderImageSupportDynamically(provider({
      apiFormat: 'openai_responses',
      models: {
        main: 'qwen3.7-plus',
        haiku: 'qwen3.7-plus',
        sonnet: 'qwen3.7-plus',
        opus: 'qwen3.7-plus',
      },
    }), 'qwen3.7-plus', { fetchImpl })

    expect(calls).toBe(1)
    expect(result.status).toBe('unknown')
    expect(result.supportsImages).toBe(false)
    expect(result.source).toBe('model-id')
  })

  test('validates OpenAI Responses image support from the visual answer', async () => {
    let requestBody: any
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '7' }] }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const result = await probeProviderImageSupport(provider({
      apiFormat: 'openai_responses',
    }), 'private-model', { fetchImpl })

    expect(result.status).toBe('supported')
    expect(requestBody.input[0].content[0]).toMatchObject({ type: 'input_image' })
    expect(requestBody.input[0].content[1]).toEqual({
      type: 'input_text',
      text: 'Count the distinct vertical colored bars in the image. Reply with only the number.',
    })
  })

  test('reads Ollama vision capability metadata without stripping model tags', async () => {
    let requestBody: any
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://localhost:11434/api/show')
      requestBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        capabilities: ['completion', 'tools', 'thinking', 'vision'],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    const ollama = provider({
      presetId: 'ollama',
      baseUrl: 'http://localhost:11434',
      apiKey: '',
    })

    const result = await resolveProviderImageSupportDynamically(
      ollama,
      'qwen3.5:0.8b',
      { fetchImpl },
    )

    expect(result.status).toBe('supported')
    expect(result.source).toBe('learned')
    expect(requestBody).toEqual({ model: 'qwen3.5:0.8b' })
    expect(getLearnedImageSupport(ollama.baseUrl, 'qwen3.5:0.8b')).toMatchObject({
      status: 'supported',
      source: 'local-metadata',
      modelId: 'qwen3.5:0.8b',
    })
  })

  test('lets Ollama metadata override optimistic preset image support', async () => {
    let calls = 0
    const fetchImpl = (async (url: string | URL | Request) => {
      calls++
      expect(String(url)).toBe('http://localhost:11434/api/show')
      return new Response(JSON.stringify({
        capabilities: ['completion', 'tools'],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    const ollama = provider({
      presetId: 'ollama',
      baseUrl: 'http://localhost:11434',
      apiKey: '',
      models: {
        main: 'qwen3.6',
        haiku: 'qwen3.6',
        sonnet: 'qwen3.6',
        opus: 'qwen3.6',
      },
    })

    const result = await resolveProviderImageSupportDynamically(
      ollama,
      'qwen3.6',
      { fetchImpl },
    )

    expect(calls).toBe(1)
    expect(result.status).toBe('unsupported')
    expect(result.source).toBe('learned')
    expect(getLearnedImageSupport(ollama.baseUrl, 'qwen3.6')).toMatchObject({
      status: 'unsupported',
      source: 'local-metadata',
    })
  })

  test('learns unsupported custom models and reuses the cached result', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response(JSON.stringify({
        error: { message: 'Image input is not supported by this text-only model.' },
      }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    const custom = provider()

    const first = await resolveProviderImageSupportDynamically(custom, 'private-model', { fetchImpl })
    const second = await resolveProviderImageSupportDynamically(custom, 'private-model', {
      fetchImpl: (async () => {
        throw new Error('cached capability should avoid another probe')
      }) as typeof fetch,
    })

    expect(calls).toBe(1)
    expect(first.status).toBe('unsupported')
    expect(second.status).toBe('unsupported')
    expect(second.source).toBe('learned')
  })

  test('shares learned custom-model support with the CLI request layer', async () => {
    const custom = provider({
      baseUrl: 'https://dynamic.example/anthropic',
      models: {
        main: 'private-vision-model',
        haiku: 'private-vision-model',
        sonnet: 'private-vision-model',
        opus: 'private-vision-model',
      },
    })
    const fetchImpl = (async () => new Response(JSON.stringify({
      type: 'message',
      content: [{ type: 'text', text: '7' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch

    const result = await resolveProviderImageSupportDynamically(
      custom,
      'private-vision-model',
      { fetchImpl },
    )
    process.env.CYBERCODE_PROVIDER_BASE_URL = custom.baseUrl
    process.env.ANTHROPIC_BASE_URL = custom.baseUrl

    expect(result.status).toBe('supported')
    expect(modelSupportsImages('private-vision-model')).toBe(true)
  })
})
