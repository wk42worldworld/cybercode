/**
 * Provider Service — preset-based provider configuration
 *
 * Storage: ~/.cyber/cybercode/providers.json (lightweight index)
 * Active provider env vars written to ~/.cyber/cybercode/settings.json
 * (isolated from the original Claude Code settings in ~/.cyber/settings.json)
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { ApiError } from '../middleware/errorHandler.js'
import { anthropicToOpenaiChat } from '../proxy/transform/anthropicToOpenaiChat.js'
import { anthropicToOpenaiResponses } from '../proxy/transform/anthropicToOpenaiResponses.js'
import { openaiChatToAnthropic } from '../proxy/transform/openaiChatToAnthropic.js'
import { openaiResponsesToAnthropic } from '../proxy/transform/openaiResponsesToAnthropic.js'
import { buildOpenAICompatibleUrl } from '../proxy/openaiCompatUrl.js'
import type { AnthropicRequest, AnthropicResponse } from '../proxy/transform/types.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import {
  CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV,
  buildModelContextWindowMap,
  inferContextWindowFromModelName,
  parseContextWindowTokenValue,
} from '../../utils/modelContextWindows.js'
import type {
  SavedProvider,
  ProvidersIndex,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderInput,
  ProviderTestResult,
  ProviderTestStepResult,
  ApiFormat,
  ModelContextWindows,
  ModelMapping,
} from '../types/provider.js'
import { resolveProviderImageSupport } from './modelImageSupport.js'
import { resolveProviderImageSupportDynamically } from './modelImageCapabilityProbe.js'
import { IMAGE_INPUT_CAPABILITY } from '../../utils/model/imageSupport.js'
import {
  CYBERCODE_PROVIDER_BASE_URL_ENV,
  CYBERCODE_PROVIDER_ID_ENV,
} from '../../utils/model/imageCapabilityRegistry.js'
import { isKimiBaseUrl, isKimiProviderTarget } from '../../utils/model/kimi.js'
import {
  isKimiAlwaysOnThinkingModel,
  isKimiK3ModelId,
  requiresEnabledThinkingParamForModel,
} from '../../utils/model/thinkingPolicy.js'

const MANAGED_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  CYBERCODE_PROVIDER_BASE_URL_ENV,
  CYBERCODE_PROVIDER_ID_ENV,
  CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV,
] as const

const DEFAULT_INDEX: ProvidersIndex = { activeId: null, providers: [] }
const MODEL_ROLES = ['main', 'haiku', 'sonnet', 'opus'] as const
const KIMI_CODE_PRESET_ID = 'kimi-code'
const KIMI_API_PRESET_ID = 'kimi'
const KIMI_CODE_STABLE_MODEL = 'kimi-for-coding'
const KIMI_CODE_HIGHSPEED_MODEL = 'kimi-for-coding-highspeed'
const XIAOMI_MIMO_PRESET_ID = 'xiaomimimo'
const MASKED_API_KEYS = new Set(['***', '••••••••'])
const LEGACY_PRESET_MODEL_IDS: Record<string, Record<string, string>> = {
  deepseek: {
    'deepseek-v4-pro[1m]': 'deepseek-v4-pro',
    'deepseek-chat': 'deepseek-v4-flash',
    'deepseek-reasoner': 'deepseek-v4-flash',
  },
  zhipuglm: {
    'glm-5.2[1m]': 'glm-5.2',
    'glm-4.5-air': 'glm-4.7',
  },
  kimi: {
    'kimi-k2-thinking-turbo': 'kimi-k2.6',
    'kimi-k2-thinking': 'kimi-k2.6',
    'kimi-k2-turbo-preview': 'kimi-k2.6',
    'kimi-k2-0905-preview': 'kimi-k2.6',
  },
  minimax: {
    'minimax-m3[1m]': 'MiniMax-M3',
  },
  xiaomimimo: {
    'mimo-v2.5-flash': 'mimo-v2.5',
    'mimo-v2-pro': 'mimo-v2.5-pro',
    'mimo-v2-flash': 'mimo-v2.5',
  },
}

const STALE_PRESET_CONTEXT_WINDOWS: Record<string, ReadonlySet<number>> = {
  zhipuglm: new Set([200_000]),
  'kimi-code': new Set([256_000]),
  kimi: new Set([256_000]),
  minimax: new Set([1_000_000]),
  lmstudio: new Set([200_000]),
  ollama: new Set([256_000]),
}

function getPresetDefaultEnv(presetId: string): Record<string, string> {
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.defaultEnv ?? {}
}

function getPresetDefaultContextWindows(presetId: string): ModelContextWindows {
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.defaultModelContextWindows ?? {}
}

function getPresetModelContextWindow(
  presetId: string,
  modelId: string | undefined,
): number | undefined {
  const normalized = modelId?.trim()
  if (!normalized) return undefined
  return PROVIDER_PRESETS
    .find((preset) => preset.id === presetId)
    ?.modelOptions?.find((option) => option.id === normalized)
    ?.contextWindow
}

function getPresetDefaultModels(presetId: string): ModelMapping | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.defaultModels
}

function normalizeProviderModels(models: ModelMapping): ModelMapping {
  const main = (
    models.main ||
    models.sonnet ||
    models.opus ||
    models.haiku
  ).trim()
  return {
    main,
    haiku: models.haiku.trim() || main,
    sonnet: models.sonnet.trim() || main,
    opus: models.opus.trim() || main,
  }
}

function migrateLegacyPresetModelIds(provider: SavedProvider): ModelMapping {
  const aliases = LEGACY_PRESET_MODEL_IDS[provider.presetId]
  const models = normalizeProviderModels(provider.models)
  if (!aliases) return models

  const migrated = { ...models }
  for (const role of MODEL_ROLES) {
    const replacement = aliases[migrated[role].toLowerCase()]
    if (replacement) migrated[role] = replacement
  }
  return migrated
}

function isMaskedApiKey(value: string | undefined): boolean {
  return value !== undefined && MASKED_API_KEYS.has(value.trim())
}

function getManagedEnvKeys(): string[] {
  const keys = new Set<string>(MANAGED_ENV_KEYS)
  for (const preset of PROVIDER_PRESETS) {
    for (const key of Object.keys(preset.defaultEnv ?? {})) {
      keys.add(key)
    }
  }
  return [...keys]
}

export function getProviderManagedEnvKeys(): string[] {
  return getManagedEnvKeys()
}

function compactModelContextWindows(
  input: ModelContextWindows | undefined,
): ModelContextWindows | undefined {
  if (!input) return undefined

  const compacted: ModelContextWindows = {}
  for (const role of MODEL_ROLES) {
    const parsed = parseContextWindowTokenValue(input[role])
    if (parsed) compacted[role] = parsed
  }

  return Object.keys(compacted).length > 0 ? compacted : undefined
}

function mergeCapabilityList(
  raw: string | undefined,
  capability: string,
  enabled: boolean | undefined,
): string | undefined {
  if (enabled === undefined) return raw

  const capabilities = new Set(
    (raw ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )

  if (enabled) {
    capabilities.add(capability)
  } else {
    capabilities.delete(capability)
  }

  return [...capabilities].sort().join(',')
}

function explicitImageSupportOverride(
  provider: SavedProvider,
  modelId: string,
): boolean | undefined {
  const resolution = resolveProviderImageSupport(provider, modelId)
  return [
    'provider-forced',
    'provider-legacy',
    'learned',
    'provider-catalog',
    'preset-model',
  ].includes(resolution.source)
    ? resolution.supportsImages
    : undefined
}

function addCapabilityEnv(
  target: Record<string, string>,
  key: string,
  raw: string | undefined,
  enabled: boolean | undefined,
): void {
  const value = mergeCapabilityList(raw, IMAGE_INPUT_CAPABILITY, enabled)
  if (value !== undefined) target[key] = value
}

function migrateProviderIndex(index: ProvidersIndex): { index: ProvidersIndex; changed: boolean } {
  let changed = false
  const providers = index.providers.map((provider) => {
    let migrated = provider

    const normalizedModels = migrateLegacyPresetModelIds(migrated)
    if (JSON.stringify(normalizedModels) !== JSON.stringify(migrated.models)) {
      changed = true
      migrated = {
        ...migrated,
        models: normalizedModels,
      }
    }

    if (isSavedKimiCodeProvider(migrated)) {
      changed = true
      migrated = {
        ...migrated,
        presetId: KIMI_CODE_PRESET_ID,
      }
    }

    const kimiCodeModelMigration = migrateKimiCodeModelIds(migrated)
    if (kimiCodeModelMigration !== migrated) {
      changed = true
      migrated = kimiCodeModelMigration
    }

    const kimiEndpointMigration = migrateLegacyKimiApiEndpoint(migrated)
    if (kimiEndpointMigration !== migrated) {
      changed = true
      migrated = kimiEndpointMigration
    }

    if (
      isSavedKimiApiProviderWithLegacyImageSupport(migrated) ||
      isSavedProviderWithStaleLegacyImageSupport(migrated)
    ) {
      changed = true
      const rest = { ...migrated }
      delete rest.supportsImages
      migrated = {
        ...rest,
        imageSupportMode: 'auto',
      }
    }

    const contextWindowMigration = migrateStalePresetContextWindows(migrated)
    if (contextWindowMigration !== migrated) {
      changed = true
      migrated = contextWindowMigration
    }

    return migrated
  })

  return {
    index: changed ? { ...index, providers } : index,
    changed,
  }
}

function isSavedKimiCodeProvider(provider: SavedProvider): boolean {
  return provider.presetId === KIMI_API_PRESET_ID &&
    isKimiCodeBaseUrl(provider.baseUrl)
}

function migrateKimiCodeModelIds(provider: SavedProvider): SavedProvider {
  if (provider.presetId !== KIMI_CODE_PRESET_ID || !isKimiCodeBaseUrl(provider.baseUrl)) {
    return provider
  }

  let changed = false
  const models = { ...provider.models }
  for (const role of MODEL_ROLES) {
    const normalized = normalizeSavedModel(models[role])
    if (normalized === 'kimi-k2.7-code-highspeed') {
      models[role] = KIMI_CODE_HIGHSPEED_MODEL
      changed = true
    } else if (normalized === 'kimi-k2.7-code' || normalized === 'kimi-k2.6') {
      models[role] = KIMI_CODE_STABLE_MODEL
      changed = true
    }
  }

  return changed ? { ...provider, models } : provider
}

function migrateLegacyKimiApiEndpoint(provider: SavedProvider): SavedProvider {
  if (provider.presetId !== KIMI_API_PRESET_ID) return provider
  if ((provider.apiFormat ?? 'anthropic') !== 'anthropic') return provider

  const normalized = provider.baseUrl.trim().replace(/\/+$/, '').toLowerCase()
  if (normalized === 'https://api.moonshot.cn/anthropic') {
    return { ...provider, baseUrl: 'https://api.moonshot.cn', apiFormat: 'openai_chat' }
  }
  if (normalized === 'https://api.moonshot.ai/anthropic') {
    return { ...provider, baseUrl: 'https://api.moonshot.ai', apiFormat: 'openai_chat' }
  }
  return provider
}

function isSavedKimiApiProviderWithLegacyImageSupport(provider: SavedProvider): boolean {
  return provider.presetId === KIMI_API_PRESET_ID &&
    isKimiBaseUrl(provider.baseUrl) &&
    !isKimiCodeBaseUrl(provider.baseUrl) &&
    provider.imageSupportMode === undefined &&
    provider.supportsImages === false
}

function isSavedProviderWithStaleLegacyImageSupport(provider: SavedProvider): boolean {
  return (
    provider.presetId === KIMI_CODE_PRESET_ID ||
    provider.presetId === XIAOMI_MIMO_PRESET_ID
  ) &&
    provider.imageSupportMode === undefined &&
    typeof provider.supportsImages === 'boolean'
}

function migrateStalePresetContextWindows(provider: SavedProvider): SavedProvider {
  const staleValues = STALE_PRESET_CONTEXT_WINDOWS[provider.presetId]
  if (!staleValues || !provider.modelContextWindows) return provider

  let changed = false
  const next = { ...provider.modelContextWindows }
  for (const role of MODEL_ROLES) {
    const current = parseContextWindowTokenValue(next[role])
    if (!current || !staleValues.has(current)) continue
    // K3 can be deliberately capped below 1M by the user or their Kimi plan.
    if (isKimiK3ModelId(provider.models[role])) continue
    const official = getPresetModelContextWindow(provider.presetId, provider.models[role])
    if (!official || official === current) continue
    next[role] = official
    changed = true
  }

  return changed ? { ...provider, modelContextWindows: next } : provider
}

function normalizeSavedModel(model: string | undefined): string {
  return (model ?? '')
    .trim()
    .toLowerCase()
    .replace(/:(?:\d+(?:k|m)?|[a-z]+)$/i, '')
}

function normalizeProviderRuntimeModel(provider: SavedProvider, modelId: string): string {
  return LEGACY_PRESET_MODEL_IDS[provider.presetId]?.[modelId.trim().toLowerCase()] ?? modelId
}

function getProviderRuntimeModelSet(provider: SavedProvider): Set<string> {
  return new Set(
    [
      ...MODEL_ROLES.map((role) =>
        normalizeProviderRuntimeModel(provider, provider.models[role]).trim()
      ),
      ...(provider.modelCatalog ?? []).map((model) =>
        normalizeProviderRuntimeModel(provider, model.id).trim()
      ),
    ].filter(Boolean),
  )
}

function resolveProviderManagedModel(
  settings: Record<string, unknown>,
  provider: SavedProvider,
  env: Record<string, string>,
): string {
  const allowedModels = getProviderRuntimeModelSet(provider)
  const currentModel =
    typeof settings.model === 'string'
      ? normalizeProviderRuntimeModel(provider, settings.model).trim()
      : ''
  if (currentModel && allowedModels.has(currentModel)) return currentModel

  const envModel = normalizeProviderRuntimeModel(provider, env.ANTHROPIC_MODEL ?? '').trim()
  if (envModel && allowedModels.has(envModel)) return envModel

  return normalizeProviderRuntimeModel(provider, provider.models.main).trim()
}

export class ProviderService {
  private static serverPort = 3456

  static setServerPort(port: number): void {
    ProviderService.serverPort = port
  }

  static getServerPort(): number {
    return ProviderService.serverPort
  }
  private getConfigDir(): string {
    return getClaudeConfigHomeDir()
  }

  private getCybercodeDir(): string {
    return path.join(this.getConfigDir(), 'cybercode')
  }

  private getIndexPath(): string {
    return path.join(this.getCybercodeDir(), 'providers.json')
  }

  private getSettingsPath(): string {
    return path.join(this.getCybercodeDir(), 'settings.json')
  }

  private async readIndex(): Promise<ProvidersIndex> {
    try {
      const raw = await fs.readFile(this.getIndexPath(), 'utf-8')
      await this.securePath(this.getIndexPath(), 0o600)
      await this.securePath(this.getCybercodeDir(), 0o700)
      const index = JSON.parse(raw) as ProvidersIndex
      const migrated = migrateProviderIndex(index)
      if (migrated.changed) {
        await this.writeIndex(migrated.index)
        const activeProvider = migrated.index.activeId
          ? migrated.index.providers.find((provider) => provider.id === migrated.index.activeId)
          : undefined
        if (activeProvider) {
          if (activeProvider.presetId === 'official') {
            await this.clearProviderFromSettings()
          } else {
            await this.syncToSettings(activeProvider)
          }
        }
      }
      return migrated.index
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ...DEFAULT_INDEX, providers: [] }
      }
      throw ApiError.internal(`Failed to read providers index: ${err}`)
    }
  }

  private async writeIndex(index: ProvidersIndex): Promise<void> {
    const filePath = this.getIndexPath()
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    await this.securePath(dir, 0o700)

    const tmpFile = `${filePath}.tmp.${Date.now()}`
    try {
      await fs.writeFile(tmpFile, JSON.stringify(index, null, 2) + '\n', {
        encoding: 'utf-8',
        mode: 0o600,
      })
      await fs.rename(tmpFile, filePath)
      await this.securePath(filePath, 0o600)
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write providers index: ${err}`)
    }
  }

  private async readSettings(): Promise<Record<string, unknown>> {
    try {
      const raw = await fs.readFile(this.getSettingsPath(), 'utf-8')
      await this.securePath(this.getSettingsPath(), 0o600)
      await this.securePath(this.getCybercodeDir(), 0o700)
      return JSON.parse(raw) as Record<string, unknown>
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw ApiError.internal(`Failed to read settings.json: ${err}`)
    }
  }

  private async writeSettings(settings: Record<string, unknown>): Promise<void> {
    const filePath = this.getSettingsPath()
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    await this.securePath(dir, 0o700)

    const tmpFile = `${filePath}.tmp.${Date.now()}`
    try {
      await fs.writeFile(tmpFile, JSON.stringify(settings, null, 2) + '\n', {
        encoding: 'utf-8',
        mode: 0o600,
      })
      await fs.rename(tmpFile, filePath)
      await this.securePath(filePath, 0o600)
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write settings.json: ${err}`)
    }
  }

  private async securePath(targetPath: string, mode: number): Promise<void> {
    // Windows does not implement POSIX modes fully. Treat chmod as best-effort
    // there while enforcing it on Unix-like desktop builds.
    await fs.chmod(targetPath, mode).catch(() => {})
  }

  async getManagedSettings(): Promise<Record<string, unknown>> {
    const settings = await this.readSettings()
    const index = await this.readIndex()
    const activeProvider = index.activeId
      ? index.providers.find((provider) => provider.id === index.activeId)
      : undefined

    if (activeProvider && activeProvider.presetId !== 'official') {
      const before = JSON.stringify(settings)
      this.applyProviderManagedRuntimeSettings(settings, activeProvider)
      if (JSON.stringify(settings) !== before) {
        await this.writeSettings(settings)
      }
    }

    return settings
  }

  async updateManagedSettings(settings: Record<string, unknown>): Promise<void> {
    const current = await this.readSettings()
    const incoming = { ...settings }
    if (incoming.env && typeof incoming.env === 'object' && !Array.isArray(incoming.env)) {
      const incomingEnv = { ...(incoming.env as Record<string, unknown>) }
      const currentEnv =
        current.env && typeof current.env === 'object' && !Array.isArray(current.env)
          ? current.env as Record<string, unknown>
          : {}
      for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
        if (
          typeof incomingEnv[key] === 'string' &&
          isMaskedApiKey(incomingEnv[key] as string)
        ) {
          if (currentEnv[key] !== undefined) incomingEnv[key] = currentEnv[key]
          else delete incomingEnv[key]
        }
      }
      incoming.env = incomingEnv
    }
    const next = Object.assign({}, current, incoming)
    const index = await this.readIndex()
    const activeProvider = index.activeId
      ? index.providers.find((provider) => provider.id === index.activeId)
      : undefined

    if (activeProvider && activeProvider.presetId !== 'official') {
      this.applyProviderManagedRuntimeSettings(next, activeProvider)
    }

    await this.writeSettings(next)
  }

  // --- CRUD ---

  async listProviders(): Promise<{ providers: SavedProvider[]; activeId: string | null }> {
    const index = await this.readIndex()
    return { providers: index.providers, activeId: index.activeId }
  }

  async getProvider(id: string): Promise<SavedProvider> {
    const index = await this.readIndex()
    const provider = index.providers.find((p) => p.id === id)
    if (!provider) throw ApiError.notFound(`Provider not found: ${id}`)
    return provider
  }

  async addProvider(input: CreateProviderInput): Promise<SavedProvider> {
    const index = await this.readIndex()

    const provider: SavedProvider = {
      id: crypto.randomUUID(),
      presetId: input.presetId,
      name: input.name,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      apiFormat: input.apiFormat ?? 'anthropic',
      models: normalizeProviderModels(input.models),
      ...(input.modelCatalog !== undefined && { modelCatalog: input.modelCatalog }),
      ...(compactModelContextWindows(input.modelContextWindows) && {
        modelContextWindows: compactModelContextWindows(input.modelContextWindows),
      }),
      ...(input.imageSupportMode !== undefined && { imageSupportMode: input.imageSupportMode }),
      ...(input.imageSupportMode === undefined &&
        input.supportsImages !== undefined && { supportsImages: input.supportsImages }),
      ...(input.notes !== undefined && { notes: input.notes }),
    }

    index.providers.push(provider)
    await this.writeIndex(index)
    return provider
  }

  async updateProvider(id: string, input: UpdateProviderInput): Promise<SavedProvider> {
    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.id === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)

    const existing = index.providers[idx]
    const updated: SavedProvider = {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.apiKey !== undefined &&
        !isMaskedApiKey(input.apiKey) && { apiKey: input.apiKey }),
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
      ...(input.apiFormat !== undefined && { apiFormat: input.apiFormat }),
      ...(input.models !== undefined && { models: normalizeProviderModels(input.models) }),
      ...(input.modelCatalog !== undefined && { modelCatalog: input.modelCatalog }),
      ...(input.modelContextWindows !== undefined && {
        modelContextWindows: compactModelContextWindows(input.modelContextWindows),
      }),
      ...(input.imageSupportMode !== undefined && { imageSupportMode: input.imageSupportMode }),
      ...(input.imageSupportMode === undefined &&
        input.supportsImages !== undefined && { supportsImages: input.supportsImages }),
      ...(input.notes !== undefined && { notes: input.notes }),
    }
    if (input.imageSupportMode !== undefined) {
      delete updated.supportsImages
    }

    index.providers[idx] = updated
    await this.writeIndex(index)

    if (index.activeId === id) {
      await this.syncToSettings(updated)
    }

    return updated
  }

  async deleteProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.id === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)

    if (index.activeId === id) {
      throw ApiError.conflict('Cannot delete the active provider. Switch to another provider first.')
    }

    index.providers.splice(idx, 1)
    await this.writeIndex(index)
  }

  // --- Activation ---

  async activateProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    const provider = index.providers.find((p) => p.id === id)
    if (!provider) throw ApiError.notFound(`Provider not found: ${id}`)

    index.activeId = id
    await this.writeIndex(index)

    if (provider.presetId === 'official') {
      await this.clearProviderFromSettings()
    } else {
      await this.syncToSettings(provider)
    }
  }

  async activateOfficial(): Promise<void> {
    const index = await this.readIndex()
    index.activeId = null
    await this.writeIndex(index)
    await this.clearProviderFromSettings()
  }

  // --- Settings sync ---

  private buildManagedEnv(
    provider: SavedProvider,
    options?: { proxyPath?: string; modelId?: string },
  ): Record<string, string> {
    const needsProxy = provider.apiFormat != null && provider.apiFormat !== 'anthropic'
    const proxyPath = options?.proxyPath ?? '/proxy'
    const baseUrl = needsProxy
      ? `http://127.0.0.1:${ProviderService.serverPort}${proxyPath}`
      : provider.baseUrl
    const requestedModel = options?.modelId?.trim() || provider.models.main
    const mainModel = normalizeProviderRuntimeModel(provider, requestedModel)
    const modelContextWindowMap = this.getProviderModelContextWindowMap(provider)
    const presetEnv = getPresetDefaultEnv(provider.presetId)
    const roleCapabilities: Record<string, string> = {}
    addCapabilityEnv(
      roleCapabilities,
      'ANTHROPIC_MODEL_SUPPORTED_CAPABILITIES',
      presetEnv.ANTHROPIC_MODEL_SUPPORTED_CAPABILITIES,
      explicitImageSupportOverride(provider, mainModel),
    )
    addCapabilityEnv(
      roleCapabilities,
      'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
      presetEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES,
      explicitImageSupportOverride(provider, provider.models.haiku),
    )
    addCapabilityEnv(
      roleCapabilities,
      'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
      presetEnv.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES,
      explicitImageSupportOverride(provider, provider.models.sonnet),
    )
    addCapabilityEnv(
      roleCapabilities,
      'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
      presetEnv.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES,
      explicitImageSupportOverride(provider, provider.models.opus),
    )

    return {
      ...presetEnv,
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_API_KEY: needsProxy
        ? process.env.SERVER_AUTH_TOKEN || 'proxy-managed'
        : provider.apiKey,
      ANTHROPIC_MODEL: mainModel,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: provider.models.haiku || mainModel,
      ANTHROPIC_DEFAULT_SONNET_MODEL: provider.models.sonnet || mainModel,
      ANTHROPIC_DEFAULT_OPUS_MODEL: provider.models.opus || mainModel,
      [CYBERCODE_PROVIDER_BASE_URL_ENV]: provider.baseUrl,
      [CYBERCODE_PROVIDER_ID_ENV]: provider.id,
      ...roleCapabilities,
      ...(Object.keys(modelContextWindowMap).length > 0
        ? { [CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV]: JSON.stringify(modelContextWindowMap) }
        : {}),
    }
  }

  getProviderRoleContextWindows(provider: SavedProvider): ModelContextWindows {
    const presetWindows = getPresetDefaultContextWindows(provider.presetId)
    const presetModels = getPresetDefaultModels(provider.presetId)
    const userWindows = provider.modelContextWindows ?? {}
    const resolved: ModelContextWindows = {}

    for (const role of MODEL_ROLES) {
      const userValue = parseContextWindowTokenValue(userWindows[role])
      const exactPresetValue = parseContextWindowTokenValue(
        getPresetModelContextWindow(provider.presetId, provider.models[role]),
      )
      const rolePresetValue =
        !presetModels || presetModels[role]?.trim() === provider.models[role]?.trim()
          ? parseContextWindowTokenValue(presetWindows[role])
          : undefined
      const inferredValue = inferContextWindowFromModelName(provider.models[role])
      const contextWindow =
        userValue ??
        exactPresetValue ??
        rolePresetValue ??
        inferredValue
      if (contextWindow) resolved[role] = contextWindow
    }

    return resolved
  }

  getProviderModelContextWindowMap(provider: SavedProvider): Record<string, number> {
    const roleMap = buildModelContextWindowMap(
      provider.models as ModelMapping,
      this.getProviderRoleContextWindows(provider),
    )
    for (const model of provider.modelCatalog ?? []) {
      const contextWindow = parseContextWindowTokenValue(model.contextWindow)
      if (!contextWindow) continue
      const existing = roleMap[model.id]
      roleMap[model.id] = existing ? Math.min(existing, contextWindow) : contextWindow
    }
    return roleMap
  }

  async getProviderRuntimeEnv(id: string, modelId?: string): Promise<Record<string, string>> {
    const provider = await this.getProvider(id)
    return this.buildManagedEnv(provider, {
      proxyPath: `/proxy/providers/${provider.id}`,
      modelId,
    })
  }

  private async syncToSettings(provider: SavedProvider): Promise<void> {
    const settings = await this.readSettings()
    this.applyProviderManagedRuntimeSettings(settings, provider)
    await this.writeSettings(settings)
  }

  private applyProviderManagedRuntimeSettings(
    settings: Record<string, unknown>,
    provider: SavedProvider,
  ): void {
    const existingEnv = (settings.env as Record<string, string>) || {}
    const cleanedEnv = { ...existingEnv }
    const runtimeModel = resolveProviderManagedModel(settings, provider, existingEnv)
    const managedEnv = this.buildManagedEnv(provider, { modelId: runtimeModel })

    for (const key of getManagedEnvKeys()) {
      delete cleanedEnv[key]
    }

    settings.env = {
      ...cleanedEnv,
      ...managedEnv,
    }
    settings.model = managedEnv.ANTHROPIC_MODEL
    delete settings.modelContext
  }

  private async clearProviderFromSettings(): Promise<void> {
    const settings = await this.readSettings()
    const env = (settings.env as Record<string, string>) || {}

    for (const key of getManagedEnvKeys()) {
      delete env[key]
    }

    settings.env = env
    if (Object.keys(env).length === 0) {
      delete settings.env
    }

    await this.writeSettings(settings)
  }

  // --- Auth status ---

  /**
   * Check whether any usable auth exists:
   *  1. A cybercode provider is active → has auth
   *  2. Original ~/.cyber/settings.json has ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY → has auth
   *  3. process.env already has ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN → has auth
   *  4. None of the above → needs setup
   */
  async checkAuthStatus(): Promise<{
    hasAuth: boolean
    source: 'cybercode-provider' | 'original-settings' | 'env' | 'none'
    activeProvider?: string
  }> {
    // 1. Check cybercode active provider
    const index = await this.readIndex()
    if (index.activeId) {
      const provider = index.providers.find(p => p.id === index.activeId)
      const preset = provider
        ? PROVIDER_PRESETS.find(item => item.id === provider.presetId)
        : undefined
      if (provider && (provider.apiKey || preset?.needsApiKey === false)) {
        return { hasAuth: true, source: 'cybercode-provider', activeProvider: provider.name }
      }
    }

    // 2. Check process.env (covers .env file + inherited env)
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
      return { hasAuth: true, source: 'env' }
    }

    // 3. Check original ~/.cyber/settings.json
    try {
      const originalPath = path.join(this.getConfigDir(), 'settings.json')
      const raw = await fs.readFile(originalPath, 'utf-8')
      const settings = JSON.parse(raw) as { env?: Record<string, string> }
      const env = settings.env ?? {}
      if (env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY) {
        return { hasAuth: true, source: 'original-settings' }
      }
    } catch {
      // File doesn't exist or invalid
    }

    return { hasAuth: false, source: 'none' }
  }

  // --- Proxy support ---

  async getProviderForProxy(providerId?: string): Promise<{
    baseUrl: string
    apiKey: string
    apiFormat: ApiFormat
  } | null> {
    if (providerId) {
      const provider = await this.getProvider(providerId)
      return {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        apiFormat: provider.apiFormat ?? 'anthropic',
      }
    }

    const index = await this.readIndex()
    if (!index.activeId) return null
    const provider = index.providers.find((p) => p.id === index.activeId)
    if (!provider) return null
    return {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      apiFormat: provider.apiFormat ?? 'anthropic',
    }
  }

  async getActiveProviderForProxy(): Promise<{
    baseUrl: string
    apiKey: string
    apiFormat: ApiFormat
  } | null> {
    return this.getProviderForProxy()
  }

  // --- Test ---

  async testProvider(
    id: string,
    overrides?: {
      baseUrl?: string
      modelId?: string
      models?: ModelMapping
      apiFormat?: ApiFormat
    },
  ): Promise<ProviderTestResult> {
    const provider = await this.getProvider(id)
    const baseUrl = overrides?.baseUrl || provider.baseUrl
    const models = normalizeProviderModels(
      overrides?.models ?? {
        ...provider.models,
        main: overrides?.modelId || provider.models.main,
      },
    )
    const modelId = models.main
    const apiFormat = overrides?.apiFormat ?? provider.apiFormat ?? 'anthropic'
    const preset = PROVIDER_PRESETS.find((item) => item.id === provider.presetId)
    const apiKey =
      provider.apiKey ||
      preset?.defaultEnv?.ANTHROPIC_API_KEY ||
      preset?.defaultEnv?.ANTHROPIC_AUTH_TOKEN ||
      (preset?.needsApiKey === false ? 'local-provider' : '')

    if (!baseUrl || !apiKey) {
      return { connectivity: { success: false, latencyMs: 0, error: 'Missing baseUrl or apiKey' } }
    }
    return this.testProviderConfig({
      baseUrl,
      apiKey,
      modelId,
      models,
      presetId: provider.presetId,
      probeImages: false,
      apiFormat,
    })
  }

  async testProviderConfig(input: TestProviderInput): Promise<ProviderTestResult> {
    const format: ApiFormat = input.apiFormat ?? 'anthropic'
    const base = input.baseUrl.replace(/\/+$/, '')
    const apiKey = input.apiKey.trim() || 'local-provider'
    const models = normalizeProviderModels(
      input.models ?? {
        main: input.modelId,
        haiku: input.modelId,
        sonnet: input.modelId,
        opus: input.modelId,
      },
    )
    const groupedModels = new Map<
      string,
      { requestedModel: string; roles: Array<(typeof MODEL_ROLES)[number]> }
    >()
    for (const role of MODEL_ROLES) {
      const requestedModel = normalizeProviderRuntimeModel({
        id: 'provider-test',
        presetId: input.presetId ?? 'custom',
        name: 'Provider test',
        apiKey,
        baseUrl: base,
        apiFormat: format,
        models,
      }, models[role])
      const key = requestedModel.toLowerCase()
      const existing = groupedModels.get(key)
      if (existing) existing.roles.push(role)
      else groupedModels.set(key, { requestedModel, roles: [role] })
    }
    const checks = [...groupedModels.values()]
    const mainCheck = checks.find((check) => check.roles.includes('main')) ?? checks[0]!

    // ── Step 1: Basic connectivity ───────────────────────────
    // Directly call the upstream API to verify URL, key, and model.
    const step1 = await this.testConnectivity(
      base,
      apiKey,
      mainCheck.requestedModel,
      format,
    )
    const modelChecks = [{
      roles: mainCheck.roles,
      requestedModel: mainCheck.requestedModel,
      result: step1,
    }]

    // If connectivity failed, no point running step 2
    if (!step1.success) {
      return { connectivity: step1, modelChecks, allModelsPassed: false }
    }

    const secondaryChecks = await Promise.all(
      checks
        .filter((check) => check !== mainCheck)
        .map(async (check) => ({
          roles: check.roles,
          requestedModel: check.requestedModel,
          result: await this.testConnectivity(base, apiKey, check.requestedModel, format),
        })),
    )
    modelChecks.push(...secondaryChecks)

    const result: ProviderTestResult = {
      connectivity: step1,
      modelChecks,
      allModelsPassed: modelChecks.every((check) => check.result.success),
    }

    // For native Anthropic format, no proxy pipeline to test
    if (format !== 'anthropic') {
      // ── Step 2: Full proxy pipeline ──────────────────────────
      // Anthropic request → transform → upstream → transform back → validate
      result.proxy = await this.testProxyPipeline(
        base,
        apiKey,
        mainCheck.requestedModel,
        format,
      )
    }

    if (input.probeImages) {
      const imageResolution = await resolveProviderImageSupportDynamically({
        id: 'provider-test',
        presetId: input.presetId ?? 'custom',
        name: 'Provider test',
        apiKey,
        baseUrl: base,
        apiFormat: format,
        models,
        imageSupportMode: 'auto',
      }, mainCheck.requestedModel, { timeoutMs: 8_000 })
      result.imageCapability = {
        modelId: imageResolution.modelId ?? mainCheck.requestedModel,
        status: imageResolution.status,
        source: imageResolution.source,
      }
    }

    return result
  }

  /** Step 1: Direct upstream call to verify connectivity, auth, and model. */
  private async testConnectivity(
    base: string,
    apiKey: string,
    modelId: string,
    format: ApiFormat,
  ): Promise<ProviderTestStepResult> {
    const start = Date.now()
    try {
      const { url, headers, body } = buildDirectTestRequest(base, apiKey, modelId, format)
      let response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })

      let resBody = await response.json().catch(() => null) as Record<string, unknown> | null
      if (
        !response.ok &&
        !('thinking' in body) &&
        isOnlyEnabledThinkingAllowedResponse(resBody)
      ) {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...body,
            thinking: { type: 'enabled' },
          }),
          signal: AbortSignal.timeout(30000),
        })
        resBody = await response.json().catch(() => null) as Record<string, unknown> | null
      }
      const latencyMs = Date.now() - start

      if (!response.ok) {
        let error = `HTTP ${response.status}`
        if (resBody?.error && typeof resBody.error === 'object') {
          error = ((resBody.error as Record<string, unknown>).message as string) || error
        }
        error = explainProviderTestError(base, modelId, error)
        return { success: false, latencyMs, error, modelUsed: modelId, httpStatus: response.status }
      }

      // Validate response structure
      const valid = validateResponseBody(resBody, format)
      if (!valid.ok) {
        return { success: false, latencyMs, error: valid.error, modelUsed: modelId, httpStatus: response.status }
      }

      const modelUsed = valid.model || modelId
      return {
        success: true,
        latencyMs,
        modelUsed,
        modelMatched: modelUsed.trim().toLowerCase() === modelId.trim().toLowerCase(),
        httpStatus: response.status,
      }
    } catch (err: unknown) {
      const latencyMs = Date.now() - start
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return { success: false, latencyMs, error: 'Request timed out (30s)', modelUsed: modelId }
      }
      return { success: false, latencyMs, error: err instanceof Error ? err.message : String(err), modelUsed: modelId }
    }
  }

  /** Step 2: Full proxy pipeline — Anthropic → transform → upstream → transform back → validate. */
  private async testProxyPipeline(
    base: string,
    apiKey: string,
    modelId: string,
    format: 'openai_chat' | 'openai_responses',
  ): Promise<ProviderTestStepResult> {
    const start = Date.now()
    try {
      // Build an Anthropic Messages API request (same shape as what CLI sends)
      const anthropicReq: AnthropicRequest = {
        model: modelId,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      }

      // Transform to OpenAI format
      let upstreamUrl: string
      let transformedBody: unknown
      if (format === 'openai_chat') {
        const isKimi = isKimiBaseUrl(base)
        transformedBody = anthropicToOpenaiChat(anthropicReq, {
          kimiThinking: isKimi,
          preserveReasoningContent: isKimi,
        })
        upstreamUrl = buildOpenAICompatibleUrl(base, 'chat/completions')
      } else {
        transformedBody = anthropicToOpenaiResponses(anthropicReq)
        upstreamUrl = buildOpenAICompatibleUrl(base, 'responses')
      }

      // Call upstream with transformed request
      const response = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(transformedBody),
        signal: AbortSignal.timeout(30000),
      })

      if (!response.ok) {
        const latencyMs = Date.now() - start
        const errText = await response.text().catch(() => '')
        return { success: false, latencyMs, modelUsed: modelId, httpStatus: response.status,
          error: `Upstream HTTP ${response.status}: ${errText.slice(0, 200)}` }
      }

      // Transform response back to Anthropic format
      const responseBody = await response.json()
      const anthropicRes = format === 'openai_chat'
        ? openaiChatToAnthropic(responseBody, modelId)
        : openaiResponsesToAnthropic(responseBody, modelId)

      const latencyMs = Date.now() - start

      // Validate the final Anthropic response
      if (anthropicRes.type !== 'message' || !Array.isArray(anthropicRes.content)) {
        return { success: false, latencyMs, modelUsed: modelId,
          error: 'Proxy transform produced invalid Anthropic response' }
      }

      return { success: true, latencyMs, modelUsed: anthropicRes.model || modelId, httpStatus: response.status }
    } catch (err: unknown) {
      const latencyMs = Date.now() - start
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return { success: false, latencyMs, error: 'Proxy pipeline timed out (30s)', modelUsed: modelId }
      }
      return { success: false, latencyMs, error: err instanceof Error ? err.message : String(err), modelUsed: modelId }
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────

function buildDirectTestRequest(
  base: string,
  apiKey: string,
  modelId: string,
  format: ApiFormat,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const prompt = 'Say "ok" and nothing else.'

  if (format === 'openai_chat') {
    return {
      url: buildOpenAICompatibleUrl(base, 'chat/completions'),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: withProviderSpecificTestDefaults(base, modelId, format, {
        model: modelId,
        max_tokens: 16,
        messages: [{ role: 'user', content: prompt }],
      }),
    }
  }
  if (format === 'openai_responses') {
    return {
      url: buildOpenAICompatibleUrl(base, 'responses'),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: { model: modelId, max_output_tokens: 16, input: [{ type: 'message', role: 'user', content: prompt }] },
    }
  }
  // anthropic
  return {
    url: `${base}/v1/messages`,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: withProviderSpecificTestDefaults(base, modelId, format, {
      model: modelId,
      max_tokens: 16,
      messages: [{ role: 'user', content: prompt }],
    }),
  }
}

function withProviderSpecificTestDefaults(
  base: string,
  modelId: string,
  format: ApiFormat,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (
    format === 'openai_chat' &&
    isKimiK3ModelId(modelId) &&
    isKimiAlwaysOnThinkingModel(modelId, base)
  ) {
    return {
      ...body,
      reasoning_effort: 'max',
    }
  }

  if (
    format !== 'openai_responses' &&
    requiresEnabledThinkingParamForModel(modelId, base)
  ) {
    return {
      ...body,
      thinking: { type: 'enabled' },
    }
  }

  return body
}

function explainProviderTestError(base: string, modelId: string, error: string): string {
  if (!isKimiProviderTarget(modelId, base) || !looksLikeInvalidApiKeyError(error)) {
    return error
  }

  if (isKimiCodeBaseUrl(base)) {
    return [
      'Kimi Code API Key 无效或已过期。',
      '这个接口需要 Kimi For Coding 会员页面生成的 API Key；',
      'Moonshot/Kimi 开放平台的 API Key 不能用于 https://api.kimi.com/coding/。',
      '如果你使用的是开放平台 API Key，请把 API 地址改为 https://api.moonshot.cn，协议选择 OpenAI Chat，并使用 kimi-k2.7-code。',
    ].join(' ')
  }

  if (isKimiBaseUrl(base)) {
    return [
      'Kimi/Moonshot API Key 无效或已过期。',
      '请确认这个 Key 属于当前 API 地址；Kimi For Coding 会员 Key 应使用 https://api.kimi.com/coding/，开放平台 Key 应使用 https://api.moonshot.cn 和 OpenAI Chat 协议。',
    ].join(' ')
  }

  return error
}

function isKimiCodeBaseUrl(base: string): boolean {
  try {
    const host = new URL(base).host.toLowerCase()
    return host === 'api.kimi.com'
  } catch {
    return false
  }
}

function looksLikeInvalidApiKeyError(error: string): boolean {
  return /api\s*key/i.test(error) && /(invalid|expired|无效|过期)/i.test(error)
}

function isOnlyEnabledThinkingAllowedResponse(
  body: Record<string, unknown> | null,
): boolean {
  if (!body) return false
  const text = JSON.stringify(body).toLowerCase()
  return text.includes('invalid thinking') && text.includes('only type=enabled')
}

function validateResponseBody(
  body: Record<string, unknown> | null,
  format: ApiFormat,
): { ok: true; model?: string } | { ok: false; error: string } {
  if (!body) return { ok: false, error: 'Empty response — not a valid API endpoint' }
  if (body.error && typeof body.error === 'object') {
    return { ok: false, error: ((body.error as Record<string, unknown>).message as string) || 'Error in response body' }
  }

  if (format === 'openai_chat') {
    if (!Array.isArray(body.choices) || body.choices.length === 0) {
      return { ok: false, error: 'Response missing choices — not a valid Chat Completions endpoint' }
    }
    return { ok: true, model: (body.model as string) || undefined }
  }
  if (format === 'openai_responses') {
    if (!Array.isArray(body.output)) {
      return { ok: false, error: 'Response missing output — not a valid Responses API endpoint' }
    }
    return { ok: true, model: (body.model as string) || undefined }
  }
  // anthropic
  if (body.type !== 'message' || !Array.isArray(body.content)) {
    return { ok: false, error: 'Not a valid Anthropic Messages endpoint' }
  }
  return { ok: true, model: (body.model as string) || undefined }
}
