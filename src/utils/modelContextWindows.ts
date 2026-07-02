export const CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV =
  'CYBERCODE_MODEL_CONTEXT_WINDOWS'

const MIN_CONTEXT_WINDOW_TOKENS = 1_000

let cachedRaw: string | undefined
let cachedMap: Map<string, number> | null = null

export function parseContextWindowTokenValue(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= MIN_CONTEXT_WINDOW_TOKENS
      ? Math.round(value)
      : undefined
  }

  if (typeof value !== 'string') return undefined
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

export function inferContextWindowFromModelName(
  model: string | undefined,
): number | undefined {
  const raw = model?.trim()
  if (!raw) return undefined

  const bracketMatch = raw.match(/\[(\d+(?:\.\d+)?)(k|m)\]/i)
  const bracketValue = bracketMatch
    ? parseContextWindowTokenValue(`${bracketMatch[1]}${bracketMatch[2]}`)
    : undefined
  if (bracketValue) return bracketValue

  const tokenMatch = raw.match(
    /(?:^|[-_:/\s])(\d+(?:\.\d+)?)(k|m)(?:$|[-_:/\s])/i,
  )
  const tokenValue = tokenMatch
    ? parseContextWindowTokenValue(`${tokenMatch[1]}${tokenMatch[2]}`)
    : undefined
  if (tokenValue) return tokenValue

  return undefined
}

export function formatContextWindowLabel(tokens: number | undefined): string {
  if (!tokens || !Number.isFinite(tokens)) return ''
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) {
    return `${tokens / 1_000_000}m`
  }
  if (tokens >= 1_000 && tokens % 1_000 === 0) {
    return `${tokens / 1_000}k`
  }
  return String(tokens)
}

export function buildModelContextWindowMap(
  models: Record<string, string | undefined>,
  contextWindows: Record<string, number | undefined>,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [role, model] of Object.entries(models)) {
    const modelId = model?.trim()
    const contextWindow = contextWindows[role]
    if (!modelId || !contextWindow) continue
    const existing = result[modelId]
    result[modelId] = existing ? Math.max(existing, contextWindow) : contextWindow
  }
  return result
}

export function getContextWindowOverrideForModel(
  model: string,
  raw = process.env[CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV],
): number | undefined {
  const map = parseModelContextWindowMap(raw)
  if (!map || map.size === 0) return undefined

  for (const candidate of getModelKeyCandidates(model)) {
    const match = map.get(candidate)
    if (match) return match
  }

  return undefined
}

function parseModelContextWindowMap(raw: string | undefined): Map<string, number> | null {
  if (raw === cachedRaw) return cachedMap
  cachedRaw = raw
  cachedMap = null

  if (!raw?.trim()) return null

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    const map = new Map<string, number>()
    for (const [key, value] of Object.entries(parsed)) {
      const modelKey = normalizeModelKey(key)
      const contextWindow = parseContextWindowTokenValue(value)
      if (modelKey && contextWindow) {
        map.set(modelKey, contextWindow)
      }
    }

    cachedMap = map
    return map
  } catch {
    return null
  }
}

function getModelKeyCandidates(model: string): string[] {
  const candidates = new Set<string>()
  const raw = model.trim()
  const withoutTier = raw.replace(/:(?:\d+(?:\.\d+)?[km]?|1m)$/i, '')

  for (const candidate of [raw, withoutTier]) {
    const normalized = normalizeModelKey(candidate)
    if (normalized) candidates.add(normalized)
  }

  return [...candidates]
}

function normalizeModelKey(value: string): string {
  return value.trim().toLowerCase()
}
