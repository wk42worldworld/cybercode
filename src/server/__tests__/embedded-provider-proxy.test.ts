import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  ensureActiveProviderRuntime,
  getEmbeddedProviderProxyPort,
  stopEmbeddedProviderProxy,
} from '../proxy/embeddedProxy.js'
import { ProviderService } from '../services/providerService.js'

const ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'CYBERCODE_PROVIDER_ID',
] as const

describe('standalone CLI provider runtime', () => {
  let tmpDir: string
  let originalEnv: Record<string, string | undefined>
  let upstream: ReturnType<typeof Bun.serve> | null

  beforeEach(async () => {
    originalEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]))
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cybercode-embedded-proxy-'))
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    upstream = null
    stopEmbeddedProviderProxy()
  })

  afterEach(async () => {
    stopEmbeddedProviderProxy()
    upstream?.stop(true)
    ProviderService.setServerPort(3456)
    for (const key of ENV_KEYS) {
      const value = originalEnv[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('starts the built-in bridge and translates an OpenAI-compatible request', async () => {
    let forwardedBody: Record<string, unknown> | null = null
    let forwardedAuthorization = ''
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        forwardedBody = await request.json() as Record<string, unknown>
        forwardedAuthorization = request.headers.get('authorization') ?? ''
        return Response.json({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-test',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'pong' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        })
      },
    })

    const service = new ProviderService()
    const provider = await service.addProvider({
      presetId: 'custom',
      name: 'Mock OpenAI',
      apiKey: 'upstream-secret',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiFormat: 'openai_chat',
      models: {
        main: 'gpt-test',
        haiku: 'gpt-test',
        sonnet: 'gpt-test',
        opus: 'gpt-test',
      },
    })
    await service.activateProvider(provider.id)

    const runtime = await ensureActiveProviderRuntime({ applyEnvironment: true })

    expect(runtime.mode).toBe('proxy')
    expect(runtime.proxyPort).toBeNumber()
    expect(runtime.proxyPort!).toBeGreaterThan(0)
    expect(process.env.ANTHROPIC_BASE_URL).toBe(
      `http://127.0.0.1:${runtime.proxyPort}/proxy/providers/${provider.id}`,
    )
    expect(process.env.ANTHROPIC_API_KEY).toBe('proxy-managed')

    const response = await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
      },
      body: JSON.stringify({
        model: 'gpt-test',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })
    const body = await response.json() as {
      content: Array<{ type: string; text?: string }>
    }

    expect(response.status).toBe(200)
    expect(body.content).toEqual([{ type: 'text', text: 'pong' }])
    expect(forwardedAuthorization).toBe('Bearer upstream-secret')
    expect(forwardedBody?.model).toBe('gpt-test')
    expect(getEmbeddedProviderProxyPort()).toBe(runtime.proxyPort!)
  })

  test('connects directly when the provider already supports Anthropic Messages', async () => {
    const service = new ProviderService()
    const provider = await service.addProvider({
      presetId: 'custom',
      name: 'Native Anthropic endpoint',
      apiKey: 'native-secret',
      baseUrl: 'https://models.example.com/anthropic',
      apiFormat: 'anthropic',
      models: {
        main: 'native-model',
        haiku: 'native-model',
        sonnet: 'native-model',
        opus: 'native-model',
      },
    })
    await service.activateProvider(provider.id)

    const runtime = await ensureActiveProviderRuntime({ applyEnvironment: true })

    expect(runtime.mode).toBe('direct')
    expect(getEmbeddedProviderProxyPort()).toBeNull()
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://models.example.com/anthropic')
    expect(process.env.ANTHROPIC_API_KEY).toBe('native-secret')
  })

  test('does not start a second bridge for desktop-managed child sessions', async () => {
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:3456/proxy/providers/desktop'

    const runtime = await ensureActiveProviderRuntime({ applyEnvironment: true })

    expect(runtime.mode).toBe('host-managed')
    expect(getEmbeddedProviderProxyPort()).toBeNull()
    expect(process.env.ANTHROPIC_BASE_URL).toBe(
      'http://127.0.0.1:3456/proxy/providers/desktop',
    )
  })

  test('treats local presets without API keys as fully configured', async () => {
    const service = new ProviderService()
    const provider = await service.addProvider({
      presetId: 'lmstudio',
      name: 'LM Studio',
      apiKey: '',
      baseUrl: 'http://localhost:1234',
      apiFormat: 'anthropic',
      models: {
        main: 'openai/gpt-oss-20b',
        haiku: 'openai/gpt-oss-20b',
        sonnet: 'openai/gpt-oss-20b',
        opus: 'openai/gpt-oss-20b',
      },
    })
    await service.activateProvider(provider.id)

    expect(await service.checkAuthStatus()).toEqual({
      hasAuth: true,
      source: 'cybercode-provider',
      activeProvider: 'LM Studio',
    })
  })
})
