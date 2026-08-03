import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pluginsApi } from '../../api/plugins'
import { useTranslation } from '../../i18n'
import { openExternalUrl } from '../../lib/openExternalUrl'
import { usePluginStore } from '../../stores/pluginStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import type {
  PluginMarketplaceCatalog,
  PluginMarketplaceItem,
} from '../../types/plugin'
import {
  marketplaceCategoryKey,
  marketplaceCategoryLabel,
  marketplaceDescription,
  marketplaceFeatureLabel,
  marketplaceSourceLabel,
  sortMarketplaceItems,
  type MarketplaceSortMode,
} from '../../utils/marketplaceLocalization'
import { Button } from '../shared/Button'
import { Icon } from '../shared/Icon'
import { SelectField } from '../shared/SelectField'

type PluginMarketplaceProps = {
  cwd?: string
}

const catalogCache = new Map<string, PluginMarketplaceCatalog>()
const PAGE_SIZE = 50

function PluginLogo({ item }: { item: PluginMarketplaceItem }) {
  const [failed, setFailed] = useState(false)
  const fallback = item.displayName.trim().slice(0, 2).toUpperCase()

  useEffect(() => {
    setFailed(false)
  }, [item.iconUrl])

  return (
    <div
      className="flex h-[50px] w-[50px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)]"
      style={item.brandColor ? { backgroundColor: item.brandColor } : undefined}
    >
      {item.iconUrl && !failed ? (
        <img
          src={item.iconUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-[12px] font-bold text-[var(--color-text-secondary)]">
          {fallback}
        </span>
      )}
    </div>
  )
}

export function PluginMarketplace({ cwd }: PluginMarketplaceProps) {
  const t = useTranslation()
  const locale = useSettingsStore((state) => state.locale)
  const cacheKey = cwd ?? 'user'
  const reloadPlugins = usePluginStore((state) => state.reloadPlugins)
  const [catalog, setCatalog] = useState<PluginMarketplaceCatalog | null>(
    () => catalogCache.get(cacheKey) ?? null,
  )
  const [isLoading, setIsLoading] = useState(!catalogCache.has(cacheKey))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortMode, setSortMode] = useState<MarketplaceSortMode>('recommended')
  const [pendingItemId, setPendingItemId] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const catalogAbortRef = useRef<AbortController | null>(null)
  const catalogRequestIdRef = useRef(0)
  const installInFlightRef = useRef(false)
  const mountedRef = useRef(true)

  const loadCatalog = useCallback(async (refresh = false) => {
    catalogAbortRef.current?.abort()
    const controller = new AbortController()
    const requestId = ++catalogRequestIdRef.current
    const hasCachedCatalog = catalogCache.has(cacheKey)
    catalogAbortRef.current = controller

    if (!hasCachedCatalog) setIsLoading(true)
    setIsRefreshing(refresh && hasCachedCatalog)
    setError(null)
    try {
      const response = await pluginsApi.marketplace(refresh, controller.signal)
      if (controller.signal.aborted || requestId !== catalogRequestIdRef.current) return
      catalogCache.set(cacheKey, response.catalog)
      setCatalog(response.catalog)
    } catch (loadError) {
      if (controller.signal.aborted || requestId !== catalogRequestIdRef.current) return
      setError(
        loadError instanceof Error
          ? loadError.message
          : t('settings.plugins.market.error'),
      )
    } finally {
      if (requestId === catalogRequestIdRef.current && mountedRef.current) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [cacheKey, t])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      catalogAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    const cached = catalogCache.get(cacheKey) ?? null
    setCatalog(cached)
    setIsLoading(!cached)
    void loadCatalog(false)
    return () => catalogAbortRef.current?.abort()
  }, [cacheKey, loadCatalog])

  const sourceOptions = useMemo(() => [
    { value: 'all', label: t('settings.plugins.market.sourceAll') },
    ...(catalog?.sources ?? []).map((source) => ({
      value: source.id,
      label: `${marketplaceSourceLabel(source.name, locale)} (${source.itemCount})`,
    })),
  ], [catalog?.sources, locale, t])

  const categoryOptions = useMemo(() => {
    const values = new Set(
      (catalog?.items ?? [])
        .filter((item) => sourceFilter === 'all' || item.sourceId === sourceFilter)
        .map((item) => marketplaceCategoryKey(item.category)),
    )
    return [
      { value: 'all', label: t('settings.plugins.market.categoryAll') },
      ...Array.from(values)
        .sort((a, b) => (
          marketplaceCategoryLabel(a, locale).localeCompare(
            marketplaceCategoryLabel(b, locale),
            locale,
          )
        ))
        .map((category) => ({
          value: category,
          label: marketplaceCategoryLabel(category, locale),
        })),
    ]
  }, [catalog?.items, locale, sourceFilter, t])

  const sortOptions = useMemo(() => [
    { value: 'recommended' as const, label: t('settings.plugins.market.sortRecommended') },
    { value: 'newest' as const, label: t('settings.plugins.market.sortNewest') },
    { value: 'popular' as const, label: t('settings.plugins.market.sortPopular') },
    { value: 'name' as const, label: t('settings.plugins.market.sortName') },
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
      const featureLabels = item.features.map((feature) => (
        marketplaceFeatureLabel(feature, locale)
      ))
      return [
        item.displayName,
        item.name,
        marketplaceDescription(item, locale, 'plugin', item.features),
        item.author ?? '',
        item.sourceName,
        item.category,
        categoryLabel,
        ...item.tags,
        ...featureLabels,
      ].some((value) => value.toLowerCase().includes(normalizedQuery))
    })
    return sortMarketplaceItems(matches, sortMode, locale)
  }, [catalog?.items, categoryFilter, locale, query, sortMode, sourceFilter])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [categoryFilter, query, sortMode, sourceFilter])

  const visibleItems = filteredItems.slice(0, visibleCount)

  const failedSources = (catalog?.sources ?? []).filter(
    (source) => source.status !== 'ready',
  )

  const installItem = useCallback(async (item: PluginMarketplaceItem) => {
    if (installInFlightRef.current) return
    installInFlightRef.current = true
    setPendingItemId(item.id)
    try {
      const result = await pluginsApi.installMarketplaceItem(item.id)
      setCatalog((current) => {
        if (!current || !result.item?.id) return current
        const next = {
          ...current,
          items: current.items.map((entry) => (
            entry.id === result.item.id ? result.item : entry
          )),
        }
        catalogCache.set(cacheKey, next)
        return next
      })

      let reloadError: unknown = null
      try {
        await reloadPlugins(cwd)
      } catch (error) {
        reloadError = error
      }
      await loadCatalog(false)

      if (reloadError) {
        useUIStore.getState().addToast({
          type: 'success',
          message: `${item.displayName}: ${result.updated
            ? t('settings.plugins.market.update')
            : t('settings.plugins.market.installedState')}`,
        })
        useUIStore.getState().addToast({
          type: 'error',
          message: `${t('settings.plugins.apply')}: ${reloadError instanceof Error
            ? reloadError.message
            : t('settings.plugins.market.actionFailed')}`,
        })
      } else {
        useUIStore.getState().addToast({
          type: 'success',
          message: result.updated
            ? t('settings.plugins.market.updated', { name: item.displayName })
            : t('settings.plugins.market.installed', { name: item.displayName }),
        })
      }
    } catch (actionError) {
      useUIStore.getState().addToast({
        type: 'error',
        message: actionError instanceof Error
          ? actionError.message
          : t('settings.plugins.market.actionFailed'),
      })
    } finally {
      installInFlightRef.current = false
      if (mountedRef.current) setPendingItemId(null)
    }
  }, [cacheKey, cwd, loadCatalog, reloadPlugins, t])

  if (isLoading && !catalog) {
    return (
      <div className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex h-[56px] items-center gap-3 border-b border-[var(--color-border-separator)] px-4">
          <Icon name="loading" size={15} className="animate-spin text-[var(--color-text-tertiary)]" />
          <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
            {t('settings.plugins.market.loading')}
          </span>
        </div>
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex h-[96px] animate-pulse items-center gap-3 border-b border-[var(--color-border-separator)] px-4 last:border-b-0">
            <div className="h-[50px] w-[50px] rounded-[8px] bg-[var(--color-surface-container-high)]" />
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
          {t('settings.plugins.market.error')}
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
            placeholder={t('settings.plugins.market.searchPlaceholder')}
            aria-label={t('settings.plugins.market.searchLabel')}
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
          aria-label={t('settings.plugins.market.refresh')}
          title={t('settings.plugins.market.refresh')}
        />
      </div>

      <div className="grid min-w-0 grid-cols-3 gap-2">
        <SelectField
          value={sourceFilter}
          onChange={setSourceFilter}
          options={sourceOptions}
          ariaLabel={t('settings.plugins.market.source')}
        />
        <SelectField
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={categoryOptions}
          ariaLabel={t('settings.plugins.market.category')}
        />
        <SelectField
          value={sortMode}
          onChange={setSortMode}
          options={sortOptions}
          ariaLabel={t('settings.plugins.market.sort')}
        />
      </div>

      {(error || failedSources.length > 0) && (
        <div
          role="alert"
          className="flex min-h-[34px] flex-wrap items-center gap-x-3 gap-y-1 rounded-[7px] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 px-3 py-1.5 text-[11px] text-[var(--color-text-secondary)]"
        >
          <Icon name="warning" size={13} className="text-[var(--color-warning)]" />
          <span>{t('settings.plugins.market.sourceWarning')}</span>
          {error && (
            <span className="font-semibold text-[var(--color-text-primary)]">{error}</span>
          )}
          {failedSources.map((source) => (
            <span key={source.id} title={source.error} className="font-semibold text-[var(--color-text-primary)]">
              {source.name}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 px-0.5 text-[11px] text-[var(--color-text-tertiary)]">
        <span>{t('settings.plugins.market.results', { count: filteredItems.length })}</span>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="shield" size={12} />
          {t('settings.plugins.market.safety')}
        </span>
      </div>

      {filteredItems.length === 0 ? (
        <div className="flex min-h-[180px] flex-col items-center justify-center rounded-[8px] border border-dashed border-[var(--color-border)] px-4 text-center">
          <Icon name="search" size={20} className="text-[var(--color-text-tertiary)]" />
          <p className="mt-2 text-[12px] font-semibold text-[var(--color-text-secondary)]">
            {t('settings.plugins.market.empty')}
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)]">
          {visibleItems.map((item) => {
            const userInstallation = item.installations.find((entry) => entry.scope === 'user')
            const installedElsewhere = item.installations.find((entry) => entry.scope !== 'user')
            const isBusy = pendingItemId === item.id
            const isAnyInstallPending = pendingItemId !== null
            return (
              <li
                key={item.id}
                className="flex min-h-[104px] items-center gap-3 border-b border-[var(--color-border-separator)] px-4 py-3 last:border-b-0"
              >
                <PluginLogo item={item} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                      {item.displayName}
                    </span>
                    <button
                      type="button"
                      onClick={() => void openExternalUrl(item.homepage ?? item.sourceUrl)}
                      className="inline-flex h-[20px] items-center gap-1 rounded-[5px] bg-[var(--color-surface-container-high)] px-1.5 text-[9px] font-semibold text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
                      title={t('settings.plugins.market.openSource')}
                    >
                      {marketplaceSourceLabel(item.sourceName, locale)}
                      <Icon name="open_in_new" size={9} />
                    </button>
                    {item.version && (
                      <span className="font-mono text-[9px] text-[var(--color-text-tertiary)]">
                        v{item.version}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-[17px] text-[var(--color-text-secondary)]">
                    {marketplaceDescription(item, locale, 'plugin', item.features)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[9px] font-medium text-[var(--color-text-tertiary)]">
                    <span>{marketplaceCategoryLabel(item.category, locale)}</span>
                    {item.features.slice(0, 4).map((feature) => (
                      <span key={feature} className="rounded-[4px] bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[var(--color-text-secondary)]">
                        {marketplaceFeatureLabel(feature, locale)}
                      </span>
                    ))}
                    {installedElsewhere && (
                      <span>{t('settings.plugins.market.installedOtherScope')}</span>
                    )}
                  </div>
                </div>
                <div className="flex w-[104px] shrink-0 justify-end">
                  {!item.compatible ? (
                    <span
                      className="text-right text-[10px] font-medium leading-4 text-[var(--color-text-tertiary)]"
                      title={t('settings.plugins.market.incompatible')}
                    >
                      {t('settings.plugins.market.incompatible')}
                    </span>
                  ) : userInstallation?.updateAvailable ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={isBusy}
                      disabled={isAnyInstallPending}
                      onClick={() => void installItem(item)}
                      className="h-[32px] rounded-[6px] px-3 shadow-none"
                      icon={<Icon name="upgrade" size={13} />}
                      aria-label={`${t('settings.plugins.market.update')} ${item.displayName}`}
                    >
                      {t('settings.plugins.market.update')}
                    </Button>
                  ) : userInstallation ? (
                    <span className="inline-flex h-[28px] items-center gap-1 text-[10px] font-semibold text-[var(--color-success)]">
                      <Icon name="check_circle" size={13} />
                      {t('settings.plugins.market.installedState')}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      loading={isBusy}
                      disabled={isAnyInstallPending}
                      onClick={() => void installItem(item)}
                      className="h-[32px] rounded-[6px] px-3 shadow-none"
                      icon={<Icon name="download" size={13} />}
                      aria-label={`${t('settings.plugins.market.install')} ${item.displayName}`}
                    >
                      {t('settings.plugins.market.install')}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
          {visibleItems.length < filteredItems.length && (
            <li className="flex min-h-[52px] items-center justify-center border-t border-[var(--color-border-separator)] px-4 py-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                className="h-[32px] rounded-[6px] px-4 text-[11px] shadow-none"
                icon={<Icon name="expand_more" size={13} />}
              >
                {t('settings.plugins.market.loadMore', {
                  shown: visibleItems.length,
                  total: filteredItems.length,
                })}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
