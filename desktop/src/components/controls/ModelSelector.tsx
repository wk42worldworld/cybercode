import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'
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
  openSignal?: number
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
    ? 'model-selector-compact h-[34px] max-w-[176px] rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container-high)] px-[12px] text-[12px] font-semibold leading-normal text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
    : 'model-selector-compact h-[34px] max-w-[176px] rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container-high)] px-[12px] text-[12px] font-semibold leading-normal text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
  const compactLabelClassName = variant === 'pill' ? 'max-w-[118px]' : 'max-w-[118px]'

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
          <ChevronRight size={14} strokeWidth={2} className={`shrink-0 ${placement === 'top' ? '-rotate-90' : 'rotate-90'}`} />
        ) : (
          <Icon name="expand_more" size={18} className="flex-shrink-0 text-[12px]" />
        )}
      </button>

      {open && (
        <div className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} z-[140] w-[320px] overflow-hidden rounded-[24px] border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)] animate-fade-in ${placement === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-[10px]'}`}>
          <div className="max-h-[420px] overflow-y-auto p-[8px]">
            {/* Section label */}
            <div className="flex items-center justify-between px-[10px] py-[8px]">
              <div className="text-[13px] font-semibold leading-tight text-[var(--color-text-primary)]">
                {t('model.configuration')}
              </div>
              {buttonProviderLabel && (
                <div className="max-w-[132px] truncate rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)] px-[9px] py-[4px] text-[11px] font-medium text-[var(--color-text-tertiary)]">
                  {buttonProviderLabel}
                </div>
              )}
            </div>

            {isRuntimeScoped ? (
              <div className="space-y-[8px]">
                {providerChoices.map((choice) => (
                  <div key={choice.providerId ?? 'official'} className="rounded-[18px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] p-[6px]">
                    <div className="flex items-center gap-[8px] px-[8px] py-[6px]">
                      <span className="min-w-0 truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                        {choice.providerName}
                      </span>
                      {choice.isDefault && (
                        <span className="shrink-0 rounded-full bg-[var(--color-surface-selected)] px-[8px] py-[3px] text-[10px] font-semibold text-[var(--color-text-secondary)]">
                          {t('settings.providers.default')}
                        </span>
                      )}
                    </div>

                    <div className="space-y-[3px]">
                      {choice.models.map((model) => {
                        const isSelected =
                          activeRuntimeSelection?.providerId === choice.providerId &&
                          activeRuntimeSelection.modelId === model.id
                        return (
                          <button
                            key={`${choice.providerId ?? 'official'}:${model.id}`}
                            onClick={() => handleRuntimeSelect({ providerId: choice.providerId, modelId: model.id })}
                            className={`
                              group flex min-h-[48px] w-full items-center gap-[10px] rounded-[14px] px-[10px] py-[8px] text-left transition-colors
                              ${isSelected
                                ? 'bg-[var(--color-surface-selected)]'
                                : 'hover:bg-[var(--color-surface-hover)]'
                              }
                            `}
                          >
                            <div className="min-w-0 flex-1">
                              <div className={`truncate text-[13px] ${isSelected ? 'font-semibold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'}`}>
                                {model.name}
                              </div>
                              {model.description && (
                                <div className="mt-[2px] truncate text-[11px] font-medium text-[var(--color-text-tertiary)]">
                                  {model.description}
                                </div>
                              )}
                            </div>
                            {isSelected && (
                              <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-background)]">
                                <Check size={13} strokeWidth={2.4} />
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-[3px]">
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
                        group flex min-h-[48px] w-full items-center gap-[10px] rounded-[14px] px-[10px] py-[8px] text-left transition-colors
                        ${isSelected
                          ? 'bg-[var(--color-surface-selected)]'
                          : 'hover:bg-[var(--color-surface-hover)]'
                        }
                      `}
                    >
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-[13px] ${isSelected ? 'font-semibold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'}`}>
                          {model.name}
                        </div>
                        {model.description && (
                          <div className="mt-[2px] truncate text-[11px] font-medium text-[var(--color-text-tertiary)]">
                            {model.description}
                          </div>
                        )}
                      </div>
                      {isSelected && (
                        <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-background)]">
                          <Check size={13} strokeWidth={2.4} />
                        </div>
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
