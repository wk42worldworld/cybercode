import { useEffect, useMemo, useRef, useState } from 'react'
import { OFFICIAL_DEFAULT_MODEL_ID, OFFICIAL_MODELS } from '../../constants/modelCatalog'
import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import { useProviderStore } from '../../stores/providerStore'
import { DRAFT_RUNTIME_SELECTION_KEY, useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { SavedProvider } from '../../types/provider'
import type { RuntimeSelection } from '../../types/runtime'
import type { EffortLevel, ModelInfo } from '../../types/settings'

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
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex max-w-[280px] items-center gap-2 rounded-full bg-[var(--color-surface-container-low)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text-primary)]">
            {buttonModelLabel}
          </span>
          {buttonProviderLabel && (
            <span className="max-w-[108px] flex-shrink-0 truncate text-[11px] text-[var(--color-text-tertiary)]">
              {buttonProviderLabel}
            </span>
          )}
        </div>
        <span className="material-symbols-outlined flex-shrink-0 text-[12px]">expand_more</span>
      </button>

      {open && (
        <div className="absolute right-0 bottom-full z-50 mb-2 w-[360px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]">
          <div className="max-h-[420px] overflow-y-auto p-3">
            <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--color-outline)]">
              {t('model.configuration')}
            </div>

            {isRuntimeScoped ? (
              <div className="space-y-3">
                {providerChoices.map((choice) => (
                  <div key={choice.providerId ?? 'official'} className="space-y-1.5">
                    <div className="flex items-center justify-between px-2 pt-1">
                      <span className="truncate text-[11px] font-semibold tracking-[0.01em] text-[var(--color-text-secondary)]">
                        {choice.providerName}
                      </span>
                      {choice.isDefault && (
                        <span className="flex-shrink-0 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                          {t('settings.providers.default')}
                        </span>
                      )}
                    </div>

                    <div className="space-y-1">
                      {choice.models.map((model) => {
                        const isSelected =
                          activeRuntimeSelection?.providerId === choice.providerId &&
                          activeRuntimeSelection.modelId === model.id
                        return (
                          <button
                            key={`${choice.providerId ?? 'official'}:${model.id}`}
                            onClick={() => handleRuntimeSelect({ providerId: choice.providerId, modelId: model.id })}
                            className={`
                              w-full rounded-lg border px-3 py-2.5 text-left transition-colors
                              ${isSelected
                                ? 'border-[var(--color-model-option-selected-border)] bg-[var(--color-model-option-selected-bg)]'
                                : 'border-transparent hover:bg-[var(--color-surface-hover)]'
                              }
                            `}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                                isSelected ? 'border-[var(--color-brand)]' : 'border-[var(--color-outline)]'
                              }`}>
                                {isSelected && (
                                  <div className="h-2 w-2 rounded-full bg-[var(--color-brand)]" />
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                                  {model.name}
                                </div>
                                {model.description && (
                                  <div className="mt-0.5 truncate pr-[6px] text-[10px] text-[var(--color-text-tertiary)]">
                                    {model.description}
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1">
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
                        w-full rounded-lg px-3 py-2.5 text-left transition-colors
                        ${isSelected
                          ? 'border border-[var(--color-model-option-selected-border)] bg-[var(--color-model-option-selected-bg)]'
                          : 'hover:bg-[var(--color-surface-hover)]'
                        }
                      `}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                          isSelected ? 'border-[var(--color-brand)]' : 'border-[var(--color-outline)]'
                        }`}>
                          {isSelected && (
                            <div className="h-2 w-2 rounded-full bg-[var(--color-brand)]" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-[var(--color-text-primary)]">{model.name}</div>
                          {model.description && (
                            <div className="mt-0.5 truncate text-[10px] text-[var(--color-text-tertiary)]">
                              {model.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {!isControlled && !isRuntimeScoped && (
            <div className="border-t border-[var(--color-border)] p-3">
              <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--color-outline)]">
                {t('model.effort')}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
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
                        rounded-lg py-2 text-center text-xs font-semibold transition-colors
                        ${isSelected
                          ? 'bg-[var(--color-brand)] text-white'
                          : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
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
