export function isKimiModel(model: string | undefined): boolean {
  const normalized = model?.trim().toLowerCase()
  if (!normalized) return false

  return normalized.includes('kimi') || normalized.includes('moonshot')
}

function normalizeKimiModel(model: string | undefined): string {
  return (model ?? '')
    .trim()
    .toLowerCase()
    .replace(/:(?:\d+(?:k|m)?|[a-z]+)$/i, '')
}

export function isKimiBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false

  try {
    const host = new URL(baseUrl).host.toLowerCase()
    return host === 'kimi.com' ||
      host.endsWith('.kimi.com') ||
      host === 'moonshot.cn' ||
      host.endsWith('.moonshot.cn')
  } catch {
    return false
  }
}

export function isKimiProviderTarget(model: string | undefined, baseUrl = process.env.ANTHROPIC_BASE_URL): boolean {
  return isKimiModel(model) || isKimiBaseUrl(baseUrl)
}

export function isKimiAlwaysOnThinkingModel(model: string | undefined): boolean {
  const normalized = normalizeKimiModel(model)
  if (!normalized) return false

  return normalized.includes('kimi-k2.7-code') || normalized === 'kimi-for-coding'
}

function isMiMoThinkingModel(model: string | undefined): boolean {
  const normalized = normalizeKimiModel(model)
  if (!normalized) return false

  return normalized.includes('mimo-v2')
}

export function shouldOmitDisabledThinkingForModel(model: string | undefined): boolean {
  return isKimiAlwaysOnThinkingModel(model) || isMiMoThinkingModel(model)
}

export function shouldOmitThinkingParamForModel(model: string | undefined): boolean {
  return isKimiAlwaysOnThinkingModel(model)
}
