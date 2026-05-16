import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { OFFICIAL_DEFAULT_MODEL_ID, OFFICIAL_MODELS } from '../../constants/modelCatalog'
import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import { useProviderStore } from '../../stores/providerStore'
import { DRAFT_RUNTIME_SELECTION_KEY, useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { SavedProvider } from '../../types/provider'
import type { RuntimeSelection } from '../../types/runtime'
import type { EffortLevel, ModelInfo } from '../../types/settings'
import { Icon } from '../shared/Icon'

type ProviderChoice = {
  providerId: string | null
  providerName: string
  isDefault: boolean
  models: ModelInfo[]
}

type Props = {
  value?: string
  onChange?: (modelId: string) => void
  runtimeKey?: string
  disabled?: boolean
  placement?: 'top' | 'bottom'
  align?: 'left' | 'right'
  compact?: boolean
  variant?: 'default' | 'pill'
}

function officialChoices(availableModels: ModelInfo[], isDefault: boolean, officialName: string): ProviderChoice {
  return {
    providerId: null,
    providerName: officialName,
    isDefault,
    models: availableModels.length > 0 ? availableModels : OFFICIAL_MODELS,
  }
}

function buildProviderModels(
  provider: SavedProvider,
  labels: Record<'main' | 'haiku' | 'sonnet' | 'opus', string>,
): ModelInfo[] {
  const entries: Array<{ id: string; label: string }> = [
    { id: provider.models.main.trim(), label: labels.main },
    { id: provider.models.haiku.trim(), label: labels.haiku },
    { id: provider.models.sonnet.trim(), label: labels.sonnet },
    { id: provider.models.opus.trim(), label: labels.opus },
  ]

  const byId = new Map<string, { id: string; labels: string[] }>()
  for (const entry of entries) {
    if (!entry.id) continue
    const existing = byId.get(entry.id)
    if (existing) {
      if (!existing.labels.includes(entry.label)) {
        existing.labels.push(entry.label)
      }
      continue
    }
    byId.set(entry.id, { id: entry.id, labels: [entry.label] })
  }

  return [...byId.values()].map((entry) => ({
    id: entry.id,
    name: entry.id,
    description: entry.labels.join(' · '),
    context: '',
  }))
}

function buildProviderChoices(
  providers: SavedProvider[],
  activeId: string | null,
  availableModels: ModelInfo[],
  officialName: string,
  labels: Record<'main' | 'haiku' | 'sonnet' | 'opus', string>,
): ProviderChoice[] {
  return [
    officialChoices(availableModels, activeId === null, officialName),
    ...providers.map((provider) => ({
      providerId: provider.id,
      providerName: provider.name,
      isDefault: activeId === provider.id,
      models: buildProviderModels(provider, labels),
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
  runtimeKey,
  disabled = false,
  placement = 'top',
  align = 'right',
  compact = false,
  variant = 'default',
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
    isLoading: providersLoading,
    fetchProviders,
  } = useProviderStore()
  const runtimeSelection = useSessionRuntimeStore((state) =>
    runtimeKey ? state.selections[runtimeKey] : undefined,
  )
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const requestedProvidersRef = useRef(false)

  const EFFORT_OPTIONS: { value: EffortLevel; label: string }[] = [
    { value: 'low', label: t('settings.general.effort.low') },
    { value: 'medium', label: t('settings.general.effort.medium') },
    { value: 'high', label: t('settings.general.effort.high') },
    { value: 'max', label: t('settings.general.effort.max') },
  ]

  const isControlled = value !== undefined
  const isRuntimeScoped = !isControlled && runtimeKey !== undefined

  useEffect(() => {
    if (!isRuntimeScoped || providersLoading || requestedProvidersRef.current) return
    requestedProvidersRef.current = true
    void fetchProviders()
  }, [fetchProviders, isRuntimeScoped, providersLoading])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
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
      t('settings.providers.officialName'),
      roleLabels,
    ),
    [activeId, availableModels, providers, roleLabels, t],
  )

  const selectedModel = isControlled
    ? availableModels.find((model) => model.id === value) || null
    : storeModel

  const activeRuntimeSelection = isRuntimeScoped
    ? runtimeSelection ?? resolveDefaultRuntimeSelection(
      activeId,
      activeProviderName,
      providers,
      storeModel?.id,
    )
    : null

  const selectedProviderChoice = activeRuntimeSelection
    ? providerChoices.find((choice) => choice.providerId === activeRuntimeSelection.providerId) ?? null
    : null

  const selectedRuntimeModel = activeRuntimeSelection
    ? selectedProviderChoice?.models.find((model) => model.id === activeRuntimeSelection.modelId)
      ?? {
        id: activeRuntimeSelection.modelId,
        name: activeRuntimeSelection.modelId,
        description: '',
        context: '',
      }
    : null

  const buttonModelLabel = isRuntimeScoped
    ? selectedRuntimeModel?.name ?? storeModel?.name ?? t('model.selectModel')
    : selectedModel?.name ?? t('model.selectModel')
  const buttonProviderLabel = isRuntimeScoped
    ? selectedProviderChoice?.providerName ?? activeProviderName ?? t('settings.providers.officialName')
    : null

  const handleRuntimeSelect = (selection: RuntimeSelection) => {
    if (!runtimeKey) return
    useSessionRuntimeStore.getState().setSelection(runtimeKey, selection)
    if (runtimeKey !== DRAFT_RUNTIME_SELECTION_KEY) {
      useChatStore.getState().setSessionRuntime(runtimeKey, selection)
    }
    setOpen(false)
  }
  const compactClassName = variant === 'pill'
    ? 'model-selector-compact h-[36px] rounded-full border border-neutral-200 bg-white px-[16px] text-[13px] font-bold leading-normal text-neutral-600 hover:bg-neutral-50 hover:text-black'
    : 'model-selector-compact h-[36px] rounded-full border border-neutral-200 bg-white px-[16px] text-[13px] font-bold leading-normal text-neutral-600 hover:bg-neutral-50 hover:text-black'
  const compactLabelClassName = variant === 'pill' ? 'max-w-[120px]' : 'max-w-[100px]'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`
          flex items-center gap-[8px] transition-colors disabled:cursor-not-allowed disabled:opacity-50
          ${compact
            ? compactClassName
            : 'max-w-[280px] gap-2 rounded-md bg-[var(--color-surface-container)] border border-[var(--color-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
          }
        `}
      >
        <span className={`min-w-0 truncate ${compact ? compactLabelClassName : 'flex-1 text-[14px] font-semibold text-[var(--color-text-primary)]'}`} style={compact ? undefined : { fontFamily: 'var(--font-headline)' }}>
          {buttonModelLabel}
        </span>
        {!compact && buttonProviderLabel && (
          <span className="max-w-[108px] flex-shrink-0 truncate text-[11px] text-[var(--color-text-tertiary)]">
            {buttonProviderLabel}
          </span>
        )}
        {compact ? (
          <ChevronRight size={14} strokeWidth={2} className="shrink-0 rotate-90" />
        ) : (
          <Icon name="expand_more" size={18} className="flex-shrink-0 text-[12px]" />
        )}
      </button>

      {open && (
        <div className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} z-50 w-[280px] rounded-xl border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-dropdown)] overflow-hidden animate-fade-in ${placement === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'}`}>
          <div className="max-h-[380px] overflow-y-auto py-2 px-1.5">
            {/* Section label */}
            <div className="px-2.5 py-2 text-[13px] font-semibold text-[var(--color-text-primary)]">
              {t('model.configuration')}
            </div>

            {isRuntimeScoped ? (
              <div className="space-y-2">
                {providerChoices.map((choice) => (
                  <div key={choice.providerId ?? 'official'} className="space-y-1">
                    <div className="mx-1 inline-flex w-fit max-w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg border border-[var(--color-border-separator)] bg-[var(--color-surface-container-high)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <span className="min-w-0 truncate text-[14px] font-bold tracking-tight text-[var(--color-text-primary)]">
                        {choice.providerName}
                      </span>
                      {choice.isDefault && (
                        <span className="flex-shrink-0 rounded-md bg-[var(--color-surface-selected)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                          {t('settings.providers.default')}
                        </span>
                      )}
                    </div>

                    <div>
                      {choice.models.map((model) => {
                        const isSelected =
                          activeRuntimeSelection?.providerId === choice.providerId &&
                          activeRuntimeSelection.modelId === model.id
                        return (
                          <button
                            key={`${choice.providerId ?? 'official'}:${model.id}`}
                            onClick={() => handleRuntimeSelect({ providerId: choice.providerId, modelId: model.id })}
                            className={`
                              w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors group
                              ${isSelected
                                ? 'bg-[var(--color-surface-selected)]'
                                : 'hover:bg-[var(--color-surface-hover)]'
                              }
                            `}
                          >
                            <div className="min-w-0 flex-1">
                              <div className={`truncate text-[12px] ${isSelected ? 'font-semibold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'}`}>
                                {model.name}
                              </div>
                              {model.description && (
                                <div className="mt-px truncate text-[10px] text-[var(--color-text-tertiary)]">
                                  {model.description}
                                </div>
                              )}
                            </div>
                            {isSelected && (
                              <Icon name="check" size={14} className="shrink-0 text-[var(--color-brand)]" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-0.5">
                {availableModels.map((model) => {
                  const isSelected = model.id === selectedModel?.id
                  return (
                    <button
                      key={model.id}
                      onClick={() => {
                        if (isControlled) {
                          onChange?.(model.id)
                        } else {
                          void setModel(model.id)
                        }
                        setOpen(false)
                      }}
                      className={`
                        w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors group
                        ${isSelected
                          ? 'bg-[var(--color-surface-selected)]'
                          : 'hover:bg-[var(--color-surface-hover)]'
                        }
                      `}
                    >
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-[12px] ${isSelected ? 'font-semibold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'}`}>
                          {model.name}
                        </div>
                        {model.description && (
                          <div className="mt-px truncate text-[10px] text-[var(--color-text-tertiary)]">
                            {model.description}
                          </div>
                        )}
                      </div>
                      {isSelected && (
                        <Icon name="check" size={14} className="shrink-0 text-[var(--color-brand)]" />
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {!isControlled && !isRuntimeScoped && (
            <div className="border-t border-[var(--color-border-separator)] px-2.5 py-3">
              <div className="px-2.5 mb-2 text-[13px] font-semibold text-[var(--color-text-primary)]">
                {t('model.effort')}
              </div>
              <div className="flex gap-1">
                {EFFORT_OPTIONS.map((opt) => {
                  const isSelected = opt.value === effortLevel
                  return (
                    <button
                      key={opt.value}
                      onClick={() => {
                        void setEffort(opt.value)
                        setOpen(false)
                      }}
                      className={`
                        flex-1 rounded-lg py-1.5 text-center text-[11px] font-medium transition-colors
                        ${isSelected
                          ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] font-semibold'
                          : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]'
                        }
                      `}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
