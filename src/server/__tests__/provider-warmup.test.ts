/**
 * Unit tests for the provider warmup endpoint and ollama keep_alive injection
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ProviderService } from '../services/providerService.js'
import { handleProvidersApi } from '../api/providers.js'
import { handleProxyRequest } from '../proxy/handler.js'
import type { CreateProviderInput } from '../types/provider.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalFetch: typeof globalThis.fetch
let originalKeepAliveEnv: string | undefined

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-warmup-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  originalFetch = globalThis.fetch
  originalKeepAliveEnv = process.env.CYBERCODE_OLLAMA_KEEP_ALIVE
  delete process.env.CYBERCODE_OLLAMA_KEEP_ALIVE
}

async function teardown() {
  if (originalConfigDir !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }
  globalThis.fetch = originalFetch
  if (originalKeepAliveEnv !== undefined) {
    process.env.CYBERCODE_OLLAMA_KEEP_ALIVE = originalKeepAliveEnv
  } else {
    delete process.env.CYBERCODE_OLLAMA_KEEP_ALIVE
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
}

function makeRequest(
  method: string,
  urlStr: string,
  body?: Record<string, unknown>,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const init: RequestInit = { method }
  if (body) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const req = new Request(url.toString(), init)
  const segments = url.pathname.split('/').filter(Boolean)
  return { req, url, segments }
}

function ollamaInput(overrides?: Partial<CreateProviderInput>): CreateProviderInput {
  return {
    presetId: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434',
    apiKey: '',
    apiFormat: 'openai_chat',
    models: { main: 'qwen3.6', haiku: 'qwen3.6', sonnet: 'qwen3.6', opus: 'qwen3.6' },
    ...overrides,
  }
}

describe('POST /api/providers/:id/warmup', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('starts an ollama warmup with the provider main model by default', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(ollamaInput())
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) })
      return Response.json({ done: true })
    }) as typeof fetch

    const { req, url, segments } = makeRequest('POST', `/api/providers/${provider.id}/warmup`, {})
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(202)
    const body = await res.json() as { ok: boolean; started: boolean; model: string }
    expect(body).toEqual({ ok: true, started: true, model: 'qwen3.6' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://localhost:11434/api/generate')
    expect(calls[0].body).toEqual({
      model: 'qwen3.6',
      prompt: '',
      stream: false,
      keep_alive: '30m',
    })
  })

  test('honors an explicit modelId for non-ollama local servers', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(ollamaInput({
      presetId: 'llama.cpp',
      name: 'llama.cpp',
      baseUrl: 'http://localhost:8080',
    }))
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) })
      return Response.json({ choices: [] })
    }) as typeof fetch

    const { req, url, segments } = makeRequest(
      'POST',
      `/api/providers/${provider.id}/warmup`,
      { modelId: 'custom-model' },
    )
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(202)
    const body = await res.json() as { ok: boolean; started: boolean; model: string }
    expect(body).toEqual({ ok: true, started: true, model: 'custom-model' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://localhost:8080/v1/chat/completions')
    expect(calls[0].body).toEqual({
      model: 'custom-model',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
    })
  })

  test('dedupes a warmup already in flight for the same provider and model', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(ollamaInput())
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let fetchCount = 0
    globalThis.fetch = (async () => {
      fetchCount += 1
      await gate
      return Response.json({ done: true })
    }) as typeof fetch

    const first = makeRequest('POST', `/api/providers/${provider.id}/warmup`, {})
    const firstRes = await handleProvidersApi(first.req, first.url, first.segments)
    expect(await firstRes.json()).toMatchObject({ ok: true, started: true })

    const second = makeRequest('POST', `/api/providers/${provider.id}/warmup`, {})
    const secondRes = await handleProvidersApi(second.req, second.url, second.segments)
    expect(secondRes.status).toBe(202)
    expect(await secondRes.json()).toMatchObject({ ok: true, started: false })

    release()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(fetchCount).toBe(1)
  })

  test('rejects non-local providers without touching the network', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(ollamaInput({
      presetId: 'custom',
      name: 'Cloud',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
    }))
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      return Response.json({})
    }) as typeof fetch

    const { req, url, segments } = makeRequest('POST', `/api/providers/${provider.id}/warmup`, {})
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; reason: string }
    expect(body.ok).toBe(false)
    expect(body.reason).toContain('not a local')
    expect(fetchCalled).toBe(false)
  })

  test('returns 404 for an unknown provider', async () => {
    const { req, url, segments } = makeRequest('POST', '/api/providers/missing/warmup', {})
    const res = await handleProvidersApi(req, url, segments)
    expect(res.status).toBe(404)
  })
})

describe('ollama keep_alive injection in the chat proxy', () => {
  beforeEach(setup)
  afterEach(teardown)

  async function proxyChatRequest(): Promise<Record<string, unknown>> {
    const svc = new ProviderService()
    const provider = await svc.addProvider(ollamaInput())
    await svc.activateProvider(provider.id)
    const bodies: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return Response.json({
        id: 'chatcmpl-warm',
        object: 'chat.completion',
        created: 1,
        model: 'qwen3.6',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
      })
    }) as typeof fetch

    const req = new Request('http://localhost:3456/proxy/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.6',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    const res = await handleProxyRequest(req, new URL(req.url))
    expect(res.status).toBe(200)
    expect(bodies).toHaveLength(1)
    return bodies[0]
  }

  test('injects keep_alive 30m for ollama chat requests by default', async () => {
    const upstream = await proxyChatRequest()
    expect(upstream.keep_alive).toBe('30m')
  })

  test('honors the CYBERCODE_OLLAMA_KEEP_ALIVE override', async () => {
    process.env.CYBERCODE_OLLAMA_KEEP_ALIVE = '2h'
    const upstream = await proxyChatRequest()
    expect(upstream.keep_alive).toBe('2h')
  })

  test('disables injection when the override is 0', async () => {
    process.env.CYBERCODE_OLLAMA_KEEP_ALIVE = '0'
    const upstream = await proxyChatRequest()
    expect(upstream.keep_alive).toBeUndefined()
  })
})

describe('local upstream error reporting in the chat proxy', () => {
  beforeEach(setup)
  afterEach(teardown)

  async function activateLocal(): Promise<void> {
    const svc = new ProviderService()
    const provider = await svc.addProvider(ollamaInput())
    await svc.activateProvider(provider.id)
  }

  async function activateRemote(): Promise<void> {
    const svc = new ProviderService()
    const provider = await svc.addProvider({
      presetId: 'custom',
      name: 'Cloud',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      apiFormat: 'openai_chat',
      models: { main: 'gpt-test', haiku: 'gpt-test', sonnet: 'gpt-test', opus: 'gpt-test' },
    })
    await svc.activateProvider(provider.id)
  }

  function chatRequest(model: string): Request {
    return new Request('http://localhost:3456/proxy/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
  }

  test('connection failure to a local server returns actionable 502 guidance', async () => {
    await activateLocal()
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })
    }) as typeof fetch

    const req = chatRequest('qwen3.6')
    const res = await handleProxyRequest(req, new URL(req.url))

    expect(res.status).toBe(502)
    expect(res.headers.get('x-should-retry')).toBe('false')
    const body = await res.json() as { error: { message: string } }
    expect(body.error.message).toContain('Cannot connect to local model server at http://localhost:11434')
    expect(body.error.message).toContain('ollama serve')
    expect(body.error.message).not.toBe('fetch failed')
  })

  test('local TTFB timeout explains the wait and the env override', async () => {
    await activateLocal()
    globalThis.fetch = (async () => {
      throw new DOMException('This operation was aborted', 'AbortError')
    }) as typeof fetch

    const req = chatRequest('qwen3.6')
    const res = await handleProxyRequest(req, new URL(req.url))

    expect(res.status).toBe(502)
    expect(res.headers.get('x-should-retry')).toBe('false')
    const body = await res.json() as { error: { message: string } }
    expect(body.error.message).toContain('did not respond within 180s')
    expect(body.error.message).toContain('http://localhost:11434')
    expect(body.error.message).toContain('qwen3.6')
    expect(body.error.message).toContain('CYBERCODE_LOCAL_STREAM_TTFB_TIMEOUT_MS')
  })

  test('remote provider errors keep the raw upstream message', async () => {
    await activateRemote()
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch

    const req = chatRequest('gpt-test')
    const res = await handleProxyRequest(req, new URL(req.url))

    expect(res.status).toBe(502)
    expect(res.headers.get('x-should-retry')).toBeNull()
    const body = await res.json() as { error: { message: string } }
    expect(body.error.message).toBe('fetch failed')
  })

  test('local upstream 5xx passthrough carries the no-retry header', async () => {
    await activateLocal()
    globalThis.fetch = (async () => new Response('model runner crashed: out of memory', {
      status: 500,
    })) as typeof fetch

    const req = chatRequest('qwen3.6')
    const res = await handleProxyRequest(req, new URL(req.url))

    expect(res.status).toBe(500)
    expect(res.headers.get('x-should-retry')).toBe('false')
  })

  test('local upstream 4xx passthrough does not need the no-retry header', async () => {
    await activateLocal()
    globalThis.fetch = (async () => new Response('model not found', {
      status: 404,
    })) as typeof fetch

    const req = chatRequest('qwen3.6')
    const res = await handleProxyRequest(req, new URL(req.url))

    expect(res.status).toBe(404)
    expect(res.headers.get('x-should-retry')).toBeNull()
  })
})
