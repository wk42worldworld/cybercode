import type { ApiFormat } from './provider'

export type ModelMapping = {
  main: string
  haiku: string
  sonnet: string
  opus: string
}

export type ModelContextWindows = Partial<Record<keyof ModelMapping, number>>

export type ProviderPreset = {
  id: string
  name: string
  baseUrl: string
  apiFormat: ApiFormat
  defaultModels: ModelMapping
  defaultModelContextWindows?: ModelContextWindows
  needsApiKey: boolean
  websiteUrl: string
  apiKeyUrl?: string
  promoText?: string
  featured?: boolean
  defaultEnv?: Record<string, string>
}
