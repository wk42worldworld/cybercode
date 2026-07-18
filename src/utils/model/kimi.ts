export function isKimiModel(model: string | undefined): boolean {
  const normalized = model?.trim().toLowerCase().replace(/\[(?:1|2)m\]$/i, '')
  if (!normalized) return false

  return normalized === 'k3' || normalized.includes('kimi') || normalized.includes('moonshot')
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

export {
  isKimiAlwaysOnThinkingModel,
  isKimiK3ModelId,
  shouldOmitDisabledThinkingForModel,
  shouldOmitThinkingParamForModel,
} from './thinkingPolicy.js'
