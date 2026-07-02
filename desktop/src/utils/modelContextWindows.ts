import type { ModelContextWindows, ModelMapping } from '../types/provider'

export const MODEL_ROLES = ['main', 'haiku', 'sonnet', 'opus'] as const
export type ModelRole = (typeof MODEL_ROLES)[number]

const MIN_CONTEXT_WINDOW_TOKENS = 1_000

export function parseContextWindowInput(value: string): number | undefined {
  const normalized = value.trim().toLowerCase().replace(/[,_\s]/g, '')
  if (!normalized) return undefined

  const match = normalized.match(/^(\d+(?:\.\d+)?)(k|m)?$/)
  if (!match) return undefined

  const amount = Number.parseFloat(match[1]!)
  if (!Number.isFinite(amount) || amount <= 0) return undefined

  const multiplier =
    match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1
  const tokens = Math.round(amount * multiplier)
  return tokens >= MIN_CONTEXT_WINDOW_TOKENS ? tokens : undefined
}

export function parseContextWindowValue(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= MIN_CONTEXT_WINDOW_TOKENS
      ? Math.round(value)
      : undefined
  }
  return typeof value === 'string' ? parseContextWindowInput(value) : undefined
}

export function inferContextWindowFromModelId(
  model: string | undefined,
): number | undefined {
  const raw = model?.trim()
  if (!raw) return undefined

  const bracketMatch = raw.match(/\[(\d+(?:\.\d+)?)(k|m)\]/i)
  const bracketValue = bracketMatch
    ? parseContextWindowInput(`${bracketMatch[1]}${bracketMatch[2]}`)
    : undefined
  if (bracketValue) return bracketValue

  const tokenMatch = raw.match(
    /(?:^|[-_:/\s])(\d+(?:\.\d+)?)(k|m)(?:$|[-_:/\s])/i,
  )
  return tokenMatch
    ? parseContextWindowInput(`${tokenMatch[1]}${tokenMatch[2]}`)
    : undefined
}

export function formatContextWindowInput(tokens: number | undefined): string {
  if (!tokens || !Number.isFinite(tokens)) return ''
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) {
    return `${tokens / 1_000_000}m`
  }
  if (tokens >= 1_000 && tokens % 1_000 === 0) {
    return `${tokens / 1_000}k`
  }
  return String(tokens)
}

export function compactModelContextWindows(
  contextWindows: ModelContextWindows,
): ModelContextWindows | undefined {
  const compacted: ModelContextWindows = {}
  for (const role of MODEL_ROLES) {
    const value = contextWindows[role]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      compacted[role] = Math.round(value)
    }
  }
  return Object.keys(compacted).length > 0 ? compacted : undefined
}

export function resolveRoleContextWindows(
  models: ModelMapping,
  userWindows: ModelContextWindows | undefined,
  presetWindows: ModelContextWindows | undefined,
): ModelContextWindows {
  const resolved: ModelContextWindows = {}
  for (const role of MODEL_ROLES) {
    const value =
      userWindows?.[role] ??
      presetWindows?.[role] ??
      inferContextWindowFromModelId(models[role])
    if (value) resolved[role] = value
  }
  return resolved
}

export function buildModelContextWindowMap(
  models: ModelMapping,
  contextWindows: ModelContextWindows | undefined,
): Record<string, number> {
  const result: Record<string, number> = {}
  if (!contextWindows) return result

  for (const role of MODEL_ROLES) {
    const modelId = models[role]?.trim()
    const contextWindow = contextWindows[role]
    if (!modelId || !contextWindow) continue
    const existing = result[modelId]
    result[modelId] = existing ? Math.max(existing, contextWindow) : contextWindow
  }

  return result
}
