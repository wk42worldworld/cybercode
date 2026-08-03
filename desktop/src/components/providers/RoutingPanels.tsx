import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  Check,
  Copy,
  Gauge,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useRoutingStore } from '../../stores/routingStore'
import type {
  RouteHealthSnapshot,
  RouteProfile,
  RoutingSource,
  SourceAuthClass,
  SourceCostClass,
  SourceRiskClass,
} from '../../types/routing'
import {
  createRouteId,
  isUneditedLegacyRouteProfile,
  routeBuilderModeFor,
} from '../../utils/routingRoutes'
import {
  buildRouteGraphTemplate,
  cloneRouteGraph,
  routeGraphToLegacyFields,
} from '../../utils/routeGraph'
import { Button } from '../shared/Button'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { SettingsRow, SettingsSection, Switch } from '../settings/SettingsLayout'
import { ProviderLogo } from './ProviderLogo'

const RouteGraphEditor = lazy(async () => {
  const module = await import('./route-graph/RouteGraphEditor')
  return { default: module.RouteGraphEditor }
})

type RouteContextMenuState = {
  routeId: string
  left: number
  top: number
}

const ROUTE_CONTEXT_MENU_WIDTH = 184
const ROUTE_CONTEXT_MENU_HEIGHT = 112
const ROUTE_CONTEXT_MENU_GUTTER = 8

function routeContextMenuPosition(event: React.MouseEvent): Pick<RouteContextMenuState, 'left' | 'top'> {
  return {
    left: Math.max(
      ROUTE_CONTEXT_MENU_GUTTER,
      Math.min(event.clientX, window.innerWidth - ROUTE_CONTEXT_MENU_WIDTH - ROUTE_CONTEXT_MENU_GUTTER),
    ),
    top: Math.max(
      ROUTE_CONTEXT_MENU_GUTTER,
      Math.min(event.clientY, window.innerHeight - ROUTE_CONTEXT_MENU_HEIGHT - ROUTE_CONTEXT_MENU_GUTTER),
    ),
  }
}

function profileTranslationKey(id: string, suffix: 'name' | 'description') {
  return `settings.routing.profile.${id}.${suffix}` as never
}

function translatedOrFallback(
  t: ReturnType<typeof useTranslation>,
  key: string,
  fallback: string,
): string {
  const translated = t(key as never)
  return translated === key ? fallback : translated
}

function buildNewGraphRoute(
  name: string,
  routes: RouteProfile[],
  sources: RoutingSource[],
): RouteProfile {
  const id = createRouteId(name, routes.map((entry) => entry.id))
  const draftGraph = buildRouteGraphTemplate('stable-fallback', sources)
  return {
    id,
    name,
    enabled: false,
    strictFree: false,
    allowExperimental: false,
    ...routeGraphToLegacyFields(draftGraph),
    draftGraph,
    draftRevision: 1,
  }
}

function preferredBlueprintRouteId(routes: RouteProfile[]): string | null {
  return routes.find((profile) => profile.graph && profile.enabled)?.id
    ?? routes.find((profile) => profile.graph)?.id
    ?? routes[0]?.id
    ?? null
}

export function isRoutingTargetCoolingDown(
  entry: RouteHealthSnapshot,
  now = Date.now(),
): boolean {
  return Boolean(entry.cooldownUntil && Date.parse(entry.cooldownUntil) > now)
}

export function summarizeRoutingHealth(
  health: RouteHealthSnapshot[],
  now = Date.now(),
) {
  const requests = health.reduce((sum, entry) => sum + entry.requests, 0)
  const successes = health.reduce((sum, entry) => sum + entry.successes, 0)
  const latencySamples = health.filter((entry) => (
    entry.averageLatencyMs !== null && entry.successes > 0
  ))
  const latencySuccesses = latencySamples.reduce((sum, entry) => sum + entry.successes, 0)
  const latencyTotal = latencySamples.reduce((sum, entry) => (
    sum + entry.averageLatencyMs! * entry.successes
  ), 0)

  return {
    requests,
    successRate: requests > 0 ? Math.round((successes / requests) * 100) : 0,
    active: health.filter((entry) => !isRoutingTargetCoolingDown(entry, now)).length,
    latency: latencySuccesses > 0 ? Math.round(latencyTotal / latencySuccesses) : 0,
  }
}

function AccessBadge({
  tone,
  children,
}: {
  tone: 'positive' | 'warning' | 'neutral' | 'muted'
  children: string
}) {
  const toneClass = {
    positive: 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
    warning: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
    neutral: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]',
    muted: 'bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)]',
  }[tone]

  return (
    <span className={`inline-flex h-[20px] items-center rounded-full px-[8px] text-[10px] font-semibold ${toneClass}`}>
      {children}
    </span>
  )
}

export function SmartRoutingPanel({
  onOpenSources,
}: {
  onOpenSources?: () => void
} = {}) {
  const t = useTranslation()
  const {
    dashboard,
    isLoading,
    isSaving,
    isPreviewing,
    isPublishing,
    previews,
    error,
    fetchDashboard,
    updateConfig,
    updateProfile,
    updateProfileDraft,
    previewProfile,
    publishProfile,
  } = useRoutingStore()
  const [editingRouteId, setEditingRouteId] = useState<string | null>(() => (
    preferredBlueprintRouteId(dashboard?.config.profiles ?? [])
  ))
  const [routeToDelete, setRouteToDelete] = useState<RouteProfile | null>(null)
  const [routeContextMenu, setRouteContextMenu] = useState<RouteContextMenuState | null>(null)
  const autoCreateAttemptedRef = useRef(false)
  const routeManagerRequestedRef = useRef(false)

  useEffect(() => {
    void fetchDashboard()
  }, [fetchDashboard])

  useEffect(() => {
    if (!routeContextMenu) return
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('[data-route-context-menu]')) {
        setRouteContextMenu(null)
      }
    }
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRouteContextMenu(null)
    }
    const closeMenu = () => setRouteContextMenu(null)
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnKeyDown)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnKeyDown)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [routeContextMenu])

  useEffect(() => {
    if (!dashboard) return
    if (dashboard.config.profiles.length > 0) {
      const routeStillExists = dashboard.config.profiles.some((profile) => (
        profile.id === editingRouteId
      ))
      if (!routeStillExists && !routeManagerRequestedRef.current) {
        setEditingRouteId(preferredBlueprintRouteId(dashboard.config.profiles))
      }
      return
    }
    const sources = dashboard.sources.filter((source) => (
      source.routable && source.providerId && source.models.length > 0
    ))
    if (sources.length === 0 || autoCreateAttemptedRef.current) return
    autoCreateAttemptedRef.current = true
    const routeProfile = buildNewGraphRoute(
      t('settings.routing.graph.newRouteName'),
      dashboard.config.profiles,
      sources,
    )
    routeManagerRequestedRef.current = false
    setEditingRouteId(routeProfile.id)
    void updateConfig({
      ...dashboard.config,
      profiles: [routeProfile],
    }).then(() => {
      if (useRoutingStore.getState().error) setEditingRouteId(null)
    })
  }, [dashboard, editingRouteId, t, updateConfig])

  const saveEditorDraft = useCallback(async (graph: Parameters<typeof updateProfileDraft>[1], name: string) => {
    if (!editingRouteId) return
    await useRoutingStore.getState().updateProfileDraft(editingRouteId, graph, { name })
  }, [editingRouteId])

  const previewEditor = useCallback(async (graph: Parameters<typeof previewProfile>[1]) => {
    if (!editingRouteId) return null
    return useRoutingStore.getState().previewProfile(editingRouteId, graph)
  }, [editingRouteId])

  const publishEditor = useCallback(async (
    graph: Parameters<typeof publishProfile>[1],
    name: string,
  ) => {
    if (!editingRouteId) return false
    return useRoutingStore.getState().publishProfile(editingRouteId, graph, name)
  }, [editingRouteId])

  const rollbackEditor = useCallback(async () => {
    if (!editingRouteId) return false
    return useRoutingStore.getState().rollbackProfile(editingRouteId)
  }, [editingRouteId])

  const setEditorRouteUsage = useCallback(async (enabled: boolean) => {
    if (!editingRouteId) return
    const state = useRoutingStore.getState()
    const currentDashboard = state.dashboard
    const currentProfile = currentDashboard?.config.profiles.find((profile) => (
      profile.id === editingRouteId
    ))
    if (!currentDashboard || !currentProfile?.graph) return
    await state.updateConfig({
      ...currentDashboard.config,
      enabled: enabled ? true : currentDashboard.config.enabled,
      profiles: currentDashboard.config.profiles.map((profile) => (
        profile.id === editingRouteId ? { ...profile, enabled } : profile
      )),
    })
  }, [editingRouteId])

  if (isLoading && !dashboard) return <LoadingState />
  if (!dashboard) return <EmptyState text={error || t('settings.routing.loadFailed')} />

  const routes = dashboard.config.profiles
  const publishedRoutes = routes.filter((profile) => Boolean(profile.graph))
  const draftRoutes = routes.filter((profile) => !profile.graph)
  const routableSources = dashboard.sources.filter((source) => (
    source.routable && source.providerId && source.models.length > 0
  ))
  const editingRoute = editingRouteId
    ? routes.find((routeProfile) => routeProfile.id === editingRouteId) ?? null
    : null
  const contextRoute = routeContextMenu
    ? routes.find((routeProfile) => routeProfile.id === routeContextMenu.routeId) ?? null
    : null
  const availableEditorRoutes = publishedRoutes.flatMap((routeProfile) => {
    const availability = dashboard.routeAvailability[routeProfile.id]
    if (!availability || availability.candidateCount <= 0) return []
    const isDefault = isUneditedLegacyRouteProfile(routeProfile)
    return [{
      id: routeProfile.id,
      name: isDefault
        ? translatedOrFallback(
            t,
            profileTranslationKey(routeProfile.id, 'name'),
            routeProfile.name,
          )
        : routeProfile.name,
      isDefault,
      isCurrent: routeProfile.id === editingRouteId,
      isActive: availability.available,
      candidateCount: availability.candidateCount,
    }]
  })

  const openCreate = () => {
    const name = t('settings.routing.graph.newRouteName')
    const routeProfile = buildNewGraphRoute(name, routes, routableSources)
    routeManagerRequestedRef.current = false
    setEditingRouteId(routeProfile.id)
    void updateConfig({
      ...dashboard.config,
      profiles: [...routes, routeProfile],
    })
  }

  const openEdit = (routeProfile: RouteProfile) => {
    routeManagerRequestedRef.current = false
    setEditingRouteId(routeProfile.id)
  }

  const duplicateRoute = (routeProfile: RouteProfile) => {
    const copyName = t('settings.routing.routeCopyName', { name: routeProfile.name })
    const copy: RouteProfile = {
      ...routeProfile,
      id: createRouteId(copyName, routes.map((entry) => entry.id)),
      name: copyName,
      enabled: false,
      targets: routeProfile.targets.map((target) => ({ ...target })),
      graph: routeProfile.graph ? cloneRouteGraph(routeProfile.graph) : undefined,
      draftGraph: routeProfile.draftGraph ? cloneRouteGraph(routeProfile.draftGraph) : undefined,
      draftName: routeProfile.draftName,
      previousGraph: routeProfile.previousGraph ? cloneRouteGraph(routeProfile.previousGraph) : undefined,
      draftRevision: routeProfile.draftRevision ? routeProfile.draftRevision + 1 : undefined,
    }
    void updateConfig({
      ...dashboard.config,
      profiles: [...routes, copy],
    })
  }

  const deleteRouteById = async (routeId: string): Promise<boolean> => {
    const state = useRoutingStore.getState()
    const currentDashboard = state.dashboard
    if (!currentDashboard) return false
    const currentRoutes = currentDashboard.config.profiles
    if (!currentRoutes.some((entry) => entry.id === routeId)) return true

    const remainingRoutes = currentRoutes.filter((entry) => entry.id !== routeId)
    const deletingCurrentRoute = editingRouteId === routeId
    const previousAutoCreateAttempted = autoCreateAttemptedRef.current
    if (remainingRoutes.length === 0) autoCreateAttemptedRef.current = true
    if (deletingCurrentRoute) {
      routeManagerRequestedRef.current = remainingRoutes.length === 0
      setEditingRouteId(preferredBlueprintRouteId(remainingRoutes))
    }

    await state.updateConfig({
      ...currentDashboard.config,
      profiles: remainingRoutes,
    })
    if (useRoutingStore.getState().error) {
      autoCreateAttemptedRef.current = previousAutoCreateAttempted
      if (deletingCurrentRoute) {
        routeManagerRequestedRef.current = false
        setEditingRouteId(routeId)
      }
      return false
    }
    return true
  }

  const deleteRoute = async () => {
    if (!routeToDelete) return
    if (await deleteRouteById(routeToDelete.id)) setRouteToDelete(null)
  }

  if (editingRoute) {
    return (
      <Suspense fallback={<LoadingState />}>
        <RouteGraphEditor
          profile={editingRoute}
          sources={routableSources}
          preview={previews[editingRoute.id]}
          isSaving={isSaving}
          isPreviewing={isPreviewing}
          isPublishing={isPublishing}
          globallyEnabled={dashboard.config.enabled}
          routeEnabled={editingRoute.enabled}
          error={error}
          onBack={() => {
            routeManagerRequestedRef.current = true
            setEditingRouteId(null)
          }}
          onSaveDraft={saveEditorDraft}
          onPreview={previewEditor}
          onPublish={publishEditor}
          onRollback={rollbackEditor}
          onUsageChange={setEditorRouteUsage}
          availableRoutes={availableEditorRoutes}
          onSelectRoute={(routeId) => {
            routeManagerRequestedRef.current = false
            setEditingRouteId(routeId)
          }}
          onDeleteRoute={deleteRouteById}
        />
      </Suspense>
    )
  }

  const renderRouteItems = (profiles: RouteProfile[]) => (
    <div className="divide-y divide-[var(--color-border-separator)]">
      {profiles.map((routeProfile) => (
        <RouteListItem
          key={routeProfile.id}
          profile={routeProfile}
          sources={routableSources}
          candidateCount={dashboard.routeAvailability[routeProfile.id]?.candidateCount ?? 0}
          globallyEnabled={dashboard.config.enabled}
          disabled={isSaving}
          onChange={(next) => void updateProfile(next)}
          onEdit={() => openEdit(routeProfile)}
          onDuplicate={() => duplicateRoute(routeProfile)}
          onDelete={() => setRouteToDelete(routeProfile)}
          onContextMenu={(event) => {
            event.preventDefault()
            setRouteContextMenu({
              routeId: routeProfile.id,
              ...routeContextMenuPosition(event),
            })
          }}
        />
      ))}
    </div>
  )

  return (
    <div
      className="flex flex-col gap-[14px]"
      onContextMenu={(event) => event.preventDefault()}
    >
      <section className="overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
        <header className="routing-global-header flex min-h-[76px] items-center justify-between gap-[18px] px-[18px] py-[14px]">
          <div className="min-w-0">
            <h2 className="text-[16px] font-bold text-[var(--color-text-primary)]">
              {t('settings.routing.global')}
            </h2>
            <p className="mt-[3px] max-w-[560px] text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
              {t('settings.routing.globalHint')}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-[10px]">
            <span className="hidden text-[11px] font-semibold text-[var(--color-text-secondary)] sm:block">
              {t(dashboard.config.enabled
                ? 'settings.routing.globalEnabled'
                : 'settings.routing.globalDisabled')}
            </span>
            <Switch
              checked={dashboard.config.enabled}
              disabled={isSaving}
              accent
              ariaLabel={t('settings.routing.global')}
              onChange={(enabled) => void updateConfig({ ...dashboard.config, enabled })}
            />
          </div>
        </header>
      </section>

      <section className="overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
        <header className="routing-routes-header flex min-h-[68px] items-center justify-between gap-[14px] border-b border-[var(--color-border-separator)] px-[18px] py-[12px]">
          <div className="min-w-0">
            <h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">
              {t('settings.routing.myRoutes')}
            </h3>
            <p className="mt-[3px] text-[10px] leading-[16px] text-[var(--color-text-tertiary)]">
              {t('settings.routing.myRoutesHint')}
            </p>
          </div>
          <Button
            size="sm"
            icon={<Plus size={14} />}
            disabled={isSaving}
            onClick={openCreate}
            className="h-[36px] shrink-0 rounded-[7px] px-[13px] shadow-none"
          >
            {t('settings.routing.createRoute')}
          </Button>
        </header>

        {routes.length > 0 ? (
          <div>
            <RouteGroupHeader
              title={t('settings.routing.publishedRoutes')}
              count={publishedRoutes.length}
              testId="published-routes"
            />
            {publishedRoutes.length > 0 ? renderRouteItems(publishedRoutes) : (
              <p className="border-t border-[var(--color-border-separator)] px-[18px] py-[18px] text-[11px] text-[var(--color-text-tertiary)]">
                {t('settings.routing.noPublishedRoutes')}
              </p>
            )}

            {draftRoutes.length > 0 && (
              <div className="border-t border-[var(--color-border)]">
                <RouteGroupHeader
                  title={t('settings.routing.draftRoutes')}
                  count={draftRoutes.length}
                  testId="draft-routes"
                />
                {renderRouteItems(draftRoutes)}
              </div>
            )}
          </div>
        ) : (
          <RouteEmptyState
            hasSources={routableSources.length > 0}
            onCreate={openCreate}
            onOpenSources={onOpenSources}
          />
        )}
      </section>

      {error && <p className="text-[12px] text-[var(--color-error)]">{error}</p>}

      <ConfirmDialog
        open={routeToDelete !== null}
        onClose={() => setRouteToDelete(null)}
        onConfirm={deleteRoute}
        title={t('settings.routing.deleteTitle')}
        body={t('settings.routing.deleteBody', { name: routeToDelete?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={isSaving}
        size="compact"
      />

      {routeContextMenu && contextRoute && createPortal(
        <div
          data-route-context-menu
          data-testid="route-context-menu"
          role="menu"
          aria-label={t('settings.routing.routeActions')}
          className="native-ui-text fixed z-[10000] w-[184px] max-w-[calc(100vw-16px)] overflow-hidden rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-[4px] shadow-[var(--shadow-dropdown)]"
          style={{ left: routeContextMenu.left, top: routeContextMenu.top }}
          onContextMenu={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              setRouteContextMenu(null)
              openEdit(contextRoute)
            }}
            className="flex h-[32px] w-full items-center gap-[9px] rounded-[5px] px-[9px] text-left text-[11px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
          >
            <Pencil size={15} className="text-[var(--color-text-tertiary)]" />
            <span>{t('settings.routing.editRoute')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setRouteContextMenu(null)
              duplicateRoute(contextRoute)
            }}
            className="flex h-[32px] w-full items-center gap-[9px] rounded-[5px] px-[9px] text-left text-[11px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
          >
            <Copy size={15} className="text-[var(--color-text-tertiary)]" />
            <span>{t('settings.routing.duplicateRoute')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setRouteContextMenu(null)
              setRouteToDelete(contextRoute)
            }}
            className="flex h-[32px] w-full items-center gap-[9px] rounded-[5px] px-[9px] text-left text-[11px] font-semibold text-[var(--color-text-primary)] hover:bg-[color-mix(in_srgb,var(--color-error)_9%,transparent)] hover:text-[var(--color-error)]"
          >
            <Trash2 size={15} className="text-[var(--color-error)]" />
            <span>{t('settings.routing.deleteRoute')}</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}

function RouteGroupHeader({
  title,
  count,
  testId,
}: {
  title: string
  count: number
  testId: string
}) {
  return (
    <div
      data-testid={testId}
      className="flex min-h-[36px] items-center justify-between bg-[var(--color-surface-container-low)] px-[18px] py-[8px]"
    >
      <span className="text-[11px] font-bold text-[var(--color-text-secondary)]">
        {title}
      </span>
      <span className="font-mono text-[10px] font-semibold text-[var(--color-text-tertiary)]">
        {count}
      </span>
    </div>
  )
}

function RouteListItem({
  profile,
  sources,
  candidateCount,
  globallyEnabled,
  disabled,
  onChange,
  onEdit,
  onDuplicate,
  onDelete,
  onContextMenu,
}: {
  profile: RouteProfile
  sources: RoutingSource[]
  candidateCount: number
  globallyEnabled: boolean
  disabled: boolean
  onChange: (profile: RouteProfile) => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void
}) {
  const t = useTranslation()
  const mode = routeBuilderModeFor(profile.strategy)
  const isLegacyProfile = isUneditedLegacyRouteProfile(profile)
  const profileName = isLegacyProfile
    ? translatedOrFallback(
        t,
        profileTranslationKey(profile.id, 'name'),
        profile.name,
      )
    : profile.name
  const modeDescription = profile.strictFree
    ? t('settings.routing.costPolicy.free-only.description')
    : t(`settings.routing.mode.${mode}.description` as never)
  const routeDescription = isLegacyProfile
    ? translatedOrFallback(
        t,
        profileTranslationKey(profile.id, 'description'),
        modeDescription,
      )
    : modeDescription
  const behaviorName = isLegacyProfile
    ? t(`settings.routing.strategy.${profile.strategy}.name` as never)
    : t(`settings.routing.mode.${mode}.name` as never)
  const graphTargets = profile.graph && profile.graph.source !== 'legacy'
    ? profile.graph.nodes.flatMap((node) => (
        node.data.kind === 'model' && node.data.config.providerId
          ? [{
              providerId: node.data.config.providerId,
              modelId: node.data.config.modelId,
            }]
          : []
      ))
    : []
  const configuredTargets = (graphTargets.length > 0 ? graphTargets : profile.targets).map((target) => {
    const source = sources.find((item) => item.providerId === target.providerId)
    return {
      target,
      source,
      modelId: target.modelId ?? source?.models[0]?.id ?? '',
    }
  })
  const isPublished = Boolean(profile.graph)
  const isActive = isPublished && globallyEnabled && profile.enabled && candidateCount > 0
  const publishedTime = profile.publishedAt
    ? new Date(profile.publishedAt).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <article
      className={`routing-route-item px-[16px] py-[15px] ${profile.enabled || !isPublished ? '' : 'opacity-60'}`}
      onContextMenu={onContextMenu}
    >
      <div className="routing-route-layout flex flex-col gap-[13px]">
        <div className="flex min-w-0 flex-1 items-start gap-[11px]">
          <span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]">
            <Route size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-[7px]">
              <h4 className="max-w-full truncate text-[13px] font-bold text-[var(--color-text-primary)]">
                {profileName}
              </h4>
              <AccessBadge tone="neutral">
                {behaviorName}
              </AccessBadge>
              <AccessBadge tone={isActive ? 'positive' : isPublished ? 'neutral' : 'warning'}>
                {t(isActive
                  ? 'settings.routing.routeActive'
                  : isPublished
                    ? 'settings.routing.graph.published'
                    : 'settings.routing.graph.draft')}
              </AccessBadge>
              {isPublished && (
                <AccessBadge tone={candidateCount > 0 ? 'positive' : 'warning'}>
                  {t('settings.routing.readyCount', { count: candidateCount })}
                </AccessBadge>
              )}
            </div>
            <p className="mt-[3px] text-[10px] leading-[16px] text-[var(--color-text-tertiary)]">
              {routeDescription}
            </p>
            {(publishedTime || !isPublished) && (
              <p className="mt-[3px] text-[10px] leading-[16px] text-[var(--color-text-tertiary)]">
                {publishedTime
                  ? t('settings.routing.publishedAt', { time: publishedTime })
                  : t('settings.routing.publishRequired')}
              </p>
            )}

            <div className="mt-[8px] flex min-w-0 items-center gap-[8px]">
              {configuredTargets.length > 0 ? (
                <>
                  <div className="flex shrink-0 items-center gap-[3px]">
                    {configuredTargets.slice(0, 4).map(({ target, source, modelId }, index) => (
                      <ProviderLogo
                        key={`${target.providerId}:${modelId}:${index}`}
                        name={source?.name ?? target.providerId}
                        providerId={source?.presetId}
                        modelId={modelId}
                        identityPriority="model"
                        size="xs"
                        decorative
                      />
                    ))}
                  </div>
                  <span className="min-w-0 truncate text-[10px] font-medium text-[var(--color-text-secondary)]">
                    {configuredTargets
                      .slice(0, 3)
                      .map(({ modelId }) => modelId)
                      .filter(Boolean)
                      .join(' → ')}
                    {configuredTargets.length > 3
                      ? t('settings.routing.moreModels', { count: configuredTargets.length - 3 })
                      : ''}
                  </span>
                </>
              ) : (
                <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">
                  {t('settings.routing.legacyAllModels')}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="routing-route-actions flex shrink-0 items-center justify-between gap-[8px] border-t border-[var(--color-border-separator)] pt-[10px]">
          <div className="flex items-center gap-[2px]">
            <RouteActionButton label={t('settings.routing.editRoute')} onClick={onEdit}>
              <Pencil size={14} />
            </RouteActionButton>
            <RouteActionButton label={t('settings.routing.duplicateRoute')} onClick={onDuplicate}>
              <Copy size={14} />
            </RouteActionButton>
            <RouteActionButton label={t('settings.routing.deleteRoute')} onClick={onDelete} danger>
              <Trash2 size={14} />
            </RouteActionButton>
          </div>
          <div
            className="border-l border-[var(--color-border-separator)] pl-[12px]"
            style={{ marginLeft: 4 }}
          >
            <Switch
              checked={profile.enabled}
              disabled={disabled || !globallyEnabled || !isPublished}
              accent
              ariaLabel={profileName}
              onChange={(enabled) => onChange({ ...profile, enabled })}
            />
          </div>
        </div>
      </div>
    </article>
  )
}

function RouteActionButton({
  label,
  danger = false,
  onClick,
  children,
}: {
  label: string
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-[32px] w-[32px] items-center justify-center rounded-[6px] transition-colors ${
        danger
          ? 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]'
          : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {children}
    </button>
  )
}

function RouteEmptyState({
  hasSources,
  onCreate,
  onOpenSources,
}: {
  hasSources: boolean
  onCreate: () => void
  onOpenSources?: () => void
}) {
  const t = useTranslation()
  return (
    <div className="flex min-h-[236px] flex-col items-center justify-center px-[24px] py-[32px] text-center">
      <span className="flex h-[44px] w-[44px] items-center justify-center rounded-[9px] bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]">
        <Route size={20} />
      </span>
      <h4 className="mt-[13px] text-[14px] font-bold text-[var(--color-text-primary)]">
        {t(hasSources
          ? 'settings.routing.emptyTitle'
          : 'settings.routing.emptyNoSourcesTitle')}
      </h4>
      <p className="mt-[5px] max-w-[390px] text-[11px] leading-[18px] text-[var(--color-text-tertiary)]">
        {t(hasSources
          ? 'settings.routing.emptyHint'
          : 'settings.routing.emptyNoSourcesHint')}
      </p>
      <Button
        size="sm"
        icon={<Plus size={14} />}
        onClick={hasSources || !onOpenSources ? onCreate : onOpenSources}
        className="mt-[16px] h-[36px] rounded-[7px] px-[14px] shadow-none"
      >
        {t(hasSources || !onOpenSources
          ? 'settings.routing.createFirstRoute'
          : 'settings.routing.addModelSources')}
      </Button>
    </div>
  )
}

export function RoutingStatusPanel() {
  const t = useTranslation()
  const { dashboard, isLoading, isSaving, error, fetchDashboard, resetHealth } = useRoutingStore()

  useEffect(() => {
    void fetchDashboard()
    const timer = window.setInterval(() => void fetchDashboard({ quiet: true }), 5000)
    return () => window.clearInterval(timer)
  }, [fetchDashboard])

  const summary = useMemo(
    () => summarizeRoutingHealth(dashboard?.health ?? []),
    [dashboard?.health],
  )

  if (isLoading && !dashboard) return <LoadingState />
  if (!dashboard) return <EmptyState text={error || t('settings.routing.loadFailed')} />

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="routing-metrics-grid grid grid-cols-2 overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
        <Metric icon={Activity} label={t('settings.routing.metric.requests')} value={String(summary.requests)} />
        <Metric icon={Check} label={t('settings.routing.metric.success')} value={`${summary.successRate}%`} />
        <Metric icon={Gauge} label={t('settings.routing.metric.latency')} value={summary.latency ? `${summary.latency} ms` : '-'} />
        <Metric icon={ShieldCheck} label={t('settings.routing.metric.available')} value={String(summary.active)} />
      </div>

      <SettingsSection
        title={t('settings.routing.healthTitle')}
        action={(
          <Button
            variant="ghost"
            size="sm"
            disabled={isSaving}
            onClick={() => void resetHealth()}
          >
            <RefreshCw size={14} />
            {t('settings.routing.resetHealth')}
          </Button>
        )}
      >
        {dashboard.health.length === 0 ? (
          <SettingsRow><span className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.routing.noHealth')}</span></SettingsRow>
        ) : dashboard.health.map((entry) => {
          const coolingDown = isRoutingTargetCoolingDown(entry)
          return (
            <SettingsRow
              key={`${entry.providerId}:${entry.modelId}`}
              label={`${entry.providerName} · ${entry.modelId}`}
              hint={entry.lastError || t('settings.routing.healthSummary', {
                success: entry.successes,
                requests: entry.requests,
                latency: entry.averageLatencyMs ?? '-',
              })}
            >
              <AccessBadge tone={coolingDown ? 'warning' : 'positive'}>
                {coolingDown ? t('settings.routing.cooldown') : t('settings.routing.healthy')}
              </AccessBadge>
            </SettingsRow>
          )
        })}
      </SettingsSection>

      <SettingsSection title={t('settings.routing.eventsTitle')}>
        {dashboard.events.length === 0 ? (
          <SettingsRow><span className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.routing.noEvents')}</span></SettingsRow>
        ) : dashboard.events.slice(0, 20).map((event) => (
          <SettingsRow
            key={event.id}
            label={`${event.providerName} · ${event.modelId}`}
            hint={`${translatedOrFallback(
              t,
              profileTranslationKey(event.routeId, 'name'),
              dashboard.config.profiles.find((profile) => profile.id === event.routeId)?.name ?? event.routeId,
            )} · ${new Date(event.timestamp).toLocaleTimeString()}${event.error ? ` · ${event.error}` : ''}`}
          >
            <AccessBadge tone={event.status === 'success' ? 'positive' : 'warning'}>
              {event.status === 'success'
                ? `${event.latencyMs} ms`
                : t('settings.routing.failedAttempt', { attempt: event.attempt })}
            </AccessBadge>
          </SettingsRow>
        ))}
      </SettingsSection>
    </div>
  )
}

function Metric({
  icon: MetricIcon,
  label,
  value,
}: {
  icon: typeof Activity
  label: string
  value: string
}) {
  return (
    <div className="routing-metric flex min-h-[82px] min-w-0 items-center gap-[12px] px-[16px]">
      <MetricIcon size={17} className="shrink-0 text-[var(--color-text-tertiary)]" />
      <div className="min-w-0">
        <div className="text-[18px] font-bold text-[var(--color-text-primary)]">{value}</div>
        <div className="truncate text-[10px] font-semibold text-[var(--color-text-tertiary)]">{label}</div>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex justify-center py-[48px]">
      <RefreshCw size={20} className="animate-spin text-[var(--color-text-tertiary)]" />
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--color-border)] px-[18px] py-[28px] text-center text-[12px] text-[var(--color-text-tertiary)]">
      {text}
    </div>
  )
}

// Exported unions keep translation maps exhaustive at callsites.
export type RoutingAccessClasses = SourceCostClass | SourceAuthClass | SourceRiskClass
