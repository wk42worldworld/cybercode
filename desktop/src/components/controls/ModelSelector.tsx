import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, Route, Search, Server } from 'lucide-react'
import { OFFICIAL_DEFAULT_MODEL_ID, OFFICIAL_MODELS } from '../../constants/modelCatalog'
import { providersApi } from '../../api/providers'
import { isLocalProvider } from '../chat/localProvider'
import { useTranslation } from '../../i18n'
import { subscribeToViewportChanges } from '../../lib/viewportEvents'
import { useChatStore } from '../../stores/chatStore'
import { useProviderStore } from '../../stores/providerStore'
import { DRAFT_RUNTIME_SELECTION_KEY, useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useRoutingStore } from '../../stores/routingStore'
import type { SavedProvider } from '../../types/provider'
import type { RuntimeSelection } from '../../types/runtime'
import type { EffortLevel, ModelInfo } from '../../types/settings'
import type { ProviderPreset } from '../../types/providerPreset'
import {
  buildModelContextWindowMap,
  formatContextWindowInput,
  resolveRoleContextWindows,
} from '../../utils/modelContextWindows'
import {
  isUneditedLegacyRouteProfile,
  routeBuilderModeFor,
} from '../../utils/routingRoutes'
import { ProviderLogo } from '../providers/ProviderLogo'
import { Icon } from '../shared/Icon'
import {
  ProviderModelBrowser,
  type ProviderModelBrowserGroup,
} from './ProviderModelBrowser'

type ProviderChoice = {
  providerId: string | null
  providerLogoId?: string | null
  providerName: string
  providerBaseUrl?: string
  providerModelHint?: string
  isDefault: boolean
  models: ModelInfo[]
}

type Props = {
  value?: string
  onChange?: (modelId: string) => void
  runtimeValue?: RuntimeSelection
  onRuntimeChange?: (selection: RuntimeSelection) => void
  runtimeKey?: string
  disabled?: boolean
  placement?: 'top' | 'bottom'
  align?: 'left' | 'right'
  compact?: boolean
  variant?: 'default' | 'pill'
  openSignal?: number
}

type MenuPosition = {
  top: number
  left: number
  width: number
  maxHeight: number
  direction: 'up' | 'down'
}

const MENU_WIDTH = 360
const MENU_MAX_HEIGHT = 480
const MENU_GAP = 10
const VIEWPORT_MARGIN = 12

function officialChoices(availableModels: ModelInfo[], isDefault: boolean, officialName: string): ProviderChoice {
  return {
    providerId: null,
    providerLogoId: 'official',
    providerName: officialName,
    providerModelHint: OFFICIAL_DEFAULT_MODEL_ID,
    isDefault,
    models: availableModels.length > 0 ? availableModels : OFFICIAL_MODELS,
  }
}

function resolveProviderLogoId(provider: SavedProvider): string | null {
  return provider.presetId === 'custom' ? null : provider.presetId
}

function buildProviderModelHint(provider: SavedProvider): string {
  if (provider.presetId === 'custom') return ''
  return [
    provider.models.main,
    provider.models.haiku,
    provider.models.sonnet,
    provider.models.opus,
  ].filter(Boolean).join(' ')
}

function translatedOrFallback(
  t: ReturnType<typeof useTranslation>,
  key: string,
  fallback: string,
): string {
  const translated = t(key as never)
  return translated === key ? fallback : translated
}

function buildProviderModels(
  provider: SavedProvider,
  presets: ProviderPreset[],
  labels: Record<'main' | 'haiku' | 'sonnet' | 'opus', string>,
): ModelInfo[] {
  const entries: Array<{ id: string; label: string; contextWindow?: number }> = [
    { id: provider.models.main.trim(), label: labels.main },
    { id: provider.models.haiku.trim(), label: labels.haiku },
    { id: provider.models.sonnet.trim(), label: labels.sonnet },
    { id: provider.models.opus.trim(), label: labels.opus },
    ...(provider.modelCatalog ?? []).map((model) => ({
      id: model.id.trim(),
      label: model.label || model.id,
      contextWindow: model.contextWindow,
    })),
  ]

  const byId = new Map<string, { id: string; labels: string[]; contextWindow?: number }>()
  for (const entry of entries) {
    if (!entry.id) continue
    const existing = byId.get(entry.id)
    if (existing) {
      if (!existing.labels.includes(entry.label)) {
        existing.labels.push(entry.label)
      }
      if (entry.contextWindow) {
        existing.contextWindow = existing.contextWindow
          ? Math.min(existing.contextWindow, entry.contextWindow)
          : entry.contextWindow
      }
      continue
    }
    byId.set(entry.id, {
      id: entry.id,
      labels: [entry.label],
      contextWindow: entry.contextWindow,
    })
  }

  const preset = presets.find((item) => item.id === provider.presetId)
  const roleContextWindows = resolveRoleContextWindows(
    provider.models,
    provider.modelContextWindows,
    preset?.defaultModelContextWindows,
    preset?.defaultModels,
    Object.fromEntries(
      (preset?.modelOptions ?? [])
        .filter((option) => option.contextWindow)
        .map((option) => [option.id, option.contextWindow]),
    ),
  )
  const contextWindowMap = buildModelContextWindowMap(provider.models, roleContextWindows)

  return [...byId.values()].map((entry) => {
    const contextWindow = entry.contextWindow ?? contextWindowMap[entry.id]
    return {
      id: entry.id,
      name: entry.id,
      description: entry.labels.join(' · '),
      context: formatContextWindowInput(contextWindow),
      contextWindow,
    }
  })
}

function buildProviderChoices(
  providers: SavedProvider[],
  activeId: string | null,
  availableModels: ModelInfo[],
  presets: ProviderPreset[],
  officialName: string,
  labels: Record<'main' | 'haiku' | 'sonnet' | 'opus', string>,
): ProviderChoice[] {
  return [
    officialChoices(availableModels, activeId === null, officialName),
    ...providers.map((provider) => ({
      providerId: provider.id,
      providerLogoId: resolveProviderLogoId(provider),
      providerName: provider.name,
      providerBaseUrl: provider.baseUrl,
      providerModelHint: buildProviderModelHint(provider),
      isDefault: activeId === provider.id,
      models: buildProviderModels(provider, presets, labels),
    })),
  ]
}

function resolveDefaultRuntimeSelection(
  activeId: string | null,
  activeProviderName: string | null,
  providers: SavedProvider[],
  currentModelId: string | undefined,
): RuntimeSelection {
  const inferredProviderId = activeId ?? (
    activeProviderName
      ? providers.find((provider) => provider.name === activeProviderName)?.id ?? null
      : null
  )

  return {
    providerId: inferredProviderId,
    modelId: currentModelId ?? OFFICIAL_DEFAULT_MODEL_ID,
  }
}

export function ModelSelector({
  value,
  onChange,
  runtimeValue,
  onRuntimeChange,
  runtimeKey,
  disabled = false,
  placement = 'top',
  align = 'right',
  compact = false,
  variant = 'default',
  openSignal,
}: Props = {}) {
  const t = useTranslation()
  const {
    currentModel: storeModel,
    availableModels,
    effortLevel,
    activeProviderName,
    setModel,
    setEffort,
  } = useSettingsStore()
  const {
    providers,
    activeId,
    presets,
    isLoading: providersLoading,
    fetchProviders,
  } = useProviderStore()
  const routingDashboard = useRoutingStore((state) => state.dashboard)
  const routingLoading = useRoutingStore((state) => state.isLoading)
  const fetchRoutingDashboard = useRoutingStore((state) => state.fetchDashboard)
  const storedRuntimeSelection = useSessionRuntimeStore((state) =>
    runtimeKey ? state.selections[runtimeKey] : undefined,
  )
  const [open, setOpen] = useState(false)
  const [menuView, setMenuView] = useState<'routes' | 'models'>('models')
  const [routeQuery, setRouteQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const requestedProvidersRef = useRef(false)
  const requestedRoutingRef = useRef(false)
  const refreshedRoutingForOpenRef = useRef(false)

  const EFFORT_OPTIONS: { value: EffortLevel; label: string }[] = [
    { value: 'low', label: t('settings.general.effort.low') },
    { value: 'medium', label: t('settings.general.effort.medium') },
    { value: 'high', label: t('settings.general.effort.high') },
    { value: 'max', label: t('settings.general.effort.max') },
  ]

  const isControlled = value !== undefined
  const isRuntimeControlled = runtimeValue !== undefined
  const isRuntimeScoped = isRuntimeControlled || (!isControlled && runtimeKey !== undefined)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const width = Math.min(
      MENU_WIDTH,
      Math.max(1, window.innerWidth - VIEWPORT_MARGIN * 2),
    )
    const maxLeft = Math.max(
      VIEWPORT_MARGIN,
      window.innerWidth - width - VIEWPORT_MARGIN,
    )
    const desiredLeft = align === 'left' ? rect.left : rect.right - width
    const spaceAbove = rect.top - MENU_GAP - VIEWPORT_MARGIN
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN
    const preferredDirection = placement === 'top' ? 'up' : 'down'
    const preferredSpace = preferredDirection === 'up' ? spaceAbove : spaceBelow
    const alternateSpace = preferredDirection === 'up' ? spaceBelow : spaceAbove
    const direction = (
      preferredSpace >= MENU_MAX_HEIGHT ||
      preferredSpace >= alternateSpace
    ) ? preferredDirection : preferredDirection === 'up' ? 'down' : 'up'
    const availableHeight = direction === 'up' ? spaceAbove : spaceBelow

    setMenuPosition({
      top: direction === 'up' ? rect.top - MENU_GAP : rect.bottom + MENU_GAP,
      left: Math.min(Math.max(desiredLeft, VIEWPORT_MARGIN), maxLeft),
      width,
      maxHeight: Math.max(48, Math.min(MENU_MAX_HEIGHT, availableHeight)),
      direction,
    })
  }, [align, placement])

  useEffect(() => {
    if (!isRuntimeScoped || providersLoading || requestedProvidersRef.current) return
    requestedProvidersRef.current = true
    void fetchProviders()
  }, [fetchProviders, isRuntimeScoped, providersLoading])

  useEffect(() => {
    if (!isRuntimeScoped || routingLoading || requestedRoutingRef.current) return
    requestedRoutingRef.current = true
    void fetchRoutingDashboard()
  }, [fetchRoutingDashboard, isRuntimeScoped, routingLoading])

  useEffect(() => {
    if (!open) {
      refreshedRoutingForOpenRef.current = false
      return
    }
    if (
      !isRuntimeScoped ||
      routingLoading ||
      refreshedRoutingForOpenRef.current
    ) return
    refreshedRoutingForOpenRef.current = true
    void fetchRoutingDashboard({ quiet: Boolean(routingDashboard) })
  }, [fetchRoutingDashboard, isRuntimeScoped, open, routingDashboard, routingLoading])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // Use capture phase so ancestor stopPropagation (e.g. TabBar drag region)
    // does not prevent the dropdown from closing on outside clicks.
    document.addEventListener('mousedown', handleClick, true)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick, true)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null)
      return
    }

    updateMenuPosition()
    return subscribeToViewportChanges(updateMenuPosition)
  }, [open, updateMenuPosition])

  useEffect(() => {
    if (openSignal === undefined || disabled) return
    setOpen(true)
  }, [openSignal, disabled])

  const roleLabels = useMemo(
    () => ({
      main: t('settings.providers.mainModel'),
      haiku: t('settings.providers.haikuModel'),
      sonnet: t('settings.providers.sonnetModel'),
      opus: t('settings.providers.opusModel'),
    }),
    [t],
  )

  const providerChoices = useMemo(
    () => buildProviderChoices(
      providers,
      activeId,
      activeId === null ? availableModels : OFFICIAL_MODELS,
      presets,
      t('settings.providers.officialName'),
      roleLabels,
    ),
    [activeId, availableModels, presets, providers, roleLabels, t],
  )

  const selectedModel = isControlled
    ? availableModels.find((model) => model.id === value) || null
    : storeModel

  const activeRuntimeSelection = isRuntimeScoped
    ? runtimeValue ?? storedRuntimeSelection ?? resolveDefaultRuntimeSelection(
      activeId,
      activeProviderName,
      providers,
      storeModel?.id,
    )
    : null

  const activeRouteId = activeRuntimeSelection?.routeId
  const activeRouteProfile = activeRouteId
    ? routingDashboard?.config.profiles.find((profile) => profile.id === activeRouteId) ?? null
    : null
  const availableRouteProfiles = routingDashboard?.config.enabled
    ? routingDashboard.config.profiles.filter((profile) => (
        Boolean(profile.graph) &&
        profile.enabled &&
        routingDashboard.routeAvailability[profile.id]?.available
      ))
    : []
  const normalizedRouteQuery = routeQuery.trim().toLocaleLowerCase()
  const visibleRouteProfiles = availableRouteProfiles.filter((profile) => {
    if (!normalizedRouteQuery) return true
    const isLegacyProfile = isUneditedLegacyRouteProfile(profile)
    const behaviorName = isLegacyProfile
      ? t(`settings.routing.strategy.${profile.strategy}.name` as never)
      : t(`settings.routing.mode.${routeBuilderModeFor(profile.strategy)}.name` as never)
    return [profile.name, profile.description, behaviorName].some((value) => (
      value?.toLocaleLowerCase().includes(normalizedRouteQuery)
    ))
  })

  const selectedProviderChoice = activeRuntimeSelection && !activeRouteId
    ? providerChoices.find((choice) => choice.providerId === activeRuntimeSelection.providerId) ?? null
    : null
  const defaultProviderChoice = providerChoices.find((choice) => choice.isDefault) ?? providerChoices[0] ?? null

  const selectedRuntimeModel = activeRuntimeSelection && activeRouteProfile
    ? {
        id: activeRuntimeSelection.modelId,
        name: isUneditedLegacyRouteProfile(activeRouteProfile)
          ? translatedOrFallback(
              t,
              `settings.routing.profile.${activeRouteProfile.id}.name`,
              activeRouteProfile.name,
            )
          : activeRouteProfile.name,
        description: '',
        context: '',
        contextWindow: activeRuntimeSelection.contextWindow,
      }
    : activeRuntimeSelection
    ? selectedProviderChoice?.models.find((model) => model.id === activeRuntimeSelection.modelId)
      ?? {
        id: activeRuntimeSelection.modelId,
        name: activeRuntimeSelection.modelId,
        description: '',
        context: '',
        contextWindow: activeRuntimeSelection.contextWindow,
      }
    : null

  const buttonModelLabel = isRuntimeScoped
    ? selectedRuntimeModel?.name ?? storeModel?.name ?? t('model.selectModel')
    : selectedModel?.name ?? t('model.selectModel')
  const buttonProviderLabel = isRuntimeScoped
    ? activeRouteId
      ? t('settings.routing.tab.routing')
      : selectedProviderChoice?.providerName ?? activeProviderName ?? t('settings.providers.officialName')
    : null
  const buttonProviderChoice = isRuntimeScoped
    ? activeRouteId ? null : selectedProviderChoice ?? defaultProviderChoice
    : defaultProviderChoice
  const buttonModelId = isRuntimeScoped
    ? activeRouteId ? undefined : selectedRuntimeModel?.id
    : selectedModel?.id
  const selectedModelGroupId = selectedProviderChoice
    ? selectedProviderChoice.providerId ?? 'official'
    : null
  const runtimeModelGroups = useMemo<ProviderModelBrowserGroup[]>(
    () => providerChoices.map((choice) => ({
      id: choice.providerId ?? 'official',
      name: choice.providerName,
      logoId: choice.providerLogoId,
      baseUrl: choice.providerBaseUrl,
      modelHint: choice.providerModelHint,
      badge: choice.isDefault ? t('settings.providers.default') : undefined,
      models: choice.models.map((model) => ({
        id: model.id,
        label: model.name,
        description: model.description,
        context: model.context,
      })),
    })),
    [providerChoices, t],
  )
  const standardModelGroups = useMemo<ProviderModelBrowserGroup[]>(
    () => [{
      id: 'official',
      name: defaultProviderChoice?.providerName ?? t('settings.providers.officialName'),
      logoId: defaultProviderChoice?.providerLogoId ?? 'official',
      baseUrl: defaultProviderChoice?.providerBaseUrl,
      modelHint: defaultProviderChoice?.providerModelHint,
      models: availableModels.map((model) => ({
        id: model.id,
        label: model.name,
        description: model.description,
        context: model.context,
      })),
    }],
    [availableModels, defaultProviderChoice, t],
  )

  useEffect(() => {
    if (!open) return
    setMenuView(activeRouteId ? 'routes' : 'models')
    setRouteQuery('')
  }, [activeRouteId, open])

  const handleRuntimeSelect = (selection: RuntimeSelection) => {
    if (onRuntimeChange) {
      onRuntimeChange(selection)
    } else if (runtimeKey) {
      useSessionRuntimeStore.getState().setSelection(runtimeKey, selection)
      if (runtimeKey !== DRAFT_RUNTIME_SELECTION_KEY) {
        useChatStore.getState().setSessionRuntime(runtimeKey, selection)
      }
    }
    setOpen(false)
  }
  const compactClassName = variant === 'pill'
    ? 'model-selector-compact h-[34px] max-w-[200px] rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-high)] px-[9px] text-[12px] font-semibold leading-normal text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
    : 'model-selector-compact h-[34px] max-w-[200px] rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-high)] px-[9px] text-[12px] font-semibold leading-normal text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
  const compactLabelClassName = variant === 'pill' ? 'max-w-[128px]' : 'max-w-[128px]'

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${buttonModelLabel}${buttonProviderLabel ? ` · ${buttonProviderLabel}` : ''}`}
        className={`
          flex items-center gap-[8px] transition-colors disabled:cursor-not-allowed disabled:opacity-50
          ${compact
            ? compactClassName
            : 'min-h-[40px] max-w-[300px] gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
          }
        `}
      >
        {compact && activeRouteId ? (
          <span className="flex size-[20px] shrink-0 items-center justify-center rounded-[5px] bg-[#1473e6]/10 text-[#1473e6] dark:bg-[#68adff]/12 dark:text-[#68adff]">
            <Route size={12} strokeWidth={2} />
          </span>
        ) : buttonProviderChoice ? (
          <ProviderLogo
            name={buttonProviderChoice.providerName}
            providerId={buttonProviderChoice.providerLogoId}
            baseUrl={buttonProviderChoice.providerBaseUrl}
            modelId={buttonModelId ?? buttonProviderChoice.providerModelHint}
            identityPriority="model"
            size={compact ? 'xs' : 'sm'}
            active={open}
            decorative
          />
        ) : null}
        <span className={`min-w-0 truncate ${compact ? compactLabelClassName : 'flex-1 text-[14px] font-semibold text-[var(--color-text-primary)]'}`} style={compact ? undefined : { fontFamily: 'var(--font-headline)' }}>
          {buttonModelLabel}
        </span>
        {!compact && buttonProviderLabel && (
          <span className="max-w-[108px] flex-shrink-0 truncate text-[11px] text-[var(--color-text-tertiary)]">
            {buttonProviderLabel}
          </span>
        )}
        {compact ? (
          <ChevronRight size={14} strokeWidth={2} className={`shrink-0 ${placement === 'top' ? '-rotate-90' : 'rotate-90'}`} />
        ) : (
          <Icon name="expand_more" size={18} className="flex-shrink-0 text-[12px]" />
        )}
      </button>

      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          className="settings-ui native-ui-text fixed z-[9999] flex flex-col overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)] animate-fade-in"
          style={{
            left: menuPosition.left,
            width: menuPosition.width,
            maxHeight: menuPosition.maxHeight,
            ...(menuPosition.direction === 'down'
              ? { top: menuPosition.top }
              : { bottom: window.innerHeight - menuPosition.top }),
          }}
        >
          <div className="shrink-0 border-b border-[var(--color-border-separator)] p-[10px]">
            <div className="flex min-h-[28px] items-center justify-between gap-[10px] px-[2px]">
              <div className="text-[13px] font-bold leading-tight text-[var(--color-text-primary)]">
                {t('model.configuration')}
              </div>
              {buttonProviderLabel && (
                <div className="flex max-w-[178px] items-center gap-[6px] rounded-[6px] bg-[var(--color-surface-container-low)] px-[7px] py-[4px] text-[10px] font-medium text-[var(--color-text-tertiary)]">
                  {activeRouteId ? (
                    <Route size={12} strokeWidth={2} className="shrink-0" />
                  ) : buttonProviderChoice ? (
                    <ProviderLogo
                      name={buttonProviderChoice.providerName}
                      providerId={buttonProviderChoice.providerLogoId}
                      baseUrl={buttonProviderChoice.providerBaseUrl}
                      modelId={buttonProviderChoice.providerModelHint}
                      size="xs"
                      decorative
                    />
                  ) : null}
                  <span className="min-w-0 truncate">
                    {buttonProviderLabel}
                  </span>
                </div>
              )}
            </div>

            {isRuntimeScoped && (
              <div
                role="tablist"
                aria-label={t('model.selectionType')}
                className="mt-[9px] grid grid-cols-2 rounded-[8px] bg-[var(--color-surface-container)] p-[3px]"
              >
                {([
                  ['routes', t('model.routes'), availableRouteProfiles.length, Route],
                  ['models', t('model.directModels'), runtimeModelGroups.reduce((count, group) => count + group.models.length, 0), Server],
                ] as const).map(([view, label, count, ViewIcon]) => (
                  <button
                    key={view}
                    type="button"
                    role="tab"
                    aria-selected={menuView === view}
                    onClick={() => setMenuView(view)}
                    className={`flex h-[34px] min-w-0 items-center justify-center gap-[6px] rounded-[6px] px-[8px] text-[11px] font-semibold transition-[background-color,color,box-shadow] ${
                      menuView === view
                        ? 'bg-[var(--color-surface-container-lowest)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]'
                        : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    <ViewIcon size={13} strokeWidth={1.9} />
                    <span className="truncate">{label}</span>
                    <span className="text-[9px] text-[var(--color-text-tertiary)]">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-[10px]">
            {isRuntimeScoped && menuView === 'routes' ? (
              <div className="flex flex-col gap-[10px]">
                <div className="relative">
                  <Search
                    size={15}
                    strokeWidth={1.9}
                    className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                  />
                  <input
                    value={routeQuery}
                    onChange={(event) => setRouteQuery(event.target.value)}
                    aria-label={t('model.searchRoutes')}
                    placeholder={t('model.searchRoutes')}
                    className="h-[38px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] pl-[34px] pr-[11px] text-[12px] font-medium text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
                  />
                </div>
                <div className="overflow-hidden rounded-[8px] border border-[var(--color-border-separator)]">
                  {visibleRouteProfiles.length > 0 ? (
                    <div className="divide-y divide-[var(--color-border-separator)]">
                      {visibleRouteProfiles.map((profile) => {
                        const selected = activeRouteId === profile.id
                        const availability = routingDashboard?.routeAvailability[profile.id]
                        const legacy = isUneditedLegacyRouteProfile(profile)
                        const behaviorName = legacy
                          ? t(`settings.routing.strategy.${profile.strategy}.name` as never)
                          : t(`settings.routing.mode.${routeBuilderModeFor(profile.strategy)}.name` as never)
                        const routeName = legacy
                          ? translatedOrFallback(
                              t,
                              `settings.routing.profile.${profile.id}.name`,
                              profile.name,
                            )
                          : profile.name
                        return (
                          <button
                            key={profile.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => handleRuntimeSelect({
                              kind: 'route',
                              providerId: null,
                              routeId: profile.id,
                              modelId: `cybercode-route-${profile.id}`,
                              contextWindow: availability?.contextWindow,
                            })}
                            className={`group flex min-h-[54px] w-full items-center gap-[10px] px-[11px] py-[8px] text-left transition-colors ${
                              selected
                                ? 'bg-[var(--color-surface-selected)]'
                                : 'hover:bg-[var(--color-surface-hover)]'
                            }`}
                          >
                            <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[7px] bg-[#1473e6]/10 text-[#1473e6] dark:bg-[#68adff]/12 dark:text-[#68adff]">
                              <Route size={15} strokeWidth={1.9} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12px] font-semibold text-[var(--color-text-primary)]">
                                {routeName}
                              </span>
                              <span className="mt-[2px] block truncate text-[10px] text-[var(--color-text-tertiary)]">
                                {behaviorName} · {t('settings.routing.candidates', { count: availability?.candidateCount ?? 0 })}
                              </span>
                            </span>
                            <span className={`flex size-[20px] shrink-0 items-center justify-center rounded-full border ${
                              selected
                                ? 'border-[#1473e6] bg-[#1473e6] text-white dark:border-[#68adff] dark:bg-[#68adff] dark:text-[#111315]'
                                : 'border-[var(--color-border)] text-transparent group-hover:border-[var(--color-border-focus)]'
                            }`}>
                              <Check size={11} strokeWidth={2.5} />
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="flex min-h-[112px] flex-col items-center justify-center gap-[7px] px-[20px] py-[24px] text-center">
                      <Search size={17} strokeWidth={1.7} className="text-[var(--color-text-tertiary)]" />
                      <p className="text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
                        {t('model.noRoutes')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <ProviderModelBrowser
                groups={isRuntimeScoped ? runtimeModelGroups : standardModelGroups}
                selectedGroupId={isRuntimeScoped ? selectedModelGroupId : 'official'}
                selectedModelId={isRuntimeScoped
                  ? activeRouteId ? undefined : activeRuntimeSelection?.modelId
                  : selectedModel?.id}
                searchLabel={t('model.searchModels')}
                noMatchesLabel={t('model.noMatches')}
                modelCountLabel={(count) => t('model.modelCount', { count })}
                resetKey={`${open}:${menuView}`}
                onSelect={(group, model) => {
                  if (isRuntimeScoped) {
                    const choice = providerChoices.find((item) => (
                      (item.providerId ?? 'official') === group.id
                    ))
                    const sourceModel = choice?.models.find((item) => item.id === model.id)
                    handleRuntimeSelect({
                      providerId: choice?.providerId ?? null,
                      modelId: model.id,
                      contextWindow: sourceModel?.contextWindow,
                    })
                    const provider = choice?.providerId
                      ? providers.find((item) => item.id === choice.providerId)
                      : undefined
                    if (provider && isLocalProvider(provider)) {
                      // Fire-and-forget: prewarm local backends so the next
                      // request does not pay the cold-start cost.
                      void providersApi
                        .warmupProvider(provider.id, model.id)
                        .catch((error) => {
                          console.warn(`Warmup request for ${provider.name} failed:`, error)
                        })
                    }
                    return
                  }
                  if (isControlled) {
                    onChange?.(model.id)
                  } else {
                    void setModel(model.id)
                  }
                  setOpen(false)
                }}
              />
            )}
          </div>

          {!isControlled && !isRuntimeScoped && (
            <div className="shrink-0 border-t border-[var(--color-border-separator)] px-[10px] py-[9px]">
              <div className="mb-[7px] px-[2px] text-[11px] font-semibold text-[var(--color-text-secondary)]">
                {t('model.effort')}
              </div>
              <div className="grid grid-cols-4 rounded-[7px] bg-[var(--color-surface-container)] p-[3px]">
                {EFFORT_OPTIONS.map((opt) => {
                  const isSelected = opt.value === effortLevel
                  return (
                    <button
                      key={opt.value}
                      onClick={() => {
                        void setEffort(opt.value)
                        setOpen(false)
                      }}
                      className={`h-[30px] rounded-[5px] px-[4px] text-center text-[10px] font-medium transition-[background-color,color,box-shadow] ${
                        isSelected
                          ? 'bg-[var(--color-surface-container-lowest)] font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]'
                          : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
