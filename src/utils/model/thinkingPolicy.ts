function normalizeThinkingPolicyModel(model: string | undefined): string {
  return (model ?? '')
    .trim()
    .toLowerCase()
    .replace(/\[(1|2)m\]$/i, '')
    .replace(/:(?:\d+(?:k|m)?|[a-z]+)$/i, '')
}

export function isKimiAlwaysOnThinkingModel(model: string | undefined): boolean {
  const normalized = normalizeThinkingPolicyModel(model)
  if (!normalized) return false

  return normalized.includes('kimi-k2.7-code') || normalized === 'kimi-for-coding'
}

function isMiMoThinkingModel(model: string | undefined): boolean {
  const normalized = normalizeThinkingPolicyModel(model)
  if (!normalized) return false

  return normalized.includes('mimo-v2')
}

export function isZhipuGlmEnabledThinkingModel(model: string | undefined): boolean {
  const normalized = normalizeThinkingPolicyModel(model)
  if (!normalized) return false

  return normalized.includes('glm-5')
}

export function requiresEnabledThinkingParamForModel(model: string | undefined): boolean {
  return isKimiAlwaysOnThinkingModel(model) || isZhipuGlmEnabledThinkingModel(model)
}

export function shouldOmitDisabledThinkingForModel(model: string | undefined): boolean {
  return requiresEnabledThinkingParamForModel(model) || isMiMoThinkingModel(model)
}

export function shouldOmitThinkingParamForModel(model: string | undefined): boolean {
  return false
}
