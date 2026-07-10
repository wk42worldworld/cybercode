import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from './providers.js'
import { get3PModelCapabilityOverride } from './modelSupportOverrides.js'
import {
  CYBERCODE_IMAGE_INPUT_OVERRIDE_ENV,
  CYBERCODE_PROVIDER_BASE_URL_ENV,
  getLearnedImageSupport,
} from './imageCapabilityRegistry.js'

export const IMAGE_INPUT_CAPABILITY = 'images'

function normalizeModelId(modelId: string | undefined): string {
  return (modelId ?? '').trim().replace(/\[(?:1|2)m\]$/i, '')
}

export function inferModelSupportsImages(modelId: string | undefined): boolean | undefined {
  const normalized = normalizeModelId(modelId).toLowerCase()
  if (!normalized) return undefined

  if (/\bmimo-v2\.5-pro\b/.test(normalized)) return false
  if (/\bmimo-v2\.5(?:[:\-]|$)/.test(normalized)) return true

  if (
    /\b(?:vision|vl|v[\.-]?l|image|img|omni|multimodal)\b/.test(normalized) ||
    normalized.includes('gemini') ||
    normalized.includes('gpt-4o') ||
    normalized.includes('gpt-4.1') ||
    normalized.includes('gpt-5') ||
    normalized.includes('kimi-k2') ||
    normalized.includes('kimi-for-coding') ||
    /\bqwen3\.5(?:[:\-]|$)/.test(normalized) ||
    normalized.includes('claude-3') ||
    normalized.includes('claude-4') ||
    normalized.includes('claude-sonnet') ||
    normalized.includes('claude-opus')
  ) {
    return true
  }

  if (
    normalized.includes('deepseek') ||
    normalized.includes('minimax-m3') ||
    normalized.includes('gpt-oss')
  ) {
    return false
  }

  return undefined
}

export function modelSupportsImages(modelId: string | undefined): boolean {
  const normalized = normalizeModelId(modelId)

  const sessionOverride = process.env[CYBERCODE_IMAGE_INPUT_OVERRIDE_ENV]
  if (sessionOverride === 'enabled') return true
  if (sessionOverride === 'disabled') return false

  const override = normalized
    ? get3PModelCapabilityOverride(normalized, IMAGE_INPUT_CAPABILITY)
    : undefined
  if (typeof override === 'boolean') return override

  const learned = getLearnedImageSupport(
    process.env[CYBERCODE_PROVIDER_BASE_URL_ENV] || process.env.ANTHROPIC_BASE_URL,
    normalized,
  )
  if (learned) return learned.status === 'supported'

  const inferred = inferModelSupportsImages(normalized)
  if (typeof inferred === 'boolean') return inferred

  return getAPIProvider() === 'firstParty' && isFirstPartyAnthropicBaseUrl()
}
