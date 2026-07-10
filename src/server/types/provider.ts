/**
 * Provider types — preset-based provider configuration.
 *
 * Providers are stored in ~/.cyber/cybercode/providers.json as a lightweight index.
 * The active provider's env vars are written to ~/.cyber/cybercode/settings.json.
 */

import { z } from 'zod'
import { parseContextWindowTokenValue } from '../../utils/modelContextWindows.js'

const MODEL_ROLES = ['main', 'haiku', 'sonnet', 'opus'] as const

export const ApiFormatSchema = z.enum([
  'anthropic',         // Native Anthropic Messages API (passthrough, no proxy)
  'openai_chat',       // OpenAI Chat Completions /v1/chat/completions
  'openai_responses',  // OpenAI Responses API /v1/responses
])
export type ApiFormat = z.infer<typeof ApiFormatSchema>

export const ImageSupportModeSchema = z.enum(['auto', 'enabled', 'disabled'])
export type ImageSupportMode = z.infer<typeof ImageSupportModeSchema>

export const ModelMappingSchema = z.object({
  main: z.string().trim().min(1),
  haiku: z.string(),
  sonnet: z.string(),
  opus: z.string(),
})

const ContextWindowValueSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === '') return undefined
    return parseContextWindowTokenValue(value)
  },
  z.number().int().positive().optional(),
)

export const ModelContextWindowsSchema = z.object({
  main: ContextWindowValueSchema,
  haiku: ContextWindowValueSchema,
  sonnet: ContextWindowValueSchema,
  opus: ContextWindowValueSchema,
})

export const ProviderModelInfoSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
  supportsImages: z.boolean().optional(),
})

export const SavedProviderSchema = z.object({
  id: z.string(),
  presetId: z.string(),
  name: z.string().min(1),
  apiKey: z.string(),
  baseUrl: z.string(),
  apiFormat: ApiFormatSchema.default('anthropic'),
  models: ModelMappingSchema,
  modelCatalog: z.array(ProviderModelInfoSchema).optional(),
  modelContextWindows: ModelContextWindowsSchema.optional(),
  imageSupportMode: ImageSupportModeSchema.optional(),
  // Legacy boolean from older desktop builds. New writes should use imageSupportMode.
  supportsImages: z.boolean().optional(),
  notes: z.string().optional(),
})

export const ProvidersIndexSchema = z.object({
  activeId: z.string().nullable(),
  providers: z.array(SavedProviderSchema),
})

export const CreateProviderSchema = z.object({
  presetId: z.string().min(1),
  name: z.string().min(1),
  apiKey: z.string(),
  baseUrl: z.string(),
  apiFormat: ApiFormatSchema.default('anthropic'),
  models: ModelMappingSchema,
  modelCatalog: z.array(ProviderModelInfoSchema).optional(),
  modelContextWindows: ModelContextWindowsSchema.optional(),
  imageSupportMode: ImageSupportModeSchema.optional(),
  supportsImages: z.boolean().optional(),
  notes: z.string().optional(),
})

export const UpdateProviderSchema = z.object({
  name: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  apiFormat: ApiFormatSchema.optional(),
  models: ModelMappingSchema.optional(),
  modelCatalog: z.array(ProviderModelInfoSchema).optional(),
  modelContextWindows: ModelContextWindowsSchema.optional(),
  imageSupportMode: ImageSupportModeSchema.optional(),
  supportsImages: z.boolean().optional(),
  notes: z.string().optional(),
})

export const TestProviderSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().default(''),
  modelId: z.string().min(1),
  models: ModelMappingSchema.optional(),
  presetId: z.string().optional(),
  probeImages: z.boolean().optional(),
  apiFormat: ApiFormatSchema.default('anthropic'),
})

// TypeScript types
export type ModelMapping = z.infer<typeof ModelMappingSchema>
export type ModelContextWindows = z.infer<typeof ModelContextWindowsSchema>
export type ProviderModelInfo = z.infer<typeof ProviderModelInfoSchema>
export type SavedProvider = z.infer<typeof SavedProviderSchema>
export type ProvidersIndex = z.infer<typeof ProvidersIndexSchema>
export type CreateProviderInput = z.infer<typeof CreateProviderSchema>
export type UpdateProviderInput = z.infer<typeof UpdateProviderSchema>
export type TestProviderInput = z.infer<typeof TestProviderSchema>

export interface ProviderTestStepResult {
  success: boolean
  latencyMs: number
  error?: string
  modelUsed?: string
  modelMatched?: boolean
  httpStatus?: number
}

export interface ProviderModelCheckResult {
  roles: Array<(typeof MODEL_ROLES)[number]>
  requestedModel: string
  result: ProviderTestStepResult
}

export interface ProviderImageCapabilityResult {
  modelId: string
  status: 'supported' | 'unsupported' | 'unknown'
  source: string
}

export interface ProviderTestResult {
  /** Step 1: Basic connectivity — API reachable, key valid, model exists */
  connectivity: ProviderTestStepResult
  /** Step 2: Proxy pipeline — full Anthropic→OpenAI→Anthropic round-trip (only for openai_* formats) */
  proxy?: ProviderTestStepResult
  /** Connectivity result for every unique configured role model. */
  modelChecks?: ProviderModelCheckResult[]
  /** Main-model image capability resolution when capability probing is requested. */
  imageCapability?: ProviderImageCapabilityResult
  allModelsPassed?: boolean
}
