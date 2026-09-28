import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { ProviderLogo } from '../providers/ProviderLogo'

export type ProviderModelBrowserModel = {
  id: string
  label?: string
  description?: string
  context?: string
  disabled?: boolean
  disabledLabel?: string
}

export type ProviderModelBrowserGroup = {
  id: string
  name: string
  logoId?: string | null
  baseUrl?: string
  modelHint?: string
  badge?: string
  models: ProviderModelBrowserModel[]
}

type ProviderModelBrowserProps = {
  groups: ProviderModelBrowserGroup[]
  selectedGroupId?: string | null
  selectedModelId?: string
  searchLabel: string
  noMatchesLabel: string
  modelCountLabel: (count: number) => string
  resetKey?: string | number | boolean
  maxListHeight?: number
  onSelect: (group: ProviderModelBrowserGroup, model: ProviderModelBrowserModel) => void
}

function matchesModel(
  group: ProviderModelBrowserGroup,
  model: ProviderModelBrowserModel,
  query: string,
): boolean {
  if (!query) return true
  return [
    group.name,
    model.id,
    model.label,
    model.description,
  ].some((value) => value?.toLocaleLowerCase().includes(query))
}

export function ProviderModelBrowser({
  groups,
  selectedGroupId,
  selectedModelId,
  searchLabel,
  noMatchesLabel,
  modelCountLabel,
  resetKey,
  maxListHeight,
  onSelect,
}: ProviderModelBrowserProps) {
  const [query, setQuery] = useState('')
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(
    selectedGroupId ?? groups[0]?.id ?? null,
  )

  useEffect(() => {
    setQuery('')
    setExpandedGroupId(selectedGroupId ?? groups[0]?.id ?? null)
  }, [resetKey])

  useEffect(() => {
    if (selectedGroupId && groups.some((group) => group.id === selectedGroupId)) {
      setExpandedGroupId(selectedGroupId)
    }
  }, [groups, selectedGroupId])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleGroups = useMemo(
    () => groups
      .map((group) => ({
        ...group,
        visibleModels: group.models.filter((model) => (
          matchesModel(group, model, normalizedQuery)
        )),
      }))
      .filter((group) => group.visibleModels.length > 0),
    [groups, normalizedQuery],
  )

  return (
    <div className="flex min-h-0 flex-col gap-[10px]">
      <div className="relative shrink-0">
        <Search
          size={15}
          strokeWidth={1.9}
          className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={searchLabel}
          placeholder={searchLabel}
          className="h-[38px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] pl-[34px] pr-[11px] text-[12px] font-medium text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
        />
      </div>

      <div
        className="min-h-0 overflow-y-auto overscroll-contain rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)]"
        style={maxListHeight ? { maxHeight: maxListHeight } : undefined}
      >
        {visibleGroups.length > 0 ? (
          <div className="divide-y divide-[var(--color-border-separator)]">
            {visibleGroups.map((group) => {
              const expanded = Boolean(normalizedQuery) || expandedGroupId === group.id
              return (
                <section key={group.id} data-provider-group={group.id}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedGroupId((current) => (
                      current === group.id ? null : group.id
                    ))}
                    className="group flex min-h-[54px] w-full items-center gap-[10px] px-[12px] py-[8px] text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                  >
                    <ProviderLogo
                      name={group.name}
                      providerId={group.logoId}
                      baseUrl={group.baseUrl}
                      modelId={group.modelHint ?? group.models[0]?.id}
                      size="sm"
                      decorative
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-[7px]">
                        <span className="truncate text-[12px] font-semibold text-[var(--color-text-primary)]">
                          {group.name}
                        </span>
                        {group.badge && (
                          <span className="shrink-0 rounded-[5px] bg-[var(--color-surface-selected)] px-[6px] py-[2px] text-[9px] font-semibold text-[var(--color-text-secondary)]">
                            {group.badge}
                          </span>
                        )}
                      </span>
                      <span className="mt-[2px] block text-[10px] font-medium text-[var(--color-text-tertiary)]">
                        {modelCountLabel(group.models.length)}
                      </span>
                    </span>
                    {expanded
                      ? <ChevronDown size={15} className="shrink-0 text-[var(--color-text-tertiary)]" />
                      : <ChevronRight size={15} className="shrink-0 text-[var(--color-text-tertiary)]" />}
                  </button>

                  {expanded && (
                    <div className="border-t border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)]">
                      {group.visibleModels.map((model) => {
                        const selected = selectedGroupId === group.id && selectedModelId === model.id
                        const primaryLabel = model.label || model.id
                        const secondaryLabel = model.label && model.label !== model.id
                          ? model.id
                          : model.description
                        return (
                          <button
                            key={model.id}
                            type="button"
                            disabled={model.disabled}
                            aria-pressed={selected}
                            onClick={() => onSelect(group, model)}
                            className={`group/model flex min-h-[48px] w-full items-center gap-[9px] px-[12px] py-[7px] pl-[20px] text-left transition-colors disabled:cursor-default ${
                              selected
                                ? 'bg-[var(--color-surface-selected)]'
                                : 'hover:bg-[var(--color-surface-hover)] disabled:opacity-55 disabled:hover:bg-transparent'
                            }`}
                          >
                            <ProviderLogo
                              name={group.name}
                              providerId={group.logoId}
                              baseUrl={group.baseUrl}
                              modelId={model.id}
                              identityPriority="model"
                              size="xs"
                              decorative
                            />
                            <span className="min-w-0 flex-1">
                              <span className={`block truncate text-[12px] ${
                                selected
                                  ? 'font-semibold text-[var(--color-text-primary)]'
                                  : 'font-medium text-[var(--color-text-secondary)] group-hover/model:text-[var(--color-text-primary)]'
                              }`}>
                                {primaryLabel}
                              </span>
                              {secondaryLabel && (
                                <span className="mt-[2px] block truncate text-[10px] text-[var(--color-text-tertiary)]">
                                  {secondaryLabel}
                                </span>
                              )}
                            </span>
                            {model.context && (
                              <span className="shrink-0 rounded-[5px] border border-[var(--color-border-separator)] px-[5px] py-[1px] text-[9px] font-semibold uppercase text-[var(--color-text-tertiary)]">
                                {model.context}
                              </span>
                            )}
                            {model.disabled && model.disabledLabel ? (
                              <span className="shrink-0 text-[9px] font-semibold text-[var(--color-text-tertiary)]">
                                {model.disabledLabel}
                              </span>
                            ) : (
                              <span className={`flex size-[20px] shrink-0 items-center justify-center rounded-full border transition-colors ${
                                selected
                                  ? 'border-[#1473e6] bg-[#1473e6] text-white dark:border-[#68adff] dark:bg-[#68adff] dark:text-[#111315]'
                                  : 'border-[var(--color-border)] text-transparent group-hover/model:border-[var(--color-border-focus)]'
                              }`}>
                                <Check size={11} strokeWidth={2.5} />
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        ) : (
          <div className="flex min-h-[112px] flex-col items-center justify-center gap-[7px] px-[20px] py-[24px] text-center">
            <Search size={17} strokeWidth={1.7} className="text-[var(--color-text-tertiary)]" />
            <p className="text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
              {noMatchesLabel}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
