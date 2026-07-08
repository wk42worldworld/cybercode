import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from './providers.js'
import { get3PModelCapabilityOverride } from './modelSupportOverrides.js'

export const IMAGE_INPUT_CAPABILITY = 'images'

function normalizeModelId(modelId: string | undefined): string {
  const trimmed = (modelId ?? '').trim()
  return trimmed.replace(/:(?:\d+(?:k|m)?|[a-z]+)$/i, '')
}

export function inferModelSupportsImages(modelId: string | undefined): boolean | undefined {
  const normalized = normalizeModelId(modelId).toLowerCase()
  if (!normalized) return undefined

  if (
    /\b(?:vision|vl|v[\.-]?l|image|img|omni|multimodal)\b/.test(normalized) ||
    normalized.includes('gemini') ||
    normalized.includes('gpt-4o') ||
    normalized.includes('gpt-4.1') ||
    normalized.includes('gpt-5') ||
    normalized.includes('kimi-k2') ||
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
    normalized.includes('mimo-') ||
    normalized.includes('gpt-oss') ||
    /\bqwen3(?:[.\-]|$)/.test(normalized)
  ) {
    return false
  }

  return undefined
}

export function modelSupportsImages(modelId: string | undefined): boolean {
  const normalized = normalizeModelId(modelId)
  const override = normalized
    ? get3PModelCapabilityOverride(normalized, IMAGE_INPUT_CAPABILITY)
    : undefined
  if (typeof override === 'boolean') return override

  const inferred = inferModelSupportsImages(normalized)
  if (typeof inferred === 'boolean') return inferred

  return getAPIProvider() === 'firstParty' && isFirstPartyAnthropicBaseUrl()
}
