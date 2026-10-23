import type { TranslationKey } from '../../i18n/locales/en'
import {
  resolveProviderIdentity,
  type ProviderIdentityInput,
} from './providerIdentity'

const API_KEY_PROVIDER_IDS = [
  'openai',
  'anthropic-api',
  'google',
  'deepseek',
  'xai',
  'kimi-code',
  'kimi',
  'zhipuglm',
  'minimax',
  'mistral',
  'perplexity',
  'cohere',
  'meta-llama',
  'ai21',
  'reka',
  'nous-research',
  'xiaomimimo',
] as const

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

const NO_AUTH_PROVIDER_IDS = [
  'opencode-free',
] as const

const API_KEY_PROVIDER_RANK = new Map<string, number>(
  API_KEY_PROVIDER_IDS.map((id, index) => [id, index]),
)

const NO_AUTH_PROVIDER_SET = new Set<string>(NO_AUTH_PROVIDER_IDS)

const AGGREGATOR_GATEWAY_PROVIDER_SET = new Set<string>(
  AGGREGATOR_GATEWAY_PROVIDER_IDS,
)

const AGGREGATOR_GATEWAY_PROVIDER_RANK = new Map<string, number>(
  AGGREGATOR_GATEWAY_PROVIDER_IDS.map((id, index) => [id, index]),
)

const PROVIDER_CATALOG_NAME_KEYS: Partial<Record<string, TranslationKey>> = {
  'kimi-code': 'settings.providers.catalogName.kimiCode',
  kimi: 'settings.providers.catalogName.kimi',
  alibaba: 'settings.providers.catalogName.alibaba',
  volcengine: 'settings.providers.catalogName.volcengine',
  qianfan: 'settings.providers.catalogName.qianfan',
  siliconflow: 'settings.providers.catalogName.siliconflow',
  zhipuglm: 'settings.providers.catalogName.zhipuglm',
  xiaomimimo: 'settings.providers.catalogName.xiaomimimo',
  custom: 'settings.providers.catalogName.custom',
}

const PROVIDER_IDENTITY_PRESET_ALIASES: Record<string, string> = {
  official: 'anthropic-api',
  baidu: 'qianfan',
  qwen: 'alibaba',
  meta: 'meta-llama',
}

export type ProviderCatalogGroup = {
  id: string
  name: string
  presetIds: readonly string[]
}

const PROVIDER_CATALOG_GROUPS: readonly ProviderCatalogGroup[] = []

const PROVIDER_CATALOG_GROUP_BY_PRESET_ID = new Map(
  PROVIDER_CATALOG_GROUPS.flatMap((group) => (
    group.presetIds.map((presetId) => [presetId, group] as const)
  )),
)

type ProviderCatalogPreset = {
  id: string
  needsApiKey: boolean
}

export function isApiKeyProviderPreset(preset: ProviderCatalogPreset): boolean {
  return preset.needsApiKey && preset.id !== 'custom'
}

export function isNoAuthProviderPreset(
  preset: Pick<ProviderCatalogPreset, 'id'>,
): boolean {
  return NO_AUTH_PROVIDER_SET.has(preset.id)
}

export function isCustomProviderPreset(
  preset: Pick<ProviderCatalogPreset, 'id'>,
): boolean {
  return preset.id === 'custom'
}

export function isLocalProviderPreset(preset: ProviderCatalogPreset): boolean {
  return (
    !preset.needsApiKey &&
    !isNoAuthProviderPreset(preset) &&
    !isCustomProviderPreset(preset)
  )
}

export function isAggregatorGatewayPreset(
  preset: Pick<ProviderCatalogPreset, 'id'>,
): boolean {
  return AGGREGATOR_GATEWAY_PROVIDER_SET.has(preset.id)
}

export function compareProviderPopularity(leftId: string, rightId: string): number {
  const leftRank = API_KEY_PROVIDER_RANK.get(leftId) ?? Number.MAX_SAFE_INTEGER
  const rightRank = API_KEY_PROVIDER_RANK.get(rightId) ?? Number.MAX_SAFE_INTEGER
  return leftRank - rightRank
}

export function compareAggregatorGatewayOrder(leftId: string, rightId: string): number {
  const leftRank = AGGREGATOR_GATEWAY_PROVIDER_RANK.get(leftId) ?? Number.MAX_SAFE_INTEGER
  const rightRank = AGGREGATOR_GATEWAY_PROVIDER_RANK.get(rightId) ?? Number.MAX_SAFE_INTEGER
  return leftRank - rightRank
}

export function getProviderCatalogDisplayName(
  providerId: string,
  fallback: string,
  translate: (key: TranslationKey) => string,
): string {
  const key = PROVIDER_CATALOG_NAME_KEYS[providerId]
  return key ? translate(key) : fallback
}

export function getProviderCatalogGroup(
  presetId: string,
): ProviderCatalogGroup | null {
  // These products use different keys, endpoints, and protocols.
  if (presetId === 'kimi-code' || presetId === 'kimi') return null
  return PROVIDER_CATALOG_GROUP_BY_PRESET_ID.get(presetId) ?? null
}

export function getProviderCatalogGroupId(presetId: string): string {
  return getProviderCatalogGroup(presetId)?.id ?? presetId
}

export function inferProviderPresetId(
  input: ProviderIdentityInput,
  availablePresetIds: ReadonlySet<string>,
): string | null {
  const identityId = resolveProviderIdentity({
    providerId: input.providerId,
    name: input.name,
    baseUrl: input.baseUrl,
  }).id
  const presetId = PROVIDER_IDENTITY_PRESET_ALIASES[identityId] ?? identityId
  return availablePresetIds.has(presetId) ? presetId : null
}

export const apiKeyProviderIds = [...API_KEY_PROVIDER_IDS]
export const aggregatorGatewayProviderIds = [...AGGREGATOR_GATEWAY_PROVIDER_IDS]
export const noAuthProviderIds = [...NO_AUTH_PROVIDER_IDS]
