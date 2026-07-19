import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useSettingsStore } from '../stores/settingsStore'
import { useProviderStore } from '../stores/providerStore'
import { localeOptions, useTranslation } from '../i18n'
import { Modal } from '../components/shared/Modal'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { Input } from '../components/shared/Input'
import { Textarea } from '../components/shared/Textarea'
import { Button } from '../components/shared/Button'
import { Dropdown } from '../components/shared/Dropdown'
import type { PermissionMode, EffortLevel, ThemeMode } from '../types/settings'
import type { SavedProvider, UpdateProviderInput, ProviderTestResult, ModelMapping, ApiFormat, ModelContextWindows, ImageSupportMode, ProviderModelInfo } from '../types/provider'
import type { ProviderPreset, ProviderModelOption } from '../types/providerPreset'
import {
  MODEL_ROLES,
  compactModelContextWindows,
  formatContextWindowInput,
  inferContextWindowFromModelId,
  parseContextWindowInput,
  type ModelRole,
} from '../utils/modelContextWindows'
import { useAgentStore } from '../stores/agentStore'
import { useSessionStore } from '../stores/sessionStore'
import type { AgentDefinition, AgentSource } from '../api/agents'
import { MarkdownRenderer } from '../components/markdown/MarkdownRenderer'
import { useSkillStore } from '../stores/skillStore'
import { skillsApi, type SkillsConfig } from '../api/skills'
import { SkillList } from '../components/skills/SkillList'
import { SkillDetail } from '../components/skills/SkillDetail'
import {
  SkillLearningModeControl,
  SkillLearningPanel,
  type SkillLearningView,
} from '../components/skills/SkillLearningPanel'
import { useSkillLearningStore } from '../stores/skillLearningStore'
import { usePluginStore } from '../stores/pluginStore'
import { PluginList } from '../components/plugins/PluginList'
import { PluginDetail } from '../components/plugins/PluginDetail'
import { useUIStore, type SettingsTab } from '../stores/uiStore'
import { ClaudeOfficialLogin } from '../components/settings/ClaudeOfficialLogin'
import { SettingsPage, SettingsSection, SettingsRow, SegmentedControl, Switch } from '../components/settings/SettingsLayout'
import { ProviderLogo } from '../components/providers/ProviderLogo'
import { useUpdateStore } from '../stores/updateStore'
import { formatBytes } from '../lib/formatBytes'
import { isTauriRuntime } from '../lib/desktopRuntime'
import { Icon } from '../components/shared/Icon'
import {
  promptMemoryApi,
  type PromptMemoryAutoReviewLogEntry,
  type PromptMemoryInsight,
  type PromptMemoryInsights,
  type PromptMemoryStatus,
  type PromptMemoryTarget,
} from '../api/promptMemory'
import { EvolutionProfile } from '../components/memory/EvolutionProfile'

const SETTINGS_TABS: SettingsTab[] = [
  'general',
  'memory',
  'about',
]

export function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const pendingSettingsTab = useUIStore((s) => s.pendingSettingsTab)
  const t = useTranslation()

  useEffect(() => {
    if (!pendingSettingsTab) return
    if (SETTINGS_TABS.includes(pendingSettingsTab)) {
      setActiveTab(pendingSettingsTab)
    }
    useUIStore.getState().setPendingSettingsTab(null)
  }, [pendingSettingsTab])

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--color-background)]">
      <header className="z-10 flex h-[76px] shrink-0 items-center justify-end bg-[var(--color-background)] px-[24px] md:px-[32px]">
        <button
          onClick={() => useUIStore.getState().closeSettings()}
          className="flex h-[36px] w-[36px] items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-black dark:text-[var(--color-text-secondary)] dark:hover:bg-[var(--color-surface-hover)] dark:hover:text-[var(--color-text-primary)]"
          aria-label={t('common.close')}
          title="Esc"
        >
          <Icon name="close" size={18} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto bg-[var(--color-background)]">
        <div className="flex min-h-[68px] flex-wrap items-center justify-center gap-[6px] px-[24px] pb-[30px] pt-[10px] md:px-[32px]">
          {SETTINGS_TABS.map((key) => {
            const isActive = activeTab === key
            const label = t(`settings.tab.${key}` as never) as string
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex h-[36px] min-w-[72px] items-center justify-center rounded-full px-[16px] text-[13px] font-bold tracking-normal whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-black text-white shadow-[0_4px_16px_rgba(0,0,0,0.10)] dark:bg-white dark:text-black'
                    : 'text-neutral-500 hover:bg-neutral-100 hover:text-black dark:text-[var(--color-text-secondary)] dark:hover:bg-[var(--color-surface-hover)] dark:hover:text-[var(--color-text-primary)]'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
        <div className="px-[24px] pb-[40px] md:px-[32px]">
          {activeTab === 'general' && <GeneralSettings />}
          {activeTab === 'memory' && <MemorySettings />}
          {activeTab === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  )
}


// ─── Provider Settings ──────────────────────────────────────

export function ProviderSettings() {
  const {
    providers,
    activeId,
    hasLoadedProviders,
    presets,
    isLoading,
    isPresetsLoading,
    fetchProviders,
    fetchPresets,
    deleteProvider,
    activateProvider,
    activateOfficial,
    testProvider,
  } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()
  const [editingProvider, setEditingProvider] = useState<SavedProvider | null>(null)
  const [creatingPresetId, setCreatingPresetId] = useState<string | null>(null)
  const [pendingDeleteProvider, setPendingDeleteProvider] = useState<SavedProvider | null>(null)
  const [isDeletingProvider, setIsDeletingProvider] = useState(false)
  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; result?: ProviderTestResult }>>({})

  useEffect(() => {
    void fetchProviders()
    void fetchPresets()
  }, [fetchPresets, fetchProviders])

  const providerRows = useMemo(
    () => buildProviderCatalogRows(providers, presets),
    [providers, presets],
  )

  const handleDelete = async (provider: SavedProvider) => {
    if (activeId === provider.id) return
    setPendingDeleteProvider(provider)
  }

  const confirmDelete = async () => {
    if (!pendingDeleteProvider) return
    setIsDeletingProvider(true)
    try {
      await deleteProvider(pendingDeleteProvider.id)
      setPendingDeleteProvider(null)
    } catch (error) {
      console.error(error)
    } finally {
      setIsDeletingProvider(false)
    }
  }

  const handleTest = async (provider: SavedProvider) => {
    setTestResults((r) => ({ ...r, [provider.id]: { loading: true } }))
    try {
      const result = await testProvider(provider.id)
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result } }))
    } catch {
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result: { connectivity: { success: false, latencyMs: 0, error: t('settings.providers.requestFailed') } } } }))
    }
  }

  const handleActivate = async (id: string) => {
    await activateProvider(id)
    await fetchSettings()
  }

  const handleActivateOfficial = async () => {
    await activateOfficial()
    await fetchSettings()
  }

  const isOfficialActive = hasLoadedProviders && activeId === null
  const isInitialLoading = (isLoading && !hasLoadedProviders) || (isPresetsLoading && presets.length === 0)

  return (
    <SettingsPage
      icon="dns"
      title={t('settings.providers.title')}
      description={t('settings.providers.description')}
    >
      {isInitialLoading ? (
        <div className="flex justify-center py-10">
          <Icon name="loading" size={24} className="animate-spin text-[var(--color-text-tertiary)]" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <ProviderCatalogItem
            name={t('settings.providers.officialName')}
            description={t('settings.providers.officialDesc')}
            detail="claude-opus-4-8 · claude-sonnet-5 · claude-haiku-4-5"
            providerId="official"
            isActive={isOfficialActive}
            isConfigured={true}
            badges={[
              t('settings.providers.officialBadge'),
              isOfficialActive ? t('settings.providers.default') : null,
            ]}
            actions={!isOfficialActive ? (
              <Button variant="secondary" size="sm" onClick={handleActivateOfficial}>
                {t('settings.providers.setDefault')}
              </Button>
            ) : null}
          >
            {isOfficialActive && (
              <div className="border-t border-[var(--color-border-separator)] px-5 pb-5 pt-3">
                <ClaudeOfficialLogin />
              </div>
            )}
          </ProviderCatalogItem>

          {providerRows.map(({ key, preset, provider }) => {
            const isConfigured = Boolean(provider)
            const isActive = Boolean(provider && activeId === provider.id)
            const test = provider ? testResults[provider.id] : undefined
            const name = provider && preset.id === 'custom' ? provider.name : preset.name
            const description = provider && provider.name !== preset.name
              ? provider.name
              : getPresetDescription(preset, t)
            const detail = provider
              ? `${provider.baseUrl} · ${provider.models.main}`
              : getPresetDetail(preset, t)
            const apiFormat = provider?.apiFormat ?? preset.apiFormat
            const badges = [
              isConfigured ? t('settings.providers.configured') : t('settings.providers.notConfigured'),
              isActive ? t('settings.providers.default') : null,
              apiFormat !== 'anthropic'
                ? (apiFormat === 'openai_chat' ? 'OpenAI Chat' : 'OpenAI Responses')
                : null,
            ]

            return (
              <ProviderCatalogItem
                key={key}
                name={name}
                description={description}
                detail={detail}
                providerId={provider && preset.id === 'custom' ? undefined : preset.id}
                isActive={isActive}
                isConfigured={isConfigured}
                badges={badges}
                test={test}
                actions={provider ? (
                  <>
                    {!isActive && (
                      <Button variant="secondary" size="sm" onClick={() => handleActivate(provider.id)}>
                        {t('settings.providers.setDefault')}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => handleTest(provider)} loading={test?.loading}>
                      {t('settings.providers.test')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingProvider(provider)} aria-label={t('settings.providers.edit')}>
                      <Icon name="edit" size={14} />
                    </Button>
                    {!isActive && (
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(provider)} className="text-[var(--color-error)]/70 hover:text-[var(--color-error)]" aria-label={t('common.delete')}>
                        <Icon name="delete" size={14} />
                      </Button>
                    )}
                  </>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => setCreatingPresetId(preset.id)}>
                    {t('settings.providers.configure')}
                  </Button>
                )}
              />
            )
          })}
        </div>
      )}

      {/* Create Modal — conditionally rendered so state resets on close */}
      {creatingPresetId && (
        <ProviderFormModal
          open={true}
          onClose={() => setCreatingPresetId(null)}
          mode="create"
          presets={presets}
          initialPresetId={creatingPresetId}
        />
      )}

      {/* Edit Modal */}
      {editingProvider && (
        <ProviderFormModal key={editingProvider.id} open={true} onClose={() => setEditingProvider(null)} mode="edit" provider={editingProvider} presets={presets} />
      )}

      <ConfirmDialog
        open={pendingDeleteProvider !== null}
        onClose={() => {
          if (isDeletingProvider) return
          setPendingDeleteProvider(null)
        }}
        onConfirm={confirmDelete}
        title={t('common.delete')}
        body={pendingDeleteProvider ? t('settings.providers.confirmDelete', { name: pendingDeleteProvider.name }) : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={isDeletingProvider}
      />
    </SettingsPage>
  )
}

type ProviderCatalogRow = {
  key: string
  preset: ProviderPreset
  provider?: SavedProvider
}

function buildProviderCatalogRows(
  providers: SavedProvider[],
  presets: ProviderPreset[],
): ProviderCatalogRow[] {
  const rows: ProviderCatalogRow[] = []
  const presetById = new Map(presets.map((preset) => [preset.id, preset]))

  for (const preset of presets) {
    if (preset.id === 'official' || preset.id === 'custom') continue
    const configured = providers.filter((provider) => provider.presetId === preset.id)
    if (configured.length === 0) {
      rows.push({ key: `preset:${preset.id}`, preset })
      continue
    }
    for (const provider of configured) {
      rows.push({ key: `provider:${provider.id}`, preset, provider })
    }
  }

  for (const provider of providers) {
    if (
      presetById.has(provider.presetId) ||
      provider.presetId === 'official' ||
      provider.presetId === 'custom'
    ) continue
    rows.push({
      key: `provider:${provider.id}`,
      preset: buildFallbackPreset(provider),
      provider,
    })
  }

  const customPreset = presetById.get('custom')
  for (const provider of providers.filter((item) => item.presetId === 'custom')) {
    rows.push({
      key: `provider:${provider.id}`,
      preset: customPreset ?? buildFallbackPreset(provider),
      provider,
    })
  }
  if (customPreset) {
    rows.push({ key: 'preset:custom', preset: customPreset })
  }

  return rows
}

function ProviderCatalogItem({
  name,
  description,
  detail,
  providerId,
  isActive,
  isConfigured,
  badges,
  test,
  actions,
  children,
}: {
  name: string
  description: string
  detail: string
  providerId?: string
  isActive: boolean
  isConfigured: boolean
  badges: Array<string | null>
  test?: { loading: boolean; result?: ProviderTestResult }
  actions: ReactNode
  children?: ReactNode
}) {
  const t = useTranslation()
  const testSummary = test?.result ? summarizeProviderConnectionTest(test.result) : null
  return (
    <div
      className={`relative overflow-hidden rounded-[12px] border transition-all ${
        isActive
          ? 'border-[3px] border-[var(--color-brand)] bg-[var(--color-surface-container)] shadow-[var(--shadow-accent-glow)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface-container)] hover:border-[var(--color-border-focus)]'
      }`}
    >
      <div className="flex min-h-[76px] items-center gap-[14px] px-[20px] py-[14px]">
        <ProviderLogo name={name} providerId={providerId} active={isActive} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold tracking-tight text-[var(--color-text-primary)]">
              {name}
            </span>
            {badges.filter((badge): badge is string => Boolean(badge)).map((badge) => (
              <ProviderBadge
                key={badge}
                active={badge === t('settings.providers.default')}
                muted={badge === t('settings.providers.notConfigured')}
                warning={badge.startsWith('OpenAI')}
              >
                {badge}
              </ProviderBadge>
            ))}
          </div>
          <p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)] truncate">
            {description}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)] truncate">
            {detail}
          </p>
          {test && !test.loading && testSummary && (
            <p className={`mt-1 text-[11px] ${testSummary.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
              {testSummary.success
                ? t('settings.providers.connectivityOk', { latency: String(testSummary.latencyMs) })
                : t('settings.providers.connectivityFailed', {
                    error: testSummary.error || t('settings.providers.requestFailed'),
                  })}
            </p>
          )}
        </div>

        <div className={`flex shrink-0 items-center gap-[8px] ${isConfigured ? '' : 'opacity-95'}`}>
          {actions}
        </div>
      </div>
      {children}
    </div>
  )
}

function summarizeProviderConnectionTest(result: ProviderTestResult): {
  success: boolean
  latencyMs: number
  error: string
} {
  const failedModel = result.modelChecks?.find((check) => !check.result.success)?.result
  const failedProxy = result.proxy?.success === false ? result.proxy : undefined
  const failure = !result.connectivity.success
    ? result.connectivity
    : failedModel ?? failedProxy

  return {
    success: !failure && result.allModelsPassed !== false,
    latencyMs: result.connectivity.latencyMs,
    error: failure?.error ?? '',
  }
}

function ProviderBadge({
  active,
  muted,
  warning,
  children,
}: {
  active?: boolean
  muted?: boolean
  warning?: boolean
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        active
          ? 'bg-[var(--color-brand)]/12 text-[var(--color-brand)]'
          : warning
            ? 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
            : muted
              ? 'bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)]'
              : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
      }`}
    >
      {active && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)]" />}
      {children}
    </span>
  )
}

function getPresetDescription(
  preset: ProviderPreset,
  t: ReturnType<typeof useTranslation>,
): string {
  if (preset.id === 'custom') return t('settings.providers.customDesc')
  if (preset.promoText) return preset.promoText
  return preset.websiteUrl || preset.baseUrl || t('settings.providers.description')
}

function getPresetDetail(
  preset: ProviderPreset,
  t: ReturnType<typeof useTranslation>,
): string {
  const model = preset.defaultModels.main || t('settings.providers.modelPending')
  const baseUrl = preset.baseUrl || t('settings.providers.baseUrlPending')
  return `${baseUrl} · ${model}`
}

// ─── Provider Form Modal ──────────────────────────────────────

type ProviderFormProps = {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  provider?: SavedProvider
  presets: ProviderPreset[]
  initialPresetId?: string
}

function buildFallbackPreset(provider?: SavedProvider): ProviderPreset {
  return {
    id: provider?.presetId ?? 'custom',
    name: provider?.name ?? 'Custom',
    baseUrl: provider?.baseUrl ?? '',
    apiFormat: provider?.apiFormat ?? 'anthropic',
    defaultModels: provider?.models ?? { main: '', haiku: '', sonnet: '', opus: '' },
    defaultModelContextWindows: provider?.modelContextWindows,
    supportsImages: provider?.supportsImages,
    needsApiKey: true,
    websiteUrl: '',
  }
}

function openExternalUrl(url: string) {
  if (!isTauriRuntime()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }

  void import('@tauri-apps/plugin-shell')
    .then((mod) => mod.open(url))
    .catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
}

const MASKED_API_KEYS = new Set(['***', '••••••••'])

function createContextWindowInputs(
  models: ModelMapping,
  provider: SavedProvider | undefined,
  preset: ProviderPreset,
): Record<ModelRole, string> {
  return Object.fromEntries(
    MODEL_ROLES.map((role) => {
      const value =
        provider?.modelContextWindows?.[role] ??
        provider?.modelCatalog?.find((model) => model.id === models[role])?.contextWindow ??
        getPresetModelContextWindow(preset, models[role]) ??
        inferContextWindowFromModelId(models[role]) ??
        (preset.defaultModels[role]?.trim() === models[role]?.trim()
          ? preset.defaultModelContextWindows?.[role]
          : undefined)
      return [role, formatContextWindowInput(value)]
    }),
  ) as Record<ModelRole, string>
}

function parseContextWindowInputs(
  inputs: Record<ModelRole, string>,
): ModelContextWindows | undefined {
  const parsed: ModelContextWindows = {}
  for (const role of MODEL_ROLES) {
    const value = parseContextWindowInput(inputs[role])
    if (value) parsed[role] = value
  }
  return compactModelContextWindows(parsed)
}

function createContextWindowTouched(provider?: SavedProvider): Record<ModelRole, boolean> {
  return Object.fromEntries(
    MODEL_ROLES.map((role) => [role, provider?.modelContextWindows?.[role] !== undefined]),
  ) as Record<ModelRole, boolean>
}

function getPresetModelContextWindow(
  preset: ProviderPreset,
  modelId: string | undefined,
): number | undefined {
  const normalized = modelId?.trim()
  if (!normalized) return undefined
  return preset.modelOptions?.find((option) => option.id === normalized)?.contextWindow
}

function normalizeModelId(modelId: string | undefined): string {
  return (modelId ?? '').trim().replace(/\[(?:1|2)m\]$/i, '')
}

function inferModelSupportsImages(modelId: string | undefined): boolean | undefined {
  const normalized = normalizeModelId(modelId).toLowerCase()
  if (!normalized) return undefined
  if (/\bmimo-v2\.5-pro\b/.test(normalized)) return false
  if (/\bmimo-v2\.5(?:[:\-]|$)/.test(normalized)) return true
  if (
    /\b(?:vision|vl|v[\.-]?l|image|img|omni|multimodal)\b/.test(normalized) ||
    normalized.includes('gemini') ||
    normalized.includes('gpt-4o') ||
    normalized.includes('gpt-4.1') ||
    normalized.includes('gpt-5') ||
    normalized === 'k3' ||
    normalized.includes('kimi-k3') ||
    normalized.includes('kimi-k2') ||
    normalized.includes('kimi-for-coding') ||
    /\bqwen3\.(?:5|6|7)(?:[:\-]|$)/.test(normalized) ||
    /\b(?:pixtral|llava|internvl|molmo|paligemma)\b/.test(normalized) ||
    /\bminicpm[-_.]?v\b/.test(normalized) ||
    /\bgemma[-_. ]?3n\b/.test(normalized) ||
    /\bgemma[-_. ]?3(?:[:\-_. ](?:4b|12b|27b))\b/.test(normalized) ||
    /\bgemma[-_. ]?4\b/.test(normalized) ||
    /\bgrok[-_. ]?4\.(?:3|5)\b/.test(normalized) ||
    normalized.includes('claude-3') ||
    normalized.includes('claude-4') ||
    normalized.includes('claude-sonnet') ||
    normalized.includes('claude-opus')
  ) {
    return true
  }
  if (
    normalized.includes('deepseek') ||
    normalized.includes('minimax-m3') ||
    normalized.includes('gpt-oss')
  ) {
    return false
  }
  return undefined
}

function inferProviderSupportsImages(
  preset: ProviderPreset,
  modelId: string | undefined,
): boolean | undefined {
  const normalized = normalizeModelId(modelId)
  const presetModel = preset.modelOptions?.find((option) =>
    normalizeModelId(option.id).toLowerCase() === normalized.toLowerCase()
  )
  return presetModel?.supportsImages ?? inferModelSupportsImages(normalized) ?? preset.supportsImages
}

function ModelIdInput({
  label,
  required,
  value,
  onChange,
  onSelectOption,
  placeholder,
  options = [],
  selectLabel,
}: {
  label: string
  required?: boolean
  value: string
  onChange: (value: string) => void
  onSelectOption?: (option: ProviderModelOption) => void
  placeholder?: string
  options?: ProviderModelOption[]
  selectLabel: string
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputId = label.toLowerCase().replace(/\s+/g, '-')
  const hasOptions = options.length > 0

  useEffect(() => {
    if (!open) return
    const handleClick = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[13px] font-bold tracking-normal text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-label)' }}>
        {label}
        {required && <span className="text-[var(--color-error)] ml-0.5">*</span>}
      </label>
      <div ref={wrapperRef} className="relative">
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (hasOptions && (event.key === 'ArrowDown' || event.key === 'Enter')) {
              setOpen(true)
            }
          }}
          placeholder={placeholder}
          className={`
            h-[40px] w-full rounded-[10px] border border-[var(--color-border)] bg-white px-[14px] text-[13px] font-medium
            text-[var(--color-text-primary)] outline-none transition-all duration-200
            placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]
            dark:bg-[var(--color-surface-container-low)]
            ${hasOptions ? 'pr-[42px]' : ''}
          `}
        />
        {hasOptions && (
          <button
            type="button"
            onClick={() => setOpen((next) => !next)}
            aria-label={`${selectLabel}: ${label}`}
            className="absolute right-[6px] top-1/2 flex h-[28px] w-[28px] -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)]"
          >
            <Icon name="expand_more" size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
        {hasOptions && open && (
          <div className="absolute left-0 right-0 z-50 mt-1.5 max-h-[260px] overflow-y-auto rounded-[10px] border border-[var(--color-border-separator)] bg-[var(--color-background)] py-1 shadow-[var(--shadow-dropdown)] animate-slide-down">
            {options.map((option) => {
              const selected = option.id === value
              const contextLabel = formatContextWindowInput(option.contextWindow)
              return (
                <button
                  key={option.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (onSelectOption) onSelectOption(option)
                    else onChange(option.id)
                    setOpen(false)
                  }}
                  className={`
                    flex min-h-[42px] w-full items-center gap-2 px-3 py-2 text-left transition-colors
                    hover:bg-[var(--color-surface-hover)] focus-visible:bg-[var(--color-surface-hover)] focus-visible:outline-none
                    ${selected ? 'bg-[var(--color-surface-selected)]' : ''}
                  `}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold tracking-normal text-[var(--color-text-primary)]">
                      {option.label ?? option.id}
                    </div>
                    {option.label && option.label !== option.id && (
                      <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-text-tertiary)]">
                        {option.id}
                      </div>
                    )}
                  </div>
                  {contextLabel && (
                    <span className="shrink-0 rounded-[6px] border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--color-text-tertiary)]">
                      {contextLabel}
                    </span>
                  )}
                  {selected && <Icon name="check" size={14} className="shrink-0 text-[var(--color-text-secondary)]" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function normalizedProviderModels(models: ModelMapping): ModelMapping {
  const main = models.main.trim()
  return {
    main,
    haiku: models.haiku.trim() || main,
    sonnet: models.sonnet.trim() || main,
    opus: models.opus.trim() || main,
  }
}

function ProviderFormModal({ open, onClose, mode, provider, presets, initialPresetId }: ProviderFormProps) {
  const { createProvider, updateProvider, testConfig } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()

  const availablePresets = presets.filter((p) => p.id !== 'official')
  const fallbackPreset = provider
    ? buildFallbackPreset(provider)
    : availablePresets.find((p) => p.id === 'custom') ?? buildFallbackPreset()
  const initialPreset = provider
    ? availablePresets.find((p) => p.id === provider.presetId) ?? fallbackPreset
    : availablePresets.find((p) => p.id === initialPresetId) ?? availablePresets[0] ?? fallbackPreset

  const selectedPreset = initialPreset
  const [name, setName] = useState(provider?.name ?? initialPreset.name)
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? initialPreset.baseUrl)
  const [apiFormat, setApiFormat] = useState<ApiFormat>(provider?.apiFormat ?? initialPreset.apiFormat ?? 'anthropic')
  const [apiKey, setApiKey] = useState(
    provider?.apiKey && !MASKED_API_KEYS.has(provider.apiKey) ? provider.apiKey : '',
  )
  const [showApiKey, setShowApiKey] = useState(false)
  const [notes, setNotes] = useState(provider?.notes ?? '')
  const [models, setModels] = useState<ModelMapping>(provider?.models ?? { ...initialPreset.defaultModels })
  const [modelCatalog, setModelCatalog] = useState<ProviderModelInfo[]>(provider?.modelCatalog ?? [])
  const [imageSupportMode, setImageSupportMode] = useState<ImageSupportMode>(
    provider?.imageSupportMode ?? 'auto',
  )
  const [contextWindowInputs, setContextWindowInputs] = useState<Record<ModelRole, string>>(() =>
    createContextWindowInputs(provider?.models ?? { ...initialPreset.defaultModels }, provider, initialPreset),
  )
  const [contextWindowTouched, setContextWindowTouched] = useState<Record<ModelRole, boolean>>(() =>
    createContextWindowTouched(provider),
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [isDiscoveringModels, setIsDiscoveringModels] = useState(false)
  const [modelDiscoveryMessage, setModelDiscoveryMessage] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(initialPreset.id === 'custom')
  const parsedContextWindows = useMemo(
    () => parseContextWindowInputs(contextWindowInputs),
    [contextWindowInputs],
  )
  const availableModelOptions = useMemo(() => {
    const options = new Map<string, ProviderModelInfo>()
    for (const option of selectedPreset.modelOptions ?? []) {
      options.set(option.id.toLowerCase(), option)
    }
    for (const model of modelCatalog) {
      const key = model.id.toLowerCase()
      options.set(key, { ...options.get(key), ...model })
    }
    return [...options.values()]
  }, [modelCatalog, selectedPreset.modelOptions])

  const updateModel = (role: ModelRole, value: string) => {
    setModels((prev) => ({ ...prev, [role]: value }))
    if (contextWindowTouched[role]) return
    const inferred =
      availableModelOptions.find((option) => option.id === value)?.contextWindow ??
      inferContextWindowFromModelId(value) ??
      (selectedPreset.defaultModels[role]?.trim() === value.trim()
        ? selectedPreset.defaultModelContextWindows?.[role]
        : undefined)
    setContextWindowInputs((prev) => ({
      ...prev,
      [role]: formatContextWindowInput(inferred),
    }))
  }

  const selectModelOption = (role: ModelRole, option: ProviderModelOption) => {
    setModels((prev) => ({ ...prev, [role]: option.id }))
    const contextWindow =
      option.contextWindow ??
      inferContextWindowFromModelId(option.id) ??
      (selectedPreset.defaultModels[role]?.trim() === option.id.trim()
        ? selectedPreset.defaultModelContextWindows?.[role]
        : undefined)
    setContextWindowInputs((prev) => ({
      ...prev,
      [role]: formatContextWindowInput(contextWindow),
    }))
    setContextWindowTouched((prev) => ({ ...prev, [role]: false }))
  }

  const updateContextWindowInput = (role: ModelRole, value: string) => {
    setContextWindowTouched((prev) => ({ ...prev, [role]: true }))
    setContextWindowInputs((prev) => ({ ...prev, [role]: value }))
  }

  const isCustom = selectedPreset.id === 'custom'
  const requiresApiKey = selectedPreset.needsApiKey !== false
  const hasContextWindowError = MODEL_ROLES.some((role) =>
    contextWindowInputs[role].trim() && !parseContextWindowInput(contextWindowInputs[role]),
  )
  const canSubmit = name.trim() && baseUrl.trim() && (mode === 'edit' || !requiresApiKey || apiKey.trim()) && models.main.trim() && !hasContextWindowError
  const apiKeyUrl = selectedPreset.apiKeyUrl?.trim()
  const promoText = selectedPreset.promoText?.trim()
  const apiFormatItems = [
    {
      value: 'anthropic' as const,
      label: t('settings.providers.apiFormatAnthropic'),
      icon: <Icon name="hub" size={17} />,
    },
    {
      value: 'openai_chat' as const,
      label: t('settings.providers.apiFormatOpenaiChat'),
      icon: <Icon name="forum" size={17} />,
    },
    {
      value: 'openai_responses' as const,
      label: t('settings.providers.apiFormatOpenaiResponses'),
      icon: <Icon name="route" size={17} />,
    },
  ]
  const selectedApiFormatLabel = apiFormatItems.find((item) => item.value === apiFormat)?.label ?? t('settings.providers.apiFormatAnthropic')
  const automaticImageSupport = inferProviderSupportsImages(selectedPreset, models.main)
  const imageSupportItems: Array<{ value: ImageSupportMode; label: string }> = [
    { value: 'auto', label: t('settings.providers.imageSupportAuto') },
    { value: 'enabled', label: t('settings.providers.imageSupportEnabled') },
    { value: 'disabled', label: t('settings.providers.imageSupportDisabled') },
  ]
  const imageSupportHint = imageSupportMode === 'auto'
    ? automaticImageSupport === undefined
      ? t('settings.providers.imageSupportAutoDetectHint')
      : t('settings.providers.imageSupportAutoHint', {
          state: automaticImageSupport
            ? t('settings.providers.imageSupportAutoOn')
            : t('settings.providers.imageSupportAutoOff'),
        })
    : t('settings.providers.supportsImagesHint')
  const connectionTestSummary = testResult
    ? summarizeProviderConnectionTest(testResult)
    : null

  const handleSubmit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      const resolvedModels = normalizedProviderModels(models)

      if (mode === 'create') {
        await createProvider({
          presetId: selectedPreset.id,
          name: name.trim(),
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim(),
          apiFormat,
          models: resolvedModels,
          modelCatalog,
          modelContextWindows: parsedContextWindows,
          imageSupportMode,
          notes: notes.trim() || undefined,
        })
      } else if (provider) {
        const input: UpdateProviderInput = {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          apiFormat,
          models: resolvedModels,
          modelCatalog,
          modelContextWindows: parsedContextWindows ?? {},
          imageSupportMode,
          notes: notes.trim() || undefined,
        }
        if (apiKey.trim()) input.apiKey = apiKey.trim()
        await updateProvider(provider.id, input)
      }
      await fetchSettings()
      onClose()
    } catch (err) {
      console.error('Failed to save provider:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDiscoverModels = async () => {
    if (!baseUrl.trim() || (requiresApiKey && mode === 'create' && !apiKey.trim())) return
    setIsDiscoveringModels(true)
    setModelDiscoveryMessage(null)
    try {
      const { providersApi } = await import('../api/providers')
      const { result } = await providersApi.discoverModels({
        ...(mode === 'edit' && provider ? { providerId: provider.id } : {}),
        presetId: selectedPreset.id,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        apiFormat,
        force: true,
      })
      setModelCatalog(result.models)
      setModelDiscoveryMessage(
        t('settings.providers.modelsDiscovered', { count: result.models.length }),
      )
    } catch (error) {
      setModelDiscoveryMessage(
        t('settings.providers.modelDiscoveryFailed', {
          error: error instanceof Error ? error.message : t('settings.providers.requestFailed'),
        }),
      )
    } finally {
      setIsDiscoveringModels(false)
    }
  }

  const handleTest = async () => {
    if (!baseUrl.trim() || !models.main.trim()) return
    const resolvedModels = normalizedProviderModels(models)
    setIsTesting(true)
    setTestResult(null)
    try {
      let result: ProviderTestResult
      if (mode === 'edit' && provider && !apiKey.trim()) {
        result = await useProviderStore.getState().testProvider(provider.id, {
          baseUrl: baseUrl.trim(),
          modelId: resolvedModels.main,
          models: resolvedModels,
          apiFormat,
        })
      } else {
        if (requiresApiKey && !apiKey.trim()) return
        result = await testConfig({
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim() || selectedPreset.defaultEnv?.ANTHROPIC_AUTH_TOKEN || 'local',
          modelId: resolvedModels.main,
          models: resolvedModels,
          presetId: selectedPreset.id,
          probeImages: false,
          apiFormat,
        })
      }
      setTestResult(result)
    } catch {
      setTestResult({ connectivity: { success: false, latencyMs: 0, error: t('settings.providers.requestFailed') } })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'create'
        ? t('settings.providers.configureTitle', { name: selectedPreset.name })
        : t('settings.providers.editTitle')}
      width={720}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={isSubmitting}>
            {mode === 'create' ? t('common.add') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex min-h-[76px] items-start gap-[12px] rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[16px] py-[12px]">
          <ProviderLogo name={selectedPreset.name} providerId={selectedPreset.id} active={false} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="min-w-0 truncate text-[14px] font-semibold text-[var(--color-text-primary)]">
                {selectedPreset.name}
              </span>
              <ProviderBadge warning={apiFormat !== 'anthropic'}>
                {selectedApiFormatLabel}
              </ProviderBadge>
            </div>
            <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--color-text-secondary)]">
              {getPresetDescription(selectedPreset, t)}
            </p>
          </div>
          {selectedPreset.websiteUrl && (
            <button
              type="button"
              onClick={() => openExternalUrl(selectedPreset.websiteUrl)}
              aria-label={t('settings.providers.openProviderSite')}
              className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)]"
            >
              <Icon name="arrow_outward" size={16} />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_128px]">
          <Input label={t('settings.providers.baseUrl')} required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t('settings.providers.baseUrlPlaceholder')} />
          <ModelIdInput
            label={t('settings.providers.mainModel')}
            required
            value={models.main}
            onChange={(value) => updateModel('main', value)}
            onSelectOption={(option) => selectModelOption('main', option)}
            placeholder="Model ID"
            options={availableModelOptions}
            selectLabel={t('model.selectModel')}
          />
          <Input
            label={t('settings.providers.contextWindow')}
            value={contextWindowInputs.main}
            onChange={(e) => updateContextWindowInput('main', e.target.value)}
            placeholder="200k"
            error={contextWindowInputs.main.trim() && !parseContextWindowInput(contextWindowInputs.main) ? t('settings.providers.contextWindowError') : undefined}
          />
        </div>

        <div className="flex min-h-[32px] items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleDiscoverModels}
            disabled={isDiscoveringModels || !baseUrl.trim()}
            className="inline-flex h-[32px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)] disabled:opacity-40"
          >
            <Icon name="refresh" size={15} className={isDiscoveringModels ? 'animate-spin' : ''} />
            {t('settings.providers.discoverModels')}
          </button>
          {modelDiscoveryMessage && (
            <span className="min-w-0 truncate text-[11px] text-[var(--color-text-tertiary)]">
              {modelDiscoveryMessage}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="provider-api-key" className="text-[14px] font-medium text-[var(--color-text-primary)]">
            {t('settings.providers.apiKey')}
            {mode === 'create' && requiresApiKey && <span className="text-[var(--color-error)] ml-0.5">*</span>}
          </label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                id="provider-api-key"
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="h-[40px] w-full rounded-[10px] border border-[var(--color-border)] bg-white px-[14px] pr-[40px] text-[13px] font-medium text-[var(--color-text-primary)] outline-none transition-colors duration-150 placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)] dark:bg-[var(--color-surface-container-low)]"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((visible) => !visible)}
                aria-label={showApiKey ? 'Hide API Key' : 'Show API Key'}
                className="absolute right-[6px] top-1/2 flex h-[28px] w-[28px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)]"
              >
                <Icon name={showApiKey ? 'visibility_off' : 'visibility'} size={16} />
              </button>
            </div>
            {apiKeyUrl && (
              <button
                type="button"
                onClick={() => openExternalUrl(apiKeyUrl)}
                className="h-[40px] flex-shrink-0 cursor-pointer rounded-full border border-[var(--color-border)] bg-transparent px-[14px] text-[13px] font-bold text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)] disabled:cursor-default disabled:opacity-40"
              >
                {t('settings.providers.getApiKey')}
              </button>
            )}
            <button
              type="button"
              onClick={handleTest}
              disabled={isTesting || !baseUrl.trim() || !models.main.trim()}
              className="h-[40px] flex-shrink-0 cursor-pointer rounded-full border border-[var(--color-border)] bg-transparent px-[14px] text-[13px] font-bold text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)] disabled:cursor-default disabled:opacity-40"
            >
              {isTesting ? `${t('settings.providers.testConnection')}…` : t('settings.providers.testConnection')}
            </button>
          </div>
          {connectionTestSummary && (
            <div className="mt-1">
              <span className={`text-[12px] ${connectionTestSummary.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                {connectionTestSummary.success
                  ? t('settings.providers.connectivityOk', { latency: String(connectionTestSummary.latencyMs) })
                  : t('settings.providers.connectivityFailed', {
                      error: connectionTestSummary.error || t('settings.providers.requestFailed'),
                    })}
              </span>
            </div>
          )}
        </div>

        {promoText && (
          <button
            type="button"
            onClick={() => apiKeyUrl && openExternalUrl(apiKeyUrl)}
            disabled={!apiKeyUrl}
            className="group flex w-full cursor-pointer items-start gap-1.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-2.5 py-1.5 text-left text-[11px] leading-5 text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)] disabled:cursor-default"
          >
            <Icon name="tips_and_updates" size={18} className="mt-0.5 text-[13px] text-[var(--color-brand)]" />
            <span>{promoText}</span>
            {apiKeyUrl && (
              <Icon name="arrow_outward" size={18} className="ml-auto mt-1 text-[10px] text-[var(--color-text-accent)] opacity-45 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            )}
          </button>
        )}

        {/* Advanced settings — folded by default */}
        <div className="border-t border-[var(--color-border)] pt-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-1.5 text-[14px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus:outline-none"
          >
            <Icon name="chevron_right" size={18} className="transition-transform shrink-0" style={{ transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0deg)' }} />
            {t('settings.providers.advanced')}
          </button>
          {showAdvanced && (
            <div className="mt-3 flex flex-col gap-4">
              <Input label={t('settings.providers.name')} required value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.providers.namePlaceholder')} />

              <Input label={t('settings.providers.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('settings.providers.notesPlaceholder')} />

              {/* API Format */}
              {(isCustom || mode === 'edit') ? (
                <div>
                  <label className="text-[14px] font-medium text-[var(--color-text-primary)] mb-1 block">{t('settings.providers.apiFormat')}</label>
                  <Dropdown<ApiFormat>
                    items={apiFormatItems}
                    value={apiFormat}
                    onChange={setApiFormat}
                    width="100%"
                    className="block w-full"
                    trigger={
                      <button
                        type="button"
                        className="flex h-[40px] w-full items-center gap-[12px] rounded-[10px] border border-[var(--color-border)] bg-white px-[14px] text-left text-[13px] font-medium text-[var(--color-text-primary)] outline-none transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-container-low)] focus-visible:border-[var(--color-border-focus)] focus-visible:shadow-[var(--shadow-focus-ring)] dark:bg-[var(--color-surface-container-low)]"
                      >
                        <span className="min-w-0 flex-1 truncate">{selectedApiFormatLabel}</span>
                        <Icon name="expand_more" size={18} className="flex-shrink-0 text-[18px] text-[var(--color-text-secondary)]" />
                      </button>
                    }
                  />
                  {apiFormat !== 'anthropic' && (
                    <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{t('settings.providers.proxyHint')}</p>
                  )}
                </div>
              ) : apiFormat !== 'anthropic' ? (
                <div>
                  <label className="text-[14px] font-medium text-[var(--color-text-primary)] mb-1 block">{t('settings.providers.apiFormat')}</label>
                  <div className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[14px] py-[10px] text-[12px] text-[var(--color-text-tertiary)]">
                    {apiFormat === 'openai_chat' ? t('settings.providers.apiFormatOpenaiChat') : t('settings.providers.apiFormatOpenaiResponses')}
                  </div>
                </div>
              ) : null}

              <div className="flex min-h-[56px] items-center justify-between gap-4 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[14px] py-[10px]">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-[var(--color-text-primary)]">
                    {t('settings.providers.supportsImages')}
                  </div>
                  <p className="mt-1 text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
                    {imageSupportHint}
                  </p>
                </div>
                <SegmentedControl items={imageSupportItems} value={imageSupportMode} onChange={setImageSupportMode} />
              </div>

              {/* Model Mapping */}
              <div>
                <label className="text-[14px] font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.modelMapping')}</label>
                <div className="grid grid-cols-1 gap-2">
                  {MODEL_ROLES.filter((role) => role !== 'main').map((role) => (
                    <div key={role} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_128px]">
                      <ModelIdInput
                        label={role === 'haiku'
                          ? t('settings.providers.haikuModel')
                          : role === 'sonnet'
                            ? t('settings.providers.sonnetModel')
                            : t('settings.providers.opusModel')}
                        value={models[role]}
                        onChange={(value) => updateModel(role, value)}
                        onSelectOption={(option) => selectModelOption(role, option)}
                        placeholder={t('settings.providers.sameAsMain')}
                        options={availableModelOptions}
                        selectLabel={t('model.selectModel')}
                      />
                      <Input
                        label={t('settings.providers.contextWindow')}
                        value={contextWindowInputs[role]}
                        onChange={(e) => updateContextWindowInput(role, e.target.value)}
                        placeholder={contextWindowInputs.main || '200k'}
                        error={contextWindowInputs[role].trim() && !parseContextWindowInput(contextWindowInputs[role]) ? t('settings.providers.contextWindowError') : undefined}
                      />
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}


// ─── Permission Settings ──────────────────────────────────────

export function PermissionSettings() {
  const { permissionMode, setPermissionMode } = useSettingsStore()
  const t = useTranslation()

  const MODES: Array<{ mode: PermissionMode; icon: string; label: string; desc: string }> = [
    { mode: 'default', icon: 'verified_user', label: t('settings.permissions.default'), desc: t('settings.permissions.defaultDesc') },
    { mode: 'acceptEdits', icon: 'edit_note', label: t('settings.permissions.acceptEdits'), desc: t('settings.permissions.acceptEditsDesc') },
    { mode: 'plan', icon: 'architecture', label: t('settings.permissions.plan'), desc: t('settings.permissions.planDesc') },
    { mode: 'bypassPermissions', icon: 'bolt', label: t('settings.permissions.bypass'), desc: t('settings.permissions.bypassDesc') },
  ]

  return (
    <SettingsPage>
      <div className="flex flex-col gap-[8px]">
        {MODES.map(({ mode, icon, label, desc }) => {
          const isSelected = permissionMode === mode
          return (
            <button
              key={mode}
              onClick={() => setPermissionMode(mode)}
              className={`flex min-h-[76px] items-center gap-[12px] rounded-[12px] border px-[16px] py-[12px] text-left transition-colors duration-150 ${
                isSelected
                  ? 'border-[var(--color-brand)] bg-[var(--color-surface-container)] shadow-[var(--shadow-accent-glow)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface-container)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <Icon
                name={icon}
                size={20}
                className={isSelected ? 'text-[var(--color-brand)]' : 'text-[var(--color-text-tertiary)]'}
              />
              <div className="flex-1">
                <div className={`text-[14px] font-semibold tracking-normal ${isSelected ? 'text-[var(--color-brand)]' : 'text-[var(--color-text-primary)]'}`}>{label}</div>
                <div className={`mt-[3px] text-[12px] leading-[18px] ${isSelected ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)]'}`}>{desc}</div>
              </div>
              {isSelected && (
                <Icon name="check_circle" size={18} className="text-[var(--color-brand)]" />
              )}
            </button>
          )
        })}
      </div>
    </SettingsPage>
  )
}

// ─── General Settings ──────────────────────────────────────

export function GeneralSettings() {
  const {
    effortLevel,
    setEffort,
    locale,
    setLocale,
    theme,
    setTheme,
    skipWebFetchPreflight,
    setSkipWebFetchPreflight,
  } = useSettingsStore()
  const t = useTranslation()

  const themeItems: Array<{ value: ThemeMode; label: string }> = [
    { value: 'light', label: t('settings.general.appearance.light') },
    { value: 'dark', label: t('settings.general.appearance.dark') },
  ]

  const effortItems: Array<{ value: EffortLevel; label: string }> = [
    { value: 'low', label: t('settings.general.effort.low') },
    { value: 'medium', label: t('settings.general.effort.medium') },
    { value: 'high', label: t('settings.general.effort.high') },
    { value: 'max', label: t('settings.general.effort.max') },
  ]

  return (
    <SettingsPage>
      <SettingsSection>
        <SettingsRow label={t('settings.general.appearanceTitle')} hint={t('settings.general.appearanceDescription')}>
          <SegmentedControl items={themeItems} value={theme} onChange={(v) => void setTheme(v)} />
        </SettingsRow>
        <SettingsRow label={t('settings.general.languageTitle')} hint={t('settings.general.languageDescription')}>
          <SegmentedControl items={localeOptions} value={locale} onChange={(v) => setLocale(v)} />
        </SettingsRow>
        <SettingsRow label={t('settings.general.effortTitle')} hint={t('settings.general.effortDescription')}>
          <SegmentedControl items={effortItems} value={effortLevel} onChange={(v) => setEffort(v)} />
        </SettingsRow>
        <SettingsRow
          label={t('settings.general.webFetchPreflightEnabled')}
          hint={t('settings.general.webFetchPreflightHint')}
          align="start"
        >
          <Switch
            checked={skipWebFetchPreflight}
            onChange={(next) => void setSkipWebFetchPreflight(next)}
            ariaLabel={t('settings.general.webFetchPreflightEnabled')}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  )
}

// ─── Prompt Memory Settings ──────────────────────────────────────

const MEMORY_TARGETS: PromptMemoryTarget[] = ['soul', 'brief', 'user']

const MEMORY_TARGET_LABEL_KEYS = {
  soul: 'settings.memory.target.soul',
  brief: 'settings.memory.target.brief',
  user: 'settings.memory.target.user',
} as const

const MEMORY_TARGET_DESCRIPTION_KEYS = {
  soul: 'settings.memory.target.soulDescription',
  brief: 'settings.memory.target.briefDescription',
  user: 'settings.memory.target.userDescription',
} as const

const MEMORY_TARGET_ICONS = {
  soul: 'psychology',
  brief: 'memory',
  user: 'person',
} as const

export function MemorySettings() {
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)
  const [activeView, setActiveView] = useState<'profile' | 'files' | 'history'>('profile')
  const [target, setTarget] = useState<PromptMemoryTarget>('brief')
  const [status, setStatus] = useState<PromptMemoryStatus | null>(null)
  const [autoLogs, setAutoLogs] = useState<PromptMemoryAutoReviewLogEntry[]>([])
  const [insights, setInsights] = useState<PromptMemoryInsights | null>(null)
  const [draft, setDraft] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSavingInjection, setIsSavingInjection] = useState(false)
  const [removingInsightId, setRemovingInsightId] = useState<string | null>(null)
  const [pendingRemoveInsight, setPendingRemoveInsight] = useState<PromptMemoryInsight | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadMemory = useCallback(async (nextTarget: PromptMemoryTarget = target) => {
    setIsLoading(true)
    setError(null)
    try {
      const [nextStatus, nextLogs, nextInsights] = await Promise.all([
        promptMemoryApi.status(),
        promptMemoryApi.logs(20),
        promptMemoryApi.insights(),
      ])
      setStatus(nextStatus)
      setAutoLogs(nextLogs)
      setInsights(nextInsights)
      setDraft(nextStatus.files[nextTarget].content)
    } catch (loadError) {
      setError(getMemoryErrorMessage(loadError, t('settings.memory.loadFailed')))
    } finally {
      setIsLoading(false)
    }
  }, [target, t])

  useEffect(() => {
    void loadMemory(target)
  }, [loadMemory, target])

  const targetItems = useMemo(
    () => MEMORY_TARGETS.map((value) => ({
      value,
      label: t(MEMORY_TARGET_LABEL_KEYS[value]),
    })),
    [t],
  )

  const selectedFile = status?.files[target] ?? null
  const trimmedDraft = draft.trim()
  const draftCharCount = trimmedDraft.length
  const limit = selectedFile?.limit ?? 0
  const isDirty = selectedFile ? trimmedDraft !== selectedFile.content : false
  const isOverLimit = limit > 0 && draftCharCount > limit

  const handleTargetChange = (nextTarget: PromptMemoryTarget) => {
    setTarget(nextTarget)
    setError(null)
    if (status) {
      setDraft(status.files[nextTarget].content)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)
    try {
      const saved = await promptMemoryApi.write(target, draft)
      setStatus((current) => current
        ? {
            ...current,
            files: {
              ...current.files,
              [target]: saved,
            },
          }
        : current)
      setDraft(saved.content)
      const nextInsights = await promptMemoryApi.insights()
      setInsights(nextInsights)
      addToast({
        type: 'success',
        message: t('settings.memory.saved'),
      })
    } catch (saveError) {
      setError(getMemoryErrorMessage(saveError, t('settings.memory.saveFailed')))
    } finally {
      setIsSaving(false)
    }
  }

  const handleInjectionChange = async (injectEvolutionMemory: boolean) => {
    setIsSavingInjection(true)
    setError(null)
    try {
      const config = await promptMemoryApi.updateConfig(injectEvolutionMemory)
      setStatus((current) => current ? { ...current, config } : current)
      addToast({
        type: 'success',
        message: t(injectEvolutionMemory
          ? 'settings.memory.injection.enabledToast'
          : 'settings.memory.injection.disabledToast'),
      })
    } catch (saveError) {
      setError(getMemoryErrorMessage(
        saveError,
        t('settings.memory.injection.saveFailed'),
      ))
    } finally {
      setIsSavingInjection(false)
    }
  }

  const handleEditInsight = (insight: PromptMemoryInsight) => {
    setActiveView('files')
    setTarget(insight.target)
    if (status) setDraft(status.files[insight.target].content)
    window.requestAnimationFrame(() => {
      document.getElementById('prompt-memory-editor')?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  const handleRemoveInsight = async () => {
    const insight = pendingRemoveInsight
    if (!insight) return
    setRemovingInsightId(insight.id)
    setError(null)
    try {
      await promptMemoryApi.removeEntry(insight.target, insight.raw)
      await loadMemory(target)
      addToast({
        type: 'success',
        message: t('settings.memory.insight.removed'),
      })
      setPendingRemoveInsight(null)
    } catch (removeError) {
      addToast({
        type: 'error',
        message: getMemoryErrorMessage(
          removeError,
          t('settings.memory.insight.removeFailed'),
        ),
      })
    } finally {
      setRemovingInsightId(null)
    }
  }

  return (
    <main
      className="mx-auto w-full max-w-[980px] overflow-x-hidden pb-[20px]"
      style={{ fontFamily: 'Geist, var(--font-body)' }}
    >
      <motion.header
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
        className="mb-[30px] flex min-h-[78px] items-end justify-between gap-[24px]"
      >
        <div className="min-w-0">
          <h1 className="w-full max-w-none text-[28px] font-semibold leading-[34px] text-[var(--color-text-primary)]">
            {t('settings.memory.title')}
          </h1>
          <p className="mt-[8px] max-w-[720px] text-[13px] leading-[20px] text-[var(--color-text-secondary)]">
            {t('settings.memory.description')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMemory(target)}
          disabled={isLoading}
          aria-label={t('settings.memory.reload')}
          title={t('settings.memory.reload')}
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] text-[var(--color-text-secondary)] transition-[transform,background-color,color] duration-200 hover:-translate-y-[1px] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
        >
          <Icon name={isLoading ? 'loading' : 'refresh'} size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </motion.header>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-[18px] flex items-start gap-[10px] overflow-hidden rounded-[8px] border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 px-[13px] py-[11px] text-[12px] leading-[18px] text-[var(--color-error)]"
          >
            <Icon name="warning" size={16} className="mt-[1px] shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <nav className="mb-[22px] flex min-h-[44px] items-end gap-[26px] border-b border-[var(--color-border-separator)]" aria-label={t('settings.memory.title')}>
        {([
          ['profile', 'settings.memory.insight.title'],
          ['files', 'settings.memory.sectionTitle'],
          ['history', 'settings.memory.autoLogTitle'],
        ] as const).map(([view, labelKey]) => (
          <button
            key={view}
            type="button"
            onClick={() => setActiveView(view)}
            aria-pressed={activeView === view}
            className={`relative h-[43px] whitespace-nowrap text-[12px] font-semibold transition-colors ${
              activeView === view
                ? 'text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            {t(labelKey)}
            {activeView === view && (
              <motion.span
                layoutId="memory-active-view"
                className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-[var(--color-text-primary)]"
              />
            )}
          </button>
        ))}
      </nav>

      <section className="mb-[22px] flex min-h-[70px] items-center justify-between gap-[18px] border-y border-[var(--color-border-separator)] px-[2px] py-[12px]">
        <div className="flex min-w-0 items-start gap-[11px]">
          <span className="mt-[1px] flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] bg-[var(--color-surface-container-low)] text-[var(--color-text-secondary)]">
            <Icon name="psychology" size={16} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[12px] font-semibold leading-[18px] text-[var(--color-text-primary)]">
              {t('settings.memory.injection.title')}
            </h2>
            <p className="mt-[2px] max-w-[760px] whitespace-normal text-[10px] leading-[16px] text-[var(--color-text-tertiary)]">
              {t('settings.memory.injection.description')}
            </p>
          </div>
        </div>
        <Switch
          checked={status?.config?.injectEvolutionMemory ?? true}
          onChange={(next) => void handleInjectionChange(next)}
          disabled={isLoading || isSavingInjection || !status}
          ariaLabel={t('settings.memory.injection.title')}
        />
      </section>

      <AnimatePresence initial={false}>
        {activeView === 'profile' && (
          <motion.section
            key="profile"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <p className="mb-[12px] max-w-[760px] whitespace-normal text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
              {t('settings.memory.insight.description')}
            </p>
            <EvolutionProfile
              overview={insights}
              removingId={removingInsightId}
              onEdit={handleEditInsight}
              onRemove={setPendingRemoveInsight}
            />
          </motion.section>
        )}

        {activeView === 'files' && (
          <motion.section
            key="files"
            id="prompt-memory-editor"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]"
          >
            <header className="flex min-h-[66px] items-center justify-between gap-[16px] border-b border-[var(--color-border-separator)] px-[16px] py-[12px]">
              <div className="min-w-0 flex-1">
                <h2 className="whitespace-normal text-[13px] font-semibold leading-[19px] text-[var(--color-text-primary)]">
                  {t('settings.memory.sectionTitle')}
                </h2>
                <p className="mt-[3px] break-all text-[10px] leading-[15px] text-[var(--color-text-tertiary)]">
                  {selectedFile?.path ?? t('settings.memory.sectionDescription')}
                </p>
              </div>
              <span className={`shrink-0 font-mono text-[11px] tabular-nums ${
                isOverLimit ? 'text-[var(--color-error)]' : 'text-[var(--color-text-secondary)]'
              }`}>
                {t('settings.memory.characters', { count: draftCharCount, limit: limit || '-' })}
              </span>
            </header>

            <div className="grid h-[72px] grid-cols-3 border-b border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)]">
              {targetItems.map((item) => {
                const isActive = item.value === target
                const file = status?.files[item.value]
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => handleTargetChange(item.value)}
                    aria-pressed={isActive}
                    className={`flex min-w-0 items-center justify-center gap-[9px] border-l border-[var(--color-border-separator)] px-[12px] text-left first:border-l-0 ${
                      isActive
                        ? 'bg-[var(--color-text-primary)] text-[var(--color-background)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    <Icon name={MEMORY_TARGET_ICONS[item.value]} size={15} className="shrink-0" />
                    <div className="min-w-0">
                      <div className="whitespace-normal text-[11px] font-semibold leading-[15px]">{item.label}</div>
                      <div className={`mt-[3px] break-all font-mono text-[9px] leading-[13px] ${isActive ? 'opacity-60' : 'text-[var(--color-text-tertiary)]'}`}>
                        {file?.filename ?? item.label}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="px-[16px] pb-[12px] pt-[14px]">
              <p className="whitespace-normal text-[11px] leading-[18px] text-[var(--color-text-secondary)]">
                {t(MEMORY_TARGET_DESCRIPTION_KEYS[target])}
              </p>
              <AnimatePresence mode="wait">
                {target === 'soul' && (
                  <motion.div
                    key="soul-warning"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="mt-[10px] border-l-2 border-[var(--color-warning)] bg-[var(--color-surface-container-low)] px-[10px] py-[8px] text-[10px] leading-[16px] text-[var(--color-text-secondary)]"
                  >
                    {t('settings.memory.soulWarning')}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="px-[16px] pb-[14px]">
              <Textarea
                aria-label={t('settings.memory.editorLabel')}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={isLoading}
                rows={15}
                spellCheck={false}
                className={`min-h-[360px] rounded-[7px] bg-[var(--color-background)] font-mono text-[12px] leading-[20px] ${
                  isOverLimit ? 'border-[var(--color-error)] focus:border-[var(--color-error)]' : ''
                }`}
                placeholder={t('settings.memory.placeholder')}
              />
            </div>

            <footer className="flex min-h-[58px] flex-wrap items-center justify-between gap-[12px] border-t border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-[16px] py-[10px]">
              <div className="flex min-w-0 flex-wrap items-center gap-x-[12px] gap-y-[4px] text-[10px] text-[var(--color-text-tertiary)]">
                <span>{t('settings.memory.delayedEffect')}</span>
                {selectedFile && target !== 'soul' && <span>{t('settings.memory.entries', { count: selectedFile.entries.length })}</span>}
                {isDirty && <span className="font-semibold text-[var(--color-warning)]">{t('settings.memory.unsaved')}</span>}
              </div>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isLoading || isSaving || !selectedFile || !isDirty || isOverLimit}
                className="inline-flex h-[34px] items-center justify-center gap-[7px] rounded-[6px] bg-[var(--color-text-primary)] px-[13px] text-[11px] font-semibold text-[var(--color-background)] transition-[transform,opacity] duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0"
              >
                <Icon name={isSaving ? 'loading' : 'save'} size={14} className={isSaving ? 'animate-spin' : ''} />
                {t('common.save')}
              </button>
            </footer>
          </motion.section>
        )}

        {activeView === 'history' && (
          <motion.section
            key="history"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]"
          >
            <header className="flex min-h-[66px] items-center justify-between gap-[16px] border-b border-[var(--color-border-separator)] px-[16px] py-[12px]">
              <div className="min-w-0">
                <h2 className="whitespace-normal text-[13px] font-semibold leading-[19px] text-[var(--color-text-primary)]">
                  {t('settings.memory.autoLogTitle')}
                </h2>
                <p className="mt-[3px] whitespace-normal text-[10px] leading-[15px] text-[var(--color-text-tertiary)]">
                  {t('settings.memory.autoLogDescription')}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--color-text-tertiary)]">{autoLogs.length}</span>
            </header>
            {autoLogs.length === 0 ? (
              <div className="flex min-h-[300px] flex-col items-center justify-center px-[24px] text-center">
                <span className="mb-[12px] flex h-[38px] w-[38px] items-center justify-center rounded-[8px] border border-[var(--color-border-separator)] text-[var(--color-text-tertiary)]">
                  <Icon name="history" size={17} />
                </span>
                <p className="max-w-[360px] whitespace-normal text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
                  {t('settings.memory.autoLogEmpty')}
                </p>
              </div>
            ) : autoLogs.map((entry, index) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.025, 0.2), duration: 0.22 }}
                className="grid grid-cols-[18px_minmax(0,1fr)] gap-[10px] border-t border-[var(--color-border-separator)] px-[16px] py-[14px] first:border-t-0 hover:bg-[var(--color-surface-hover)]"
              >
                <div className="relative flex justify-center">
                  <span className="relative z-10 mt-[5px] h-[6px] w-[6px] rounded-full bg-[var(--color-brand)]" />
                  {index < autoLogs.length - 1 && <span className="absolute bottom-[-15px] top-[11px] w-px bg-[var(--color-border-separator)]" />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[3px] text-[10px] leading-[15px] text-[var(--color-text-tertiary)]">
                    <span className="font-semibold text-[var(--color-text-primary)]">{t(`settings.memory.autoLog.action.${entry.action}` as never)}</span>
                    <span>{t(entry.target === 'user' ? 'settings.memory.autoLog.target.user' : 'settings.memory.autoLog.target.brief')}</span>
                    <span>{t(`settings.memory.autoLog.trigger.${entry.trigger}` as never)}</span>
                    <span>{formatMemoryLogTime(entry.timestamp)}</span>
                  </div>
                  <p className="mt-[6px] whitespace-pre-wrap break-words text-[12px] leading-[19px] text-[var(--color-text-secondary)]">
                    {formatMemoryLogContent(entry.content || entry.oldText || entry.message)}
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.section>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={pendingRemoveInsight !== null}
        onClose={() => {
          if (!removingInsightId) setPendingRemoveInsight(null)
        }}
        onConfirm={handleRemoveInsight}
        title={t('settings.memory.insight.confirmTitle')}
        body={pendingRemoveInsight
          ? t('settings.memory.insight.confirmBody', {
              content: pendingRemoveInsight.content,
            })
          : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={removingInsightId !== null}
      />
    </main>
  )
}

function formatMemoryLogTime(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleString()
}

function formatMemoryLogContent(content: string) {
  return content.replace(/^\[[a-z][a-z-]{1,31}\]\s*/i, '').trim()
}

function getMemoryErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback
}

// ─── Agents Settings ──────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
  pink: '#ec4899',
  cyan: '#06b6d4',
}

const AGENT_SOURCE_ORDER: AgentSource[] = [
  'userSettings',
  'projectSettings',
  'localSettings',
  'policySettings',
  'plugin',
  'flagSettings',
  'built-in',
]

export function AgentsSettings() {
  const {
    allAgents,
    isLoading,
    error,
    selectedAgent,
    fetchAgents,
  } = useAgentStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const t = useTranslation()

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined

  useEffect(() => {
    void fetchAgents(currentWorkDir)
  }, [fetchAgents, currentWorkDir])

  const listedAgents = useMemo(
    () =>
      [...allAgents].sort((a, b) => {
        const selectedRank = Number(isSameAgent(b, selectedAgent)) - Number(isSameAgent(a, selectedAgent))
        if (selectedRank !== 0) return selectedRank

        const sourceRank = getAgentSourceRank(a.source) - getAgentSourceRank(b.source)
        if (sourceRank !== 0) return sourceRank

        return a.agentType.localeCompare(b.agentType)
      }),
    [allAgents, selectedAgent],
  )

  return (
    <SettingsPage>
      {isLoading && allAgents.length === 0 ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="text-center py-12 px-4">
          <Icon name="error_outline" size={40} className="text-[var(--color-error)] mb-3 block" />
          <p className="text-[14px] text-[var(--color-error)] mb-2">{error}</p>
          <button
            onClick={() => void fetchAgents(currentWorkDir)}
            className="text-[12px] text-[var(--color-text-accent)] hover:underline"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : listedAgents.length === 0 ? (
        <div className="text-center py-12 px-4 rounded-[12px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
          <Icon name="account_tree" size={40} className="text-[var(--color-text-tertiary)] mb-3 block" />
          <p className="text-[14px] text-[var(--color-text-secondary)] mb-1">{t('settings.agents.empty')}</p>
          <p className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.agents.emptyHint')}</p>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-[8px]">
          {listedAgents.map((agent) => {
            const sourceLabel = t(`settings.agents.source.${agent.source}`)
            const isSelected = isSameAgent(agent, selectedAgent)

            return (
              <article
                key={`${agent.source}-${agent.agentType}`}
                aria-current={isSelected ? 'true' : undefined}
                className={`min-h-[76px] rounded-[12px] border px-[16px] py-[12px] transition-colors min-w-0 ${
                  isSelected
                    ? 'border-[var(--color-border-focus)] bg-[var(--color-brand)]/5'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span className="relative mt-[2px] flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
                    <Icon
                      name="account_tree"
                      size={17}
                      style={{ color: getAgentDotColor(agent.color) }}
                    />
                    {agent.isActive && (
                      <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-success)]" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-semibold text-[var(--color-text-primary)] break-all">
                        {agent.agentType}
                      </span>
                      {agent.modelDisplay && (
                        <MetaPill>{agent.modelDisplay}</MetaPill>
                      )}
                      <MetaPill>{sourceLabel}</MetaPill>
                      <MetaPill>
                        {agent.isActive
                          ? t('settings.agents.status.active')
                          : t('settings.agents.status.available')}
                      </MetaPill>
                      {agent.overriddenBy && (
                        <MetaPill>
                          {t('settings.agents.overriddenBy', {
                            source: t(`settings.agents.source.${agent.overriddenBy}`),
                          })}
                        </MetaPill>
                      )}
                    </div>

                    <div className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)] break-words [&_.prose]:text-[12px] [&_.prose]:leading-5 [&_.prose]:text-[var(--color-text-secondary)]">
                      <MarkdownRenderer
                        content={agent.description || t('settings.agents.noDescription')}
                      />
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                      <span>
                        {agent.tools?.length
                          ? t('settings.agents.toolCount', { count: String(agent.tools.length) })
                          : t('settings.agents.noTools')}
                      </span>
                      {agent.baseDir && (
                        <span className="break-all">{agent.baseDir}</span>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </SettingsPage>
  )
}

function getAgentDotColor(color?: string) {
  return color && AGENT_COLORS[color] ? AGENT_COLORS[color] : 'var(--color-text-tertiary)'
}

function isSameAgent(agent: AgentDefinition, selectedAgent: AgentDefinition | null) {
  return !!selectedAgent && agent.agentType === selectedAgent.agentType && agent.source === selectedAgent.source
}

function getAgentSourceRank(source: AgentSource) {
  const rank = AGENT_SOURCE_ORDER.indexOf(source)
  return rank === -1 ? AGENT_SOURCE_ORDER.length : rank
}

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-[10px] py-[4px] text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
      {children}
    </span>
  )
}
// ─── Skill Settings ──────────────────────────────────────

export function SkillSettings() {
  const selectedSkill = useSkillStore((s) => s.selectedSkill)
  const fetchInstalledSkills = useSkillStore((s) => s.fetchSkills)
  const t = useTranslation()
  const [config, setConfig] = useState<SkillsConfig | null>(null)
  const [openingConfig, setOpeningConfig] = useState(false)
  const [skillView, setSkillView] = useState<'installed' | SkillLearningView>('installed')
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const overview = useSkillLearningStore((s) => s.overview)
  const fetchLearningOverview = useSkillLearningStore((s) => s.fetchOverview)
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined
  const recentCandidates = overview?.recentCandidates ?? []
  const latestApprovedCandidateAt = recentCandidates.find(
    (candidate) => candidate.status === 'approved',
  )?.updatedAt

  useEffect(() => {
    let cancelled = false
    skillsApi.config()
      .then(({ config }) => {
        if (!cancelled) setConfig(config)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void fetchLearningOverview(currentWorkDir)
    const timer = window.setInterval(() => {
      void fetchLearningOverview(currentWorkDir, true)
    }, 12_000)
    return () => window.clearInterval(timer)
  }, [currentWorkDir, fetchLearningOverview])

  useEffect(() => {
    if (!latestApprovedCandidateAt) return
    void fetchInstalledSkills(currentWorkDir)
  }, [currentWorkDir, fetchInstalledSkills, latestApprovedCandidateAt])

  const openConfigDir = async () => {
    setOpeningConfig(true)
    try {
      if (isTauriRuntime()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('open_skills_config_dir')
          return
        } catch (desktopError) {
          console.warn('[skills] open_skills_config_dir failed, falling back to shell open', desktopError)
        }

        if (config?.userSkillsDir) {
          try {
            const { open } = await import('@tauri-apps/plugin-shell')
            await open(config.userSkillsDir)
            return
          } catch (shellError) {
            console.warn('[skills] shell open failed', shellError)
          }
        }

        throw new Error(t('settings.skills.openConfigFailed'))
      }

      await skillsApi.openConfig()
    } catch (error) {
      useUIStore.getState().addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('settings.skills.openConfigFailed'),
      })
    } finally {
      setOpeningConfig(false)
    }
  }

  if (selectedSkill) {
    return (
      <div className="w-full min-w-0">
        <SkillDetail />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[896px] flex-col gap-[24px]">
      <header className="flex min-h-[76px] flex-col justify-center gap-[6px] pb-[4px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-bold tracking-normal text-[var(--color-text-primary)]">
              {t('settings.skills.title')}
            </h1>
            <p className="mt-1 text-[13px] leading-[20px] text-[var(--color-text-secondary)]">
              {t('settings.skills.description')}
            </p>
          </div>
          <SkillLearningModeControl cwd={currentWorkDir} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={openConfigDir}
              loading={openingConfig}
              icon={<Icon name="folder_open" size={14} />}
              className="h-[34px] max-w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-[10px] font-mono text-[11px] font-medium normal-case tracking-normal text-[var(--color-text-secondary)]"
              aria-label={t('settings.skills.openConfigPath')}
              title={t('settings.skills.openConfigPath')}
            >
              <span className="truncate">{config?.displayPath ?? '~/.cyber/skills'}</span>
            </Button>
        </div>
      </header>
      <div className="inline-flex h-[38px] w-fit items-center gap-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-0.5">
        {([
          ['installed', t('settings.skills.learning.tab.installed'), undefined],
          ['pending', t('settings.skills.learning.tab.pending'), overview?.pendingCandidates.length],
          [
            'learning',
            t('settings.skills.learning.tab.learning'),
            overview
              ? overview.memories.length + recentCandidates.length
              : undefined,
          ],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSkillView(key)}
            className={`inline-flex h-[32px] items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold transition-colors ${
              skillView === key
                ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm'
                : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
            }`}
            aria-pressed={skillView === key}
          >
            {label}
            {typeof count === 'number' && count > 0 && (
              <span className="min-w-[18px] rounded-md bg-[var(--color-surface-container-high)] px-1 text-center text-[10px] leading-[18px] text-[var(--color-text-secondary)]">
                {count}
              </span>
            )}
          </button>
        ))}
      </div>
      {skillView === 'installed'
        ? <SkillList />
        : <SkillLearningPanel view={skillView} cwd={currentWorkDir} />}
    </div>
  )
}

export function PluginSettings() {
  const selectedPlugin = usePluginStore((s) => s.selectedPlugin)
  const t = useTranslation()

  if (selectedPlugin) {
    return (
      <div className="w-full min-w-0">
        <PluginDetail />
      </div>
    )
  }

  return (
    <SettingsPage icon="extension" title={t('settings.plugins.title')} description={t('settings.plugins.description')}>
      <PluginList />
    </SettingsPage>
  )
}

// ─── About Settings ──────────────────────────────────────

const GITHUB_REPO = 'https://github.com/wk42worldworld/cybercode'
const GITHUB_STAR_URL = 'https://github.com/login?return_to=%2Fwk42worldworld%2Fcybercode'
const GITHUB_ISSUES = `${GITHUB_REPO}/issues`
const GITHUB_RELEASES = `${GITHUB_REPO}/releases`

export function AboutSettings() {
  const t = useTranslation()
  const [version, setVersion] = useState('')
  const updateStatus = useUpdateStore((s) => s.status)
  const availableVersion = useUpdateStore((s) => s.availableVersion)
  const releaseNotes = useUpdateStore((s) => s.releaseNotes)
  const progressPercent = useUpdateStore((s) => s.progressPercent)
  const downloadedBytes = useUpdateStore((s) => s.downloadedBytes)
  const totalBytes = useUpdateStore((s) => s.totalBytes)
  const error = useUpdateStore((s) => s.error)
  const checkedAt = useUpdateStore((s) => s.checkedAt)
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates)
  const installUpdate = useUpdateStore((s) => s.installUpdate)
  const initialize = useUpdateStore((s) => s.initialize)

  useEffect(() => {
    let cancelled = false

    import('@tauri-apps/api/app')
      .then((mod) => mod.getVersion())
      .then((value) => {
        if (!cancelled) setVersion(value)
      })
      .catch(() => {
        if (!cancelled) setVersion('0.1.0')
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void initialize()
  }, [initialize])

  const openUrl = (url: string) => {
    import('@tauri-apps/plugin-shell').then((mod) => mod.open(url)).catch(() => window.open(url, '_blank'))
  }

  const checkedAtText =
    checkedAt
      ? new Date(checkedAt).toLocaleString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          month: 'short',
          day: 'numeric',
        })
      : null

  const hasKnownProgress = typeof totalBytes === 'number' && totalBytes > 0
  const downloadedText = formatBytes(downloadedBytes)
  const updateDescription =
    error
      ? t('update.failed', { error })
      : updateStatus === 'checking'
        ? t('update.checking')
        : updateStatus === 'downloading'
          ? hasKnownProgress
            ? t('update.progress', { progress: String(progressPercent) })
            : t('update.progressBytes', { downloaded: downloadedText })
          : updateStatus === 'downloaded'
            ? t('update.ready')
            : updateStatus === 'restarting'
              ? t('update.restarting')
              : updateStatus === 'available' && availableVersion
                ? t('update.newVersion', { version: availableVersion })
                : updateStatus === 'up-to-date'
                  ? t('update.upToDate', { version: version || t('update.currentVersionUnknown') })
                  : t('update.idle')

  return (
    <div className="w-full min-w-0 max-w-[480px] mx-auto flex flex-col items-center py-10">
      {/* Logo + App Name + Version */}
      <img src="/app-icon.png" alt="CyberCode" className="w-24 h-24 mb-5 rounded-[22px]" />
      <h1 className="text-[24px] font-bold tracking-tight text-[var(--color-text-primary)]">CyberCode</h1>
      {version && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
          <span>{t('settings.about.version')} {version}</span>
          <span className="text-[var(--color-text-tertiary)]">·</span>
          <button
            onClick={() => openUrl(GITHUB_RELEASES)}
            className="rounded text-[var(--color-brand)] transition-colors hover:underline focus:outline-none"
          >
            {t('settings.about.changelog')}
          </button>
        </div>
      )}

      {/* GitHub Repo */}
      <div className="mt-6 w-full">
        <button
          onClick={() => openUrl(GITHUB_STAR_URL)}
          className="flex min-h-[76px] w-full cursor-pointer items-center gap-[12px] rounded-[12px] border border-[var(--color-border)] px-[16px] py-[12px] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          <img src="/icons/github.svg" alt="GitHub" className="w-5 h-5 opacity-70" />
          <div className="flex-1 text-left">
            <div className="text-[14px] font-medium text-[var(--color-text-primary)]">wk42worldworld/cybercode</div>
            <div className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.about.starHint')}</div>
          </div>
        </button>
      </div>

      <div className="mt-4 w-full rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-[16px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('settings.about.updates')}</div>
            <div className="text-[12px] text-[var(--color-text-tertiary)] mt-1">
              {t('settings.about.updatesDesc')}
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void checkForUpdates()}
            loading={updateStatus === 'checking'}
          >
            {t('update.checkNow')}
          </Button>
        </div>

        <div className="mt-4 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[12px]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                {t('settings.about.version')}
              </div>
              <div className="text-[14px] font-medium text-[var(--color-text-primary)] mt-1">
                {version || t('update.currentVersionUnknown')}
              </div>
            </div>

            {availableVersion && (
              <div className="text-right">
                <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                  {t('update.availableLabel')}
                </div>
                <div className="text-[14px] font-medium text-[var(--color-text-primary)] mt-1">
                  {availableVersion}
                </div>
              </div>
            )}
          </div>

          <p className={`mt-3 text-[14px] ${error ? 'text-[var(--color-error)]' : 'text-[var(--color-text-secondary)]'}`}>
            {updateDescription}
          </p>

          {checkedAtText && (
            <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
              {t('update.checkedAt', { time: checkedAtText })}
            </p>
          )}

          {(updateStatus === 'downloading' || updateStatus === 'restarting') && (
            <div className="mt-3">
              <div className="h-1.5 bg-[var(--color-surface-container-low)] rounded-full overflow-hidden">
                {hasKnownProgress || updateStatus === 'restarting' ? (
                  <div
                    className="h-full bg-[var(--color-text-accent)] transition-all duration-300"
                    style={{ width: `${Math.min(progressPercent, 100)}%` }}
                  />
                ) : (
                  <div className="h-full w-1/3 rounded-full bg-[var(--color-text-accent)]/75 animate-pulse" />
                )}
              </div>
              {!hasKnownProgress && updateStatus === 'downloading' && downloadedBytes > 0 && (
                <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                  {downloadedText}
                </p>
              )}
            </div>
          )}

          {releaseNotes && availableVersion && (
            <div className="mt-3 rounded-[12px] bg-[var(--color-surface-container-low)] px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                {t('update.releaseNotes')}
              </div>
              <MarkdownRenderer
                content={releaseNotes}
                variant="document"
                className="mt-2 text-[13px] leading-6 text-[var(--color-text-secondary)] [&_h1]:text-[18px] [&_h2]:text-[16px] [&_h3]:text-[14px] [&_p]:text-[13px] [&_p]:leading-6"
              />
            </div>
          )}

          {availableVersion && (
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                onClick={() => void installUpdate()}
                loading={updateStatus === 'downloading' || updateStatus === 'restarting'}
                disabled={updateStatus === 'checking'}
              >
                {updateStatus === 'restarting' ? t('update.restarting') : t('update.now')}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 w-full">
        <button
          onClick={() => openUrl(GITHUB_ISSUES)}
          className="flex min-h-[76px] w-full cursor-pointer items-center gap-[12px] rounded-[12px] border border-[var(--color-border)] px-[16px] py-[12px] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          <Icon name="feedback" size={20} className="text-[var(--color-text-tertiary)]" />
          <div className="flex-1 text-left">
            <div className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('settings.about.feedback')}</div>
            <div className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.about.feedbackDesc')}</div>
          </div>
        </button>
      </div>
    </div>
  )
}
