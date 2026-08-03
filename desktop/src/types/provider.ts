// desktop/src/types/provider.ts

export type ApiFormat = 'anthropic' | 'openai_chat' | 'openai_responses'
export type ImageSupportMode = 'auto' | 'enabled' | 'disabled'

export type ModelMapping = {
  main: string
  haiku: string
  sonnet: string
  opus: string
}

export type ModelContextWindows = Partial<Record<keyof ModelMapping, number>>

export type ProviderModelInfo = {
  id: string
  label?: string
  contextWindow?: number
  supportsImages?: boolean
}

export type ProviderModelSyncState = {
  enabled: boolean
  syncedModelIds: string[]
  lastSyncedAt?: string
  lastSyncError?: string
  endpoint?: string
  supported?: boolean
}

export type SavedProvider = {
  id: string
  presetId: string
  publicAlias?: string
  name: string
  apiKey: string  // masked from server
  oauthProviderId?: string
  baseUrl: string
  apiFormat: ApiFormat
  models: ModelMapping
  modelCatalog?: ProviderModelInfo[]
  modelSync?: ProviderModelSyncState
  modelContextWindows?: ModelContextWindows
  imageSupportMode?: ImageSupportMode
  // Legacy boolean kept for older saved provider records.
  supportsImages?: boolean
  notes?: string
}

export type CreateProviderInput = {
  presetId: string
  publicAlias?: string
  name: string
  apiKey: string
  baseUrl: string
  apiFormat?: ApiFormat
  models: ModelMapping
  modelCatalog?: ProviderModelInfo[]
  modelContextWindows?: ModelContextWindows
  imageSupportMode?: ImageSupportMode
  supportsImages?: boolean
  notes?: string
}

export type UpdateProviderInput = {
  presetId?: string
  publicAlias?: string
  name?: string
  apiKey?: string
  baseUrl?: string
  apiFormat?: ApiFormat
  models?: ModelMapping
  modelCatalog?: ProviderModelInfo[]
  modelContextWindows?: ModelContextWindows
  imageSupportMode?: ImageSupportMode
  supportsImages?: boolean
  notes?: string
}

export type TestProviderConfigInput = {
  baseUrl: string
  apiKey: string
  modelId: string
  models?: ModelMapping
  presetId?: string
  probeImages?: boolean
  apiFormat?: ApiFormat
}

export type ProviderTestStepResult = {
  success: boolean
  latencyMs: number
  error?: string
  modelUsed?: string
  modelMatched?: boolean
  httpStatus?: number
  /** 'lightweight' = local liveness probe, 'deep' = full inference round-trip */
  verificationMethod?: 'lightweight' | 'deep'
}

export type ProviderModelCheckResult = {
  roles: Array<keyof ModelMapping>
  requestedModel: string
  result: ProviderTestStepResult
}

export type ProviderTestResult = {
  /** Step 1: Basic connectivity */
  connectivity: ProviderTestStepResult
  /** Step 2: Proxy pipeline (only for openai_* formats) */
  proxy?: ProviderTestStepResult
  modelChecks?: ProviderModelCheckResult[]
  imageCapability?: {
    modelId: string
    status: 'supported' | 'unsupported' | 'unknown'
    source: string
  }
  allModelsPassed?: boolean
}

export type DiscoverProviderModelsInput = {
  providerId?: string
  presetId?: string
  baseUrl?: string
  apiKey?: string
  apiFormat?: ApiFormat
  force?: boolean
}

export type ProviderModelDiscoveryResult = {
  models: ProviderModelInfo[]
  endpoint: string
  cached: boolean
}

export type ProviderModelSyncResult = {
  endpoint: string
  cached: boolean
  total: number
  added: number
  updated: number
  removed: number
}
