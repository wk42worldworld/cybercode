const CYBERCODE_PROVIDER_BASE_URL_ENV = 'CYBERCODE_PROVIDER_BASE_URL'

function normalizeThinkingPolicyModel(model: string | undefined): string {
  return (model ?? '')
    .trim()
    .toLowerCase()
    .replace(/\[(1|2)m\]$/i, '')
    .replace(/:(?:\d+(?:k|m)?|[a-z]+)$/i, '')
}

function resolveThinkingPolicyBaseUrl(baseUrl?: string): string {
  return (
    baseUrl ??
    process.env[CYBERCODE_PROVIDER_BASE_URL_ENV] ??
    process.env.ANTHROPIC_BASE_URL ??
    ''
  ).trim()
}

function matchesHost(baseUrl: string | undefined, expected: RegExp): boolean {
  const resolved = resolveThinkingPolicyBaseUrl(baseUrl)
  if (!resolved) return false
  try {
    return expected.test(new URL(resolved).hostname.toLowerCase())
  } catch {
    return expected.test(resolved.toLowerCase())
  }
}

function isKimiCodeEndpoint(baseUrl?: string): boolean {
  const resolved = resolveThinkingPolicyBaseUrl(baseUrl)
  if (!matchesHost(resolved, /(?:^|\.)api\.kimi\.com$/)) return false
  try {
    return /(?:^|\/)coding(?:\/|$)/i.test(new URL(resolved).pathname)
  } catch {
    return /\/coding(?:\/|$)/i.test(resolved)
  }
}

export function isKimiAlwaysOnThinkingModel(
  model: string | undefined,
  baseUrl?: string,
): boolean {
  const normalized = normalizeThinkingPolicyModel(model)
  if (!normalized) return false

  return isKimiCodeEndpoint(baseUrl) &&
    (normalized.includes('kimi-k2.7-code') || normalized === 'kimi-for-coding')
}

function isMiMoThinkingModel(model: string | undefined, baseUrl?: string): boolean {
  const normalized = normalizeThinkingPolicyModel(model)
  if (!normalized) return false

  return matchesHost(baseUrl, /(?:^|\.)xiaomimimo\.com$/) && normalized.includes('mimo-v2')
}

export function isZhipuGlmEnabledThinkingModel(
  model: string | undefined,
  baseUrl?: string,
): boolean {
  const normalized = normalizeThinkingPolicyModel(model)
  if (!normalized) return false

  return matchesHost(baseUrl, /(?:^|\.)bigmodel\.cn$/) && normalized.includes('glm-5')
}

export function requiresEnabledThinkingParamForModel(
  model: string | undefined,
  baseUrl?: string,
): boolean {
  return isKimiAlwaysOnThinkingModel(model, baseUrl) ||
    isZhipuGlmEnabledThinkingModel(model, baseUrl)
}

export function shouldOmitDisabledThinkingForModel(
  model: string | undefined,
  baseUrl?: string,
): boolean {
  return requiresEnabledThinkingParamForModel(model, baseUrl) ||
    isMiMoThinkingModel(model, baseUrl)
}

export function shouldOmitThinkingParamForModel(
  model: string | undefined,
  _baseUrl?: string,
): boolean {
  return false
}
