import { useState } from 'react'
import { useTranslation } from '../../i18n'
import { useSkillLearningStore } from '../../stores/skillLearningStore'
import { useSkillStore } from '../../stores/skillStore'
import { useUIStore } from '../../stores/uiStore'
import type {
  SkillCandidate,
  SkillLearningEvent,
  SkillLearningMode,
  SkillLearningOverview,
} from '../../types/skill'
import { Button } from '../shared/Button'
import { Icon } from '../shared/Icon'

export type SkillLearningView = 'pending' | 'learning'

function formatDate(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function confidencePercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function learningEventText(
  event: SkillLearningEvent,
  t: ReturnType<typeof useTranslation>,
  minToolUses: number,
): string {
  const name = event.skillName ?? ''
  switch (event.kind) {
    case 'review-skipped':
      return t('settings.skills.learning.event.reviewSkipped', {
        count: event.toolUseCount ?? 0,
        required: minToolUses,
      })
    case 'review-started':
      return t('settings.skills.learning.event.reviewStarted')
    case 'candidate-created':
      return t('settings.skills.learning.event.candidateCreated', { name })
    case 'candidate-auto-approved':
      return t('settings.skills.learning.event.autoApproved', { name })
    case 'no-candidate':
      return t('settings.skills.learning.event.noCandidate')
    case 'candidate-reused':
      return t('settings.skills.learning.event.reused', { name })
    case 'review-failed':
      return t('settings.skills.learning.event.failed', { error: event.message })
    case 'candidate-approved':
      return t('settings.skills.learning.event.approved', { name })
    case 'candidate-rejected':
      return t('settings.skills.learning.event.rejected', { name })
  }
}

export function SkillLearningModeControl({ cwd }: { cwd?: string }) {
  const overview = useSkillLearningStore((state) => state.overview)
  const setMode = useSkillLearningStore((state) => state.setMode)
  const addToast = useUIStore((state) => state.addToast)
  const t = useTranslation()
  const mode = overview?.config.mode ?? 'suggest'
  const modes: SkillLearningMode[] = ['off', 'suggest', 'auto']

  const handleModeChange = async (nextMode: SkillLearningMode) => {
    try {
      await setMode(nextMode, cwd)
    } catch (error) {
      addToast({
        type: 'error',
        message: t('settings.skills.learning.actionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    }
  }

  return (
    <div
      className="inline-flex h-[34px] items-center gap-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-0.5"
      aria-label={t('settings.skills.learning.mode')}
    >
      {modes.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => void handleModeChange(item)}
          className={`h-[28px] rounded-md px-2.5 text-[11px] font-semibold transition-colors ${
            mode === item
              ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm'
              : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
          }`}
          title={t(`settings.skills.learning.mode.${item}.hint`)}
          aria-pressed={mode === item}
        >
          {t(`settings.skills.learning.mode.${item}`)}
        </button>
      ))}
    </div>
  )
}

function CandidateRow({
  candidate,
  cwd,
}: {
  candidate: SkillCandidate
  cwd?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const pendingCandidateId = useSkillLearningStore(
    (state) => state.pendingCandidateId,
  )
  const approveCandidate = useSkillLearningStore(
    (state) => state.approveCandidate,
  )
  const rejectCandidate = useSkillLearningStore(
    (state) => state.rejectCandidate,
  )
  const fetchSkills = useSkillStore((state) => state.fetchSkills)
  const addToast = useUIStore((state) => state.addToast)
  const t = useTranslation()
  const isPending = pendingCandidateId === candidate.id

  const approve = async () => {
    try {
      await approveCandidate(candidate.id, cwd)
      await fetchSkills(cwd)
      addToast({
        type: 'success',
        message: t('settings.skills.learning.saved', { name: candidate.name }),
      })
    } catch (error) {
      addToast({
        type: 'error',
        message: t('settings.skills.learning.actionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    }
  }

  const reject = async () => {
    try {
      await rejectCandidate(candidate.id, cwd)
      addToast({
        type: 'success',
        message: t('settings.skills.learning.rejected'),
      })
    } catch (error) {
      addToast({
        type: 'error',
        message: t('settings.skills.learning.actionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    }
  }

  return (
    <article className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-surface-container-high)] text-[var(--color-brand)]">
          <Icon name={candidate.action === 'update' ? 'edit' : 'auto_awesome'} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="break-all text-[14px] font-semibold text-[var(--color-text-primary)]">
              /{candidate.name}
            </h3>
            <span className="rounded-md bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]">
              {t(`settings.skills.learning.action.${candidate.action}`)}
            </span>
            <span className="text-[10px] font-medium text-[var(--color-text-tertiary)]">
              {t(`settings.skills.learning.scope.${candidate.scope}`)}
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
            {candidate.description}
          </p>
          <p className="mt-2 text-[12px] leading-5 text-[var(--color-text-tertiary)]">
            {candidate.reason}
          </p>
          {candidate.evidence.length > 0 && (
            <div className="mt-2 space-y-1 border-l-2 border-[var(--color-border)] pl-2.5">
              {candidate.evidence.slice(0, 3).map((item) => (
                <p key={item} className="text-[11px] leading-4 text-[var(--color-text-tertiary)]">
                  {item}
                </p>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--color-text-tertiary)]">
            <span>{t('settings.skills.learning.confidence', { count: confidencePercent(candidate.confidence) })}</span>
            <span>{t('settings.skills.learning.toolUses', { count: candidate.sourceToolUses })}</span>
            <span>{formatDate(candidate.createdAt)}</span>
            {candidate.duplicate && (
              <span>{t('settings.skills.learning.overlaps', { name: candidate.duplicate.skillName })}</span>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <pre className="max-h-[320px] overflow-auto border-y border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3 text-[11px] leading-[18px] text-[var(--color-text-secondary)] whitespace-pre-wrap">
          {candidate.markdown}
        </pre>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <Icon name={expanded ? 'expand_less' : 'code'} size={14} />
          {t(expanded ? 'settings.skills.learning.hideDraft' : 'settings.skills.learning.viewDraft')}
        </button>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => void reject()}
            icon={<Icon name="close" size={14} />}
            className="h-8 rounded-md px-2.5 text-[11px]"
          >
            {t('settings.skills.learning.reject')}
          </Button>
          <Button
            type="button"
            size="sm"
            loading={isPending}
            onClick={() => void approve()}
            icon={<Icon name="check" size={14} />}
            className="h-8 rounded-md px-3 text-[11px]"
          >
            {t('settings.skills.learning.approve')}
          </Button>
        </div>
      </div>
    </article>
  )
}

function PendingCandidates({
  overview,
  cwd,
}: {
  overview: SkillLearningOverview
  cwd?: string
}) {
  const t = useTranslation()
  if (overview.pendingCandidates.length === 0) {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center border-y border-[var(--color-border)] px-6 text-center">
        <Icon name="check_circle" size={28} className="text-[var(--color-text-tertiary)]" />
        <p className="mt-3 text-[13px] font-semibold text-[var(--color-text-primary)]">
          {t('settings.skills.learning.pendingEmpty')}
        </p>
        <p className="mt-1 max-w-[420px] text-[12px] leading-5 text-[var(--color-text-tertiary)]">
          {t('settings.skills.learning.pendingEmptyHint')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {overview.pendingCandidates.map((candidate) => (
        <CandidateRow key={candidate.id} candidate={candidate} cwd={cwd} />
      ))}
    </div>
  )
}

function LearningActivity({ overview }: { overview: SkillLearningOverview }) {
  const t = useTranslation()
  const isEnabled = overview.config.mode !== 'off'
  const latestEvent = overview.events[0]
  const recentCandidates = overview.recentCandidates ?? []
  return (
    <div className="space-y-5">
      <section className="flex min-h-[68px] items-center justify-between gap-4 border-y border-[var(--color-border)] px-1 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${isEnabled ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'}`} />
          <div className="min-w-0">
            <h3 className="text-[12px] font-semibold text-[var(--color-text-primary)]">
              {t(isEnabled
                ? 'settings.skills.learning.status.running'
                : 'settings.skills.learning.status.paused')}
            </h3>
            <p className="mt-1 text-[10px] leading-4 text-[var(--color-text-tertiary)]">
              {overview.config.mode === 'auto'
                ? t('settings.skills.learning.status.autoHint', {
                    tools: overview.config.minToolUses,
                    confidence: confidencePercent(overview.config.autoApproveConfidence),
                  })
                : overview.config.mode === 'suggest'
                  ? t('settings.skills.learning.status.suggestHint', {
                      tools: overview.config.minToolUses,
                    })
                  : t('settings.skills.learning.mode.off.hint')}
            </p>
          </div>
        </div>
        {latestEvent && (
          <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">
            {t('settings.skills.learning.status.lastActivity', {
              date: formatDate(latestEvent.createdAt),
            })}
          </span>
        )}
      </section>

      {recentCandidates.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[12px] font-semibold text-[var(--color-text-primary)]">
              {t('settings.skills.learning.recentTitle')}
            </h3>
            <span className="text-[10px] text-[var(--color-text-tertiary)]">
              {recentCandidates.length}
            </span>
          </div>
          <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {recentCandidates.slice(0, 12).map((candidate) => (
              <div key={candidate.id} className="flex items-start gap-3 px-1 py-3">
                <Icon
                  name={candidate.status === 'approved'
                    ? 'check_circle'
                    : candidate.status === 'failed'
                      ? 'error'
                      : 'close'}
                  size={15}
                  className={`mt-0.5 ${candidate.status === 'failed' ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all text-[12px] font-semibold text-[var(--color-text-primary)]">
                      /{candidate.name}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">
                      {t(`settings.skills.learning.candidateStatus.${candidate.status}`)}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">
                      {t(`settings.skills.learning.action.${candidate.action}`)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--color-text-secondary)]">
                    {candidate.description}
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">
                    {formatDate(candidate.updatedAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[12px] font-semibold text-[var(--color-text-primary)]">
            {t('settings.skills.learning.memoryTitle')}
          </h3>
          <span className="text-[10px] text-[var(--color-text-tertiary)]">
            {overview.memories.length}
          </span>
        </div>
        <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {overview.memories.length === 0 ? (
            <p className="px-1 py-6 text-center text-[12px] text-[var(--color-text-tertiary)]">
              {t('settings.skills.learning.memoryEmpty')}
            </p>
          ) : overview.memories.map((memory) => (
            <div key={memory.id} className="flex items-start gap-3 px-1 py-3">
              <Icon name="memory" size={15} className="mt-0.5 text-[var(--color-text-tertiary)]" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">/{memory.skillName}</span>
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">{t(`settings.skills.learning.scope.${memory.scope}`)}</span>
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">
                    {t(`settings.skills.learning.status.${memory.status}`)}
                  </span>
                </div>
                {memory.summary && (
                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--color-text-secondary)]">
                    {memory.summary}
                  </p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-3 text-[10px] text-[var(--color-text-tertiary)]">
                  <span>{t('settings.skills.learning.uses', { count: memory.useCount })}</span>
                  <span>{t('settings.skills.learning.pendingNotes', { count: memory.pendingCount })}</span>
                  <span>{t('settings.skills.learning.evidence', { count: memory.evidenceCount })}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[12px] font-semibold text-[var(--color-text-primary)]">
            {t('settings.skills.learning.activityTitle')}
          </h3>
          <span className="text-[10px] text-[var(--color-text-tertiary)]">
            {overview.events.length}
          </span>
        </div>
        <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {overview.events.length === 0 ? (
            <p className="px-1 py-6 text-center text-[12px] text-[var(--color-text-tertiary)]">
              {t('settings.skills.learning.activityEmpty')}
            </p>
          ) : overview.events.map((event) => (
            <div key={event.id} className="flex items-start gap-3 px-1 py-3">
              <Icon
                name={event.kind === 'review-failed' ? 'error' : event.kind.includes('approved') ? 'check_circle' : 'history'}
                size={14}
                className={`mt-0.5 ${event.kind === 'review-failed' ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] leading-4 text-[var(--color-text-secondary)]">
                  {learningEventText(event, t, overview.config.minToolUses)}
                </p>
                <p className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">
                  {formatDate(event.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export function SkillLearningPanel({
  view,
  cwd,
}: {
  view: SkillLearningView
  cwd?: string
}) {
  const overview = useSkillLearningStore((state) => state.overview)
  const isLoading = useSkillLearningStore((state) => state.isLoading)
  const error = useSkillLearningStore((state) => state.error)

  if (isLoading && !overview) {
    return (
      <div className="flex min-h-[260px] items-center justify-center">
        <Icon name="loading" size={20} className="animate-spin text-[var(--color-text-tertiary)]" />
      </div>
    )
  }
  if (error && !overview) {
    return <div className="py-6 text-[12px] text-[var(--color-error)]">{error}</div>
  }
  if (!overview) return null

  return view === 'pending'
    ? <PendingCandidates overview={overview} cwd={cwd} />
    : <LearningActivity overview={overview} />
}
