import { buildOpenAICompatibleUrl } from '../proxy/openaiCompatUrl.js'
import type {
  ApiFormat,
  ProviderModelInfo,
} from '../types/provider.js'

type DiscoveryInput = {
  baseUrl: string
  apiKey?: string
  apiFormat: ApiFormat
  presetId?: string
}

export type ProviderModelDiscoveryResult = {
  models: ProviderModelInfo[]
  endpoint: string
  cached: boolean
}

type DiscoveryOptions = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  force?: boolean
}

type CachedDiscovery = {
  expiresAt: number
  endpoint: string
  models: ProviderModelInfo[]
}

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, CachedDiscovery>()

function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin
  } catch {
    return baseUrl.replace(/\/+$/, '')
  }
}

function isOllama(input: DiscoveryInput): boolean {
  if (input.presetId === 'ollama') return true
  try {
    return new URL(input.baseUrl).port === '11434'
  } catch {
    return false
  }
}

function isLmStudio(input: DiscoveryInput): boolean {
  if (input.presetId === 'lmstudio') return true
  try {
    return new URL(input.baseUrl).port === '1234'
  } catch {
    return false
  }
}

function modelRecords(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) {
    return body.filter((item): item is Record<string, unknown> =>
      !!item && typeof item === 'object' && !Array.isArray(item)
    )
  }
  if (!body || typeof body !== 'object') return []
  const record = body as Record<string, unknown>
  for (const key of ['data', 'models', 'items']) {
    if (Array.isArray(record[key])) {
      return (record[key] as unknown[]).filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item),
      )
    }
  }
  return []
}

function modelId(record: Record<string, unknown>): string | undefined {
  for (const key of ['id', 'model', 'name', 'key']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1_000) {
    return Math.round(value)
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.replace(/[,_\s]/g, ''), 10)
    if (Number.isFinite(parsed) && parsed >= 1_000) return parsed
  }
  return undefined
}

function findContextWindow(value: unknown, depth = 0): number | undefined {
  if (!value || typeof value !== 'object' || depth > 3) return undefined
  const record = value as Record<string, unknown>
  const directKeys = [
    'context_window',
    'contextWindow',
    'context_length',
    'contextLength',
    'max_context_length',
    'maxContextLength',
    'loaded_context_length',
  ]
  for (const key of directKeys) {
    const parsed = parsePositiveInteger(record[key])
    if (parsed) return parsed
  }
  for (const [key, nested] of Object.entries(record)) {
    if (/context(?:_length)?$/i.test(key)) {
      const parsed = parsePositiveInteger(nested)
      if (parsed) return parsed
    }
  }
  for (const nested of Object.values(record)) {
    const parsed = findContextWindow(nested, depth + 1)
    if (parsed) return parsed
  }
  return undefined
}

function parseCapabilities(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string')
  }
  if (!value || typeof value !== 'object') return undefined
  const enabled = Object.entries(value as Record<string, unknown>)
    .filter(([, state]) => state === true)
    .map(([name]) => name)
  return enabled.length > 0 ? enabled : undefined
}

function supportsImages(record: Record<string, unknown>): boolean | undefined {
  const direct = record.supports_images ?? record.supportsImages
  if (typeof direct === 'boolean') return direct
  const capabilities = parseCapabilities(record.capabilities)
  if (!capabilities) return undefined
  return capabilities.some((capability) =>
    /^(?:vision|image|images|image_input|input_image|multimodal)$/i.test(capability.trim())
  )
}

function toModelInfo(record: Record<string, unknown>): ProviderModelInfo | undefined {
  const id = modelId(record)
  if (!id) return undefined
  const contextWindow = findContextWindow(record)
  const imageSupport = supportsImages(record)
  return {
    id,
    ...(typeof record.display_name === 'string' && { label: record.display_name }),
    ...(contextWindow && { contextWindow }),
    ...(imageSupport !== undefined && { supportsImages: imageSupport }),
  }
}

function dedupeModels(models: ProviderModelInfo[]): ProviderModelInfo[] {
  const byId = new Map<string, ProviderModelInfo>()
  for (const model of models) {
    const key = model.id.trim().toLowerCase()
    if (!key) continue
    const existing = byId.get(key)
    byId.set(key, {
      ...existing,
      ...model,
      id: existing?.id ?? model.id.trim(),
    })
  }
  return [...byId.values()].sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
  )
}

function authHeaders(input: DiscoveryInput): Record<string, string> {
  const key = input.apiKey?.trim()
  if (!key) return { Accept: 'application/json' }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${key}`,
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  }
}

async function enrichOllamaModels(
  endpoint: string,
  models: ProviderModelInfo[],
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ProviderModelInfo[]> {
  const origin = endpoint.replace(/\/api\/tags\/?$/i, '')
  return Promise.all(models.map(async (model) => {
    try {
      const response = await fetchImpl(`${origin}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.id }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) return model
      const metadata = await response.json() as Record<string, unknown>
      const contextWindow = findContextWindow(metadata)
      const imageSupport = supportsImages(metadata)
      return {
        ...model,
        ...(contextWindow && { contextWindow }),
        ...(imageSupport !== undefined && { supportsImages: imageSupport }),
      }
    } catch {
      return model
    }
  }))
}

function discoveryEndpoints(input: DiscoveryInput): string[] {
  const endpoints: string[] = []
  if (isOllama(input)) endpoints.push(`${originOf(input.baseUrl)}/api/tags`)
  if (isLmStudio(input)) endpoints.push(`${originOf(input.baseUrl)}/api/v1/models`)
  endpoints.push(buildOpenAICompatibleUrl(input.baseUrl, 'models'))
  return [...new Set(endpoints)]
}

export async function discoverProviderModels(
  input: DiscoveryInput,
  options: DiscoveryOptions = {},
): Promise<ProviderModelDiscoveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 5_000
  const cacheKey = [
    input.presetId ?? '',
    input.apiFormat,
    input.baseUrl.replace(/\/+$/, '').toLowerCase(),
  ].join('|')
  const cached = cache.get(cacheKey)
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return { models: cached.models, endpoint: cached.endpoint, cached: true }
  }

  let lastError = ''
  for (const endpoint of discoveryEndpoints(input)) {
    try {
      const response = await fetchImpl(endpoint, {
        headers: authHeaders(input),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        lastError = `HTTP ${response.status}`
        continue
      }

      let models = modelRecords(await response.json())
        .map(toModelInfo)
        .filter((model): model is ProviderModelInfo => model !== undefined)
      if (models.length === 0) {
        lastError = 'The endpoint returned no model IDs'
        continue
      }
      if (/\/api\/tags\/?$/i.test(endpoint)) {
        models = await enrichOllamaModels(endpoint, models, fetchImpl, timeoutMs)
      }
      models = dedupeModels(models)
      cache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        endpoint,
        models,
      })
      return { models, endpoint, cached: false }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  throw new Error(
    lastError
      ? `Unable to discover models: ${lastError}`
      : 'This provider does not expose a model-list endpoint',
  )
}

export function clearProviderModelDiscoveryCache(): void {
  cache.clear()
}
