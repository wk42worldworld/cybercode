import type { SessionUsageSnapshot } from '../../api/sessions'
import type { TokenUsage } from '../../types/chat'

export function getTurnTokenTotal(usage: TokenUsage): number {
  return (
    usage.input_tokens +
    usage.output_tokens +
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
