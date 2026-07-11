import { useTranslation, type TranslationKey } from '../../i18n'
import type {
  PromptMemoryInsight,
  PromptMemoryInsightCategory,
  PromptMemoryInsights,
} from '../../api/promptMemory'
import { Icon } from '../shared/Icon'

const CATEGORY_KEYS: Record<PromptMemoryInsightCategory, TranslationKey> = {
  identity: 'settings.memory.insight.category.identity',
  communication: 'settings.memory.insight.category.communication',
  collaboration: 'settings.memory.insight.category.collaboration',
  workflow: 'settings.memory.insight.category.workflow',
  quality: 'settings.memory.insight.category.quality',
  boundaries: 'settings.memory.insight.category.boundaries',
  expertise: 'settings.memory.insight.category.expertise',
  'meta-method': 'settings.memory.insight.category.metaMethod',
  environment: 'settings.memory.insight.category.environment',
  lesson: 'settings.memory.insight.category.lesson',
  other: 'settings.memory.insight.category.other',
}

const SOURCE_KEYS: Record<PromptMemoryInsight['source'], TranslationKey> = {
  explicit: 'settings.memory.insight.source.explicit',
  observed: 'settings.memory.insight.source.observed',
  manual: 'settings.memory.insight.source.manual',
}

function InsightRow({
  insight,
  isRemoving,
  onEdit,
  onRemove,
}: {
  insight: PromptMemoryInsight
  isRemoving: boolean
  onEdit: (insight: PromptMemoryInsight) => void
  onRemove: (insight: PromptMemoryInsight) => void
}) {
  const t = useTranslation()
  return (
    <div className="group flex min-w-0 items-start gap-3 px-1 py-3">
      <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]">
        <Icon name={insight.target === 'user' ? 'person' : 'psychology'} size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold text-[var(--color-text-tertiary)]">
            {t(CATEGORY_KEYS[insight.category])}
          </span>
          <span className="rounded-md bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--color-text-tertiary)]">
            {t(SOURCE_KEYS[insight.source])}
          </span>
        </div>
        <p className="mt-1 break-words text-[12px] leading-5 text-[var(--color-text-secondary)]">
          {insight.content}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={() => onEdit(insight)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          aria-label={t('settings.memory.insight.edit')}
          title={t('settings.memory.insight.edit')}
        >
          <Icon name="edit" size={13} />
        </button>
        <button
          type="button"
          disabled={isRemoving}
          onClick={() => onRemove(insight)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-error)] disabled:opacity-40"
          aria-label={t('settings.memory.insight.remove')}
          title={t('settings.memory.insight.remove')}
        >
          <Icon name={isRemoving ? 'loading' : 'delete'} size={13} className={isRemoving ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  )
}

function InsightGroup({
  title,
  icon,
  insights,
  emptyText,
  removingId,
  onEdit,
  onRemove,
}: {
  title: string
  icon: 'person' | 'psychology'
  insights: PromptMemoryInsight[]
  emptyText: string
  removingId: string | null
  onEdit: (insight: PromptMemoryInsight) => void
  onRemove: (insight: PromptMemoryInsight) => void
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-center gap-2">
        <Icon name={icon} size={15} className="text-[var(--color-text-secondary)]" />
        <h3 className="text-[12px] font-semibold text-[var(--color-text-primary)]">
          {title}
        </h3>
        <span className="ml-auto text-[10px] text-[var(--color-text-tertiary)]">
          {insights.length}
        </span>
      </div>
      <div className="divide-y divide-[var(--color-border-separator)] border-y border-[var(--color-border-separator)]">
        {insights.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] leading-4 text-[var(--color-text-tertiary)]">
            {emptyText}
          </p>
        ) : insights.map(insight => (
          <InsightRow
            key={insight.id}
            insight={insight}
            isRemoving={removingId === insight.id}
            onEdit={onEdit}
            onRemove={onRemove}
          />
        ))}
      </div>
    </section>
  )
}

export function EvolutionProfile({
  overview,
  removingId,
  onEdit,
  onRemove,
}: {
  overview: PromptMemoryInsights | null
  removingId: string | null
  onEdit: (insight: PromptMemoryInsight) => void
  onRemove: (insight: PromptMemoryInsight) => void
}) {
  const t = useTranslation()
  const userInsights = overview?.insights.filter(insight => insight.target === 'user') ?? []
  const methodInsights = overview?.insights.filter(insight => insight.target === 'brief') ?? []
  const stats = overview?.stats ?? {
    total: 0,
    user: 0,
    methods: 0,
    dimensions: 0,
    automaticUpdates: 0,
  }

  const summary = [
    ['settings.memory.insight.stat.total', stats.total],
    ['settings.memory.insight.stat.dimensions', stats.dimensions],
    ['settings.memory.insight.stat.user', stats.user],
    ['settings.memory.insight.stat.methods', stats.methods],
  ] as const

  return (
    <>
      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--color-border-separator)] sm:grid-cols-4 sm:divide-y-0">
        {summary.map(([key, value]) => (
          <div key={key} className="min-w-0 px-4 py-3.5">
            <div className="text-[18px] font-bold text-[var(--color-text-primary)]">{value}</div>
            <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">{t(key)}</div>
          </div>
        ))}
      </div>
      <div className="grid min-w-0 gap-6 px-5 py-4 lg:grid-cols-2">
        <InsightGroup
          title={t('settings.memory.insight.userTitle')}
          icon="person"
          insights={userInsights}
          emptyText={t('settings.memory.insight.userEmpty')}
          removingId={removingId}
          onEdit={onEdit}
          onRemove={onRemove}
        />
        <InsightGroup
          title={t('settings.memory.insight.methodTitle')}
          icon="psychology"
          insights={methodInsights}
          emptyText={t('settings.memory.insight.methodEmpty')}
          removingId={removingId}
          onEdit={onEdit}
          onRemove={onRemove}
        />
      </div>
    </>
  )
}
