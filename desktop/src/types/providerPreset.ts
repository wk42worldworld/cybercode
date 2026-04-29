import type { ApiFormat } from './provider'

export type ModelMapping = {
  main: string
  haiku: string
  sonnet: string
  opus: string
}

export type ProviderPreset = {
  id: string
  name: string
  baseUrl: string
  apiFormat: ApiFormat
  defaultModels: ModelMapping
  needsApiKey: boolean
  websiteUrl: string
  apiKeyUrl?: string
  promoText?: string
  featured?: boolean
  defaultEnv?: Record<string, string>
}
