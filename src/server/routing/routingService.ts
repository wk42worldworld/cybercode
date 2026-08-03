import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV } from '../../utils/modelContextWindows.js'
import { IMAGE_INPUT_CAPABILITY } from '../../utils/model/imageSupport.js'
import {
  CYBERCODE_LOCAL_MODEL_PERFORMANCE_ENV,
  isLocalInferenceProvider,
} from '../../utils/localModelPerformance.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import { ApiError } from '../middleware/errorHandler.js'
import { ProviderService } from '../services/providerService.js'
import { resolveProviderImageSupport } from '../services/modelImageSupport.js'
import type { SavedProvider } from '../types/provider.js'
import {
  buildRoutingSource,
  getRouteTargetCost,
  getSourceMetadata,
  isFreeRouteTarget,
  isProviderRuntimeRoutable,
} from './sourceCatalog.js'
import {
  compileRouteGraph,
  legacyRouteToGraph,
  previewRouteGraph,
  routeGraphImplicitJudgeAttempts,
  routeGraphModelAttemptLimit,
  validateRouteGraph,
  withLegacyGraph,
} from './graphService.js'
import {
  isRouteAgentV3Node,
  RouteGraphSchema,
  RoutePreviewSampleSchema,
  RoutingConfigSchema,
  type RouteDistributionMode,
  type RouteGraph,
  type RouteGraphEdge,
  type RouteGraphNode,
  type RouteGraphPreviewTrace,
  type RouteGraphValidationIssue,
  type RouteGraphValidationResult,
  type RoutePreviewSample,
  type RouteHealthSnapshot,
  type RouteProfile,
  type RoutingConfig,
  type RoutingDashboard,
  type RoutingEvent,
  type RoutingStrategy,
  type SourceCostClass,
} from './types.js'

type HealthState = {
  requests: number
  successes: number
  failures: number
  latencyTotalMs: number
  consecutiveFailures: number
  cooldownUntil?: number
  lastUsedAt?: number
  lastError?: string
}

export type ResolvedRouteTarget = {
  provider: SavedProvider
  modelId: string
  contextWindow?: number
  cost: SourceCostClass
}

type Candidate = ResolvedRouteTarget & {
  key: string
  costRank: number
  riskRank: number
  priority: number
  weight: number
  health: HealthState
}

type RequestShape = {
  model?: string
  max_tokens?: number
  system?: unknown
  messages?: Array<{ role?: string; content?: unknown }>
  tools?: unknown[]
}

export type ResolvedRouteGraphPlan = {
  graph: RouteGraph
  graphHash: string
  maxModelAttempts: number
  modelTargets: Record<string, ResolvedRouteTarget[]>
  agentTargets: Record<string, ResolvedRouteTarget[]>
  eligibleAgentBranches: Record<string, string[]>
  eligibleAgentOutputs: Record<string, string[]>
  judgeTargets: Record<string, ResolvedRouteTarget[]>
  distributionOrders: Record<string, string[]>
  relayOrders: Record<string, string[]>
  conditionSample: RoutePreviewSample
}

export type ResolvedRoutePlan = {
  profile: RouteProfile
  fingerprint: string
  targets: ResolvedRouteTarget[]
  graphPlan?: ResolvedRouteGraphPlan
}

function createHealthState(): HealthState {
  return {
    requests: 0,
    successes: 0,
    failures: 0,
    latencyTotalMs: 0,
    consecutiveFailures: 0,
  }
}

const DEFAULT_CONFIG: RoutingConfig = {
  version: 1,
  enabled: true,
  profiles: [],
}

const LEGACY_BUILT_IN_ROUTES = new Map<string, {
  name: string
  strategy: RoutingStrategy
  strictFree: boolean
}>([
  ['balanced', { name: 'Balanced', strategy: 'auto', strictFree: false }],
  ['coding-first', { name: 'Coding first', strategy: 'headroom', strictFree: false }],
  ['free-first', { name: 'Free first', strategy: 'cost-optimized', strictFree: true }],
  ['fastest', { name: 'Fastest', strategy: 'p2c', strictFree: false }],
  ['stable', { name: 'Stable', strategy: 'lkgp', strictFree: false }],
])

const PROVIDER_PRESET_BY_ID = new Map(PROVIDER_PRESETS.map((preset) => [preset.id, preset]))
const RETRYABLE_STATUS = new Set([400, 401, 402, 403, 404, 408, 409, 413, 422, 425, 429])
const HEALTH_COOLDOWN_MS = 60_000
const PIN_TTL_MS = 60 * 60_000
const MAX_EVENTS = 100

function candidateKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

function costRank(cost: ReturnType<typeof getSourceMetadata>['cost']): number {
  switch (cost) {
    case 'uncapped': return 0
    case 'recurring-free': return 1
    case 'signup-credit': return 2
    case 'mixed': return 3
    case 'paid': return 4
    default: return 3
  }
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function isToolResultOnly(content: unknown): boolean {
  return Array.isArray(content) && content.length > 0 && content.every((block) => (
    block && typeof block === 'object' && (block as { type?: unknown }).type === 'tool_result'
  ))
}

function turnFingerprint(body: RequestShape): string {
  const messages = body.messages ?? []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user' || isToolResultOnly(message.content)) continue
    return `${index}:${stableHash(JSON.stringify(message.content)).toString(36)}`
  }
  return stableHash(JSON.stringify(messages)).toString(36)
}

function requestContainsImage(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(requestContainsImage)
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.type === 'image' || record.type === 'image_url' || record.type === 'input_image') {
    return true
  }
  return Object.values(record).some(requestContainsImage)
}

function countImageInputs(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countImageInputs(item), 0)
  }
  if (!value || typeof value !== 'object') return 0
  const record = value as Record<string, unknown>
  if (record.type === 'image' || record.type === 'image_url' || record.type === 'input_image') {
    return 1
  }
  return Object.values(record).reduce<number>(
    (count, item) => count + countImageInputs(item),
    0,
  )
}

function withoutImagePayloads(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutImagePayloads)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record.type === 'image' || record.type === 'image_url' || record.type === 'input_image') {
    return { type: record.type }
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, withoutImagePayloads(item)]),
  )
}

function estimateRequestTokens(body: RequestShape): number {
  const input = { system: body.system, messages: body.messages, tools: body.tools }
  const textSize = JSON.stringify(withoutImagePayloads(input)).length
  const estimatedInput = Math.ceil(textSize / 3.2) + countImageInputs(input) * 2_000
  const maxOutput = typeof body.max_tokens === 'number' ? body.max_tokens : 4096
  return estimatedInput + maxOutput
}

function collectRequestText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(collectRequestText).join('\n')
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  return Object.values(record).map(collectRequestText).join('\n')
}

function requestContainsAudio(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(requestContainsAudio)
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.type === 'audio' || record.type === 'input_audio') return true
  return Object.values(record).some(requestContainsAudio)
}

function inferRequestTask(body: RequestShape): RoutePreviewSample['task'] {
  if (requestContainsImage(body.messages)) return 'vision'
  if (requestContainsAudio(body.messages)) return 'audio'
  const text = collectRequestText(body.messages).toLocaleLowerCase()
  if (/\b(code|coding|bug|function|class|typescript|javascript|python|rust|golang|compile|test)\b/.test(text)) {
    return 'coding'
  }
  if (/\b(reason|prove|analy[sz]e|derive|logic|math|trade-?off)\b/.test(text)) {
    return 'reasoning'
  }
  return 'general'
}

function requestPreviewSample(
  body: RequestShape,
  sessionId: string,
): RoutePreviewSample {
  const modalities: NonNullable<RoutePreviewSample['modalities']> = ['text']
  if (requestContainsImage(body.messages)) modalities.push('image')
  if (requestContainsAudio(body.messages)) modalities.push('audio')
  return {
    sessionId,
    task: inferRequestTask(body),
    modalities,
    contextTokens: estimateRequestTokens(body),
    hasTools: Boolean(body.tools?.length),
  }
}

function averageLatency(health: HealthState): number {
  return health.successes > 0 ? health.latencyTotalMs / health.successes : Number.POSITIVE_INFINITY
}

function normalizeLegacyBuiltInRoutes(config: RoutingConfig): {
  config: RoutingConfig
  changed: boolean
} {
  let changed = false
  const profiles = config.profiles.map((profile) => {
    const legacyRoute = LEGACY_BUILT_IN_ROUTES.get(profile.id)
    const stillUsesLegacyTargets = profile.targets.every((target) => !target.modelId)
    if (
      !legacyRoute ||
      profile.name !== legacyRoute.name ||
      !stillUsesLegacyTargets ||
      (
        profile.strategy === legacyRoute.strategy &&
        profile.strictFree === legacyRoute.strictFree
      )
    ) {
      return profile
    }

    changed = true
    return {
      ...profile,
      strategy: legacyRoute.strategy,
      strictFree: legacyRoute.strictFree,
    }
  })

  return {
    config: changed ? { ...config, profiles } : config,
    changed,
  }
}

function ensureRouteGraphs(config: RoutingConfig): {
  config: RoutingConfig
  changed: boolean
} {
  let changed = false
  const profiles = config.profiles.map((profile) => {
    const migrated = withLegacyGraph(profile)
    if (migrated !== profile) changed = true
    return migrated
  })
  return {
    config: changed ? { ...config, profiles } : config,
    changed,
  }
}

function weightedOrder(candidates: Candidate[]): Candidate[] {
  const remaining = [...candidates]
  const ordered: Candidate[] = []
  while (remaining.length > 0) {
    const total = remaining.reduce((sum, candidate) => sum + candidate.weight, 0)
    let cursor = Math.random() * total
    let picked = 0
    for (let index = 0; index < remaining.length; index += 1) {
      cursor -= remaining[index]!.weight
      if (cursor <= 0) {
        picked = index
        break
      }
    }
    ordered.push(remaining.splice(picked, 1)[0]!)
  }
  return ordered
}

function randomOrder(candidates: Candidate[]): Candidate[] {
  const result = [...candidates]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!]
  }
  return result
}

export class RoutingService {
  private providerService = new ProviderService()
  private health = new Map<string, HealthState>()
  private events: RoutingEvent[] = []
  private roundRobinCursor = new Map<string, number>()
  private lastKnownGood = new Map<string, string>()
  private pins = new Map<string, { candidateKey: string; touchedAt: number }>()

  private get configPath(): string {
    return path.join(getClaudeConfigHomeDir(), 'cybercode', 'routing.json')
  }

  private async readConfig(): Promise<RoutingConfig> {
    try {
      const parsed = RoutingConfigSchema.parse(
        JSON.parse(await fs.readFile(this.configPath, 'utf-8')),
      )
      const normalized = normalizeLegacyBuiltInRoutes(parsed)
      const graphMigration = ensureRouteGraphs(normalized.config)
      if (normalized.changed || graphMigration.changed) {
        await this.writeConfig(graphMigration.config).catch((error) => {
          console.warn('[routing] Could not persist route migration:', error)
        })
      }
      return graphMigration.config
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[routing] Ignoring invalid routing config:', error)
      }
      return structuredClone(DEFAULT_CONFIG)
    }
  }

  private async writeConfig(config: RoutingConfig): Promise<void> {
    const parsed = RoutingConfigSchema.parse(config)
    await fs.mkdir(path.dirname(this.configPath), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
        encoding: 'utf-8',
        mode: 0o600,
      })
      await fs.rename(temporaryPath, this.configPath)
      await fs.chmod(this.configPath, 0o600).catch(() => {})
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {})
      throw error
    }
  }

  async getConfig(): Promise<RoutingConfig> {
    return this.readConfig()
  }

  async updateConfig(input: unknown): Promise<RoutingConfig> {
    const current = await this.readConfig()
    const raw = input && typeof input === 'object' ? input as Record<string, unknown> : null
    const prepared = raw && Array.isArray(raw.profiles)
      ? {
          ...raw,
          profiles: raw.profiles.map((entry) => {
            if (!entry || typeof entry !== 'object') return entry
            const profile = entry as Record<string, unknown>
            const existing = current.profiles.find((candidate) => candidate.id === profile.id)
            if (!existing) return profile
            return {
              ...profile,
              ...(!Object.hasOwn(profile, 'graph') && existing.graph
                ? { graph: existing.graph }
                : {}),
              ...(!Object.hasOwn(profile, 'draftGraph') && existing.draftGraph
                ? { draftGraph: existing.draftGraph }
                : {}),
              ...(!Object.hasOwn(profile, 'previousGraph') && existing.previousGraph
                ? { previousGraph: existing.previousGraph }
                : {}),
            }
          }),
        }
      : input
    const parsed = RoutingConfigSchema.parse(prepared)
    // Publish-grade validation for graphs the caller newly introduces or
    // changes. Graphs carried over untouched (the desktop sends full configs
    // on every settings save) or regenerated by legacy migration are exempt.
    if (raw && Array.isArray(raw.profiles)) {
      for (const profile of parsed.profiles) {
        if (!profile.graph) continue
        const rawProfile = raw.profiles.find((entry) => (
          entry && typeof entry === 'object'
          && (entry as Record<string, unknown>).id === profile.id
        )) as Record<string, unknown> | undefined
        if (!rawProfile || !Object.hasOwn(rawProfile, 'graph')) continue
        const existing = current.profiles.find((candidate) => candidate.id === profile.id)
        if (
          existing?.graph
          && JSON.stringify(existing.graph) === JSON.stringify(profile.graph)
        ) continue
        const graphValidation = validateRouteGraph(profile.graph)
        if (!graphValidation.valid) {
          throw ApiError.badRequest(
            graphValidation.issues
              .filter((issue) => issue.severity === 'error')
              .map((issue) => issue.message)
              .join('; '),
          )
        }
      }
    }
    const config = ensureRouteGraphs(parsed).config
    await this.writeConfig(config)
    return this.readConfig()
  }

  async publishDraftGraph(
    profileId: string,
    inputGraph?: unknown,
    inputName?: unknown,
  ): Promise<{
    config: RoutingConfig
    profile: RouteProfile
    validation: RouteGraphValidationResult
  }> {
    const config = await this.readConfig()
    const profileIndex = config.profiles.findIndex((profile) => profile.id === profileId)
    if (profileIndex < 0) throw ApiError.notFound(`Route is unavailable: ${profileId}`)
    const profile = config.profiles[profileIndex]!
    const draftGraph = inputGraph === undefined ? profile.draftGraph : inputGraph
    if (!draftGraph) throw ApiError.badRequest('Route has no draft graph to publish')
    const graph = RouteGraphSchema.parse({
      ...RouteGraphSchema.parse(draftGraph),
      source: 'user',
    })
    const name = inputName === undefined
      ? profile.draftName ?? profile.name
      : z.string().trim().min(1).max(80).parse(inputName)
    const validation = await this.validateProfileGraph(profile, graph)
    if (!validation.valid) {
      throw ApiError.badRequest(
        validation.issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join('; '),
      )
    }
    const nextProfile: RouteProfile = {
      ...profile,
      name,
      draftName: name,
      maxAttempts: routeGraphModelAttemptLimit(graph),
      previousGraph: profile.graph ? structuredClone(profile.graph) : undefined,
      graph: structuredClone(graph),
      draftGraph: structuredClone(graph),
      publishedAt: new Date().toISOString(),
    }
    const nextConfig: RoutingConfig = {
      ...config,
      version: 2,
      profiles: config.profiles.map((entry, index) => (
        index === profileIndex ? nextProfile : entry
      )),
    }
    await this.writeConfig(nextConfig)
    return { config: nextConfig, profile: nextProfile, validation }
  }

  async rollbackGraph(profileId: string): Promise<{
    config: RoutingConfig
    profile: RouteProfile
  }> {
    const config = await this.readConfig()
    const profileIndex = config.profiles.findIndex((profile) => profile.id === profileId)
    if (profileIndex < 0) throw ApiError.notFound(`Route is unavailable: ${profileId}`)
    const profile = config.profiles[profileIndex]!
    if (!profile.previousGraph) {
      throw ApiError.conflict('Route has no previous published graph')
    }
    const restored = structuredClone(profile.previousGraph)
    const validation = await this.validateProfileGraph(profile, restored)
    if (!validation.valid) {
      throw ApiError.conflict(
        `Previous graph is no longer valid: ${validation.issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join('; ')}`,
      )
    }
    const nextProfile: RouteProfile = {
      ...profile,
      maxAttempts: routeGraphModelAttemptLimit(restored),
      graph: restored,
      draftGraph: structuredClone(restored),
      previousGraph: profile.graph ? structuredClone(profile.graph) : undefined,
      publishedAt: new Date().toISOString(),
    }
    const nextConfig: RoutingConfig = {
      ...config,
      version: 2,
      profiles: config.profiles.map((entry, index) => (
        index === profileIndex ? nextProfile : entry
      )),
    }
    await this.writeConfig(nextConfig)
    return { config: nextConfig, profile: nextProfile }
  }

  async previewGraph(
    profileId: string,
    inputGraph?: unknown,
    inputSample?: unknown,
  ): Promise<RouteGraphPreviewTrace> {
    const config = await this.readConfig()
    const profile = config.profiles.find((entry) => entry.id === profileId)
    if (!profile) throw ApiError.notFound(`Route is unavailable: ${profileId}`)
    const graph = inputGraph === undefined
      ? profile.draftGraph ?? profile.graph ?? legacyRouteToGraph(profile)
      : RouteGraphSchema.parse(inputGraph)
    const sample = RoutePreviewSampleSchema.parse(inputSample ?? {})
    const trace = previewRouteGraph(graph, sample, profile.id)
    if (!trace.validation.valid) return trace
    const providerValidation = await this.validateProfileGraph(profile, graph)
    if (providerValidation.issues.length === 0) return trace
    const validation = {
      valid: providerValidation.valid,
      issues: providerValidation.issues,
    }
    return {
      ...trace,
      valid: validation.valid,
      validation,
      warnings: [
        ...trace.warnings,
        ...validation.issues
          .filter((issue) => issue.severity === 'warning')
          .map((issue) => issue.message),
      ],
    }
  }

  async getDashboard(): Promise<RoutingDashboard> {
    const [config, { providers }] = await Promise.all([
      this.readConfig(),
      this.providerService.listProviders(),
    ])
    const sources = []
    for (const preset of PROVIDER_PRESETS) {
      const matches = providers.filter((provider) => provider.presetId === preset.id)
      if (matches.length === 0) sources.push(buildRoutingSource(preset))
      else for (const provider of matches) sources.push(buildRoutingSource(preset, provider))
    }
    for (const provider of providers) {
      if (PROVIDER_PRESET_BY_ID.has(provider.presetId)) continue
      sources.push(buildRoutingSource({
        id: provider.presetId,
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiFormat: provider.apiFormat,
        defaultModels: provider.models,
        defaultModelContextWindows: provider.modelContextWindows,
        supportsImages: provider.supportsImages,
        needsApiKey: true,
        websiteUrl: '',
      }, provider))
    }

    const routeAvailability: RoutingDashboard['routeAvailability'] = {}
    for (const profile of config.profiles) {
      const isPublished = Boolean(profile.graph)
      const candidates = await this.buildRuntimeCandidates(profile, providers, {
        estimatedTokens: 0,
        requiresImages: false,
      })
      const contextWindow = candidates.reduce(
        (largest, candidate) => Math.max(largest, candidate.contextWindow ?? 0),
        0,
      )
      routeAvailability[profile.id] = {
        candidateCount: candidates.length,
        available: config.enabled && profile.enabled && isPublished && candidates.length > 0,
        ...(contextWindow > 0 && { contextWindow }),
        ...(!config.enabled
          ? { reason: 'routing-disabled' }
          : !isPublished
            ? { reason: 'unpublished' }
          : !profile.enabled
            ? { reason: 'profile-disabled' }
            : candidates.length === 0
              ? { reason: profile.strictFree ? 'no-free-candidates' : 'no-candidates' }
              : {}),
      }
    }

    return {
      config,
      sources,
      health: this.getHealthSnapshots(providers),
      events: [...this.events],
      routeAvailability,
    }
  }

  async getRuntimeEnv(routeId: string, sessionId: string): Promise<Record<string, string>> {
    const config = await this.readConfig()
    const profile = config.profiles.find((entry) => entry.id === routeId)
    if (!config.enabled) throw ApiError.conflict('Agent routing is disabled')
    if (!profile?.enabled) throw ApiError.notFound(`Route is unavailable: ${routeId}`)
    if (!profile.graph) throw ApiError.conflict(`Route has not been published: ${routeId}`)

    const { providers } = await this.providerService.listProviders()
    const candidates = await this.buildRuntimeCandidates(profile, providers, {
      estimatedTokens: 0,
      requiresImages: false,
    })
    if (candidates.length === 0) {
      throw ApiError.conflict(
        profile.strictFree
          ? 'This route has no configured free or local source'
          : 'This route has no configured source',
      )
    }

    const runtimeModel = `cybercode-route-${profile.id}`
    const maxContext = candidates.reduce(
      (largest, candidate) => Math.max(largest, candidate.contextWindow ?? 0),
      0,
    )
    const encodedRoute = encodeURIComponent(profile.id)
    const encodedSession = encodeURIComponent(sessionId)

    return {
      ANTHROPIC_BASE_URL:
        `http://127.0.0.1:${ProviderService.getServerPort()}` +
        `/proxy/routes/${encodedRoute}/sessions/${encodedSession}`,
      ANTHROPIC_API_KEY: process.env.SERVER_AUTH_TOKEN || 'routing-managed',
      ANTHROPIC_MODEL: runtimeModel,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: runtimeModel,
      ANTHROPIC_DEFAULT_SONNET_MODEL: runtimeModel,
      ANTHROPIC_DEFAULT_OPUS_MODEL: runtimeModel,
      ...(candidates.every((candidate) =>
        isLocalInferenceProvider(candidate.provider),
      )
        ? { [CYBERCODE_LOCAL_MODEL_PERFORMANCE_ENV]: '1' }
        : {}),
      ...(candidates.some((candidate) => (
        resolveProviderImageSupport(candidate.provider, candidate.modelId).supportsImages
      ))
        ? {
            ANTHROPIC_MODEL_SUPPORTED_CAPABILITIES: IMAGE_INPUT_CAPABILITY,
            ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES: IMAGE_INPUT_CAPABILITY,
            ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES: IMAGE_INPUT_CAPABILITY,
            ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES: IMAGE_INPUT_CAPABILITY,
          }
        : {}),
      ...(maxContext > 0
        ? { [CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV]: JSON.stringify({ [runtimeModel]: maxContext }) }
        : {}),
    }
  }

  async routeSupportsImages(routeId: string): Promise<boolean> {
    const config = await this.readConfig()
    const profile = config.profiles.find((entry) => entry.id === routeId)
    if (!config.enabled || !profile?.enabled || !profile.graph) return false
    const { providers } = await this.providerService.listProviders()
    const candidates = await this.buildRuntimeCandidates(profile, providers, {
      estimatedTokens: 0,
      requiresImages: true,
    })
    return candidates.length > 0
  }

  async resolveAttempts(
    routeId: string,
    sessionId: string,
    body: RequestShape,
  ): Promise<ResolvedRoutePlan> {
    const config = await this.readConfig()
    if (!config.enabled) throw ApiError.conflict('Agent routing is disabled')
    const profile = config.profiles.find((entry) => entry.id === routeId)
    if (!profile?.enabled) throw ApiError.notFound(`Route is unavailable: ${routeId}`)
    if (!profile.graph) throw ApiError.conflict(`Route has not been published: ${routeId}`)

    const { providers } = await this.providerService.listProviders()
    const request = {
      estimatedTokens: estimateRequestTokens(body),
      requiresImages: requestContainsImage(body.messages),
    }
    const candidates = await this.buildRuntimeCandidates(profile, providers, request)
    if (candidates.length === 0) {
      throw ApiError.conflict('No route candidate satisfies this request')
    }

    const fingerprint = turnFingerprint(body)
    const pinKey = `${routeId}:${sessionId}:${fingerprint}`
    this.expirePins()
    const pinned = this.pins.get(pinKey)
    let ordered = this.orderCandidates(profile, candidates, `${sessionId}:${fingerprint}`)
    if (pinned) {
      const pinnedCandidate = ordered.find((candidate) => candidate.key === pinned.candidateKey)
      if (pinnedCandidate) {
        ordered = [pinnedCandidate, ...ordered.filter((candidate) => candidate !== pinnedCandidate)]
      }
    }

    const targets = ordered.slice(0, profile.maxAttempts).map(({
      provider,
      modelId,
      contextWindow,
      cost,
    }) => ({ provider, modelId, contextWindow, cost }))
    const graphPlan = profile.graph
      ? await this.buildGraphPlan(profile, profile.graph, providers, request, sessionId, body, ordered)
      : undefined

    return {
      profile,
      fingerprint,
      targets,
      ...(graphPlan && { graphPlan }),
    }
  }

  recordSuccess(input: {
    routeId: string
    sessionId: string
    fingerprint: string
    target: ResolvedRouteTarget
    latencyMs: number
    attempt: number
    phase?: 'generation' | 'judge' | 'agent-decision'
    nodeId?: string
    inputTokens?: number
    outputTokens?: number
    costUsd?: number
  }): void {
    const key = candidateKey(input.target.provider.id, input.target.modelId)
    const health = this.getHealth(key)
    health.requests += 1
    health.successes += 1
    health.latencyTotalMs += input.latencyMs
    health.consecutiveFailures = 0
    health.cooldownUntil = undefined
    health.lastError = undefined
    health.lastUsedAt = Date.now()
    if (input.phase !== 'agent-decision') {
      this.lastKnownGood.set(input.routeId, key)
      this.pins.set(`${input.routeId}:${input.sessionId}:${input.fingerprint}`, {
        candidateKey: key,
        touchedAt: Date.now(),
      })
    }
    this.pushEvent(input, 'success')
  }

  recordFailure(input: {
    routeId: string
    sessionId: string
    fingerprint: string
    target: ResolvedRouteTarget
    latencyMs: number
    attempt: number
    error: string
    retryable: boolean
    phase?: 'generation' | 'judge' | 'agent-decision'
    nodeId?: string
  }): void {
    const key = candidateKey(input.target.provider.id, input.target.modelId)
    const health = this.getHealth(key)
    health.requests += 1
    health.failures += 1
    health.consecutiveFailures += 1
    health.lastError = input.error.slice(0, 300)
    health.lastUsedAt = Date.now()
    if (input.retryable && health.consecutiveFailures >= 2) {
      health.cooldownUntil = Date.now() + HEALTH_COOLDOWN_MS
    }
    if (input.phase !== 'agent-decision') {
      const pinKey = `${input.routeId}:${input.sessionId}:${input.fingerprint}`
      if (this.pins.get(pinKey)?.candidateKey === key) this.pins.delete(pinKey)
      if (this.lastKnownGood.get(input.routeId) === key) this.lastKnownGood.delete(input.routeId)
    }
    this.pushEvent(input, 'failed')
  }

  isRetryableStatus(status: number): boolean {
    return RETRYABLE_STATUS.has(status) || status >= 500
  }

  resetHealth(): void {
    this.health.clear()
    this.events = []
    this.roundRobinCursor.clear()
    this.lastKnownGood.clear()
    this.pins.clear()
  }

  private graphModelProfile(
    profile: RouteProfile,
    node: Extract<RouteGraphNode, { type: 'model' }>,
  ): RouteProfile {
    return {
      ...profile,
      maxAttempts: Math.min(profile.maxAttempts, node.config.maxAttempts),
      targets: node.config.providerId
        ? [{ providerId: node.config.providerId, modelId: node.config.modelId }]
        : [],
    }
  }

  private graphAgentProfile(
    profile: RouteProfile,
    node: Extract<RouteGraphNode, { type: 'agent' }>,
  ): RouteProfile {
    return {
      ...profile,
      maxAttempts: 1,
      targets: node.config.providerId
        ? [{ providerId: node.config.providerId, modelId: node.config.modelId }]
        : [],
    }
  }

  private async buildRuntimeCandidates(
    profile: RouteProfile,
    providers: SavedProvider[],
    request: { estimatedTokens: number; requiresImages: boolean },
  ): Promise<Candidate[]> {
    if (!profile.graph || profile.graph.source === 'legacy') {
      return this.buildCandidates(profile, providers, request)
    }
    const validation = validateRouteGraph(profile.graph)
    if (!validation.valid) return []
    const candidates = new Map<string, Candidate>()
    for (const node of profile.graph.nodes) {
      if (node.type !== 'model') continue
      const resolved = await this.buildCandidates(
        this.graphModelProfile(profile, node),
        providers,
        request,
      )
      for (const candidate of resolved) candidates.set(candidate.key, candidate)
    }
    return [...candidates.values()]
  }

  private async validateProfileGraph(
    profile: RouteProfile,
    graph: RouteGraph,
  ): Promise<RouteGraphValidationResult> {
    const validation = validateRouteGraph(graph)
    if (!validation.valid) return validation
    const issues: RouteGraphValidationIssue[] = [...validation.issues]
    const { providers } = await this.providerService.listProviders()
    const providerById = new Map(providers.map((provider) => [provider.id, provider]))
    const request = { estimatedTokens: 0, requiresImages: false }

    for (const node of graph.nodes) {
      if (node.type === 'condition' && node.config.field === 'quota') {
        issues.push({
          code: 'condition.quota_unknown',
          message: 'Provider quota may be unavailable; the configured unknown branch will be used',
          severity: 'warning',
          nodeId: node.id,
        })
      }
      if (node.type === 'distribution' && node.config.mode === 'quota') {
        issues.push({
          code: 'distribution.quota_observed',
          message: 'Exact provider quota is unavailable; routing uses observed request fairness',
          severity: 'warning',
          nodeId: node.id,
        })
      }
      if (node.type === 'agent') {
        if (node.config.providerId && !providerById.has(node.config.providerId)) {
          issues.push({
            code: 'agent.provider_missing',
            message: `Agent references a missing provider: ${node.config.providerId}`,
            severity: 'error',
            nodeId: node.id,
          })
          continue
        }
        const candidates = await this.buildCandidates(
          this.graphAgentProfile(profile, node),
          providers,
          request,
        )
        if (candidates.length === 0) {
          issues.push({
            code: 'agent.unavailable',
            message: node.config.providerId
              ? 'Agent decision model is not authenticated, routable, or allowed by this route'
              : 'No authenticated model provider is available for the agent decision',
            severity: 'error',
            nodeId: node.id,
          })
        }
        continue
      }
      if (node.type !== 'model') continue
      if (node.config.providerId && !providerById.has(node.config.providerId)) {
        issues.push({
          code: 'model.provider_missing',
          message: `Model node references a missing provider: ${node.config.providerId}`,
          severity: 'error',
          nodeId: node.id,
        })
        continue
      }
      const candidates = await this.buildCandidates(
        this.graphModelProfile(profile, node),
        providers,
        request,
      )
      if (candidates.length === 0) {
        issues.push({
          code: 'model.unavailable',
          message: node.config.providerId
            ? 'Model provider is not authenticated, routable, or allowed by this route'
            : 'No authenticated model provider is available for this node',
          severity: 'error',
          nodeId: node.id,
        })
      }
    }

    for (const node of graph.nodes) {
      if (node.type !== 'result' || !node.config.judgeProviderId) continue
      const judgeNode: Extract<RouteGraphNode, { type: 'model' }> = {
        id: `${node.id}-judge`,
        type: 'model',
        position: node.position,
        config: {
          providerId: node.config.judgeProviderId,
          modelId: node.config.judgeModelId,
          timeoutMs: 120_000,
          maxAttempts: 1,
        },
      }
      if (!providerById.has(node.config.judgeProviderId)) {
        issues.push({
          code: 'result.judge_provider_missing',
          message: `Judge references a missing provider: ${node.config.judgeProviderId}`,
          severity: 'error',
          nodeId: node.id,
        })
        continue
      }
      const candidates = await this.buildCandidates(
        this.graphModelProfile(profile, judgeNode),
        providers,
        request,
      )
      if (candidates.length === 0) {
        issues.push({
          code: 'result.judge_unavailable',
          message: 'Judge provider is not authenticated, routable, or allowed by this route',
          severity: 'error',
          nodeId: node.id,
        })
      }
    }

    return {
      valid: !issues.some((issue) => issue.severity === 'error'),
      issues,
    }
  }

  private async buildGraphPlan(
    profile: RouteProfile,
    graph: RouteGraph,
    providers: SavedProvider[],
    request: { estimatedTokens: number; requiresImages: boolean },
    sessionId: string,
    body: RequestShape,
    legacyOrdered: Candidate[],
  ): Promise<ResolvedRouteGraphPlan> {
    const validation = validateRouteGraph(graph)
    if (!validation.valid) {
      throw ApiError.conflict(
        `Published route graph is invalid: ${validation.issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join('; ')}`,
      )
    }
    const compiled = compileRouteGraph(graph)
    const nodeCandidates = new Map<string, Candidate[]>()
    const modelTargets: Record<string, ResolvedRouteTarget[]> = {}
    for (const node of graph.nodes) {
      if (node.type !== 'model') continue
      let candidates = await this.buildCandidates(
        this.graphModelProfile(profile, node),
        providers,
        request,
      )
      if (!node.config.providerId) {
        candidates = legacyOrdered
      } else if (candidates.length > 1) {
        candidates = this.orderCandidates(
          this.graphModelProfile(profile, node),
          candidates,
          `${sessionId}:${node.id}`,
        )
      }
      candidates = candidates.slice(0, node.config.maxAttempts)
      nodeCandidates.set(node.id, candidates)
      modelTargets[node.id] = candidates.map(({ provider, modelId, contextWindow, cost }) => ({
        provider,
        modelId,
        contextWindow,
        cost,
      }))
    }

    const judgeTargets: Record<string, ResolvedRouteTarget[]> = {}
    for (const node of graph.nodes) {
      if (node.type !== 'result' || !node.config.judgeProviderId) continue
      const judgeNode: Extract<RouteGraphNode, { type: 'model' }> = {
        id: `${node.id}-judge`,
        type: 'model',
        position: node.position,
        config: {
          providerId: node.config.judgeProviderId,
          modelId: node.config.judgeModelId,
          timeoutMs: 120_000,
          maxAttempts: 1,
        },
      }
      const candidates = await this.buildCandidates(
        this.graphModelProfile(profile, judgeNode),
        providers,
        request,
      )
      judgeTargets[node.id] = candidates.slice(0, 1).map(({
        provider,
        modelId,
        contextWindow,
        cost,
      }) => ({ provider, modelId, contextWindow, cost }))
    }

    const agentTargets: Record<string, ResolvedRouteTarget[]> = {}
    for (const node of graph.nodes) {
      if (node.type !== 'agent') continue
      let candidates = node.config.providerId
        ? await this.buildCandidates(this.graphAgentProfile(profile, node), providers, request)
        : legacyOrdered
      if (node.config.providerId && candidates.length > 1) {
        candidates = this.orderCandidates(
          this.graphAgentProfile(profile, node),
          candidates,
          `${sessionId}:${node.id}:agent-decision`,
        )
      }
      agentTargets[node.id] = candidates.slice(0, 1).map(({
        provider,
        modelId,
        contextWindow,
        cost,
      }) => ({ provider, modelId, contextWindow, cost }))
    }

    const branchHasRunnableModel = (startId: string): boolean => {
      const seen = new Set<string>()
      const queue = [startId]
      while (queue.length > 0) {
        const nodeId = queue.shift()!
        if (seen.has(nodeId)) continue
        seen.add(nodeId)
        if ((modelTargets[nodeId]?.length ?? 0) > 0) return true
        for (const edge of compiled.outgoing.get(nodeId) ?? []) queue.push(edge.target)
      }
      return false
    }
    const eligibleAgentBranches: Record<string, string[]> = {}
    const eligibleAgentOutputs: Record<string, string[]> = {}
    for (const node of graph.nodes) {
      if (node.type !== 'agent') continue
      const eligibleEdges = (compiled.outgoing.get(node.id) ?? [])
        .filter((edge) => (
          edge.kind === 'choice' &&
          branchHasRunnableModel(edge.target)
        ))
      if (isRouteAgentV3Node(node)) {
        eligibleAgentOutputs[node.id] = eligibleEdges
          .map((edge) => edge.sourcePortId)
          .filter((portId): portId is string => Boolean(portId))
      } else {
        eligibleAgentBranches[node.id] = eligibleEdges
          .map((edge) => edge.branchId)
          .filter((branchId): branchId is string => Boolean(branchId))
      }
    }

    const firstCandidate = (startId: string): Candidate | undefined => {
      const seen = new Set<string>()
      const queue = [startId]
      while (queue.length > 0) {
        const nodeId = queue.shift()!
        if (seen.has(nodeId)) continue
        seen.add(nodeId)
        const candidate = nodeCandidates.get(nodeId)?.[0]
        if (candidate) return candidate
        for (const edge of compiled.outgoing.get(nodeId) ?? []) queue.push(edge.target)
      }
      return undefined
    }
    const orderedEdges = (edges: RouteGraphEdge[]): RouteGraphEdge[] => (
      [...edges].sort((left, right) => (
        (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)
      ))
    )
    const weightedEdges = (edges: RouteGraphEdge[]): RouteGraphEdge[] => {
      const remaining = orderedEdges(edges)
      const ordered: RouteGraphEdge[] = []
      while (remaining.length > 0) {
        const total = remaining.reduce((sum, edge) => sum + (edge.weight ?? 1), 0)
        let cursor = Math.random() * total
        let selected = 0
        for (let index = 0; index < remaining.length; index += 1) {
          cursor -= remaining[index]!.weight ?? 1
          if (cursor <= 0) {
            selected = index
            break
          }
        }
        ordered.push(remaining.splice(selected, 1)[0]!)
      }
      return ordered
    }
    const distributionOrders: Record<string, string[]> = {}
    for (const node of graph.nodes) {
      if (node.type !== 'distribution') continue
      const edges = compiled.outgoing.get(node.id) ?? []
      let ordered = orderedEdges(edges)
      const legacyStrategy = typeof node.config.legacyStrategy === 'string'
        ? node.config.legacyStrategy as RoutingStrategy
        : undefined
      if (graph.source === 'legacy' && legacyStrategy) {
        const rank = new Map(legacyOrdered.map((candidate, index) => [candidate.key, index]))
        ordered.sort((left, right) => (
          (rank.get(firstCandidate(left.target)?.key ?? '') ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(firstCandidate(right.target)?.key ?? '') ?? Number.MAX_SAFE_INTEGER)
        ))
      } else if (node.config.mode === 'weighted') {
        ordered = weightedEdges(edges)
      } else if (node.config.mode === 'round-robin') {
        const cursorKey = `${profile.id}:${node.id}`
        const cursor = this.roundRobinCursor.get(cursorKey) ?? 0
        this.roundRobinCursor.set(cursorKey, (cursor + 1) % Math.max(ordered.length, 1))
        ordered = [...ordered.slice(cursor), ...ordered.slice(0, cursor)]
      } else {
        ordered.sort((left, right) => {
          const leftCandidate = firstCandidate(left.target)
          const rightCandidate = firstCandidate(right.target)
          if (!leftCandidate || !rightCandidate) return leftCandidate ? -1 : rightCandidate ? 1 : 0
          return this.compareDistributionCandidates(
            node.config.mode,
            leftCandidate,
            rightCandidate,
          )
        })
      }
      distributionOrders[node.id] = ordered.map((edge) => edge.id)
    }

    const relayOrders: Record<string, string[]> = {}
    for (const node of graph.nodes) {
      if (node.type !== 'relay') continue
      const edges = orderedEdges(compiled.outgoing.get(node.id) ?? [])
      if (node.config.mode === 'sticky' && edges.length > 0) {
        const cursor = stableHash(`${profile.id}:${sessionId}:${node.id}`) % edges.length
        relayOrders[node.id] = [...edges.slice(cursor), ...edges.slice(0, cursor)]
          .map((edge) => edge.id)
      } else {
        relayOrders[node.id] = edges.sort((left, right) => (
          (firstCandidate(left.target)?.contextWindow ?? Number.MAX_SAFE_INTEGER) -
          (firstCandidate(right.target)?.contextWindow ?? Number.MAX_SAFE_INTEGER)
        )).map((edge) => edge.id)
      }
    }

    const conditionSample = requestPreviewSample(body, sessionId)
    const implicitJudgeAttempts = routeGraphImplicitJudgeAttempts(
      graph,
      conditionSample.hasTools === true,
    )
    return {
      graph,
      graphHash: stableHash(JSON.stringify(graph)).toString(36),
      maxModelAttempts: Math.min(profile.maxAttempts + implicitJudgeAttempts, 8),
      modelTargets,
      agentTargets,
      eligibleAgentBranches,
      eligibleAgentOutputs,
      judgeTargets,
      distributionOrders,
      relayOrders,
      conditionSample,
    }
  }

  private compareDistributionCandidates(
    mode: RouteDistributionMode,
    left: Candidate,
    right: Candidate,
  ): number {
    if (mode === 'quota') {
      return left.health.requests - right.health.requests || left.priority - right.priority
    }
    if (mode === 'cost') {
      return left.costRank - right.costRank || left.priority - right.priority
    }
    if (mode === 'latency') {
      return averageLatency(left.health) - averageLatency(right.health) ||
        left.priority - right.priority
    }
    const successRate = (candidate: Candidate): number => (
      candidate.health.requests > 0
        ? candidate.health.successes / candidate.health.requests
        : 0.75
    )
    return successRate(right) - successRate(left) ||
      left.health.consecutiveFailures - right.health.consecutiveFailures ||
      left.priority - right.priority
  }

  private async buildCandidates(
    profile: RouteProfile,
    providers: SavedProvider[],
    request: { estimatedTokens: number; requiresImages: boolean },
  ): Promise<Candidate[]> {
    const candidates: Candidate[] = []
    const providerById = new Map(providers.map((provider) => [provider.id, provider]))
    const routeEntries = profile.targets.length > 0
      ? profile.targets.flatMap((target, index) => {
          const provider = providerById.get(target.providerId)
          return provider ? [{ provider, target, index }] : []
        })
      : providers.map((provider, index) => ({ provider, target: undefined, index }))

    for (const { provider, target: explicitTarget, index } of routeEntries) {
      const metadata = getSourceMetadata(provider.presetId)
      if (!profile.allowExperimental && metadata.risk !== 'stable') continue
      const preset = PROVIDER_PRESET_BY_ID.get(provider.presetId)
      if (!isProviderRuntimeRoutable(provider, preset)) continue
      const modelId = explicitTarget?.modelId?.trim() || provider.models.main.trim()
      if (!modelId) continue
      if (profile.strictFree && !isFreeRouteTarget(provider.presetId, modelId)) continue
      const contextWindow = this.providerService.getProviderModelContextWindowMap(provider)[modelId]
      if (contextWindow && contextWindow < request.estimatedTokens) continue
      if (
        request.requiresImages &&
        !resolveProviderImageSupport(provider, modelId).supportsImages
      ) continue

      const key = candidateKey(provider.id, modelId)
      const health = this.health.get(key) ?? createHealthState()
      const learnedWeight = health.requests > 0
        ? Math.max(0.25, health.successes / health.requests)
        : 1
      candidates.push({
        provider,
        modelId,
        contextWindow,
        cost: getRouteTargetCost(provider.presetId, modelId),
        key,
        costRank: costRank(getRouteTargetCost(provider.presetId, modelId)),
        riskRank: metadata.risk === 'stable' ? 0 : metadata.risk === 'experimental' ? 1 : 2,
        priority: explicitTarget?.priority ?? index,
        weight: (explicitTarget?.weight ?? 1) * learnedWeight,
        health,
      })
    }

    const available = candidates.filter((candidate) => (
      !candidate.health.cooldownUntil || candidate.health.cooldownUntil <= Date.now()
    ))
    // A health cooldown is advisory. Compatibility filters above are hard and
    // never fail open; when every compatible target is cooling down, retry the
    // one whose cooldown expires first instead of claiming no model exists.
    return available.length > 0
      ? available
      : candidates.sort((left, right) => (
          (left.health.cooldownUntil ?? 0) - (right.health.cooldownUntil ?? 0)
        )).slice(0, 1)
  }

  private orderCandidates(
    profile: RouteProfile,
    candidates: Candidate[],
    seed: string,
  ): Candidate[] {
    const byPriority = () => [...candidates].sort((left, right) => (
      left.priority - right.priority || left.health.failures - right.health.failures
    ))
    const byHealth = () => [...candidates].sort((left, right) => {
      const leftRate = left.health.requests > 0 ? left.health.successes / left.health.requests : 0.75
      const rightRate = right.health.requests > 0 ? right.health.successes / right.health.requests : 0.75
      return rightRate - leftRate || averageLatency(left.health) - averageLatency(right.health)
    })
    const strategy: RoutingStrategy = profile.strategy

    if (strategy === 'weighted') return weightedOrder(candidates)
    if (strategy === 'random' || strategy === 'strict-random') return randomOrder(candidates)
    if (strategy === 'round-robin') {
      const sorted = byPriority()
      const cursor = this.roundRobinCursor.get(profile.id) ?? 0
      this.roundRobinCursor.set(profile.id, (cursor + 1) % sorted.length)
      return [...sorted.slice(cursor), ...sorted.slice(0, cursor)]
    }
    if (strategy === 'context-relay') {
      const sorted = byPriority()
      const cursor = stableHash(seed) % sorted.length
      return [...sorted.slice(cursor), ...sorted.slice(0, cursor)]
    }
    if (strategy === 'least-used') {
      return [...candidates].sort((left, right) => (
        left.health.requests - right.health.requests || left.priority - right.priority
      ))
    }
    if (strategy === 'fill-first') return byPriority()
    if (strategy === 'cost-optimized') {
      return [...candidates].sort((left, right) => (
        left.costRank - right.costRank || averageLatency(left.health) - averageLatency(right.health)
      ))
    }
    if (strategy === 'headroom') {
      return [...candidates].sort((left, right) => (
        (right.contextWindow ?? 0) - (left.contextWindow ?? 0) ||
        averageLatency(left.health) - averageLatency(right.health)
      ))
    }
    if (strategy === 'context-optimized') {
      return [...candidates].sort((left, right) => (
        (left.contextWindow ?? Number.MAX_SAFE_INTEGER) -
        (right.contextWindow ?? Number.MAX_SAFE_INTEGER)
      ))
    }
    if (strategy === 'lkgp') {
      const known = this.lastKnownGood.get(profile.id)
      const sorted = byHealth()
      const match = sorted.find((candidate) => candidate.key === known)
      return match ? [match, ...sorted.filter((candidate) => candidate !== match)] : sorted
    }
    if (strategy === 'p2c') {
      const shuffled = randomOrder(candidates)
      if (shuffled.length < 2) return shuffled
      const best = [shuffled[0]!, shuffled[1]!].sort((left, right) => (
        averageLatency(left.health) - averageLatency(right.health) ||
        left.health.failures - right.health.failures
      ))[0]!
      return [best, ...shuffled.filter((candidate) => candidate !== best)]
    }
    if (strategy === 'reset-aware' || strategy === 'reset-window') {
      return [...candidates].sort((left, right) => (
        left.health.consecutiveFailures - right.health.consecutiveFailures ||
        left.costRank - right.costRank ||
        left.priority - right.priority
      ))
    }
    if (strategy === 'auto') {
      return [...candidates].sort((left, right) => {
        const score = (candidate: Candidate) => {
          const successRate = candidate.health.requests > 0
            ? candidate.health.successes / candidate.health.requests
            : 0.75
          const latencyPenalty = Number.isFinite(averageLatency(candidate.health))
            ? Math.min(averageLatency(candidate.health) / 2000, 2)
            : 0.5
          return successRate * 5 - latencyPenalty - candidate.costRank * 0.35 - candidate.riskRank
        }
        return score(right) - score(left) || left.priority - right.priority
      })
    }
    return byPriority()
  }

  private getHealth(key: string): HealthState {
    const existing = this.health.get(key)
    if (existing) return existing
    const created = createHealthState()
    this.health.set(key, created)
    return created
  }

  private getHealthSnapshots(providers: SavedProvider[]): RouteHealthSnapshot[] {
    const providerById = new Map(providers.map((provider) => [provider.id, provider]))
    const now = Date.now()
    return [...this.health.entries()].flatMap(([key, health]) => {
      if (health.cooldownUntil && health.cooldownUntil <= now) {
        health.cooldownUntil = undefined
      }
      const separator = key.indexOf(':')
      const providerId = key.slice(0, separator)
      const modelId = key.slice(separator + 1)
      const provider = providerById.get(providerId)
      if (!provider) {
        this.health.delete(key)
        return []
      }
      return [{
        providerId,
        providerName: provider.name,
        modelId,
        requests: health.requests,
        successes: health.successes,
        failures: health.failures,
        averageLatencyMs: health.successes > 0
          ? Math.round(health.latencyTotalMs / health.successes)
          : null,
        consecutiveFailures: health.consecutiveFailures,
        ...(health.cooldownUntil && { cooldownUntil: new Date(health.cooldownUntil).toISOString() }),
        ...(health.lastUsedAt && { lastUsedAt: new Date(health.lastUsedAt).toISOString() }),
        ...(health.lastError && { lastError: health.lastError }),
      }]
    }).sort((left, right) => (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? ''))
  }

  private pushEvent(
    input: {
      routeId: string
      sessionId: string
      target: ResolvedRouteTarget
      latencyMs: number
      attempt: number
      error?: string
      phase?: 'generation' | 'judge' | 'agent-decision'
      nodeId?: string
      inputTokens?: number
      outputTokens?: number
      costUsd?: number
    },
    status: RoutingEvent['status'],
  ): void {
    this.events.unshift({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      routeId: input.routeId,
      sessionId: input.sessionId,
      providerId: input.target.provider.id,
      providerName: input.target.provider.name,
      modelId: input.target.modelId,
      status,
      latencyMs: Math.round(input.latencyMs),
      attempt: input.attempt,
      ...(input.phase && { phase: input.phase }),
      ...(input.nodeId && { nodeId: input.nodeId }),
      ...(input.inputTokens !== undefined && { inputTokens: input.inputTokens }),
      ...(input.outputTokens !== undefined && { outputTokens: input.outputTokens }),
      ...(input.costUsd !== undefined && { costUsd: input.costUsd }),
      ...(input.error && { error: input.error.slice(0, 300) }),
    })
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS
  }

  private expirePins(): void {
    const cutoff = Date.now() - PIN_TTL_MS
    for (const [key, value] of this.pins) {
      if (value.touchedAt < cutoff) this.pins.delete(key)
    }
  }
}

export const routingService = new RoutingService()
