import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { handleProvidersApi } from '../api/providers.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import {
  clearModelsDevCatalogCache,
  warmModelsDevCatalog,
} from '../services/modelsDevCatalog.js'

const AGGREGATOR_GATEWAY_PROVIDER_IDS = [
  'openrouter',
  'cloudflare-ai',
  'ollama-cloud',
  'llm7',
  'alibaba',
  'volcengine',
  'qianfan',
  'siliconflow',
  'groq',
  'github-models',
  'huggingface',
  'nvidia',
  'fireworks',
  'deepinfra',
  'cerebras',
  'sambanova',
  'modelscope',
  'hyperbolic',
  'nebius',
  'friendliai',
  'featherless-ai',
  'pioneer',
  'bytez',
  'openvecta',
  'synthetic',
  'kilo-gateway',
  'aimlapi',
  'novita',
  'atlascloud',
  'piapi',
  'getgoapi',
  'laozhang',
  'vercel-ai-gateway',
  'agentrouter',
  'thebai',
  'fenayai',
  'empower',
  'poe',
  'chutes',
  'hackclub',
  'freetheai',
  'nanogpt',
] as const

let tmpDir: string
let originalConfigDir: string | undefined

beforeEach(async () => {
  clearModelsDevCatalogCache()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-presets-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  clearModelsDevCatalogCache()
  if (originalConfigDir !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
})

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

describe('provider presets API', () => {
  test('GET /api/providers/presets returns the configured presets', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers/presets')
    const response = await handleProvidersApi(req, url, segments)

    expect(response.status).toBe(200)
    const body = await response.json() as {
      presets: Array<Record<string, unknown> & { id: string; cost: string }>
    }
    expect(body.presets).toHaveLength(PROVIDER_PRESETS.length)
    for (const preset of PROVIDER_PRESETS) {
      expect(body.presets.find((candidate) => candidate.id === preset.id))
        .toMatchObject(preset)
    }
    expect(body.presets.find((preset) => preset.id === 'cloudflare-ai')).toMatchObject({
      cost: 'recurring-free',
    })
    expect(body.presets.find((preset) => preset.id === 'ollama-cloud')).toMatchObject({
      cost: 'recurring-free',
    })
    expect(body.presets.find((preset) => preset.id === 'llm7')).toMatchObject({
      cost: 'mixed',
    })
    expect(body.presets.find((preset) => preset.id === 'opencode-free')).toMatchObject({
      cost: 'recurring-free',
    })
  })

  test('places live catalog models before bundled fallback models', async () => {
    await warmModelsDevCatalog({
      force: true,
      fetchImpl: (async () => Response.json({
        openai: {
          models: {
            'gpt-live-new': {
              id: 'gpt-live-new',
              name: 'GPT Live New',
              tool_call: true,
              release_date: '2026-07-30',
              modalities: {
                input: ['text', 'image'],
                output: ['text'],
              },
              limit: { context: 1_050_000 },
            },
          },
        },
      })) as typeof fetch,
    })
    const { req, url, segments } = makeRequest('GET', '/api/providers/presets')
    const response = await handleProvidersApi(req, url, segments)
    const body = await response.json() as {
      presets: Array<{
        id: string
        modelOptions?: Array<{ id: string; contextWindow?: number }>
      }>
    }
    const openai = body.presets.find((preset) => preset.id === 'openai')

    expect(openai?.modelOptions?.[0]).toEqual({
      id: 'gpt-live-new',
      label: 'GPT Live New',
      contextWindow: 1_050_000,
      supportsImages: true,
    })
    expect(openai?.modelOptions?.some(
      (model) => model.id === 'gpt-5.6-sol',
    )).toBe(true)
  })

  test('configured presets include built-in official and custom entries', () => {
    expect(PROVIDER_PRESETS.some((preset) => preset.id === 'official')).toBe(true)
    expect(PROVIDER_PRESETS.some((preset) => preset.id === 'custom')).toBe(true)
  })

  test('ships only verified OpenCode models in the no-auth preset', () => {
    const preset = PROVIDER_PRESETS.find((item) => item.id === 'opencode-free')

    expect(preset).toMatchObject({
      baseUrl: 'https://opencode.ai/zen/v1',
      apiFormat: 'openai_chat',
      needsApiKey: false,
      defaultModels: {
        main: 'north-mini-code-free',
        haiku: 'ling-3.0-flash-free',
        sonnet: 'north-mini-code-free',
        opus: 'mimo-v2.5-free',
      },
    })
    expect(preset?.modelOptions?.map((model) => model.id)).toEqual([
      'north-mini-code-free',
      'mimo-v2.5-free',
      'ling-3.0-flash-free',
    ])
  })

  test('configured presets expose separate Kimi Code and Kimi API-key entries', () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id)
    const kimiCode = PROVIDER_PRESETS.find((preset) => preset.id === 'kimi-code')
    const kimi = PROVIDER_PRESETS.find((preset) => preset.id === 'kimi')

    expect(ids).toContain('kimi-code')
    expect(ids).toContain('kimi')
    expect(ids.indexOf('kimi-code')).toBeLessThan(ids.indexOf('kimi'))
    expect(kimiCode?.name).toBe('Kimi Code')
    expect(kimi?.name).toBe('Kimi')
  })

  test('ships a broad native OpenAI-compatible source catalog', () => {
    const expectedSourceIds = [
      'openrouter',
      'cloudflare-ai',
      'ollama-cloud',
      'llm7',
      'groq',
      'mistral',
      'reka',
      'cerebras',
      'nvidia',
      'sambanova',
      'siliconflow',
      'github-models',
      'huggingface',
      'fireworks',
      'deepinfra',
      'openvecta',
      'hyperbolic',
      'nebius',
      'modelscope',
      'nous-research',
      'friendliai',
      'featherless-ai',
      'pioneer',
      'bytez',
    ]
    const byId = new Map(PROVIDER_PRESETS.map((preset) => [preset.id, preset]))

    expect(PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(30)
    for (const id of expectedSourceIds) {
      expect(byId.get(id)?.apiFormat).toBe('openai_chat')
      expect(byId.get(id)?.baseUrl).toMatch(/^https:\/\//)
    }
  })

  test('ships all multi-model platforms and gateways as configurable sources', () => {
    const byId = new Map(PROVIDER_PRESETS.map((preset) => [preset.id, preset]))

    expect(AGGREGATOR_GATEWAY_PROVIDER_IDS).toHaveLength(42)
    for (const id of AGGREGATOR_GATEWAY_PROVIDER_IDS) {
      const preset = byId.get(id)
      expect(preset, `${id} preset`).toBeDefined()
      expect(preset?.needsApiKey, `${id} API key requirement`).toBe(true)
      expect(preset?.baseUrl, `${id} base URL`).toMatch(/^https:\/\//)
      expect(preset?.websiteUrl, `${id} website`).toMatch(/^https:\/\//)
    }
  })

  test('ships selected API-key presets with their expected connection formats', () => {
    const expectedProviders = [
      ['anthropic-api', 'anthropic', 'https://api.anthropic.com'],
      ['xai', 'openai_chat', 'https://api.x.ai/v1'],
      ['alibaba', 'openai_chat', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
      ['perplexity', 'openai_chat', 'https://api.perplexity.ai'],
      ['cohere', 'openai_chat', 'https://api.cohere.com/compatibility/v1'],
      ['meta-llama', 'openai_chat', 'https://api.llama.com/compat/v1'],
      ['volcengine', 'openai_chat', 'https://ark.cn-beijing.volces.com/api/v3'],
      ['qianfan', 'openai_chat', 'https://qianfan.baidubce.com/v2'],
      ['ai21', 'openai_chat', 'https://api.ai21.com/studio/v1'],
    ] as const
    const byId = new Map(PROVIDER_PRESETS.map((preset) => [preset.id, preset]))

    for (const [id, apiFormat, baseUrl] of expectedProviders) {
      expect(byId.get(id)?.apiFormat).toBe(apiFormat)
      expect(byId.get(id)?.baseUrl).toBe(baseUrl)
      expect(byId.get(id)?.needsApiKey).toBe(true)
      expect(byId.get(id)?.defaultModels.main).not.toBe('')
    }
  })

  test('local Anthropic-compatible presets appear immediately before custom', () => {
    expect(PROVIDER_PRESETS.at(-3)?.id).toBe('lmstudio')
    expect(PROVIDER_PRESETS.at(-2)?.id).toBe('ollama')
    expect(PROVIDER_PRESETS.at(-1)?.id).toBe('custom')
  })

  test('configured presets keep current default model ids aligned with official provider docs', () => {
    const lmstudio = PROVIDER_PRESETS.find((preset) => preset.id === 'lmstudio')
    const ollama = PROVIDER_PRESETS.find((preset) => preset.id === 'ollama')
    const deepseek = PROVIDER_PRESETS.find((preset) => preset.id === 'deepseek')
    const zhipu = PROVIDER_PRESETS.find((preset) => preset.id === 'zhipuglm')
    const kimiCode = PROVIDER_PRESETS.find((preset) => preset.id === 'kimi-code')
    const kimi = PROVIDER_PRESETS.find((preset) => preset.id === 'kimi')
    const minimax = PROVIDER_PRESETS.find((preset) => preset.id === 'minimax')
    const xiaomi = PROVIDER_PRESETS.find((preset) => preset.id === 'xiaomimimo')
    const openai = PROVIDER_PRESETS.find((preset) => preset.id === 'openai')
    const google = PROVIDER_PRESETS.find((preset) => preset.id === 'google')

    expect(lmstudio?.baseUrl).toBe('http://localhost:1234')
    expect(lmstudio?.apiFormat).toBe('anthropic')
    expect(lmstudio?.defaultModels.main).toBe('openai/gpt-oss-20b')
    expect(ollama?.baseUrl).toBe('http://localhost:11434')
    expect(ollama?.apiFormat).toBe('anthropic')
    expect(ollama?.defaultModels.main).toBe('qwen3.6')
    expect(deepseek?.defaultModels.main).toBe('deepseek-v4-pro')
    expect(deepseek?.defaultModels.haiku).toBe('deepseek-v4-flash')
    expect(deepseek?.defaultModels.sonnet).toBe('deepseek-v4-pro')
    expect(deepseek?.defaultModels.opus).toBe('deepseek-v4-pro')
    expect(deepseek?.defaultModelContextWindows?.main).toBe(1_000_000)
    expect(deepseek?.defaultModelContextWindows?.haiku).toBe(1_000_000)
    expect(zhipu?.defaultModels.main).toBe('glm-5.2')
    expect(zhipu?.defaultModels.haiku).toBe('glm-4.7')
    expect(zhipu?.defaultModels.sonnet).toBe('glm-5.2')
    expect(zhipu?.defaultModels.opus).toBe('glm-5.2')
    expect(zhipu?.defaultModelContextWindows?.main).toBe(1_000_000)
    expect(zhipu?.defaultModelContextWindows?.haiku).toBe(200_000)
    expect(zhipu?.defaultModelContextWindows?.sonnet).toBe(1_000_000)
    expect(zhipu?.defaultModelContextWindows?.opus).toBe(1_000_000)
    expect(kimiCode?.baseUrl).toBe('https://api.kimi.com/coding/')
    expect(kimiCode?.defaultModels.main).toBe('kimi-for-coding')
    expect(kimiCode?.defaultModelContextWindows?.main).toBe(262_144)
    expect(kimi?.baseUrl).toBe('https://api.moonshot.cn')
    expect(kimi?.apiFormat).toBe('openai_chat')
    expect(kimi?.defaultModels.main).toBe('kimi-k3')
    expect(kimi?.defaultModels.haiku).toBe('kimi-k2.6')
    expect(kimi?.defaultModelContextWindows?.main).toBe(1_048_576)
    expect(minimax?.defaultModels.main).toBe('MiniMax-M3')
    expect(minimax?.defaultModelContextWindows?.main).toBe(1_000_000)
    expect(xiaomi?.defaultModels.haiku).toBe('mimo-v2.5')
    expect(xiaomi?.defaultModels.sonnet).toBe('mimo-v2.5')
    expect(xiaomi?.defaultModels.opus).toBe('mimo-v2.5-pro')
    expect(xiaomi?.defaultModelContextWindows?.opus).toBe(1_000_000)
    expect(openai?.baseUrl).toBe('https://api.openai.com')
    expect(openai?.apiFormat).toBe('openai_responses')
    expect(openai?.defaultModels.main).toBe('gpt-5.6-sol')
    expect(openai?.defaultModels.haiku).toBe('gpt-5.6-luna')
    expect(openai?.defaultModels.sonnet).toBe('gpt-5.6-terra')
    expect(openai?.defaultModels.opus).toBe('gpt-5.6-sol')
    expect(openai?.defaultModelContextWindows?.main).toBe(1_050_000)
    expect(openai?.defaultModelContextWindows?.haiku).toBe(1_050_000)
    expect(google?.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
    expect(google?.apiFormat).toBe('openai_chat')
    expect(google?.defaultModels.main).toBe('gemini-3.5-flash')
    expect(google?.defaultModels.haiku).toBe('gemini-3.1-flash-lite')
    expect(google?.defaultModels.sonnet).toBe('gemini-3.5-flash')
    expect(google?.defaultModels.opus).toBe('gemini-3.1-pro-preview')
    expect(google?.defaultModelContextWindows?.main).toBe(1_048_576)
  })

  test('configured presets declare default image-input support', () => {
    const byId = new Map(PROVIDER_PRESETS.map((preset) => [preset.id, preset]))

    expect(byId.get('official')?.supportsImages).toBe(true)
    expect(byId.get('openai')?.supportsImages).toBe(true)
    expect(byId.get('google')?.supportsImages).toBe(true)
    expect(byId.get('deepseek')?.supportsImages).toBe(false)
    expect(byId.get('kimi-code')?.supportsImages).toBe(true)
    expect(byId.get('kimi')?.supportsImages).toBe(true)
    expect(byId.get('lmstudio')?.supportsImages).toBeUndefined()
    expect(byId.get('ollama')?.supportsImages).toBe(true)
    expect(byId.get('custom')?.supportsImages).toBeUndefined()
  })

  test('configured presets expose newest-first model options without requiring them for custom providers', () => {
    const deepseek = PROVIDER_PRESETS.find((preset) => preset.id === 'deepseek')
    const zhipu = PROVIDER_PRESETS.find((preset) => preset.id === 'zhipuglm')
    const kimiCode = PROVIDER_PRESETS.find((preset) => preset.id === 'kimi-code')
    const kimi = PROVIDER_PRESETS.find((preset) => preset.id === 'kimi')
    const openai = PROVIDER_PRESETS.find((preset) => preset.id === 'openai')
    const google = PROVIDER_PRESETS.find((preset) => preset.id === 'google')
    const custom = PROVIDER_PRESETS.find((preset) => preset.id === 'custom')

    expect(deepseek?.modelOptions?.map((option) => option.id).slice(0, 2)).toEqual([
      'deepseek-v4-pro',
      'deepseek-v4-flash',
    ])
    expect(zhipu?.modelOptions?.[0]).toEqual({
      id: 'glm-5.2',
      label: 'GLM-5.2',
      contextWindow: 1_000_000,
    })
    expect(kimiCode?.modelOptions?.[0]).toEqual({
      id: 'k3',
      label: 'Kimi K3',
      contextWindow: 1_048_576,
      supportsImages: true,
    })
    expect(kimiCode?.modelOptions?.[2]).toEqual({
      id: 'kimi-for-coding-highspeed',
      label: 'Kimi for Coding HighSpeed',
      contextWindow: 262_144,
      supportsImages: true,
    })
    expect(kimiCode?.modelOptions).toHaveLength(3)
    expect(kimi?.modelOptions?.map((option) => option.id)).toEqual([
      'kimi-k3',
      'kimi-k2.7-code',
      'kimi-k2.7-code-highspeed',
      'kimi-k2.6',
      'kimi-k2.5',
    ])
    expect(openai?.modelOptions?.map((option) => option.id).slice(0, 4)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.6',
    ])
    expect(google?.modelOptions?.map((option) => option.id).slice(0, 3)).toEqual([
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview',
      'gemini-3.1-flash-lite',
    ])
    expect(custom?.modelOptions).toBeUndefined()
  })

  test('configured presets mark only verified million-token models as 1M-capable', () => {
    const millionTokenModels = PROVIDER_PRESETS.flatMap((preset) =>
      (preset.modelOptions ?? [])
        .filter((model) => (model.contextWindow ?? 0) >= 1_000_000)
        .map((model) => `${preset.id}:${model.id}`),
    )

    expect(millionTokenModels).toEqual([
      'anthropic-api:claude-opus-4-8',
      'anthropic-api:claude-sonnet-5',
      'deepseek:deepseek-v4-pro',
      'deepseek:deepseek-v4-flash',
      'zhipuglm:glm-5.2',
      'kimi-code:k3',
      'kimi:kimi-k3',
      'minimax:MiniMax-M3',
      'xiaomimimo:mimo-v2.5-pro',
      'xiaomimimo:mimo-v2.5',
      'openai:gpt-5.6-sol',
      'openai:gpt-5.6-terra',
      'openai:gpt-5.6-luna',
      'openai:gpt-5.6',
      'openai:gpt-5.5',
      'openai:gpt-5.5-pro',
      'openai:gpt-5.4',
      'openai:gpt-5.4-pro',
      'google:gemini-3.5-flash',
      'google:gemini-3.1-pro-preview',
      'google:gemini-3.1-flash-lite',
      'google:gemini-2.5-pro',
      'google:gemini-2.5-flash',
      'google:gemini-2.5-flash-lite',
      'ollama-cloud:glm-5.2',
      'ollama-cloud:deepseek-v4-flash',
    ])
  })

  test('configured presets can expose optional API key and promo metadata', () => {
    const lmstudio = PROVIDER_PRESETS.find((preset) => preset.id === 'lmstudio')
    const ollama = PROVIDER_PRESETS.find((preset) => preset.id === 'ollama')
    const deepseek = PROVIDER_PRESETS.find((preset) => preset.id === 'deepseek')
    const zhipu = PROVIDER_PRESETS.find((preset) => preset.id === 'zhipuglm')
    const kimiCode = PROVIDER_PRESETS.find((preset) => preset.id === 'kimi-code')
    const kimi = PROVIDER_PRESETS.find((preset) => preset.id === 'kimi')
    const minimax = PROVIDER_PRESETS.find((preset) => preset.id === 'minimax')
    const openai = PROVIDER_PRESETS.find((preset) => preset.id === 'openai')
    const google = PROVIDER_PRESETS.find((preset) => preset.id === 'google')
    const cloudflare = PROVIDER_PRESETS.find((preset) => preset.id === 'cloudflare-ai')
    const ollamaCloud = PROVIDER_PRESETS.find((preset) => preset.id === 'ollama-cloud')
    const llm7 = PROVIDER_PRESETS.find((preset) => preset.id === 'llm7')
    const custom = PROVIDER_PRESETS.find((preset) => preset.id === 'custom')

    expect(lmstudio?.needsApiKey).toBe(false)
    expect(lmstudio?.promoText).toContain('http://localhost:1234')
    expect(lmstudio?.promoText).toContain('131,072')
    expect(lmstudio?.defaultModelContextWindows?.main).toBe(131_072)
    expect(lmstudio?.defaultEnv).toEqual({ ANTHROPIC_AUTH_TOKEN: 'lmstudio' })
    expect(ollama?.needsApiKey).toBe(false)
    expect(ollama?.promoText).toContain('http://localhost:11434')
    expect(ollama?.promoText).toContain('256K')
    expect(ollama?.defaultModelContextWindows?.main).toBe(262_144)
    expect(ollama?.supportsImages).toBe(true)
    expect(ollama?.defaultEnv).toEqual({ ANTHROPIC_AUTH_TOKEN: 'ollama' })
    expect(deepseek?.apiKeyUrl).toBe('https://platform.deepseek.com/api_keys')
    expect(zhipu?.apiKeyUrl).toBe('https://www.bigmodel.cn/usercenter/proj-mgmt/apikeys')
    expect(kimiCode?.apiKeyUrl).toBe('https://www.kimi.com/coding')
    expect(kimiCode?.promoText).toContain('Kimi For Coding')
    expect(kimi?.apiKeyUrl).toBe('https://platform.kimi.com/console/api-keys')
    expect(kimi?.promoText).toContain('open platform')
    expect(minimax?.apiKeyUrl).toBe('https://platform.minimaxi.com/user-center/basic-information/interface-key')
    expect(openai?.apiKeyUrl).toBe('https://platform.openai.com/api-keys')
    expect(google?.apiKeyUrl).toBe('https://aistudio.google.com/apikey')
    expect(google?.promoText).toContain('/v1beta/openai')
    expect(cloudflare?.baseUrl).toContain('/accounts/ACCOUNT_ID/ai/v1')
    expect(cloudflare?.promoText).toContain('10,000 Neurons')
    expect(ollamaCloud?.baseUrl).toBe('https://ollama.com')
    expect(ollamaCloud?.promoText).toContain('5 小时')
    expect(llm7?.defaultModels.main).toBe('default')
    expect(llm7?.promoText).toContain('每日额度')
    expect(custom?.promoText).toBeUndefined()
  })

  test('GET and PUT /api/providers/settings read and write cybercode settings.json', async () => {
    const initial = {
      env: {
        ANTHROPIC_MODEL: 'glm-5.1',
        ANTHROPIC_API_KEY: 'secret-key',
      },
      model: 'glm-5.1',
    }
    await fs.mkdir(path.join(tmpDir, 'cybercode'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'cybercode', 'settings.json'),
      JSON.stringify(initial, null, 2),
      'utf-8',
    )

    const getReq = makeRequest('GET', '/api/providers/settings')
    const getRes = await handleProvidersApi(getReq.req, getReq.url, getReq.segments)
    expect(getRes.status).toBe(200)
    expect(await getRes.json()).toEqual({
      ...initial,
      env: {
        ...initial.env,
        ANTHROPIC_API_KEY: '••••••••',
      },
    })

    const updateBody = {
      model: 'kimi-k2.6',
      env: {
        ANTHROPIC_MODEL: 'kimi-k2.6',
      },
    }
    const putReq = makeRequest('PUT', '/api/providers/settings', updateBody)
    const putRes = await handleProvidersApi(putReq.req, putReq.url, putReq.segments)
    expect(putRes.status).toBe(200)

    const updatedRaw = await fs.readFile(path.join(tmpDir, 'cybercode', 'settings.json'), 'utf-8')
    expect(JSON.parse(updatedRaw)).toEqual(updateBody)
  })
})
