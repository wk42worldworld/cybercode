/**
 * Provider Service — preset-based provider configuration
 *
 * Storage: ~/.cyber/cybercode/providers.json (lightweight index)
 * Active provider env vars written to ~/.cyber/cybercode/settings.json
 * (isolated from the original Claude Code's ~/.cyber/settings.json)
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
import { IMAGE_INPUT_CAPABILITY } from '../../utils/model/imageSupport.js'
import { isKimiBaseUrl, isKimiProviderTarget } from '../../utils/model/kimi.js'
import { requiresEnabledThinkingParamForModel } from '../../utils/model/thinkingPolicy.js'

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
  CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV,
] as const

const DEFAULT_INDEX: ProvidersIndex = { activeId: null, providers: [] }
const MODEL_ROLES = ['main', 'haiku', 'sonnet', 'opus'] as const
const KIMI_CODE_PRESET_ID = 'kimi-code'
const KIMI_API_PRESET_ID = 'kimi'
const KIMI_API_FALLBACK_MODEL = 'kimi-k2.6'
const XIAOMI_MIMO_PRESET_ID = 'xiaomimimo'
const XIAOMI_MIMO_UNSUPPORTED_V25_FLASH = 'mimo-v2.5-flash'
const XIAOMI_MIMO_V25_MODEL = 'mimo-v2.5'
const ZHIPU_GLM_PRESET_ID = 'zhipuglm'
const ZHIPU_GLM_UNSUPPORTED_45_AIR = 'glm-4.5-air'
const ZHIPU_GLM_SMALL_MODEL = 'glm-4.7'
function getPresetDefaultEnv(presetId: string): Record<string, string> {
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.defaultEnv ?? {}
}

function getPresetDefaultContextWindows(presetId: string): ModelContextWindows {
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.defaultModelContextWindows ?? {}
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

function mergeCapabilityList(raw: string | undefined, capability: string, enabled: boolean): string {
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

function migrateProviderIndex(index: ProvidersIndex): { index: ProvidersIndex; changed: boolean } {
  let changed = false
  const providers = index.providers.map((provider) => {
    let migrated = provider

    if (isSavedKimiCodeProvider(migrated)) {
      changed = true
      migrated = {
        ...migrated,
        presetId: KIMI_CODE_PRESET_ID,
      }
    }

    if (isSavedKimiApiProviderWithMisplacedCodeModel(migrated)) {
      changed = true
      migrated = {
        ...migrated,
        models: replaceKimiCodeModelsWithApiFallback(migrated.models),
      }
    }

    if (isSavedKimiApiProviderWithLegacyImageSupport(migrated)) {
      changed = true
      const rest = { ...migrated }
      delete rest.supportsImages
      migrated = {
        ...rest,
        imageSupportMode: 'auto',
      }
    }

    if (isSavedXiaomiMiMoProviderWithUnsupportedModels(migrated)) {
      changed = true
      migrated = {
        ...migrated,
        models: replaceUnsupportedXiaomiMiMoModels(migrated.models),
      }
    }

    if (isSavedZhipuGlmProviderWithUnsupportedModels(migrated)) {
      changed = true
      migrated = {
        ...migrated,
        models: replaceUnsupportedZhipuGlmModels(migrated.models),
      }
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

function isSavedKimiApiProviderWithLegacyImageSupport(provider: SavedProvider): boolean {
  return provider.presetId === KIMI_API_PRESET_ID &&
    isKimiBaseUrl(provider.baseUrl) &&
    !isKimiCodeBaseUrl(provider.baseUrl) &&
    provider.imageSupportMode === undefined &&
    provider.supportsImages === false
}

function isSavedKimiApiProviderWithMisplacedCodeModel(provider: SavedProvider): boolean {
  return provider.presetId === KIMI_API_PRESET_ID &&
    isKimiBaseUrl(provider.baseUrl) &&
    !isKimiCodeBaseUrl(provider.baseUrl) &&
    MODEL_ROLES.some((role) => isKimiK27CodeModel(provider.models[role]))
}

function replaceKimiCodeModelsWithApiFallback(models: ModelMapping): ModelMapping {
  const next: ModelMapping = { ...models }
  for (const role of MODEL_ROLES) {
    if (isKimiK27CodeModel(next[role])) {
      next[role] = KIMI_API_FALLBACK_MODEL
    }
  }
  return next
}

function isKimiK27CodeModel(model: string | undefined): boolean {
  const normalized = (model ?? '')
    .trim()
    .toLowerCase()
    .replace(/:(?:\d+(?:k|m)?|[a-z]+)$/i, '')

  return normalized.includes('kimi-k2.7-code')
}

function isSavedXiaomiMiMoProviderWithUnsupportedModels(provider: SavedProvider): boolean {
  return provider.presetId === XIAOMI_MIMO_PRESET_ID &&
    MODEL_ROLES.some((role) => normalizeSavedModel(provider.models[role]) === XIAOMI_MIMO_UNSUPPORTED_V25_FLASH)
}

function replaceUnsupportedXiaomiMiMoModels(models: ModelMapping): ModelMapping {
  const next: ModelMapping = { ...models }
  for (const role of MODEL_ROLES) {
    if (normalizeSavedModel(next[role]) === XIAOMI_MIMO_UNSUPPORTED_V25_FLASH) {
      next[role] = XIAOMI_MIMO_V25_MODEL
    }
  }
  return next
}

function isSavedZhipuGlmProviderWithUnsupportedModels(provider: SavedProvider): boolean {
  return provider.presetId === ZHIPU_GLM_PRESET_ID &&
    MODEL_ROLES.some((role) => normalizeSavedModel(provider.models[role]) === ZHIPU_GLM_UNSUPPORTED_45_AIR)
}

function replaceUnsupportedZhipuGlmModels(models: ModelMapping): ModelMapping {
  const next: ModelMapping = { ...models }
  for (const role of MODEL_ROLES) {
    if (normalizeSavedModel(next[role]) === ZHIPU_GLM_UNSUPPORTED_45_AIR) {
      next[role] = ZHIPU_GLM_SMALL_MODEL
    }
  }
  return next
}

function normalizeSavedModel(model: string | undefined): string {
  return (model ?? '')
    .trim()
    .toLowerCase()
    .replace(/:(?:\d+(?:k|m)?|[a-z]+)$/i, '')
}

function normalizeProviderRuntimeModel(provider: SavedProvider, modelId: string): string {
  if (
    provider.presetId === KIMI_API_PRESET_ID &&
    isKimiBaseUrl(provider.baseUrl) &&
    !isKimiCodeBaseUrl(provider.baseUrl) &&
    isKimiK27CodeModel(modelId)
  ) {
    return KIMI_API_FALLBACK_MODEL
  }

  if (
    provider.presetId === XIAOMI_MIMO_PRESET_ID &&
    normalizeSavedModel(modelId) === XIAOMI_MIMO_UNSUPPORTED_V25_FLASH
  ) {
    return XIAOMI_MIMO_V25_MODEL
  }

  if (
    provider.presetId === ZHIPU_GLM_PRESET_ID &&
    normalizeSavedModel(modelId) === ZHIPU_GLM_UNSUPPORTED_45_AIR
  ) {
    return ZHIPU_GLM_SMALL_MODEL
  }

  return modelId
}

function getProviderRuntimeModelSet(provider: SavedProvider): Set<string> {
  return new Set(
    MODEL_ROLES
      .map((role) => normalizeProviderRuntimeModel(provider, provider.models[role]).trim())
      .filter(Boolean),
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
    await fs.mkdir(dir, { recursive: true })

    const tmpFile = `${filePath}.tmp.${Date.now()}`
    try {
      await fs.writeFile(tmpFile, JSON.stringify(index, null, 2) + '\n', 'utf-8')
      await fs.rename(tmpFile, filePath)
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write providers index: ${err}`)
    }
  }

  private async readSettings(): Promise<Record<string, unknown>> {
    try {
      const raw = await fs.readFile(this.getSettingsPath(), 'utf-8')
      return JSON.parse(raw) as Record<string, unknown>
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw ApiError.internal(`Failed to read settings.json: ${err}`)
    }
  }

  private async writeSettings(settings: Record<string, unknown>): Promise<void> {
    const filePath = this.getSettingsPath()
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const tmpFile = `${filePath}.tmp.${Date.now()}`
    try {
      await fs.writeFile(tmpFile, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
      await fs.rename(tmpFile, filePath)
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write settings.json: ${err}`)
    }
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
    const next = Object.assign({}, current, settings)
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
      models: input.models,
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
      ...(input.apiKey !== undefined && { apiKey: input.apiKey }),
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
      ...(input.apiFormat !== undefined && { apiFormat: input.apiFormat }),
      ...(input.models !== undefined && { models: input.models }),
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
    const supportsImages = resolveProviderImageSupport(provider, mainModel).supportsImages
    const roleCapabilities = {
      ANTHROPIC_MODEL_SUPPORTED_CAPABILITIES: mergeCapabilityList(
        presetEnv.ANTHROPIC_MODEL_SUPPORTED_CAPABILITIES,
        IMAGE_INPUT_CAPABILITY,
        supportsImages,
      ),
      ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES: mergeCapabilityList(
        presetEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES,
        IMAGE_INPUT_CAPABILITY,
        supportsImages,
      ),
      ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES: mergeCapabilityList(
        presetEnv.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES,
        IMAGE_INPUT_CAPABILITY,
        supportsImages,
      ),
      ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES: mergeCapabilityList(
        presetEnv.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES,
        IMAGE_INPUT_CAPABILITY,
        supportsImages,
      ),
    }

    return {
      ...presetEnv,
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_API_KEY: needsProxy ? 'proxy-managed' : provider.apiKey,
      ANTHROPIC_MODEL: mainModel,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: provider.models.haiku,
      ANTHROPIC_DEFAULT_SONNET_MODEL: provider.models.sonnet,
      ANTHROPIC_DEFAULT_OPUS_MODEL: provider.models.opus,
      ...roleCapabilities,
      ...(Object.keys(modelContextWindowMap).length > 0
        ? { [CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV]: JSON.stringify(modelContextWindowMap) }
        : {}),
    }
  }

  getProviderRoleContextWindows(provider: SavedProvider): ModelContextWindows {
    const presetWindows = getPresetDefaultContextWindows(provider.presetId)
    const userWindows = provider.modelContextWindows ?? {}
    const resolved: ModelContextWindows = {}

    for (const role of MODEL_ROLES) {
      const userValue = parseContextWindowTokenValue(userWindows[role])
      const presetValue = parseContextWindowTokenValue(presetWindows[role])
      const inferredValue = inferContextWindowFromModelName(provider.models[role])
      const contextWindow = userValue ?? presetValue ?? inferredValue
      if (contextWindow) resolved[role] = contextWindow
    }

    return resolved
  }

  getProviderModelContextWindowMap(provider: SavedProvider): Record<string, number> {
    return buildModelContextWindowMap(
      provider.models as ModelMapping,
      this.getProviderRoleContextWindows(provider),
    )
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
      if (provider?.apiKey) {
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
    overrides?: { baseUrl?: string; modelId?: string; apiFormat?: ApiFormat },
  ): Promise<ProviderTestResult> {
    const provider = await this.getProvider(id)
    const baseUrl = overrides?.baseUrl || provider.baseUrl
    const modelId = overrides?.modelId || provider.models.main
    const apiFormat = overrides?.apiFormat ?? provider.apiFormat ?? 'anthropic'

    if (!baseUrl || !provider.apiKey) {
      return { connectivity: { success: false, latencyMs: 0, error: 'Missing baseUrl or apiKey' } }
    }
    return this.testProviderConfig({
      baseUrl,
      apiKey: provider.apiKey,
      modelId,
      apiFormat,
    })
  }

  async testProviderConfig(input: TestProviderInput): Promise<ProviderTestResult> {
    const format: ApiFormat = input.apiFormat ?? 'anthropic'
    const base = input.baseUrl.replace(/\/+$/, '')

    // ── Step 1: Basic connectivity ───────────────────────────
    // Directly call the upstream API to verify URL, key, and model.
    const step1 = await this.testConnectivity(base, input.apiKey, input.modelId, format)

    // If connectivity failed, no point running step 2
    if (!step1.success) {
      return { connectivity: step1 }
    }

    // For native Anthropic format, no proxy pipeline to test
    if (format === 'anthropic') {
      return { connectivity: step1 }
    }

    // ── Step 2: Full proxy pipeline ──────────────────────────
    // Anthropic request → transform → upstream → transform back → validate
    const step2 = await this.testProxyPipeline(base, input.apiKey, input.modelId, format)

    return { connectivity: step1, proxy: step2 }
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
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })

      const latencyMs = Date.now() - start
      const resBody = await response.json().catch(() => null) as Record<string, unknown> | null

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

      return { success: true, latencyMs, modelUsed: valid.model || modelId, httpStatus: response.status }
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
        transformedBody = anthropicToOpenaiChat(anthropicReq)
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
  if (format === 'openai_responses' || !isKimiProviderTarget(modelId, base)) {
    if (
      format === 'anthropic' &&
      requiresEnabledThinkingParamForModel(modelId)
    ) {
      return {
        ...body,
        thinking: { type: 'enabled' },
      }
    }

    return body
  }

  return {
    ...body,
    thinking: { type: 'enabled' },
  }
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
      '如果你使用的是开放平台 API Key，请把 API 地址改为 https://api.moonshot.cn/anthropic，并使用 kimi-k2.6。',
    ].join(' ')
  }

  if (isKimiBaseUrl(base)) {
    return [
      'Kimi/Moonshot API Key 无效或已过期。',
      '请确认这个 Key 属于当前 API 地址；Kimi For Coding 会员 Key 应使用 https://api.kimi.com/coding/，开放平台 Key 应使用 https://api.moonshot.cn/anthropic。',
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
