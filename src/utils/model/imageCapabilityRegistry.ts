import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { getClaudeConfigHomeDir } from '../envUtils.js'

export const CYBERCODE_IMAGE_INPUT_OVERRIDE_ENV = 'CYBERCODE_IMAGE_INPUT_OVERRIDE'
export const CYBERCODE_PROVIDER_BASE_URL_ENV = 'CYBERCODE_PROVIDER_BASE_URL'
export const CYBERCODE_PROVIDER_ID_ENV = 'CYBERCODE_PROVIDER_ID'

export type LearnedImageSupport = 'supported' | 'unsupported'
export type LearnedImageSupportSource =
  | 'probe'
  | 'local-metadata'
  | 'runtime-success'
  | 'runtime-rejection'

export type LearnedImageCapability = {
  baseUrl: string
  modelId: string
  status: LearnedImageSupport
  source: LearnedImageSupportSource
  updatedAt: number
  expiresAt: number
}

type ImageCapabilityRegistry = {
  version: 1
  entries: Record<string, LearnedImageCapability>
}

const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000
const LOCAL_METADATA_TTL_MS = 24 * 60 * 60 * 1000
const EMPTY_REGISTRY: ImageCapabilityRegistry = { version: 1, entries: {} }

let cachedRegistry:
  | { path: string; mtimeMs: number; value: ImageCapabilityRegistry }
  | undefined

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed)
    parsed.hostname = parsed.hostname.toLowerCase()
    parsed.hash = ''
    parsed.search = ''
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return trimmed.toLowerCase()
  }
}

function normalizeModelId(modelId: string | undefined): string {
  return (modelId ?? '').trim().toLowerCase()
}

function registryKey(baseUrl: string, modelId: string): string {
  return createHash('sha256')
    .update(`${normalizeBaseUrl(baseUrl)}\n${normalizeModelId(modelId)}`)
    .digest('hex')
}

export function getImageCapabilityRegistryPath(): string {
  const override = process.env.CYBERCODE_IMAGE_CAPABILITY_CACHE_PATH?.trim()
  if (override) return override
  return join(getClaudeConfigHomeDir(), 'cybercode', 'model-capabilities.json')
}

function parseRegistry(raw: string): ImageCapabilityRegistry {
  try {
    const parsed = JSON.parse(raw) as Partial<ImageCapabilityRegistry>
    if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object') {
      return EMPTY_REGISTRY
    }
    return { version: 1, entries: parsed.entries }
  } catch {
    return EMPTY_REGISTRY
  }
}

function readRegistry(): ImageCapabilityRegistry {
  const filePath = getImageCapabilityRegistryPath()
  try {
    const mtimeMs = statSync(filePath).mtimeMs
    if (cachedRegistry?.path === filePath && cachedRegistry.mtimeMs === mtimeMs) {
      return cachedRegistry.value
    }

    const value = parseRegistry(readFileSync(filePath, 'utf-8'))
    cachedRegistry = { path: filePath, mtimeMs, value }
    return value
  } catch {
    cachedRegistry = { path: filePath, mtimeMs: -1, value: EMPTY_REGISTRY }
    return EMPTY_REGISTRY
  }
}

function writeRegistry(registry: ImageCapabilityRegistry): void {
  const filePath = getImageCapabilityRegistryPath()
  const directory = dirname(filePath)
  mkdirSync(directory, { recursive: true, mode: 0o700 })

  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(registry, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  })
  renameSync(tempPath, filePath)
  chmodSync(filePath, 0o600)
  cachedRegistry = undefined
}

export function getLearnedImageSupport(
  baseUrl: string | undefined,
  modelId: string | undefined,
  now = Date.now(),
): LearnedImageCapability | undefined {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const normalizedModelId = normalizeModelId(modelId)
  if (!normalizedBaseUrl || !normalizedModelId) return undefined

  const registry = readRegistry()
  const entry = registry.entries[registryKey(normalizedBaseUrl, normalizedModelId)]
  if (!entry || entry.expiresAt <= now) return undefined
  return entry
}

export function recordLearnedImageSupport(input: {
  baseUrl: string
  modelId: string
  status: LearnedImageSupport
  source: LearnedImageSupportSource
  ttlMs?: number
  now?: number
}): LearnedImageCapability | undefined {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const modelId = input.modelId.trim()
  if (!baseUrl || !modelId) return undefined

  const now = input.now ?? Date.now()
  const ttlMs = input.ttlMs ?? (
    input.source === 'local-metadata' ? LOCAL_METADATA_TTL_MS : DEFAULT_TTL_MS
  )
  const entry: LearnedImageCapability = {
    baseUrl,
    modelId,
    status: input.status,
    source: input.source,
    updatedAt: now,
    expiresAt: now + ttlMs,
  }

  const current = readRegistry()
  const entries = Object.fromEntries(
    Object.entries(current.entries).filter(([, value]) => value.expiresAt > now),
  )
  entries[registryKey(baseUrl, modelId)] = entry
  writeRegistry({ version: 1, entries })
  return entry
}

export function clearLearnedImageSupport(
  baseUrl: string | undefined,
  modelId: string | undefined,
): void {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const normalizedModelId = normalizeModelId(modelId)
  if (!normalizedBaseUrl || !normalizedModelId) return

  const registry = readRegistry()
  const key = registryKey(normalizedBaseUrl, normalizedModelId)
  if (!registry.entries[key]) return

  const entries = { ...registry.entries }
  delete entries[key]
  writeRegistry({ version: 1, entries })
}

export function resetImageCapabilityRegistryCacheForTests(): void {
  cachedRegistry = undefined
}
