import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { skillsApi } from '../../api/skills'
import { mcpApi } from '../../api/mcp'
import { statusApi, type StatusDiagnosticsResponse, type StatusHealthResponse } from '../../api/status'
import {
  sessionsApi,
  type SessionContextSnapshot,
  type SessionInspectionResponse,
  type SessionUsageSnapshot,
} from '../../api/sessions'
import { useTranslation, type TranslationKey } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { useMcpStore } from '../../stores/mcpStore'
import { useSkillStore } from '../../stores/skillStore'
import type { McpServerRecord } from '../../types/mcp'
import type { SkillMeta } from '../../types/skill'
import type { SlashCommandOption } from './composerUtils'
import { Icon } from '../shared/Icon'
import { CopyButton } from '../shared/CopyButton'
import { formatBytes } from '../../lib/formatBytes'

export type LocalSlashCommandName = 'mcp' | 'skills' | 'help' | 'status' | 'cost' | 'context' | 'doctor' | 'memory' | 'bug'

type Props = {
  command: LocalSlashCommandName
  sessionId?: string
  projectPath?: string
  cwd?: string
  commands?: SlashCommandOption[]
  onClose: () => void
}

type SessionInspectorTab = 'status' | 'usage' | 'context'
type Translate = ReturnType<typeof useTranslation>

const GITHUB_ISSUES_URL = 'https://github.com/wk42worldworld/cybercode/issues'

function openExternalTarget(target: string) {
  import('@tauri-apps/plugin-shell')
    .then((mod) => mod.open(target))
    .catch(() => window.open(target, '_blank'))
}

function toneForStatus(status: McpServerRecord['status']) {
  switch (status) {
    case 'connected':
      return 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20'
    case 'needs-auth':
      return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
    case 'failed':
      return 'bg-rose-500/10 text-rose-600 border-rose-500/20'
    case 'disabled':
      return 'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] border-[var(--color-border)]'
    default:
      return ''
  }
}

function scopeLabel(scope: string, t: ReturnType<typeof useTranslation>) {
  switch (scope) {
    case 'user':
      return t('settings.mcp.scope.user')
    case 'local':
      return t('settings.mcp.scope.local')
    case 'project':
      return t('settings.mcp.scope.project')
    default:
      return scope
  }
}

function projectBadge(path?: string, t?: ReturnType<typeof useTranslation>) {
  if (!path || !t) return null
  const label = path.replace(/\/$/, '').split('/').pop() || path
  return t('slash.mcp.projectBadge', { name: label })
}

function PanelShell({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mb-[12px] overflow-hidden rounded-[24px] border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-[8px] shadow-[var(--shadow-dropdown)]">
      <div className="flex min-h-[64px] items-center justify-between gap-[16px] rounded-[16px] bg-[var(--color-surface-container-low)] px-[14px] py-[10px]">
        <div>
          <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{title}</h3>
          <p className="mt-[2px] text-[12px] font-medium text-[var(--color-text-tertiary)]">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-transparent text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-border-separator)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="max-h-[min(620px,72vh)] overflow-y-auto px-[10px] py-[12px]">{children}</div>
    </div>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-[14px] text-[var(--color-text-tertiary)]">
      <div className="mr-3 h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-brand)] border-t-transparent" />
      {label}
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border-2 border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-10 text-center">
      <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">{title}</div>
      <div className="mt-2 text-[12px] leading-6 text-[var(--color-text-tertiary)]">{body}</div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-error)]/20 bg-[var(--color-error)]/8 px-5 py-4 text-[14px] text-[var(--color-error)]">
      {message}
    </div>
  )
}

function formatNumber(value: number | undefined) {
  return new Intl.NumberFormat().format(value ?? 0)
}

function formatDuration(seconds: number | undefined) {
  const total = Math.max(0, Math.round(seconds ?? 0))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const remaining = total % 60
  return remaining ? `${minutes}m ${remaining}s` : `${minutes}m`
}

function formatMilliseconds(ms: number | undefined) {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000))
  return formatDuration(total)
}

function formatPercent(value: number | undefined) {
  const percent = Math.max(0, Math.min(100, value ?? 0))
  return `${percent.toFixed(percent >= 10 || Number.isInteger(percent) ? 0 : 1)}%`
}

function sessionInspectorInitialTab(command: LocalSlashCommandName): SessionInspectorTab {
  if (command === 'cost') return 'usage'
  if (command === 'context') return 'context'
  return 'status'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function isSessionInspectionResponse(value: unknown): value is SessionInspectionResponse {
  if (!isRecord(value)) return false
  if (typeof value.active !== 'boolean') return false
  if (!isRecord(value.status)) return false
  return (
    typeof value.status.sessionId === 'string' &&
    typeof value.status.workDir === 'string' &&
    typeof value.status.permissionMode === 'string'
  )
}

function assertSessionInspectionResponse(value: unknown, t: Translate): SessionInspectionResponse {
  if (isSessionInspectionResponse(value)) return value
  throw new Error(t('slash.inspector.error.unavailable'))
}

function InspectorSectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-4">
      <div className="font-mono text-[12px] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-primary)]">{children}</div>
      {action}
    </div>
  )
}

function MetricCard({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <div className="min-h-[82px] rounded-md border-2 border-[var(--color-border)] bg-[var(--color-surface-container)] px-4 py-4 font-mono">
      <div className="text-[12px] uppercase tracking-[0.2em] text-[var(--color-text-primary)]">{label}</div>
      <div className="mt-3 whitespace-pre-line text-[15px] leading-6 text-[var(--color-text-primary)]">{value}</div>
      {detail && <div className="mt-1 text-[13px] leading-5 text-[var(--color-text-tertiary)]">{detail}</div>}
    </div>
  )
}

function InspectorNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-md border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-3 text-[14px] text-[var(--color-text-primary)]">
      <Icon name="info" size={18} className="text-[var(--color-text-tertiary)]" />
      <span>{children}</span>
    </div>
  )
}

function KeyValueRows({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <div className="overflow-hidden rounded-md border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] font-mono">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[220px_minmax(0,1fr)] border-t border-[var(--color-border)] first:border-t-0">
          <div className="border-r border-[var(--color-border)] bg-[var(--color-surface-container)] px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-primary)]">
            {label}
          </div>
          <div className="min-w-0 break-words px-4 py-3 text-[14px] text-[var(--color-text-primary)]">{value}</div>
        </div>
      ))}
    </div>
  )
}

type UsageSegment = {
  key: string
  label: string
  value: number
  color: string
}

function compactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Math.max(0, value))
}

function usageShare(value: number, total: number) {
  if (total <= 0 || value <= 0) return 0
  return (value / total) * 100
}

function TokenCompositionRing({ segments, total, reveal }: { segments: UsageSegment[]; total: number; reveal: boolean }) {
  let offset = 0

  return (
    <div className="relative h-[120px] w-[120px] shrink-0" data-testid="usage-composition-ring">
      <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="56" cy="56" r="43" fill="none" stroke="var(--color-border-separator)" strokeWidth="11" opacity="0.65" />
        {segments.map((segment) => {
          const share = usageShare(segment.value, total)
          const currentOffset = offset
          offset += share
          return (
            <circle
              key={segment.key}
              cx="56"
              cy="56"
              r="43"
              pathLength="100"
              fill="none"
              stroke={segment.color}
              strokeWidth="11"
              strokeDasharray={reveal ? `${share} ${100 - share}` : '0 100'}
              strokeDashoffset={-currentOffset}
              style={{ transition: 'stroke-dasharray 700ms cubic-bezier(0.22, 1, 0.36, 1)' }}
            />
          )
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[19px] font-semibold tabular-nums text-[var(--color-text-primary)]">{compactNumber(total)}</span>
        <span className="mt-0.5 text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">Token</span>
      </div>
    </div>
  )
}

function ContextCapacityGauge({ context, reveal, t }: { context?: SessionContextSnapshot; reveal: boolean; t: Translate }) {
  const percentage = context ? Math.max(0, Math.min(100, context.percentage)) : 0
  const radius = 43
  const circumference = 2 * Math.PI * radius
  const remaining = context ? Math.max(0, context.maxTokens - context.totalTokens) : 0
  const color = percentage >= 85
    ? 'var(--color-error)'
    : percentage >= 65
      ? 'var(--color-warning)'
      : 'var(--color-success)'

  return (
    <div className="flex min-w-0 items-center gap-5" data-testid="usage-context-gauge">
      <div className="relative h-[120px] w-[120px] shrink-0">
        <svg viewBox="0 0 112 112" className="h-full w-full" aria-hidden="true">
          <circle cx="56" cy="56" r={radius} fill="none" stroke="var(--color-border-separator)" strokeWidth="11" opacity="0.65" />
          <circle
            cx="56"
            cy="56"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - (reveal ? percentage : 0) / 100)}
            transform="rotate(-90 56 56)"
            style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.22, 1, 0.36, 1), stroke 180ms ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center font-mono text-[20px] font-semibold tabular-nums text-[var(--color-text-primary)]">
          {context ? formatPercent(percentage) : '--'}
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-[var(--color-text-tertiary)]">{t('slash.inspector.usage.contextUsed')}</div>
        {context ? (
          <>
            <div className="mt-1 font-mono text-[14px] font-semibold tabular-nums text-[var(--color-text-primary)]">
              {formatNumber(context.totalTokens)} / {formatNumber(context.maxTokens)}
            </div>
            <div className="mt-2 text-[12px] text-[var(--color-text-secondary)]">
              {t('slash.inspector.usage.contextRemaining', { tokens: formatNumber(remaining) })}
            </div>
          </>
        ) : (
          <div className="mt-2 text-[12px] leading-5 text-[var(--color-text-tertiary)]">{t('slash.inspector.usage.contextUnavailable')}</div>
        )}
      </div>
    </div>
  )
}

function TokenCompositionChart({ segments, total, reveal, t }: { segments: UsageSegment[]; total: number; reveal: boolean; t: Translate }) {
  return (
    <section data-testid="usage-composition-chart">
      <InspectorSectionTitle>{t('slash.inspector.usage.composition')}</InspectorSectionTitle>
      <div
        className="flex h-[14px] w-full overflow-hidden rounded-[4px] bg-[var(--color-surface-container-high)]"
        role="img"
        aria-label={segments.map((segment) => `${segment.label} ${formatNumber(segment.value)}`).join(', ')}
      >
        {segments.map((segment) => {
          const share = usageShare(segment.value, total)
          return (
            <div
              key={segment.key}
              className="h-full"
              style={{
                backgroundColor: segment.color,
                width: reveal ? `${share}%` : '0%',
                transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            />
          )
        })}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-4">
        {segments.map((segment) => (
          <div key={segment.key} className="flex min-w-0 items-center gap-2.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: segment.color }} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-semibold text-[var(--color-text-tertiary)]">{segment.label}</div>
              <div className="mt-0.5 flex items-baseline gap-2 font-mono tabular-nums">
                <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{formatNumber(segment.value)}</span>
                <span className="text-[10px] text-[var(--color-text-tertiary)]">{formatPercent(usageShare(segment.value, total))}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ModelUsageChart({ models, reveal, t }: { models: SessionUsageSnapshot['models']; reveal: boolean; t: Translate }) {
  const modelTotals = models.map((model) => ({
    model,
    total: model.inputTokens + model.outputTokens + model.cacheReadInputTokens + model.cacheCreationInputTokens,
  }))
  const maxTotal = Math.max(1, ...modelTotals.map((entry) => entry.total))

  return (
    <section data-testid="usage-model-chart">
      <InspectorSectionTitle>{t('slash.inspector.usage.byModel')}</InspectorSectionTitle>
      <div className="divide-y divide-[var(--color-border-separator)] border-y border-[var(--color-border-separator)]">
        {modelTotals.map(({ model, total }) => {
          const segments = [
            { value: model.inputTokens, color: 'var(--color-brand)' },
            { value: model.outputTokens, color: 'var(--color-success)' },
            { value: model.cacheReadInputTokens, color: 'var(--color-warning)' },
            { value: model.cacheCreationInputTokens, color: 'var(--color-text-secondary)' },
          ]
          return (
            <div key={model.model} className="grid grid-cols-[minmax(120px,0.85fr)_minmax(160px,1.6fr)_90px] items-center gap-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-[var(--color-text-primary)]">{model.displayName || model.model}</div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--color-text-tertiary)]">{model.model}</div>
              </div>
              <div className="h-[10px] overflow-hidden rounded-[3px] bg-[var(--color-surface-container-high)]">
                <div
                  className="flex h-full overflow-hidden rounded-[3px]"
                  style={{
                    width: reveal ? `${Math.max(total > 0 ? 2 : 0, (total / maxTotal) * 100)}%` : '0%',
                    transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)',
                  }}
                >
                  {segments.map((segment, index) => (
                    <span
                      key={index}
                      className="h-full"
                      style={{ backgroundColor: segment.color, width: `${usageShare(segment.value, total)}%` }}
                    />
                  ))}
                </div>
              </div>
              <div className="text-right font-mono text-[12px] font-semibold tabular-nums text-[var(--color-text-primary)]">{compactNumber(total)}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function UsageTab({
  usage,
  context,
  error,
  t,
}: {
  usage?: SessionUsageSnapshot
  context?: SessionContextSnapshot
  error?: string
  t: Translate
}) {
  const [revealCharts, setRevealCharts] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setRevealCharts(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  if (error && !usage) return <ErrorState message={error} />
  if (!usage) {
    return <EmptyState title={t('slash.inspector.usage.emptyTitle')} body={t('slash.inspector.usage.emptyBody')} />
  }

  const usageHasTokens = (
    usage.totalInputTokens +
    usage.totalOutputTokens +
    usage.totalCacheReadInputTokens +
    usage.totalCacheCreationInputTokens
  ) > 0
  const apiUsage = context?.apiUsage
  const useContextUsageFallback = !usageHasTokens && !!apiUsage
  const totalInputTokens = useContextUsageFallback ? apiUsage.input_tokens : usage.totalInputTokens
  const totalOutputTokens = useContextUsageFallback ? apiUsage.output_tokens : usage.totalOutputTokens
  const totalCacheReadInputTokens = useContextUsageFallback ? apiUsage.cache_read_input_tokens : usage.totalCacheReadInputTokens
  const totalCacheCreationInputTokens = useContextUsageFallback ? apiUsage.cache_creation_input_tokens : usage.totalCacheCreationInputTokens
  const models = Array.isArray(usage.models) && usage.models.length > 0
    ? usage.models
    : useContextUsageFallback
      ? [{
          model: context?.model ?? 'current-model',
          displayName: context?.model ?? t('slash.inspector.status.activeModel'),
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheReadInputTokens: totalCacheReadInputTokens,
          cacheCreationInputTokens: totalCacheCreationInputTokens,
          webSearchRequests: 0,
          costUSD: 0,
          costDisplay: 'n/a',
          contextWindow: context?.rawMaxTokens ?? 0,
          maxOutputTokens: 0,
        }]
      : []
  const sourceLabel = useContextUsageFallback
    ? t('slash.inspector.usage.source.contextSnapshot')
    : usage.source === 'transcript'
      ? t('slash.inspector.usage.source.transcript')
      : t('slash.inspector.usage.source.currentProcess')

  const totalTokens = totalInputTokens + totalOutputTokens + totalCacheReadInputTokens + totalCacheCreationInputTokens
  const segments: UsageSegment[] = [
    { key: 'input', label: t('slash.inspector.usage.input'), value: totalInputTokens, color: 'var(--color-brand)' },
    { key: 'output', label: t('slash.inspector.usage.output'), value: totalOutputTokens, color: 'var(--color-success)' },
    { key: 'cache-read', label: t('slash.inspector.usage.cacheRead'), value: totalCacheReadInputTokens, color: 'var(--color-warning)' },
    { key: 'cache-write', label: t('slash.inspector.usage.cacheWrite'), value: totalCacheCreationInputTokens, color: 'var(--color-text-secondary)' },
  ]
  return (
    <div className="space-y-6">
      {useContextUsageFallback && (
        <InspectorNotice>
          {t('slash.inspector.usage.contextSnapshotNotice')}
        </InspectorNotice>
      )}
      {usage.source === 'transcript' && (
        <div className="rounded-md border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-3 text-[14px] text-[var(--color-text-secondary)]">
          {t('slash.inspector.usage.transcriptNotice')}
        </div>
      )}
      {usage.hasUnknownModelCost && (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[14px] text-amber-700">
          {t('slash.inspector.usage.unknownCost')}
        </div>
      )}
      <section className="grid gap-6 border-y border-[var(--color-border-separator)] py-5 lg:grid-cols-2 lg:divide-x lg:divide-[var(--color-border-separator)]" data-testid="usage-overview">
        <div className="flex min-w-0 items-center gap-5 lg:pr-6">
          <TokenCompositionRing segments={segments} total={totalTokens} reveal={revealCharts} />
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-[var(--color-text-tertiary)]">{t('slash.inspector.usage.totalTokens')}</div>
            <div className="mt-1 font-mono text-[25px] font-semibold tabular-nums text-[var(--color-text-primary)]">{formatNumber(totalTokens)}</div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
              <span>{sourceLabel}</span>
              <span>{useContextUsageFallback ? 'n/a' : usage.costDisplay}</span>
            </div>
          </div>
        </div>
        <div className="lg:pl-6">
          <ContextCapacityGauge context={context} reveal={revealCharts} t={t} />
        </div>
      </section>
      <TokenCompositionChart segments={segments} total={totalTokens} reveal={revealCharts} t={t} />
      <section>
        <InspectorSectionTitle>{t('slash.inspector.usage.supportingStats')}</InspectorSectionTitle>
        <div className="grid grid-cols-2 border-y border-[var(--color-border-separator)] sm:grid-cols-3 lg:grid-cols-6">
          {[
            [t('slash.inspector.usage.totalCost'), useContextUsageFallback ? 'n/a' : usage.costDisplay],
            [t('slash.inspector.usage.apiDuration'), usage.source === 'transcript' || useContextUsageFallback ? '0ms' : formatDuration(usage.totalAPIDuration)],
            [usage.source === 'transcript' ? t('slash.inspector.usage.usageSpan') : t('slash.inspector.usage.wallDuration'), useContextUsageFallback ? '0ms' : formatDuration(usage.totalDuration)],
            [t('slash.inspector.usage.codeAdded'), `+${formatNumber(usage.totalLinesAdded)}`],
            [t('slash.inspector.usage.codeRemoved'), `-${formatNumber(usage.totalLinesRemoved)}`],
            [t('slash.inspector.usage.webSearch'), formatNumber(usage.totalWebSearchRequests)],
          ].map(([label, value], index) => (
            <div key={String(label)} className={`min-w-0 px-3 py-3 ${index > 0 ? 'border-l border-[var(--color-border-separator)]' : ''}`}>
              <div className="truncate text-[10px] font-semibold text-[var(--color-text-tertiary)]">{label}</div>
              <div className="mt-1 truncate font-mono text-[13px] font-semibold tabular-nums text-[var(--color-text-primary)]">{value}</div>
            </div>
          ))}
        </div>
      </section>
      <section>
        {models.length === 0 ? (
          <>
            <InspectorSectionTitle>{t('slash.inspector.usage.byModel')}</InspectorSectionTitle>
            <EmptyState title={t('slash.inspector.usage.noModelTitle')} body={t('slash.inspector.usage.noModelBody')} />
          </>
        ) : (
          <ModelUsageChart models={models} reveal={revealCharts} t={t} />
        )}
      </section>
    </div>
  )
}

type ContextCategory = SessionContextSnapshot['categories'][number]

function isCapacityCategory(category: ContextCategory) {
  const name = category.name.toLowerCase()
  return category.isDeferred || name.includes('free') || name.includes('autocompact')
}

function ContextStackedBar({ categories, rawMaxTokens }: { categories: ContextCategory[]; rawMaxTokens: number }) {
  const activeCategories = categories.filter((category) => !isCapacityCategory(category) && category.tokens > 0)
  if (activeCategories.length === 0) return null

  return (
    <div className="overflow-hidden rounded-full bg-[#ebe7df]">
      <div className="flex h-2.5 w-full">
        {activeCategories.map((category) => (
          <div
            key={category.name}
            title={`${category.name}: ${formatNumber(category.tokens)} tokens`}
            style={{
              width: `${Math.max(0.5, (category.tokens / rawMaxTokens) * 100)}%`,
              backgroundColor: category.color,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function CategoryBreakdown({ categories, rawMaxTokens, t }: { categories: ContextCategory[]; rawMaxTokens: number; t: Translate }) {
  const visibleCategories = categories.filter((category) => category.tokens > 0)
  if (visibleCategories.length === 0) {
    return <EmptyState title={t('slash.inspector.context.noCategoriesTitle')} body={t('slash.inspector.context.noCategoriesBody')} />
  }

  return (
    <div className="rounded-md border-2 border-[var(--color-border)] bg-[var(--color-surface-container)] px-5 py-5 font-mono">
      <InspectorSectionTitle>{t('slash.inspector.context.categoryTitle')}</InspectorSectionTitle>
      <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
        {visibleCategories.map((category) => {
          const percent = rawMaxTokens > 0 ? (category.tokens / rawMaxTokens) * 100 : 0
          const muted = isCapacityCategory(category)
          return (
            <div
              key={category.name}
              className="min-w-0"
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`min-w-0 truncate text-[14px] font-semibold ${muted ? 'text-[#5f514c]' : 'text-[var(--color-text-primary)]'}`}>
                    {category.name}
                  </span>
                </div>
                <div className="shrink-0 text-right leading-tight">
                  <div className="text-[14px] text-[var(--color-text-primary)]">{formatNumber(category.tokens)}</div>
                  <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">{formatPercent(percent)}</div>
                </div>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#ebe7df]">
                <div
                  className={muted ? 'h-full rounded-full opacity-65' : 'h-full rounded-full'}
                  style={{
                    width: `${Math.min(100, Math.max(0.5, percent))}%`,
                    backgroundColor: muted ? '#9b928c' : '#8f3217',
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ContextStatPill({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 font-mono">
      <div className="truncate text-[12px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-tertiary)]">{label}</div>
      <div className="mt-2 truncate text-[16px] font-semibold text-[var(--color-text-primary)]">{value}</div>
      {detail && <div className="mt-1 truncate text-[13px] text-[var(--color-text-tertiary)]">{detail}</div>}
    </div>
  )
}

function statusDisplayLabel(status: string, t: Translate) {
  const normalized = status.toLowerCase()
  if (normalized === 'connected') return t('slash.inspector.status.connected')
  if (normalized === 'failed') return t('slash.inspector.status.failed')
  return status
}

function InspectorStatusBadge({ status, t }: { status: string; t: Translate }) {
  const normalized = status.toLowerCase()
  const isConnected = normalized === 'connected'
  const isFailed = normalized === 'failed'
  const badgeClass = isConnected
    ? 'bg-[#d8f2b6] text-[#25451b]'
    : isFailed
      ? 'bg-[#ffd9d3] text-[#c51616]'
      : 'bg-[#ebe7df] text-[#5f514c]'
  const dotClass = isConnected ? 'bg-[#25451b]' : isFailed ? 'bg-[#c51616]' : 'bg-[var(--color-text-tertiary)]'

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] ${badgeClass}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {statusDisplayLabel(status, t)}
    </span>
  )
}

function McpServerIcon({ status }: { status: string }) {
  const isFailed = status === 'failed'
  const icon = isFailed ? 'power_off' : 'dns'
  return <Icon name={icon} size={20} className={isFailed ? 'text-[#c51616]' : 'text-[#25451b]'} />
}

function ContextOverview({ context, categories, t }: { context: SessionContextSnapshot; categories: ContextCategory[]; t: Translate }) {
  const usedPercent = Math.min(100, Math.max(0, context.percentage))
  const freeTokens = Math.max(0, context.rawMaxTokens - context.totalTokens)
  const freePercent = context.rawMaxTokens > 0 ? (freeTokens / context.rawMaxTokens) * 100 : 0
  return (
    <div className="rounded-md border-2 border-[var(--color-border)] bg-[var(--color-surface-container)] px-5 py-6">
      <div className="mb-8 flex items-start justify-between gap-4">
        <InspectorSectionTitle>{t('slash.inspector.context.windowUsage')}</InspectorSectionTitle>
        <span className="rounded-sm border-2 border-[var(--color-border)] bg-[#ebe7df] px-2 py-1 font-mono text-[12px] text-[#5f514c]">{context.model}</span>
      </div>
      <div className="font-mono text-[24px] font-semibold text-[var(--color-text-primary)]">
        {formatNumber(context.totalTokens)}
        <span className="mx-1.5 text-[var(--color-text-primary)]">/</span>
        <span>{formatNumber(context.rawMaxTokens)}</span>
        <span className="ml-3 align-middle text-[14px] font-normal text-[#0f5c8f]">[{formatPercent(usedPercent)} {t('slash.inspector.context.used')}]</span>
      </div>
      <div className="mt-7">
        <ContextStackedBar categories={categories} rawMaxTokens={context.rawMaxTokens} />
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-md border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-3">
          <ContextStatPill label={t('slash.inspector.context.free')} value={formatNumber(freeTokens)} detail={formatPercent(freePercent)} />
        </div>
        <div className="rounded-md border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-3">
          <ContextStatPill label={t('slash.inspector.context.messages')} value={formatNumber(context.messageBreakdown?.assistantMessageTokens ?? 0)} detail={t('slash.inspector.context.assistant')} />
        </div>
        <div className="rounded-md border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-3">
          <ContextStatPill label={t('slash.inspector.context.toolResults')} value={formatNumber(context.messageBreakdown?.toolResultTokens ?? 0)} />
        </div>
        <div className="rounded-md border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-3">
          <ContextStatPill label={t('slash.inspector.context.context')} value={formatPercent(usedPercent)} />
        </div>
      </div>
    </div>
  )
}

function ContextTab({
  context,
  error,
  loading,
  t,
}: {
  context?: SessionContextSnapshot
  error?: string
  loading?: boolean
  t: Translate
}) {
  if (error && !context) return <ErrorState message={error} />
  if (loading && !context) return <LoadingState label={t('slash.inspector.context.loading')} />
  if (!context) {
    return <EmptyState title={t('slash.inspector.context.emptyTitle')} body={t('slash.inspector.context.emptyBody')} />
  }

  const categories = Array.isArray(context.categories) ? context.categories : []
  return (
    <div className="space-y-6">
      <ContextOverview context={context} categories={categories} t={t} />
      <CategoryBreakdown categories={categories} rawMaxTokens={context.rawMaxTokens} t={t} />
    </div>
  )
}

function StatusTab({
  data,
  commands,
  t,
}: {
  data: SessionInspectionResponse
  commands?: SlashCommandOption[]
  t: Translate
}) {
  const mcpServers = Array.isArray(data.status.mcpServers) ? data.status.mcpServers : []
  const tools = Array.isArray(data.status.tools) ? data.status.tools : []
  const model = data.status.model ?? data.context?.model ?? data.usage?.models?.[0]?.displayName ?? data.usage?.models?.[0]?.model ?? t('slash.inspector.status.unknown')
  const slashCommandCount = (data.status.slashCommandCount ?? 0) > 0
    ? data.status.slashCommandCount
    : commands?.length ?? 0
  const connectedMcp = mcpServers.filter((server) => server.status === 'connected').length
  const failedMcp = mcpServers.filter((server) => server.status === 'failed').length
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label={t('slash.inspector.status.cliStatus')}
          value={(
            <span className="inline-flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${data.active ? 'bg-[#25451b]' : 'bg-[#c51616]'}`} />
              {data.active ? t('slash.inspector.status.running') : t('slash.inspector.status.notRunning')}
            </span>
          )}
        />
        <MetricCard label={t('slash.inspector.status.activeModel')} value={model} />
        <MetricCard
          label={t('slash.inspector.status.mcpConnections')}
          value={(
            <span>
              <span className="text-[#25451b]">{formatNumber(connectedMcp)}</span>
              <span className="mx-5 text-[var(--color-text-primary)]">/</span>
              <span className="text-[#c51616]">{formatNumber(failedMcp)}</span>
            </span>
          )}
          detail={(
            <span>
              <span className="text-[#25451b]">{t('slash.inspector.status.connected')}</span>
              <span className="mx-5 text-[var(--color-text-primary)]" />
              <span className="text-[#c51616]">{t('slash.inspector.status.failed')}</span>
            </span>
          )}
        />
        <MetricCard label={t('slash.inspector.status.registeredTools')} value={`${formatNumber(tools.length)} / ${formatNumber(slashCommandCount)} ${t('slash.inspector.status.commands')}`} />
      </div>
      <section>
        <InspectorSectionTitle>{t('slash.inspector.status.sessionMetadata')}</InspectorSectionTitle>
        <KeyValueRows
          rows={[
            [t('slash.inspector.status.version'), data.status.version ?? t('slash.inspector.status.unknown')],
            [t('slash.inspector.status.sessionId'), <span className="font-mono text-[13px]">{data.status.sessionId}</span>],
            [t('slash.inspector.status.workingDirectory'), <span className="font-mono text-[13px]">{data.status.cwd ?? data.status.workDir}</span>],
            [t('slash.inspector.status.permissionMode'), <span className="rounded-sm bg-[#ebe7df] px-1.5 py-1">{data.status.permissionMode}</span>],
            [t('slash.inspector.status.authToken'), data.status.apiKeySource ?? t('slash.inspector.status.unknown')],
            [t('slash.inspector.status.outputStyle'), data.status.outputStyle ?? t('slash.inspector.status.default')],
          ]}
        />
      </section>
      {mcpServers.length > 0 && (
        <section>
          <InspectorSectionTitle
            action={<button type="button" className="font-mono text-[12px] tracking-[0.18em] text-[#8f3217] hover:text-[#5b1e0d]">↻ {t('slash.inspector.status.refresh')}</button>}
          >
            {t('slash.inspector.status.mcpServers')}
          </InspectorSectionTitle>
          <div className="grid gap-3 lg:grid-cols-2">
            {mcpServers.map((server) => (
              <div
                key={`${server.name}:${server.status}`}
                className={`flex min-h-[48px] items-center justify-between gap-4 rounded-md border px-4 py-3 font-mono ${
                  server.status === 'failed' ? 'border-[#f1b8b0] bg-[#fff7f5]' : 'border-[var(--color-border)] bg-[var(--color-surface-container)]'
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <McpServerIcon status={server.status} />
                  <span className="min-w-0 truncate text-[14px] text-[var(--color-text-primary)]">{server.name}</span>
                </div>
                <InspectorStatusBadge status={server.status} t={t} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function SessionInspectorShell({
  selectedTab,
  tabs,
  onSelectTab,
  onClose,
  children,
  t,
}: {
  selectedTab: SessionInspectorTab
  tabs: Array<{ id: SessionInspectorTab; label: string }>
  onSelectTab: (tab: SessionInspectorTab) => void
  onClose: () => void
  children: React.ReactNode
  t: Translate
}) {
  return (
    <div
      className="absolute bottom-full left-0 right-0 z-50 mb-[12px] overflow-hidden rounded-xl border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-dropdown)]"
    >
      <div className="grid min-h-[64px] grid-cols-[1fr_auto_1fr] items-center border-b border-[var(--color-border-separator)] px-[20px]">
        <div className="font-mono text-[13px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">{t('slash.inspector.title')}</div>
        <div className="flex items-center gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`relative h-[36px] px-0 text-[13px] font-semibold transition-colors ${
                selectedTab === tab.id ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {tab.label}
              {selectedTab === tab.id && <span className="absolute bottom-1 left-0 right-0 h-[2px] rounded-full bg-[var(--color-text-secondary)] opacity-[0.45]" />}
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label={t('slash.inspector.close')}
            className="flex h-[36px] w-[36px] items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
      <div className="max-h-[min(540px,58vh)] overflow-y-auto px-[20px] py-[16px]">{children}</div>
    </div>
  )
}

function SessionInspectorPanel({
  command,
  sessionId,
  projectPath,
  commands,
  onClose,
}: {
  command: LocalSlashCommandName
  sessionId?: string
  projectPath?: string
  commands?: SlashCommandOption[]
  onClose: () => void
}) {
  const t = useTranslation()
  const [selectedTab, setSelectedTab] = useState<SessionInspectorTab>(() => sessionInspectorInitialTab(command))
  const [data, setData] = useState<SessionInspectionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState<string | null>(null)
  const contextRequestSessionRef = useRef<string | null>(null)

  useEffect(() => {
    if (command !== 'status' && command !== 'cost' && command !== 'context') return
    setSelectedTab(sessionInspectorInitialTab(command))
  }, [command])

  useEffect(() => {
    if (!sessionId) {
      setError(t('slash.inspector.error.noActiveSession'))
      return
    }
    let cancelled = false
    setData(null)
    setError(null)
    setContextLoading(false)
    setContextError(null)
    contextRequestSessionRef.current = null
    sessionsApi.getInspection(sessionId, { includeContext: false, projectPath })
      .then((response) => {
        if (!cancelled) setData(assertSessionInspectionResponse(response, t))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, projectPath, t])

  useEffect(() => {
    if (!sessionId || selectedTab !== 'context' || data === null || data.context) return
    const requestKey = `${sessionId}:${projectPath ?? ''}`
    if (contextRequestSessionRef.current === requestKey) return
    contextRequestSessionRef.current = requestKey
    let cancelled = false
    setContextLoading(true)
    setContextError(null)
    sessionsApi.getInspection(sessionId, { includeContext: true, timeout: 45_000, projectPath })
      .then((response) => {
        if (cancelled) return
        const inspected = assertSessionInspectionResponse(response, t)
        setData((current) => current
          ? {
              ...current,
              context: inspected.context,
              errors: {
                ...(current.errors ?? {}),
                ...(inspected.errors ?? {}),
              },
            }
          : inspected)
        setContextError(inspected.errors?.context ?? null)
      })
      .catch((err) => {
        if (!cancelled) setContextError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setContextLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [data, selectedTab, sessionId, projectPath, t])

  const tabs: Array<{ id: SessionInspectorTab; label: string }> = [
    { id: 'status', label: t('slash.inspector.tab.status') },
    { id: 'usage', label: t('slash.inspector.tab.usage') },
    { id: 'context', label: t('slash.inspector.tab.context') },
  ]

  return (
    <SessionInspectorShell selectedTab={selectedTab} tabs={tabs} onSelectTab={setSelectedTab} onClose={onClose} t={t}>
      {error ? (
        <ErrorState message={error} />
      ) : data === null ? (
        <LoadingState label={t('slash.inspector.loading')} />
      ) : selectedTab === 'usage' ? (
        <UsageTab usage={data.usage} context={data.context ?? data.contextEstimate} error={data.errors?.usage} t={t} />
      ) : selectedTab === 'context' ? (
        <ContextTab
          context={data.context ?? data.contextEstimate}
          error={contextError ?? data.errors?.context}
          loading={contextLoading && !data.contextEstimate}
          t={t}
        />
      ) : (
        <StatusTab data={data} commands={commands} t={t} />
      )}
    </SessionInspectorShell>
  )
}

function McpPanel({ cwd, onClose }: { cwd?: string; onClose: () => void }) {
  const t = useTranslation()
  const openSettings = useUIStore((s) => s.openSettings)
  const selectServer = useMcpStore((s) => s.selectServer)
  const [servers, setServers] = useState<McpServerRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    mcpApi.list(cwd)
      .then(async (response) => {
        if (cancelled) return
        const visibleServers = response.servers.filter((server) => server.scope === 'user' || server.scope === 'local' || server.scope === 'project')
        setServers(visibleServers)

        const statusResults = await Promise.allSettled(
          visibleServers.map((server) => mcpApi.status(server.name, cwd)),
        )
        if (cancelled) return

        const liveServers = new Map<string, McpServerRecord>()
        for (const result of statusResults) {
          if (result.status === 'fulfilled') {
            liveServers.set(result.value.server.name, result.value.server)
          }
        }
        if (liveServers.size > 0) {
          setServers((current) =>
            current?.map((server) => liveServers.get(server.name) ?? server) ?? current,
          )
        }
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [cwd])

  const grouped = useMemo(() => {
    const groups = new Map<string, McpServerRecord[]>()
    for (const server of servers ?? []) {
      const key = server.scope
      const existing = groups.get(key) ?? []
      existing.push(server)
      groups.set(key, existing)
    }
    return groups
  }, [servers])

  return (
    <PanelShell
      title={t('slash.mcp.title')}
      subtitle={cwd ? t('slash.mcp.subtitleWithProject', { path: cwd }) : t('slash.mcp.subtitle')}
      onClose={onClose}
    >
      {error ? (
        <ErrorState message={error} />
      ) : servers === null ? (
        <LoadingState label={t('common.loading')} />
      ) : servers.length === 0 ? (
        <EmptyState title={t('slash.mcp.emptyTitle')} body={t('slash.mcp.emptyBody')} />
      ) : (
        <div className="space-y-5">
          {['user', 'local', 'project'].filter((scope) => grouped.has(scope)).map((scope) => (
            <section key={scope}>
              <div className="mb-[8px] flex min-h-[36px] items-center justify-between">
                <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">{scopeLabel(scope, t)}</div>
                <div className="text-[12px] text-[var(--color-text-tertiary)]">{grouped.get(scope)?.length ?? 0}</div>
              </div>
              <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                {grouped.get(scope)?.map((server) => (
                  <button
                    type="button"
                    key={`${server.scope}:${server.projectPath ?? 'global'}:${server.name}`}
                    onClick={() => {
                      selectServer(server)
                      openSettings('mcp')
                      onClose()
                    }}
                    className="block min-h-[76px] w-full border-t border-[var(--color-border)] px-[16px] py-[12px] text-left transition-colors first:border-t-0 hover:bg-[var(--color-surface-hover)]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">{server.name}</div>
                      <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${toneForStatus(server.status)}`}>
                        {server.statusLabel}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-text-tertiary)]">
                      <span className="rounded-full bg-[var(--color-surface-hover)] px-2 py-1">{server.transport}</span>
                      {server.projectPath && (
                        <span className="rounded-full bg-[var(--color-surface-hover)] px-2 py-1" title={server.projectPath}>
                          {projectBadge(server.projectPath, t)}
                        </span>
                      )}
                      <span className="truncate">{server.summary}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PanelShell>
  )
}

function SkillsPanel({ cwd, onClose }: { cwd?: string; onClose: () => void }) {
  const t = useTranslation()
  const openSettings = useUIStore((s) => s.openSettings)
  const fetchSkillDetail = useSkillStore((s) => s.fetchSkillDetail)
  const [skills, setSkills] = useState<SkillMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    skillsApi.list(cwd)
      .then((response) => {
        if (cancelled) return
        setSkills(response.skills.filter((skill) => skill.userInvocable && skill.enabled !== false))
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [cwd])

  return (
    <PanelShell
      title={t('slash.skills.title')}
      subtitle={cwd ? t('slash.skills.subtitleWithProject', { path: cwd }) : t('slash.skills.subtitle')}
      onClose={onClose}
    >
      {error ? (
        <ErrorState message={error} />
      ) : skills === null ? (
        <LoadingState label={t('common.loading')} />
      ) : skills.length === 0 ? (
        <EmptyState title={t('slash.skills.emptyTitle')} body={t('slash.skills.emptyBody')} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          {skills.map((skill) => (
            <button
              type="button"
              key={`${skill.source}:${skill.name}`}
              onClick={async () => {
                await fetchSkillDetail(skill.source, skill.name, cwd, 'skills')
                openSettings('skills')
                onClose()
              }}
              className="block min-h-[76px] w-full border-t border-[var(--color-border)] px-[16px] py-[12px] text-left transition-colors first:border-t-0 hover:bg-[var(--color-surface-hover)]"
            >
              <div className="flex items-center gap-3">
                <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">/{skill.name}</div>
                <span className="rounded-full bg-[var(--color-surface-hover)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
                  {skill.source}
                </span>
              </div>
              <div className="mt-2 text-[12px] leading-6 text-[var(--color-text-tertiary)]">{skill.description}</div>
            </button>
          ))}
        </div>
      )}
    </PanelShell>
  )
}

const COMMAND_GROUPS = [
  {
    titleKey: 'slash.help.group.context',
    names: ['clear', 'compact', 'context', 'cost', 'status', 'memory'],
  },
  {
    titleKey: 'slash.help.group.project',
    names: ['init', 'review', 'commit', 'pr'],
  },
  {
    titleKey: 'slash.help.group.desktop',
    names: ['help', 'model', 'config', 'permissions', 'terminal-setup', 'login', 'logout', 'agents', 'mcp', 'skills', 'plugin', 'doctor', 'bug'],
  },
] satisfies Array<{ titleKey: TranslationKey; names: string[] }>

function DoctorPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslation()
  const [health, setHealth] = useState<StatusHealthResponse | null>(null)
  const [diagnostics, setDiagnostics] = useState<StatusDiagnosticsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([statusApi.health(), statusApi.diagnostics()])
      .then(([nextHealth, nextDiagnostics]) => {
        setHealth(nextHealth)
        setDiagnostics(nextDiagnostics)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const payload = JSON.stringify({ health, diagnostics }, null, 2)

  return (
    <PanelShell title={t('slash.doctor.title')} subtitle={t('slash.doctor.subtitle')} onClose={onClose}>
      {loading ? (
        <LoadingState label={t('slash.doctor.loading')} />
      ) : error ? (
        <ErrorState message={error} />
      ) : !health || !diagnostics ? (
        <EmptyState title={t('slash.doctor.emptyTitle')} body={t('slash.doctor.emptyBody')} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton
              text={payload}
              label={t('slash.doctor.copy')}
              copiedLabel={t('app.copiedDiagnostics')}
              displayLabel={t('slash.doctor.copy')}
              displayCopiedLabel={t('app.copiedDiagnostics')}
              className="border border-[var(--color-border)] bg-[var(--color-surface-container)]"
            />
            <button
              type="button"
              onClick={load}
              className="inline-flex h-[30px] items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-2.5 text-[12px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              {t('slash.doctor.refresh')}
            </button>
          </div>
          <KeyValueRows
            rows={[
              [t('slash.doctor.status'), health.status],
              [t('slash.doctor.version'), health.version],
              [t('slash.doctor.uptime'), formatMilliseconds(health.uptime)],
              [t('slash.doctor.runtime'), `Node ${diagnostics.nodeVersion} · Bun ${diagnostics.bunVersion}`],
              [t('slash.doctor.platform'), `${diagnostics.platform} ${diagnostics.arch}`],
              [t('slash.doctor.configDir'), <span className="font-mono text-[13px]">{diagnostics.configDir}</span>],
              [t('slash.doctor.memory'), `${formatBytes(diagnostics.memory.heapUsed)} / ${formatBytes(diagnostics.memory.heapTotal)} heap · ${formatBytes(diagnostics.memory.rss)} RSS`],
            ]}
          />
        </div>
      )}
    </PanelShell>
  )
}

function MemoryPanel({
  sessionId,
  projectPath,
  onClose,
}: {
  sessionId?: string
  projectPath?: string
  onClose: () => void
}) {
  const t = useTranslation()
  const [data, setData] = useState<SessionInspectionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!sessionId) {
      setLoading(false)
      setError(t('slash.inspector.error.noActiveSession'))
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    sessionsApi.getInspection(sessionId, { includeContext: true, timeout: 45_000, projectPath })
      .then((response) => {
        if (!cancelled) setData(assertSessionInspectionResponse(response, t))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [sessionId, projectPath, t])

  const context = data?.context ?? data?.contextEstimate
  const memoryFiles = context?.memoryFiles ?? []

  return (
    <PanelShell title={t('slash.memory.title')} subtitle={t('slash.memory.subtitle')} onClose={onClose}>
      {loading ? (
        <LoadingState label={t('slash.memory.loading')} />
      ) : error ? (
        <ErrorState message={error} />
      ) : memoryFiles.length === 0 ? (
        <EmptyState title={t('slash.memory.emptyTitle')} body={t('slash.memory.emptyBody')} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          {memoryFiles.map((file) => (
            <div key={`${file.type}:${file.path}`} className="grid min-h-[76px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-[var(--color-border)] px-[16px] py-[12px] first:border-t-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--color-surface-hover)] px-2 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)]">
                    {file.type}
                  </span>
                  <span className="text-[12px] text-[var(--color-text-tertiary)]">
                    {t('slash.memory.tokens', { count: formatNumber(file.tokens) })}
                  </span>
                </div>
                <div className="mt-2 truncate font-mono text-[13px] text-[var(--color-text-primary)]" title={file.path}>
                  {file.path}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <CopyButton
                  text={file.path}
                  label={t('slash.memory.copyPath')}
                  copiedLabel={t('slash.memory.copiedPath')}
                  displayLabel={t('slash.memory.copyPath')}
                  displayCopiedLabel={t('slash.memory.copiedPath')}
                />
                <button
                  type="button"
                  onClick={() => openExternalTarget(file.path)}
                  className="inline-flex h-[30px] items-center rounded-[var(--radius-md)] px-2.5 text-[12px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-brand)]"
                >
                  {t('slash.memory.openFile')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  )
}

function BugPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslation()
  const openSettings = useUIStore((s) => s.openSettings)

  return (
    <PanelShell title={t('slash.bug.title')} subtitle={t('slash.bug.subtitle')} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => openExternalTarget(GITHUB_ISSUES_URL)}
          className="min-h-[96px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
            <Icon name="feedback" size={18} className="text-[var(--color-text-tertiary)]" />
            {t('slash.bug.openIssue')}
          </div>
          <p className="mt-2 text-[12px] leading-5 text-[var(--color-text-tertiary)]">{t('slash.bug.openIssueDesc')}</p>
        </button>
        <button
          type="button"
          onClick={() => {
            openSettings('about')
            onClose()
          }}
          className="min-h-[96px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
            <Icon name="info" size={18} className="text-[var(--color-text-tertiary)]" />
            {t('slash.bug.openAbout')}
          </div>
          <p className="mt-2 text-[12px] leading-5 text-[var(--color-text-tertiary)]">{t('slash.bug.openAboutDesc')}</p>
        </button>
      </div>
    </PanelShell>
  )
}

function HelpPanel({
  commands,
  onClose,
}: {
  commands?: SlashCommandOption[]
  onClose: () => void
}) {
  const t = useTranslation()
  const commandMap = useMemo(() => {
    const map = new Map<string, SlashCommandOption>()
    for (const command of commands ?? []) {
      map.set(command.name, command)
    }
    return map
  }, [commands])

  const groupedNames = new Set(COMMAND_GROUPS.flatMap((group) => group.names))
  const otherCommands = (commands ?? [])
    .filter((command) => !groupedNames.has(command.name))
    .slice(0, 12)
  const hiddenOtherCommandCount = Math.max(
    0,
    (commands ?? []).filter((command) => !groupedNames.has(command.name)).length - otherCommands.length,
  )

  const renderCommand = (command: SlashCommandOption) => (
    <div key={command.name} className="flex min-h-[56px] min-w-0 items-start gap-[12px] border-t border-[var(--color-border)] px-[16px] py-[12px] first:border-t-0">
      <div className="shrink-0 font-[var(--font-mono)] text-[14px] font-semibold text-[var(--color-brand)]">/{command.name}</div>
      <div className="min-w-0 flex-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">{command.description}</div>
    </div>
  )

  return (
    <PanelShell
      title={t('slash.help.title')}
      subtitle={t('slash.help.subtitle')}
      onClose={onClose}
    >
      <div className="space-y-4">
        {COMMAND_GROUPS.map((group) => {
          const entries = group.names
            .map((name) => commandMap.get(name))
            .filter((command): command is SlashCommandOption => Boolean(command))
          if (entries.length === 0) return null
          return (
            <section key={group.titleKey}>
              <div className="mb-2 text-[14px] font-semibold text-[var(--color-text-primary)]">{t(group.titleKey)}</div>
              <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                {entries.map(renderCommand)}
              </div>
            </section>
          )
        })}

        {otherCommands.length > 0 && (
          <section>
            <div className="mb-2 text-[14px] font-semibold text-[var(--color-text-primary)]">{t('slash.help.group.more')}</div>
            <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
              {otherCommands.map(renderCommand)}
            </div>
            {hiddenOtherCommandCount > 0 && (
              <p className="mt-2 text-[12px] leading-5 text-[var(--color-text-tertiary)]">
                {t('slash.help.moreAvailable', { count: hiddenOtherCommandCount })}
              </p>
            )}
          </section>
        )}
      </div>
    </PanelShell>
  )
}

export function LocalSlashCommandPanel({ command, sessionId, projectPath, cwd, commands, onClose }: Props) {
  if (command === 'mcp') return <McpPanel cwd={cwd} onClose={onClose} />
  if (command === 'skills') return <SkillsPanel cwd={cwd} onClose={onClose} />
  if (command === 'doctor') return <DoctorPanel onClose={onClose} />
  if (command === 'memory') return <MemoryPanel sessionId={sessionId} projectPath={projectPath} onClose={onClose} />
  if (command === 'bug') return <BugPanel onClose={onClose} />
  if (command === 'status' || command === 'cost' || command === 'context') {
    return <SessionInspectorPanel command={command} sessionId={sessionId} projectPath={projectPath} commands={commands} onClose={onClose} />
  }
  return <HelpPanel commands={commands} onClose={onClose} />
}
