// Provider presets inspired by cc-switch (https://github.com/farion1231/cc-switch)
// Original work by Jason Young, MIT License

import { z } from 'zod'

import providerPresetsJson from './providerPresets.json'
import { ApiFormatSchema } from '../types/provider.js'

const ModelMappingSchema = z.object({
  main: z.string(),
  haiku: z.string(),
  sonnet: z.string(),
  opus: z.string(),
})

const ModelContextWindowsSchema = z.object({
  main: z.number().int().positive().optional(),
  haiku: z.number().int().positive().optional(),
  sonnet: z.number().int().positive().optional(),
  opus: z.number().int().positive().optional(),
})

const ProviderModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
  supportsImages: z.boolean().optional(),
})

const ProviderPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string(),
  apiFormat: ApiFormatSchema,
  defaultModels: ModelMappingSchema,
  defaultModelContextWindows: ModelContextWindowsSchema.optional(),
  modelOptions: z.array(ProviderModelOptionSchema).optional(),
  supportsImages: z.boolean().optional(),
  needsApiKey: z.boolean(),
  websiteUrl: z.string(),
  apiKeyUrl: z.string().optional(),
  promoText: z.string().optional(),
  featured: z.boolean().optional(),
  defaultEnv: z.record(z.string(), z.string()).optional(),
})

const ProviderPresetsSchema = z.array(ProviderPresetSchema)

export type ModelMapping = z.infer<typeof ModelMappingSchema>
export type ModelContextWindows = z.infer<typeof ModelContextWindowsSchema>
export type ProviderModelOption = z.infer<typeof ProviderModelOptionSchema>
export type ProviderPreset = z.infer<typeof ProviderPresetSchema>

export const PROVIDER_PRESETS = ProviderPresetsSchema.parse(providerPresetsJson)
