import { useEffect, useMemo, useState } from 'react'
import { sessionsApi, type SessionUsageSnapshot } from '../../api/sessions'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n/locales/en'
import { useChatStore } from '../../stores/chatStore'
import { useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import {
  formatCompactTokenCount,
  getTurnInputTokenTotal,
  resolveTokenUsageValues,
} from './tokenUsage'
import { readCachedSessionUsageEntry, writeCachedSessionUsage } from './sessionUsageCache'

type Props = {
  sessionId?: string
  projectPath?: string
  onOpenDetails: () => void
}

type LoadedUsage = {
  key: string
  snapshot: SessionUsageSnapshot | null
  context: {
    model: string
    usedTokens: number
    contextWindow: number
    percentage: number
    latestTurn?: {
      inputTokens: number
      outputTokens: number
      cacheReadInputTokens: number
      cacheCreationInputTokens: number
    }
  } | null
  revision: number
}

function loadCachedUsage(
  key: string,
  sessionId?: string,
  projectPath?: string,
): LoadedUsage {
  const cached = sessionId ? readCachedSessionUsageEntry(sessionId, projectPath) : null
  return {
    key,
    snapshot: cached?.response.usage ?? null,
    context: cached?.response.context ?? null,
    revision: cached?.revision ?? -1,
  }
}

type TokenUsageButtonProps = {
  contextPercentage: number | null
  contextTokens: number
  detailsLabel: string
  loading: boolean
  onOpenDetails: () => void
  sessionTotal: number
  turnTotal: number
  translate: (key: TranslationKey) => string
}

function formatContextPercent(percentage: number | null, contextTokens: number): string {
  if (percentage === null) return '--'
  if (contextTokens > 0 && percentage < 1) return '<1%'
  return `${Math.round(percentage)}%`
}

type ContextRingProps = {
  loading: boolean
  percentage: number | null
}

function ContextRing({ loading, percentage }: ContextRingProps) {
  const radius = 9
  const circumference = 2 * Math.PI * radius
  const progress = percentage ?? 0
  const dashOffset = circumference * (1 - progress / 100)
  const ringColor = progress >= 85
    ? 'var(--color-error)'
    : progress >= 65
      ? 'var(--color-warning)'
      : 'var(--color-brand)'
  const isIndeterminate = loading && percentage === null

  return (
    <span className="relative flex h-[22px] w-[22px] shrink-0 items-center justify-center">
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        aria-hidden="true"
        data-testid="token-context-ring"
        data-context-percent={percentage === null ? 'unknown' : Math.round(percentage)}
        className="overflow-visible"
      >
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="var(--color-border-separator)"
          strokeWidth="2.5"
        />
        {isIndeterminate ? (
          <circle
            cx="12"
            cy="12"
            r={radius}
            fill="none"
            stroke="var(--color-text-secondary)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`9 ${circumference - 9}`}
            className="origin-center motion-safe:animate-spin"
          />
        ) : (
          <circle
            cx="12"
            cy="12"
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 12 12)"
            style={{ transition: 'stroke-dashoffset 80ms linear, stroke 180ms ease' }}
          />
        )}
      </svg>
    </span>
  )
}

function TokenUsageButton({
  contextPercentage,
  contextTokens,
  detailsLabel,
  loading,
  onOpenDetails,
  sessionTotal,
  turnTotal,
  translate,
}: TokenUsageButtonProps) {
  const contextPercentLabel = formatContextPercent(contextPercentage, contextTokens)

  return (
    <button
      type="button"
      onClick={onOpenDetails}
      aria-label={detailsLabel}
      aria-busy={loading}
      title={detailsLabel}
      data-testid="token-usage-indicator"
      style={{ contain: 'layout paint' }}
      className="group flex h-[34px] w-[200px] shrink-0 items-center justify-between gap-[3px] overflow-hidden whitespace-nowrap rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container-high)] px-[6px] py-0 text-[11px] font-semibold text-[var(--color-text-secondary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
    >
      <span data-testid="token-turn-summary" className="flex w-[58px] shrink-0 items-baseline gap-[3px] overflow-hidden">
        <span className="min-w-0 truncate text-[10px] text-[var(--color-text-tertiary)]">{translate('chat.tokenUsage.turn')}</span>
        <span data-testid="token-turn-total" className="min-w-[34px] shrink-0 text-right font-mono font-semibold tabular-nums text-[var(--color-text-primary)]">
          {formatCompactTokenCount(turnTotal)}
        </span>
      </span>
      <span className="h-[12px] w-px bg-[var(--color-border-separator)]" />
      <span data-testid="token-session-summary" className="flex w-[58px] shrink-0 items-baseline gap-[3px] overflow-hidden">
        <span className="min-w-0 truncate text-[10px] text-[var(--color-text-tertiary)]">{translate('chat.tokenUsage.session')}</span>
        <span data-testid="token-session-total" className="min-w-[34px] shrink-0 text-right font-mono font-semibold tabular-nums text-[var(--color-text-primary)]">
          {formatCompactTokenCount(sessionTotal)}
        </span>
      </span>
      <span className="h-[12px] w-px bg-[var(--color-border-separator)]" />
      <span data-testid="token-context-summary" className="flex w-[52px] shrink-0 items-center justify-end gap-[4px]">
        <ContextRing
          loading={loading}
          percentage={contextPercentage}
        />
        <span className="w-[26px] text-center font-mono font-semibold tabular-nums text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)]">
          {contextPercentLabel}
        </span>
      </span>
    </button>
  )
}

export function TokenUsageIndicator({ sessionId, projectPath, onOpenDetails }: Props) {
  const t = useTranslation()
  const sessionState = useChatStore((state) => sessionId ? state.sessions[sessionId] : undefined)
  const turnUsage = sessionState?.tokenUsage ?? { input_tokens: 0, output_tokens: 0 }
  const usageRevision = sessionState?.usageRevision ?? 0
  const chatState = sessionState?.chatState ?? 'idle'
  const runtimeContextWindow = useSessionRuntimeStore((state) =>
    sessionId ? state.selections[sessionId]?.contextWindow : undefined,
  )
  const usageKey = `${sessionId ?? ''}:${projectPath ?? ''}`
  const [loadedUsage, setLoadedUsage] = useState<LoadedUsage>(() => (
    loadCachedUsage(usageKey, sessionId, projectPath)
  ))
  const [loading, setLoading] = useState(false)
  const effectiveLoadedUsage = loadedUsage.key === usageKey
    ? loadedUsage
    : { key: usageKey, snapshot: null, context: null, revision: -1 }

  useEffect(() => {
    setLoadedUsage(loadCachedUsage(usageKey, sessionId, projectPath))
  }, [projectPath, sessionId, usageKey])

  useEffect(() => {
    if (!sessionId) {
      setLoadedUsage({ key: usageKey, snapshot: null, context: null, revision: -1 })
      setLoading(false)
      return
    }

    let cancelled = false
    const delay = usageRevision > 0 ? 180 : 0
    setLoading(true)
    const timer = window.setTimeout(() => {
      sessionsApi.getUsage(sessionId, { projectPath })
        .then((response) => {
          if (!cancelled) {
            writeCachedSessionUsage(sessionId, projectPath, response, usageRevision)
            setLoadedUsage({
              key: usageKey,
              snapshot: response.usage,
              context: response.context ?? null,
              revision: usageRevision,
            })
          }
        })
        .catch(() => {
          // Real-time turn usage remains available even if a transcript has
          // not been created yet or the provider omits cumulative usage.
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, delay)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [sessionId, projectPath, usageKey, usageRevision])

  const values = useMemo(() => resolveTokenUsageValues({
    liveTurnUsage: turnUsage,
    persistedUsage: effectiveLoadedUsage.snapshot,
    persistedContext: effectiveLoadedUsage.context,
    isTurnActive: chatState !== 'idle',
    usageRevision,
    loadedRevision: effectiveLoadedUsage.revision,
    contextWindowOverride: runtimeContextWindow,
  }), [chatState, effectiveLoadedUsage, runtimeContextWindow, turnUsage, usageRevision])

  if (!sessionId) return null

  const uncachedInput = values.effectiveTurnUsage.input_tokens
  const input = getTurnInputTokenTotal(values.effectiveTurnUsage)
  const output = values.effectiveTurnUsage.output_tokens
  const cacheRead = values.effectiveTurnUsage.cache_read_input_tokens ?? values.effectiveTurnUsage.cache_read_tokens ?? 0
  const cacheWrite = values.effectiveTurnUsage.cache_creation_input_tokens ?? values.effectiveTurnUsage.cache_creation_tokens ?? 0
  const contextPercentLabel = formatContextPercent(values.contextPercentage, values.contextTokens)
  const detailsLabel = t('chat.tokenUsage.details', {
    turn: new Intl.NumberFormat().format(values.turnTotal),
    session: new Intl.NumberFormat().format(values.sessionTotal),
    input: new Intl.NumberFormat().format(input),
    uncachedInput: new Intl.NumberFormat().format(uncachedInput),
    output: new Intl.NumberFormat().format(output),
    cacheRead: new Intl.NumberFormat().format(cacheRead),
    cacheWrite: new Intl.NumberFormat().format(cacheWrite),
    contextUsed: new Intl.NumberFormat().format(values.contextTokens),
    contextWindow: values.contextWindow > 0 ? new Intl.NumberFormat().format(values.contextWindow) : '--',
    contextPercent: contextPercentLabel,
  })

  return (
    <TokenUsageButton
      key={usageKey}
      contextPercentage={values.contextPercentage}
      contextTokens={values.contextTokens}
      detailsLabel={detailsLabel}
      loading={loading}
      onOpenDetails={onOpenDetails}
      sessionTotal={values.sessionTotal}
      turnTotal={values.turnTotal}
      translate={t}
    />
  )
}
