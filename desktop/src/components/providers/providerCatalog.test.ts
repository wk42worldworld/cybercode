import { describe, expect, it } from 'vitest'

import { translate } from '../../i18n'
import {
  aggregatorGatewayProviderIds,
  apiKeyProviderIds,
  compareAggregatorGatewayOrder,
  compareProviderPopularity,
  getProviderCatalogDisplayName,
  getProviderCatalogGroup,
  getProviderCatalogGroupId,
  inferProviderPresetId,
  isAggregatorGatewayPreset,
  isApiKeyProviderPreset,
  isCustomProviderPreset,
  isLocalProviderPreset,
  isNoAuthProviderPreset,
  noAuthProviderIds,
} from './providerCatalog'

describe('API key provider catalog', () => {
  it('recognizes every non-custom source that requires an API key', () => {
    expect(isApiKeyProviderPreset({ id: 'openai', needsApiKey: true })).toBe(true)
    expect(isApiKeyProviderPreset({ id: 'openrouter', needsApiKey: true })).toBe(true)
    expect(isApiKeyProviderPreset({ id: 'siliconflow', needsApiKey: true })).toBe(true)
    expect(isApiKeyProviderPreset({ id: 'qianfan', needsApiKey: true })).toBe(true)
    expect(isApiKeyProviderPreset({ id: 'ollama', needsApiKey: false })).toBe(false)
    expect(isApiKeyProviderPreset({ id: 'custom', needsApiKey: true })).toBe(false)
  })

  it('distinguishes local runtimes from custom endpoints', () => {
    expect(isLocalProviderPreset({ id: 'ollama', needsApiKey: false })).toBe(true)
    expect(isLocalProviderPreset({ id: 'lmstudio', needsApiKey: false })).toBe(true)
    expect(isLocalProviderPreset({ id: 'custom', needsApiKey: true })).toBe(false)
    expect(isLocalProviderPreset({ id: 'opencode-free', needsApiKey: false })).toBe(false)
    expect(isCustomProviderPreset({ id: 'custom' })).toBe(true)
    expect(isCustomProviderPreset({ id: 'ollama' })).toBe(false)
  })

  it('keeps verified keyless clouds in the no-auth catalog', () => {
    expect(noAuthProviderIds).toEqual(['opencode-free'])
    expect(isNoAuthProviderPreset({ id: 'opencode-free' })).toBe(true)
    expect(isNoAuthProviderPreset({ id: 'ollama' })).toBe(false)
    expect(isNoAuthProviderPreset({ id: 'openrouter' })).toBe(false)
  })

  it('keeps multi-model clouds, inference platforms, and gateways together', () => {
    const reclassifiedPlatforms = [
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
    ]

    expect(aggregatorGatewayProviderIds).toHaveLength(42)
    expect(new Set(aggregatorGatewayProviderIds).size).toBe(42)
    for (const id of reclassifiedPlatforms) {
      expect(isAggregatorGatewayPreset({ id }), id).toBe(true)
      expect(apiKeyProviderIds, id).not.toContain(id)
    }
    expect(isAggregatorGatewayPreset({ id: 'openrouter' })).toBe(true)
    expect(isAggregatorGatewayPreset({ id: 'nanogpt' })).toBe(true)
    expect(isAggregatorGatewayPreset({ id: 'openai' })).toBe(false)
    expect(isAggregatorGatewayPreset({ id: 'anthropic-api' })).toBe(false)
    expect(apiKeyProviderIds).toHaveLength(17)

    expect(
      ['nanogpt', 'llm7', 'ollama-cloud', 'cloudflare-ai', 'siliconflow', 'qianfan', 'openrouter', 'alibaba']
        .sort(compareAggregatorGatewayOrder),
    ).toEqual([
      'openrouter',
      'cloudflare-ai',
      'ollama-cloud',
      'llm7',
      'alibaba',
      'qianfan',
      'siliconflow',
      'nanogpt',
    ])
  })

  it('keeps a stable popularity order for the card grid', () => {
    const shuffled = ['perplexity', 'mistral', 'deepseek', 'anthropic-api', 'openai', 'google']

    expect(shuffled.sort(compareProviderPopularity)).toEqual([
      'openai',
      'anthropic-api',
      'google',
      'deepseek',
      'mistral',
      'perplexity',
    ])
    expect(apiKeyProviderIds.slice(0, 8)).toEqual([
      'openai',
      'anthropic-api',
      'google',
      'deepseek',
      'xai',
      'kimi-code',
      'kimi',
      'zhipuglm',
    ])
  })

  it('keeps Kimi Code and Kimi as separate API key products', () => {
    expect(getProviderCatalogGroupId('kimi-code')).toBe('kimi-code')
    expect(getProviderCatalogGroupId('kimi')).toBe('kimi')
    expect(getProviderCatalogGroup('kimi-code')).toBeNull()
    expect(getProviderCatalogGroup('kimi')).toBeNull()
    expect(getProviderCatalogGroupId('openai')).toBe('openai')
    expect(getProviderCatalogGroup('openai')).toBeNull()
  })

  it('maps legacy custom provider identities to their built-in presets', () => {
    const availablePresetIds = new Set([
      'custom',
      'volcengine',
      'qianfan',
      'alibaba',
    ])

    expect(inferProviderPresetId({
      providerId: 'custom',
      name: '火山',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    }, availablePresetIds)).toBe('volcengine')
    expect(inferProviderPresetId({
      providerId: 'custom',
      name: '百度千帆',
      baseUrl: 'https://qianfan.baidubce.com/v2',
    }, availablePresetIds)).toBe('qianfan')
    expect(inferProviderPresetId({
      providerId: 'custom',
      name: 'Company Gateway',
      baseUrl: 'https://gateway.example.com/v1',
    }, availablePresetIds)).toBeNull()
  })

  it('localizes only brands with intentional locale-specific names', () => {
    const zh = (key: Parameters<typeof translate>[1]) => translate('zh', key)
    const en = (key: Parameters<typeof translate>[1]) => translate('en', key)

    expect(getProviderCatalogDisplayName('volcengine', 'Volcengine Ark', zh)).toBe('火山方舟')
    expect(getProviderCatalogDisplayName('qianfan', 'Baidu Qianfan', zh)).toBe('百度千帆')
    expect(getProviderCatalogDisplayName('siliconflow', 'SiliconFlow', zh)).toBe('硅基流动')
    expect(getProviderCatalogDisplayName('alibaba', 'Alibaba Qwen', zh)).toBe('阿里云百炼')
    expect(getProviderCatalogDisplayName('kimi-code', 'Kimi Coding API', zh)).toBe('Kimi Code')
    expect(getProviderCatalogDisplayName('kimi', 'Kimi API', zh)).toBe('Kimi')
    expect(getProviderCatalogDisplayName('openai', 'OpenAI', zh)).toBe('OpenAI')
    expect(getProviderCatalogDisplayName('groq', 'Groq', zh)).toBe('Groq')
    expect(getProviderCatalogDisplayName('zhipuglm', '智谱 GLM', en)).toBe('Zhipu GLM')
    expect(getProviderCatalogDisplayName('xiaomimimo', '小米 MiMo', en)).toBe('Xiaomi MiMo')
  })
})
