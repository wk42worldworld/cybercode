import { useCallback, useEffect, useMemo, useState } from 'react'
import { skillsApi } from '../../api/skills'
import { useTranslation } from '../../i18n'
import { openExternalUrl } from '../../lib/openExternalUrl'
import { useSkillStore } from '../../stores/skillStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import type {
  SkillMarketplaceCatalog,
  SkillMarketplaceItem,
  SkillMarketplaceScope,
} from '../../types/skill'
import {
  marketplaceCategoryKey,
  marketplaceCategoryLabel,
  marketplaceDescription,
  sortMarketplaceItems,
  type MarketplaceSortMode,
} from '../../utils/marketplaceLocalization'
import { Button } from '../shared/Button'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { Icon } from '../shared/Icon'
import { SelectField } from '../shared/SelectField'

type SkillMarketplaceProps = {
  cwd?: string
}

type MarketplaceAction = 'install' | 'update' | 'uninstall'

const catalogCache = new Map<string, SkillMarketplaceCatalog>()

export function SkillMarketplace({ cwd }: SkillMarketplaceProps) {
  const t = useTranslation()
  const locale = useSettingsStore((state) => state.locale)
  const fetchInstalledSkills = useSkillStore((state) => state.fetchSkills)
  const cacheKey = cwd ?? 'user'
  const [catalog, setCatalog] = useState<SkillMarketplaceCatalog | null>(
    () => catalogCache.get(cacheKey) ?? null,
  )
  const [isLoading, setIsLoading] = useState(!catalogCache.has(cacheKey))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortMode, setSortMode] = useState<MarketplaceSortMode>('recommended')
  const [scope, setScope] = useState<SkillMarketplaceScope>(cwd ? 'project' : 'user')
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [removeItem, setRemoveItem] = useState<SkillMarketplaceItem | null>(null)

  const loadCatalog = useCallback(async (refresh = false) => {
    if (refresh) setIsRefreshing(true)
    else if (!catalogCache.has(cacheKey)) setIsLoading(true)
    setError(null)
    try {
      const response = await skillsApi.marketplace(cwd, refresh)
      catalogCache.set(cacheKey, response.catalog)
      setCatalog(response.catalog)
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t('settings.skills.market.error'),
      )
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [cacheKey, cwd, t])

  useEffect(() => {
    const cached = catalogCache.get(cacheKey) ?? null
    setCatalog(cached)
    setIsLoading(!cached)
    void loadCatalog(false)
  }, [cacheKey, loadCatalog])

  useEffect(() => {
    if (!cwd && scope === 'project') setScope('user')
  }, [cwd, scope])

  const sourceOptions = useMemo(() => [
    { value: 'all', label: t('settings.skills.market.sourceAll') },
    ...(catalog?.sources ?? []).map((source) => ({
      value: source.id,
      label: `${source.name} (${source.itemCount})`,
    })),
  ], [catalog?.sources, t])

  const categoryOptions = useMemo(() => {
    const categories = new Set(
      (catalog?.items ?? [])
        .filter((item) => sourceFilter === 'all' || item.sourceId === sourceFilter)
        .map((item) => marketplaceCategoryKey(item.category)),
    )
    return [
      { value: 'all', label: t('settings.skills.market.categoryAll') },
      ...Array.from(categories)
        .sort((a, b) => marketplaceCategoryLabel(a, locale).localeCompare(
          marketplaceCategoryLabel(b, locale),
          locale,
        ))
        .map((category) => ({
          value: category,
          label: marketplaceCategoryLabel(category, locale),
        })),
    ]
  }, [catalog?.items, locale, sourceFilter, t])

  const sortOptions = useMemo(() => [
    { value: 'recommended' as const, label: t('settings.skills.market.sortRecommended') },
    { value: 'newest' as const, label: t('settings.skills.market.sortNewest') },
    { value: 'popular' as const, label: t('settings.skills.market.sortPopular') },
    { value: 'name' as const, label: t('settings.skills.market.sortName') },
  ], [t])

  useEffect(() => {
    if (!categoryOptions.some((option) => option.value === categoryFilter)) {
      setCategoryFilter('all')
    }
  }, [categoryFilter, categoryOptions])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const matches = (catalog?.items ?? []).filter((item) => {
      if (sourceFilter !== 'all' && item.sourceId !== sourceFilter) return false
      if (
        categoryFilter !== 'all'
        && marketplaceCategoryKey(item.category) !== categoryFilter
      ) return false
      if (!normalizedQuery) return true
      const categoryLabel = marketplaceCategoryLabel(item.category, locale)
      return [
        item.displayName,
        item.name,
        marketplaceDescription(item, locale, 'skill'),
        item.sourceName,
        item.category,
        categoryLabel,
        ...item.tags,
      ].some((value) => value.toLowerCase().includes(normalizedQuery))
    })
    return sortMarketplaceItems(matches, sortMode, locale)
  }, [catalog?.items, categoryFilter, locale, query, sortMode, sourceFilter])

  const failedSources = (catalog?.sources ?? []).filter(
    (source) => source.status !== 'ready',
  )

  const runAction = useCallback(async (
    action: MarketplaceAction,
    item: SkillMarketplaceItem,
  ) => {
    const operationKey = `${action}:${scope}:${item.id}`
    setPendingAction(operationKey)
    try {
      if (action === 'uninstall') {
        await skillsApi.uninstallMarketplaceItem(item.id, scope, cwd)
      } else {
        await skillsApi.installMarketplaceItem(item.id, scope, cwd)
      }
      await Promise.all([
        loadCatalog(false),
        fetchInstalledSkills(cwd),
      ])
      useUIStore.getState().addToast({
        type: 'success',
        message: action === 'install'
          ? t('settings.skills.market.installed', { name: item.displayName })
          : action === 'update'
            ? t('settings.skills.market.updated', { name: item.displayName })
            : t('settings.skills.market.removed', { name: item.displayName }),
      })
      if (action === 'uninstall') setRemoveItem(null)
    } catch (actionError) {
      useUIStore.getState().addToast({
        type: 'error',
        message: actionError instanceof Error
          ? actionError.message
          : t('settings.skills.market.actionFailed'),
      })
    } finally {
      setPendingAction(null)
    }
  }, [cwd, fetchInstalledSkills, loadCatalog, scope, t])

  if (isLoading && !catalog) {
    return (
      <div className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex h-[56px] items-center gap-3 border-b border-[var(--color-border-separator)] px-4">
          <Icon name="loading" size={15} className="animate-spin text-[var(--color-text-tertiary)]" />
          <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
            {t('settings.skills.market.loading')}
          </span>
        </div>
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex h-[88px] animate-pulse items-center gap-3 border-b border-[var(--color-border-separator)] px-4 last:border-b-0">
            <div className="h-9 w-9 rounded-[7px] bg-[var(--color-surface-container-high)]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-1/3 rounded bg-[var(--color-surface-container-high)]" />
              <div className="h-2.5 w-2/3 rounded bg-[var(--color-surface-container)]" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error && !catalog) {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 text-center">
        <Icon name="error_outline" size={22} className="text-[var(--color-error)]" />
        <p className="mt-3 text-[13px] font-semibold text-[var(--color-text-primary)]">
          {t('settings.skills.market.error')}
        </p>
        <p className="mt-1 max-w-[440px] text-[11px] leading-5 text-[var(--color-text-tertiary)]">
          {error}
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4 h-[32px] rounded-[6px] px-3 shadow-none"
          icon={<Icon name="refresh" size={13} />}
          onClick={() => void loadCatalog(true)}
        >
          {t('common.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)_42px] gap-2">
          <label className="relative block min-w-0">
            <Icon
              name="search"
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('settings.skills.market.searchPlaceholder')}
              aria-label={t('settings.skills.market.searchLabel')}
              className="h-[42px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] pl-9 pr-3 text-[12px] font-medium text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={isRefreshing}
            onClick={() => void loadCatalog(true)}
            icon={<Icon name="refresh" size={14} />}
            className="h-[42px] w-[42px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-0 shadow-none"
            aria-label={t('settings.skills.market.refresh')}
            title={t('settings.skills.market.refresh')}
          />
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">
          <SelectField
            value={sourceFilter}
            onChange={setSourceFilter}
            options={sourceOptions}
            ariaLabel={t('settings.skills.market.source')}
          />
          <SelectField
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={categoryOptions}
            ariaLabel={t('settings.skills.market.category')}
          />
          <SelectField
            value={scope}
            onChange={setScope}
            options={cwd
              ? [
                  { value: 'user', label: t('settings.skills.market.scopeUser') },
                  { value: 'project', label: t('settings.skills.market.scopeProject') },
                ]
              : [{ value: 'user', label: t('settings.skills.market.scopeUser') }]}
            ariaLabel={t('settings.skills.market.scope')}
          />
          <SelectField
            value={sortMode}
            onChange={setSortMode}
            options={sortOptions}
            ariaLabel={t('settings.skills.market.sort')}
          />
        </div>
      </div>

      {failedSources.length > 0 && (
        <div className="flex min-h-[34px] flex-wrap items-center gap-x-3 gap-y-1 rounded-[7px] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 px-3 py-1.5 text-[11px] text-[var(--color-text-secondary)]">
          <Icon name="warning" size={13} className="text-[var(--color-warning)]" />
          <span>{t('settings.skills.market.sourceWarning')}</span>
          {failedSources.map((source) => (
            <span key={source.id} title={source.error} className="font-semibold text-[var(--color-text-primary)]">
              {source.name}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 px-0.5 text-[11px] text-[var(--color-text-tertiary)]">
        <span>{t('settings.skills.market.results', { count: filteredItems.length })}</span>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="shield" size={12} />
          {t('settings.skills.market.safety')}
        </span>
      </div>

      {filteredItems.length === 0 ? (
        <div className="flex min-h-[180px] flex-col items-center justify-center rounded-[8px] border border-dashed border-[var(--color-border)] px-4 text-center">
          <Icon name="search" size={20} className="text-[var(--color-text-tertiary)]" />
          <p className="mt-2 text-[12px] font-semibold text-[var(--color-text-secondary)]">
            {t('settings.skills.market.empty')}
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)]">
          {filteredItems.map((item) => {
            const installation = item.installations.find((entry) => entry.scope === scope)
            const isManaged = installation?.managed === true
            const hasConflict = Boolean(installation && !installation.managed)
            const isBusy = pendingAction?.endsWith(`:${item.id}`) === true
            const installedElsewhere = item.installations.find((entry) => entry.scope !== scope && entry.managed)

            return (
              <li
                key={item.id}
                className="flex min-h-[92px] items-center gap-3 border-b border-[var(--color-border-separator)] px-4 py-3 last:border-b-0"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] text-[var(--color-text-secondary)]">
                  <Icon name="package" size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                      {item.displayName}
                    </span>
                    <button
                      type="button"
                      onClick={() => void openExternalUrl(item.sourceUrl)}
                      className="inline-flex h-[20px] items-center gap-1 rounded-[5px] bg-[var(--color-surface-container-high)] px-1.5 text-[9px] font-semibold text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
                      title={t('settings.skills.market.openSource')}
                      aria-label={t('settings.skills.market.openSourceNamed', { name: item.sourceName })}
                    >
                      {item.sourceName}
                      <Icon name="open_in_new" size={9} />
                    </button>
                    {item.version && (
                      <span className="font-mono text-[9px] text-[var(--color-text-tertiary)]">
                        v{item.version}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-[17px] text-[var(--color-text-secondary)]">
                    {marketplaceDescription(item, locale, 'skill')}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[9px] font-medium text-[var(--color-text-tertiary)]">
                    <span>{marketplaceCategoryLabel(item.category, locale)}</span>
                    {item.license && <span>· {item.license}</span>}
                    {installedElsewhere && (
                      <span className="rounded-[4px] bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[var(--color-text-secondary)]">
                        {installedElsewhere.scope === 'project'
                          ? t('settings.skills.market.installedProject')
                          : t('settings.skills.market.installedUser')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {hasConflict ? (
                    <span className="max-w-[112px] text-right text-[10px] font-medium leading-4 text-[var(--color-warning)]">
                      {t('settings.skills.market.conflict')}
                    </span>
                  ) : isManaged && installation.updateAvailable ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={isBusy}
                      onClick={() => void runAction('update', item)}
                      icon={<Icon name="sync" size={13} />}
                      className="h-[32px] rounded-[6px] px-3 shadow-none"
                    >
                      {t('settings.skills.market.update')}
                    </Button>
                  ) : isManaged ? (
                    <>
                      <span className="inline-flex h-[28px] items-center gap-1 text-[10px] font-semibold text-[var(--color-success)]">
                        <Icon name="check" size={12} />
                        {t('settings.skills.market.installedState')}
                      </span>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setRemoveItem(item)}
                        className="flex h-[30px] w-[30px] items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)] disabled:opacity-40"
                        aria-label={t('settings.skills.market.removeNamed', { name: item.displayName })}
                        title={t('settings.skills.market.remove')}
                      >
                        <Icon name="delete" size={13} />
                      </button>
                    </>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      loading={isBusy}
                      onClick={() => void runAction('install', item)}
                      icon={<Icon name="download" size={13} />}
                      className="h-[32px] rounded-[6px] px-3 shadow-none"
                    >
                      {t('settings.skills.market.install')}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(removeItem)}
        onClose={() => setRemoveItem(null)}
        onConfirm={() => removeItem ? runAction('uninstall', removeItem) : undefined}
        title={t('settings.skills.market.removeTitle')}
        body={t('settings.skills.market.removeBody', { name: removeItem?.displayName ?? '' })}
        confirmLabel={t('settings.skills.market.remove')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={Boolean(removeItem && pendingAction === `uninstall:${scope}:${removeItem.id}`)}
      />
    </div>
  )
}
