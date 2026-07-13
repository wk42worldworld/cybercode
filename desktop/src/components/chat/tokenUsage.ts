import type { SessionUsageResponse, SessionUsageSnapshot } from '../../api/sessions'
import type { TokenUsage } from '../../types/chat'

type ResolveTokenUsageValuesOptions = {
  liveTurnUsage: TokenUsage
  persistedUsage: SessionUsageSnapshot | null
  persistedContext: SessionUsageResponse['context']
  isTurnActive: boolean
  usageRevision: number
  loadedRevision: number
  contextWindowOverride?: number
}

export type ResolvedTokenUsageValues = {
  turnTotal: number
  sessionTotal: number
  contextTokens: number
  contextWindow: number
  contextPercentage: number | null
  effectiveTurnUsage: TokenUsage
}

export function getTurnTokenTotal(usage: TokenUsage): number {
  return getTurnInputTokenTotal(usage) + usage.output_tokens
}

export function getTurnInputTokenTotal(usage: TokenUsage): number {
  return (
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? usage.cache_read_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? usage.cache_creation_tokens ?? 0)
  )
}

export function getContextTokenTotal(usage: TokenUsage): number {
  return (
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? usage.cache_read_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? usage.cache_creation_tokens ?? 0)
  )
}

export function calculateContextUsagePercent(usedTokens: number, contextWindow: number): number | null {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return null
  const normalizedUsedTokens = Number.isFinite(usedTokens) ? Math.max(0, usedTokens) : 0
  const percentage = (normalizedUsedTokens / contextWindow) * 100
  return Math.min(100, percentage)
}

export function getSessionTokenTotal(usage: SessionUsageSnapshot | null): number {
  if (!usage) return 0
  return (
    usage.totalInputTokens +
    usage.totalOutputTokens +
    usage.totalCacheReadInputTokens +
    usage.totalCacheCreationInputTokens
  )
}

export function resolveTokenUsageValues({
  liveTurnUsage,
  persistedUsage,
  persistedContext,
  isTurnActive,
  usageRevision,
  loadedRevision,
  contextWindowOverride,
}: ResolveTokenUsageValuesOptions): ResolvedTokenUsageValues {
  const liveTurnTotal = getTurnTokenTotal(liveTurnUsage)
  const latestTurn = persistedContext?.latestTurn
  const persistedTurnUsage: TokenUsage | null = latestTurn
    ? {
        input_tokens: latestTurn.inputTokens,
        output_tokens: latestTurn.outputTokens,
        cache_read_input_tokens: latestTurn.cacheReadInputTokens,
        cache_creation_input_tokens: latestTurn.cacheCreationInputTokens,
      }
    : null
  const persistedTurnTotal = persistedTurnUsage ? getTurnTokenTotal(persistedTurnUsage) : 0
  const effectiveTurnUsage = liveTurnTotal > 0 || !persistedTurnUsage
    ? liveTurnUsage
    : persistedTurnUsage
  const includesUnpersistedTurn = isTurnActive || usageRevision > loadedRevision
  const turnTotal = includesUnpersistedTurn || liveTurnTotal > 0
    ? liveTurnTotal
    : persistedTurnTotal
  const sessionTotal = getSessionTokenTotal(persistedUsage) + (includesUnpersistedTurn ? turnTotal : 0)
  const liveContextTokens = getContextTokenTotal(liveTurnUsage)
  const contextTokens = includesUnpersistedTurn && liveContextTokens > 0
    ? liveContextTokens
    : persistedContext?.usedTokens ?? liveContextTokens
  const contextWindow = contextWindowOverride ?? persistedContext?.contextWindow ?? 0
  const contextPercentage = contextTokens === 0
    ? 0
    : calculateContextUsagePercent(contextTokens, contextWindow)

  return {
    turnTotal,
    sessionTotal,
    contextTokens,
    contextWindow,
    contextPercentage,
    effectiveTurnUsage,
  }
}

export function formatCompactTokenCount(value: number): string {
  const count = Math.max(0, Math.round(value))
  if (count < 1_000) return String(count)
  if (count < 1_000_000) {
    const digits = count >= 100_000 ? 0 : 1
    return `${(count / 1_000).toFixed(digits).replace(/\.0$/, '')}K`
  }
  const digits = count >= 100_000_000 ? 0 : 1
  return `${(count / 1_000_000).toFixed(digits).replace(/\.0$/, '')}M`
}
