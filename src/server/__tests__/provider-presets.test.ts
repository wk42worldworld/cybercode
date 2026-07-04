import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { handleProvidersApi } from '../api/providers.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'

let tmpDir: string
let originalConfigDir: string | undefined

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-presets-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterEach(async () => {
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
    expect(await response.json()).toEqual({ presets: PROVIDER_PRESETS })
  })

  test('configured presets include built-in official and custom entries', () => {
    expect(PROVIDER_PRESETS.some((preset) => preset.id === 'official')).toBe(true)
    expect(PROVIDER_PRESETS.some((preset) => preset.id === 'custom')).toBe(true)
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
    expect(deepseek?.defaultModels.main).toBe('deepseek-v4-pro[1m]')
    expect(deepseek?.defaultModels.haiku).toBe('deepseek-v4-flash')
    expect(deepseek?.defaultModels.sonnet).toBe('deepseek-v4-pro[1m]')
    expect(deepseek?.defaultModels.opus).toBe('deepseek-v4-pro[1m]')
    expect(deepseek?.defaultModelContextWindows?.main).toBe(1_000_000)
    expect(deepseek?.defaultModelContextWindows?.haiku).toBe(1_000_000)
    expect(zhipu?.defaultModels.main).toBe('glm-5.2[1m]')
    expect(zhipu?.defaultModels.haiku).toBe('glm-4.7')
    expect(zhipu?.defaultModels.sonnet).toBe('glm-5.2[1m]')
    expect(zhipu?.defaultModels.opus).toBe('glm-5.2[1m]')
    expect(zhipu?.defaultModelContextWindows?.main).toBe(1_000_000)
    expect(kimi?.baseUrl).toBe('https://api.moonshot.cn/anthropic')
    expect(kimi?.defaultModels.main).toBe('kimi-k2.7-code')
    expect(kimi?.defaultModelContextWindows?.main).toBe(256_000)
    expect(minimax?.defaultModels.main).toBe('MiniMax-M3[1m]')
    expect(minimax?.defaultModelContextWindows?.main).toBe(1_000_000)
    expect(xiaomi?.defaultModels.haiku).toBe('mimo-v2.5')
    expect(xiaomi?.defaultModels.sonnet).toBe('mimo-v2.5')
    expect(xiaomi?.defaultModels.opus).toBe('mimo-v2.5-pro')
    expect(xiaomi?.defaultModelContextWindows?.opus).toBe(1_000_000)
    expect(openai?.baseUrl).toBe('https://api.openai.com')
    expect(openai?.apiFormat).toBe('openai_responses')
    expect(openai?.defaultModels.main).toBe('gpt-5.5')
    expect(openai?.defaultModels.haiku).toBe('gpt-5.4-mini')
    expect(openai?.defaultModels.sonnet).toBe('gpt-5.4')
    expect(openai?.defaultModels.opus).toBe('gpt-5.5')
    expect(openai?.defaultModelContextWindows?.main).toBe(1_000_000)
    expect(openai?.defaultModelContextWindows?.haiku).toBe(400_000)
    expect(google?.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
    expect(google?.apiFormat).toBe('openai_chat')
    expect(google?.defaultModels.main).toBe('gemini-3.5-flash')
    expect(google?.defaultModels.haiku).toBe('gemini-3.1-flash-lite')
    expect(google?.defaultModels.sonnet).toBe('gemini-3.5-flash')
    expect(google?.defaultModels.opus).toBe('gemini-3.1-pro-preview')
    expect(google?.defaultModelContextWindows?.main).toBe(1_048_576)
  })

  test('configured presets expose newest-first model options without requiring them for custom providers', () => {
    const deepseek = PROVIDER_PRESETS.find((preset) => preset.id === 'deepseek')
    const zhipu = PROVIDER_PRESETS.find((preset) => preset.id === 'zhipuglm')
    const kimi = PROVIDER_PRESETS.find((preset) => preset.id === 'kimi')
    const openai = PROVIDER_PRESETS.find((preset) => preset.id === 'openai')
    const google = PROVIDER_PRESETS.find((preset) => preset.id === 'google')
    const custom = PROVIDER_PRESETS.find((preset) => preset.id === 'custom')

    expect(deepseek?.modelOptions?.map((option) => option.id).slice(0, 2)).toEqual([
      'deepseek-v4-pro[1m]',
      'deepseek-v4-flash',
    ])
    expect(zhipu?.modelOptions?.[0]).toEqual({
      id: 'glm-5.2[1m]',
      label: 'GLM-5.2 1M',
      contextWindow: 1_000_000,
    })
    expect(kimi?.modelOptions?.[0]?.id).toBe('kimi-k2.7-code')
    expect(openai?.modelOptions?.map((option) => option.id).slice(0, 3)).toEqual([
      'gpt-5.5',
      'gpt-5.5-pro',
      'gpt-5.4',
    ])
    expect(google?.modelOptions?.map((option) => option.id).slice(0, 3)).toEqual([
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview',
      'gemini-3.1-flash-lite',
    ])
    expect(custom?.modelOptions).toBeUndefined()
  })

  test('configured presets can expose optional API key and promo metadata', () => {
    const lmstudio = PROVIDER_PRESETS.find((preset) => preset.id === 'lmstudio')
    const ollama = PROVIDER_PRESETS.find((preset) => preset.id === 'ollama')
    const deepseek = PROVIDER_PRESETS.find((preset) => preset.id === 'deepseek')
    const zhipu = PROVIDER_PRESETS.find((preset) => preset.id === 'zhipuglm')
    const kimi = PROVIDER_PRESETS.find((preset) => preset.id === 'kimi')
    const minimax = PROVIDER_PRESETS.find((preset) => preset.id === 'minimax')
    const openai = PROVIDER_PRESETS.find((preset) => preset.id === 'openai')
    const google = PROVIDER_PRESETS.find((preset) => preset.id === 'google')
    const custom = PROVIDER_PRESETS.find((preset) => preset.id === 'custom')

    expect(lmstudio?.needsApiKey).toBe(false)
    expect(lmstudio?.promoText).toContain('http://localhost:1234')
    expect(lmstudio?.promoText).toContain('200K')
    expect(lmstudio?.defaultModelContextWindows?.main).toBe(200_000)
    expect(lmstudio?.defaultEnv).toEqual({ ANTHROPIC_AUTH_TOKEN: 'lmstudio' })
    expect(ollama?.needsApiKey).toBe(false)
    expect(ollama?.promoText).toContain('http://localhost:11434')
    expect(ollama?.promoText).toContain('256K')
    expect(ollama?.defaultModelContextWindows?.main).toBe(256_000)
    expect(ollama?.defaultEnv).toEqual({ ANTHROPIC_AUTH_TOKEN: 'ollama' })
    expect(deepseek?.apiKeyUrl).toBe('https://platform.deepseek.com/api_keys')
    expect(zhipu?.apiKeyUrl).toBe('https://www.bigmodel.cn/usercenter/proj-mgmt/apikeys')
    expect(kimi?.apiKeyUrl).toBe('https://platform.kimi.com/console/api-keys')
    expect(minimax?.apiKeyUrl).toBe('https://platform.minimaxi.com/user-center/basic-information/interface-key')
    expect(openai?.apiKeyUrl).toBe('https://platform.openai.com/api-keys')
    expect(google?.apiKeyUrl).toBe('https://aistudio.google.com/apikey')
    expect(google?.promoText).toContain('/v1beta/openai')
    expect(custom?.promoText).toBeUndefined()
  })

  test('GET and PUT /api/providers/settings read and write cybercode settings.json', async () => {
    const initial = {
      env: {
        ANTHROPIC_MODEL: 'glm-5.1',
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
    expect(await getRes.json()).toEqual(initial)

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
