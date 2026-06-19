import { useState, useEffect, useMemo, useCallback, type CSSProperties, type ReactNode } from 'react'
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
import type { SavedProvider, UpdateProviderInput, ProviderTestResult, ModelMapping, ApiFormat } from '../types/provider'
import type { ProviderPreset } from '../types/providerPreset'
import { useAgentStore } from '../stores/agentStore'
import { useSessionStore } from '../stores/sessionStore'
import type { AgentDefinition, AgentSource } from '../api/agents'
import { MarkdownRenderer } from '../components/markdown/MarkdownRenderer'
import { useSkillStore } from '../stores/skillStore'
import { skillsApi, type SkillsConfig } from '../api/skills'
import { SkillList } from '../components/skills/SkillList'
import { SkillDetail } from '../components/skills/SkillDetail'
import { usePluginStore } from '../stores/pluginStore'
import { PluginList } from '../components/plugins/PluginList'
import { PluginDetail } from '../components/plugins/PluginDetail'
import { useUIStore, type SettingsTab } from '../stores/uiStore'
import { ClaudeOfficialLogin } from '../components/settings/ClaudeOfficialLogin'
import { SettingsPage, SettingsSection, SettingsRow, SegmentedControl, Switch } from '../components/settings/SettingsLayout'
import { useUpdateStore } from '../stores/updateStore'
import { formatBytes } from '../lib/formatBytes'
import { isTauriRuntime } from '../lib/desktopRuntime'
import { Icon } from '../components/shared/Icon'
import { promptMemoryApi, type PromptMemoryAutoReviewLogEntry, type PromptMemoryStatus, type PromptMemoryTarget } from '../api/promptMemory'

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
          aria-label="Close"
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
            detail="claude-opus-4-7 · claude-sonnet-4-6 · claude-haiku-4-5"
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
          {test && !test.loading && test.result && (
            <p className={`mt-1 text-[11px] ${test.result.connectivity.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
              {test.result.connectivity.success
                ? t('settings.providers.connectivityOk', { latency: String(test.result.connectivity.latencyMs) })
                : t('settings.providers.connectivityFailed', { error: test.result.connectivity.error || '' })}
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

function ProviderLogo({
  name,
  providerId,
  active,
}: {
  name: string
  providerId?: string
  active: boolean
}) {
  const logo = getProviderLogo(providerId)
  const fallback = getFallbackProviderLogo(name)
  const containerStyle = logo
    ? undefined
    : fallback.containerStyle
  const imageStyle = logo
    ? {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
      } satisfies CSSProperties
    : undefined

  return (
    <div
      aria-label={logo ? undefined : `${name} logo`}
      role={logo ? undefined : 'img'}
      data-provider-logo={providerId ?? 'generated'}
      className={`relative flex h-[50px] w-[50px] shrink-0 items-center justify-center overflow-hidden rounded-[12px] border bg-[var(--color-surface-container-lowest)] ${
        active
          ? 'border-[var(--color-brand)] shadow-[var(--shadow-accent-glow)]'
          : 'border-[var(--color-border)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
      }`}
      style={containerStyle}
    >
      {logo ? (
        <img
          src={logo.src}
          alt={`${name} logo`}
          className="block shrink-0 select-none"
          decoding="async"
          draggable={false}
          style={imageStyle}
        />
      ) : (
        <span
          aria-hidden="true"
          className="text-[13px] font-black leading-none tracking-normal"
          style={fallback.textStyle}
        >
          {fallback.text}
        </span>
      )}
    </div>
  )
}

function getProviderInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'AI'
  const asciiParts = trimmed.match(/[A-Za-z0-9]+/g)
  if (asciiParts?.length) {
    return asciiParts.slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  }
  return Array.from(trimmed).slice(0, 2).join('')
}

type ProviderLogoAsset = {
  src: string
}

const PROVIDER_LOGOS: Record<string, ProviderLogoAsset> = {
  official: {
    src: '/provider-icons/anthropic.ico',
  },
  deepseek: {
    src: '/provider-icons/deepseek.ico',
  },
  zhipuglm: {
    src: '/provider-icons/zhipuglm.png',
  },
  kimi: {
    src: '/provider-icons/kimi.ico',
  },
  minimax: {
    src: '/provider-icons/minimax.ico',
  },
  xiaomimimo: {
    src: '/provider-icons/xiaomimimo.png',
  },
  lmstudio: {
    src: '/provider-icons/lmstudio.ico',
  },
  ollama: {
    src: '/provider-icons/ollama.png',
  },
}

function getProviderLogo(providerId: string | undefined): ProviderLogoAsset | undefined {
  return providerId ? PROVIDER_LOGOS[providerId] : undefined
}

const FALLBACK_PROVIDER_LOGOS = [
  { from: '#0ea5e9', to: '#14b8a6' },
  { from: '#7c3aed', to: '#db2777' },
  { from: '#16a34a', to: '#84cc16' },
  { from: '#dc2626', to: '#f59e0b' },
  { from: '#2563eb', to: '#4f46e5' },
] as const

function getFallbackProviderLogo(name: string) {
  const palette = FALLBACK_PROVIDER_LOGOS[hashProviderName(name) % FALLBACK_PROVIDER_LOGOS.length]!
  return {
    text: getProviderInitials(name),
    containerStyle: {
      background: `linear-gradient(135deg, ${palette.from} 0%, ${palette.to} 100%)`,
      borderColor: `${palette.to}55`,
      boxShadow: `0 4px 14px ${palette.from}30`,
    } satisfies CSSProperties,
    textStyle: {
      color: '#ffffff',
    } satisfies CSSProperties,
  }
}

function hashProviderName(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
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

const API_KEY_JSON_PLACEHOLDER = '••••••••'
const API_KEY_JSON_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

function maskSettingsJsonSecrets(raw: string, apiKey: string): string {
  if (!apiKey.trim()) return raw
  try {
    const parsed = JSON.parse(raw) as { env?: Record<string, unknown> }
    if (!parsed.env || typeof parsed.env !== 'object') return raw
    let changed = false
    for (const key of API_KEY_JSON_KEYS) {
      if (parsed.env[key] === apiKey) {
        parsed.env[key] = API_KEY_JSON_PLACEHOLDER
        changed = true
      }
    }
    return changed ? JSON.stringify(parsed, null, 2) : raw
  } catch {
    return raw
  }
}

function restoreSettingsJsonSecrets<T>(settings: T, apiKey: string): T {
  if (!apiKey.trim() || !settings || typeof settings !== 'object') return settings
  const parsed = settings as { env?: Record<string, unknown> }
  if (!parsed.env || typeof parsed.env !== 'object') return settings
  for (const key of API_KEY_JSON_KEYS) {
    if (parsed.env[key] === API_KEY_JSON_PLACEHOLDER) {
      parsed.env[key] = apiKey
    }
  }
  return settings
}

function ProviderFormModal({ open, onClose, mode, provider, presets, initialPresetId }: ProviderFormProps) {
  const { createProvider, updateProvider, testConfig } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()

  const availablePresets = presets.filter((p) => p.id !== 'official')
  const presetDefaultEnvKeys = useMemo(
    () => new Set(presets.flatMap((preset) => Object.keys(preset.defaultEnv ?? {}))),
    [presets],
  )
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
  const [apiKey, setApiKey] = useState(provider?.apiKey ?? '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [notes, setNotes] = useState(provider?.notes ?? '')
  const [models, setModels] = useState<ModelMapping>(provider?.models ?? { ...initialPreset.defaultModels })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [settingsJson, setSettingsJson] = useState('')
  const [settingsJsonError, setSettingsJsonError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(initialPreset.id === 'custom')

  // Load current settings.json and merge provider env vars
  useEffect(() => {
    let cancelled = false
    import('../api/providers').then(({ providersApi }) => {
      providersApi.getSettings().then((settings) => {
        if (cancelled) return
        const needsProxy = apiFormat !== 'anthropic'
        const existingEnv = (settings.env as Record<string, string>) || {}
        const cleanedEnv = Object.fromEntries(
          Object.entries(existingEnv).filter(([key]) => !presetDefaultEnvKeys.has(key)),
        )
        const merged = {
          ...settings,
          skipWebFetchPreflight: settings.skipWebFetchPreflight ?? true,
          env: {
            ...cleanedEnv,
            ...(selectedPreset.defaultEnv ?? {}),
            ANTHROPIC_BASE_URL: needsProxy ? 'http://127.0.0.1:3456/proxy' : baseUrl,
            ANTHROPIC_AUTH_TOKEN: needsProxy
              ? 'proxy-managed'
              : (apiKey || selectedPreset.defaultEnv?.ANTHROPIC_AUTH_TOKEN || (selectedPreset.needsApiKey ? '(your API key)' : '')),
            ANTHROPIC_MODEL: models.main,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: models.haiku,
            ANTHROPIC_DEFAULT_SONNET_MODEL: models.sonnet,
            ANTHROPIC_DEFAULT_OPUS_MODEL: models.opus,
          },
        }
        setSettingsJson(JSON.stringify(merged, null, 2))
      }).catch(() => {
        if (cancelled) return
        setSettingsJson(JSON.stringify({}, null, 2))
      })
    })
    return () => {
      cancelled = true
    }
  }, [
    apiFormat,
    apiKey,
    baseUrl,
    models.haiku,
    models.main,
    models.opus,
    models.sonnet,
    presetDefaultEnvKeys,
    selectedPreset.defaultEnv,
    selectedPreset.id,
    selectedPreset.needsApiKey,
  ])

  const isCustom = selectedPreset.id === 'custom'
  const requiresApiKey = selectedPreset.needsApiKey !== false
  const canSubmit = name.trim() && baseUrl.trim() && (mode === 'edit' || !requiresApiKey || apiKey.trim()) && models.main.trim() && !settingsJsonError
  const apiKeyUrl = selectedPreset.apiKeyUrl?.trim()
  const promoText = selectedPreset.promoText?.trim()
  const displayedSettingsJson = showApiKey
    ? settingsJson
    : maskSettingsJsonSecrets(settingsJson, apiKey)
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

  const handleSubmit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      // Write the edited cybercode settings.json first so provider-specific model
      // settings never conflict with the user's global ~/.cyber/settings.json.
      if (settingsJson.trim()) {
        try {
          const parsed = restoreSettingsJsonSecrets(JSON.parse(settingsJson), apiKey)
          const { providersApi } = await import('../api/providers')
          await providersApi.updateSettings(parsed)
        } catch {
          // JSON validation already prevents this
        }
      }

      if (mode === 'create') {
        await createProvider({
          presetId: selectedPreset.id,
          name: name.trim(),
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim(),
          apiFormat,
          models,
          notes: notes.trim() || undefined,
        })
      } else if (provider) {
        const input: UpdateProviderInput = {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          apiFormat,
          models,
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

  const handleTest = async () => {
    if (!baseUrl.trim() || !models.main.trim()) return
    setIsTesting(true)
    setTestResult(null)
    try {
      let result: ProviderTestResult
      if (mode === 'edit' && provider && !apiKey.trim()) {
        result = await useProviderStore.getState().testProvider(provider.id, {
          baseUrl: baseUrl.trim(),
          modelId: models.main.trim(),
          apiFormat,
        })
      } else {
        if (requiresApiKey && !apiKey.trim()) return
        result = await testConfig({
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim() || selectedPreset.defaultEnv?.ANTHROPIC_AUTH_TOKEN || 'local',
          modelId: models.main.trim(),
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label={t('settings.providers.baseUrl')} required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t('settings.providers.baseUrlPlaceholder')} />
          <Input label={t('settings.providers.mainModel')} required value={models.main} onChange={(e) => setModels({ ...models, main: e.target.value })} placeholder="Model ID" />
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
          {testResult && (
            <div className="flex flex-col gap-0.5 mt-1">
              <span className={`text-[12px] ${testResult.connectivity.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                {testResult.connectivity.success
                  ? t('settings.providers.connectivityOk', { latency: String(testResult.connectivity.latencyMs) })
                  : t('settings.providers.connectivityFailed', { error: testResult.connectivity.error || '' })}
              </span>
              {testResult.proxy && (
                <span className={`text-[12px] ${testResult.proxy.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                  {testResult.proxy.success
                    ? t('settings.providers.proxyOk', { latency: String(testResult.proxy.latencyMs) })
                    : t('settings.providers.proxyFailed', { error: testResult.proxy.error || '' })}
                </span>
              )}
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

              {/* Model Mapping */}
              <div>
                <label className="text-[14px] font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.modelMapping')}</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Input label={t('settings.providers.haikuModel')} value={models.haiku} onChange={(e) => setModels({ ...models, haiku: e.target.value })} placeholder={t('settings.providers.sameAsMain')} />
                  <Input label={t('settings.providers.sonnetModel')} value={models.sonnet} onChange={(e) => setModels({ ...models, sonnet: e.target.value })} placeholder={t('settings.providers.sameAsMain')} />
                  <Input label={t('settings.providers.opusModel')} value={models.opus} onChange={(e) => setModels({ ...models, opus: e.target.value })} placeholder={t('settings.providers.sameAsMain')} />
                </div>
              </div>

              {/* Settings JSON — editable, shown for all presets including official */}
              <div>
                <label className="text-[14px] font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.settingsJson')}</label>
                <textarea
                  value={displayedSettingsJson}
                  onChange={(e) => {
                    const raw = e.target.value
                    try {
                      const parsed = restoreSettingsJsonSecrets(JSON.parse(raw), apiKey)
                      setSettingsJson(JSON.stringify(parsed, null, 2))
                      setSettingsJsonError(null)
                      // Auto-fill form fields from parsed JSON env
                      const env = parsed.env as Record<string, string> | undefined
                      if (env) {
                        if (env.ANTHROPIC_BASE_URL) {
                          setBaseUrl(env.ANTHROPIC_BASE_URL)
                        }
                        const nextApiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY
                        if (nextApiKey && nextApiKey !== '(your API key)' && nextApiKey !== API_KEY_JSON_PLACEHOLDER) {
                          setApiKey(nextApiKey)
                        }
                        const newModels: Partial<ModelMapping> = {}
                        if (env.ANTHROPIC_MODEL) newModels.main = env.ANTHROPIC_MODEL
                        if (env.ANTHROPIC_DEFAULT_HAIKU_MODEL) newModels.haiku = env.ANTHROPIC_DEFAULT_HAIKU_MODEL
                        if (env.ANTHROPIC_DEFAULT_SONNET_MODEL) newModels.sonnet = env.ANTHROPIC_DEFAULT_SONNET_MODEL
                        if (env.ANTHROPIC_DEFAULT_OPUS_MODEL) newModels.opus = env.ANTHROPIC_DEFAULT_OPUS_MODEL
                        if (Object.keys(newModels).length > 0) {
                          setModels((prev) => ({ ...prev, ...newModels }))
                        }
                      }
                    } catch (err) {
                      setSettingsJson(raw)
                      setSettingsJsonError(err instanceof Error ? err.message : 'Invalid JSON')
                    }
                  }}
                  rows={16}
                  spellCheck={false}
                  className={`w-full text-[12px] px-3 py-3 rounded-[10px] bg-[var(--color-surface-container-low)] border font-mono leading-relaxed resize-y text-[var(--color-text-secondary)] outline-none ${
                    settingsJsonError
                      ? 'border-[var(--color-error)] focus:border-[var(--color-error)]'
                      : 'border-[var(--color-border)] focus:border-[var(--color-border-focus)]'
                  }`}
                />
                {settingsJsonError && (
                  <p className="text-[11px] text-[var(--color-error)] mt-1">{t('settings.providers.jsonError', { error: settingsJsonError })}</p>
                )}
                <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{t('settings.providers.settingsJsonDesc')}</p>
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

export function MemorySettings() {
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)
  const [target, setTarget] = useState<PromptMemoryTarget>('brief')
  const [status, setStatus] = useState<PromptMemoryStatus | null>(null)
  const [autoLogs, setAutoLogs] = useState<PromptMemoryAutoReviewLogEntry[]>([])
  const [draft, setDraft] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadMemory = useCallback(async (nextTarget: PromptMemoryTarget = target) => {
    setIsLoading(true)
    setError(null)
    try {
      const [nextStatus, nextLogs] = await Promise.all([
        promptMemoryApi.status(),
        promptMemoryApi.logs(20),
      ])
      setStatus(nextStatus)
      setAutoLogs(nextLogs)
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
            files: {
              ...current.files,
              [target]: saved,
            },
          }
        : current)
      setDraft(saved.content)
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

  return (
    <SettingsPage
      title={t('settings.memory.title')}
      description={t('settings.memory.description')}
    >
      <SettingsSection
        title={t('settings.memory.sectionTitle')}
        description={t('settings.memory.sectionDescription')}
        action={(
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadMemory(target)}
            loading={isLoading}
          >
            {t('settings.memory.reload')}
          </Button>
        )}
      >
        <div className="flex flex-col gap-[14px] px-[20px] py-[16px]">
          <div className="flex flex-wrap items-center justify-between gap-[12px]">
            <SegmentedControl items={targetItems} value={target} onChange={handleTargetChange} />
            <div className={`rounded-full border px-[10px] py-[5px] text-[11px] font-semibold ${
              isOverLimit
                ? 'border-[var(--color-error)] text-[var(--color-error)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'
            }`}>
              {t('settings.memory.characters', {
                count: draftCharCount,
                limit: limit || '-',
              })}
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-[8px] text-[12px]">
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[10px] py-[5px] font-mono font-semibold text-[var(--color-text-primary)]">
              {selectedFile?.filename ?? t(MEMORY_TARGET_LABEL_KEYS[target])}
            </span>
            {selectedFile?.path && (
              <span className="min-w-0 truncate text-[var(--color-text-tertiary)]">
                {selectedFile.path}
              </span>
            )}
          </div>

          <p className="max-w-[720px] text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
            {t(MEMORY_TARGET_DESCRIPTION_KEYS[target])}
          </p>
        </div>

        <div className="flex flex-col gap-[14px] px-[20px] py-[16px]">
          {error && (
            <div className="flex items-start gap-[10px] rounded-[10px] border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 px-[12px] py-[10px] text-[12px] leading-[18px] text-[var(--color-error)]">
              <Icon name="warning" size={16} className="mt-[1px] shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {target === 'soul' && (
            <div className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[12px] py-[10px] text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
              {t('settings.memory.soulWarning')}
            </div>
          )}

          <Textarea
            aria-label={t('settings.memory.editorLabel')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={isLoading}
            rows={14}
            spellCheck={false}
            className={`min-h-[320px] font-mono text-[12px] leading-[20px] ${
              isOverLimit ? 'border-[var(--color-error)] focus:border-[var(--color-error)]' : ''
            }`}
            placeholder={t('settings.memory.placeholder')}
          />

          <div className="flex flex-wrap items-center justify-between gap-[12px]">
            <div className="flex flex-wrap items-center gap-[8px] text-[11px] text-[var(--color-text-tertiary)]">
              <span>{t('settings.memory.delayedEffect')}</span>
              {selectedFile && target !== 'soul' && (
                <span>
                  {t('settings.memory.entries', { count: selectedFile.entries.length })}
                </span>
              )}
              {isDirty && <span>{t('settings.memory.unsaved')}</span>}
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSave()}
              loading={isSaving}
              disabled={isLoading || !selectedFile || !isDirty || isOverLimit}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('settings.memory.autoLogTitle')}
        description={t('settings.memory.autoLogDescription')}
      >
        <div className="flex flex-col gap-[10px] px-[20px] py-[16px]">
          {autoLogs.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[14px] py-[12px] text-[12px] text-[var(--color-text-secondary)]">
              {t('settings.memory.autoLogEmpty')}
            </div>
          ) : (
            autoLogs.map((entry) => (
              <div
                key={entry.id}
                className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[12px] py-[10px]"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
                  <span className="rounded-full bg-[var(--color-surface-container-high)] px-[8px] py-[3px] text-[10px] font-bold uppercase tracking-normal text-[var(--color-text-primary)]">
                    {t(`settings.memory.autoLog.action.${entry.action}` as never)}
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-[var(--color-text-primary)]">
                    {entry.target.toUpperCase()}.md
                  </span>
                  <span className="text-[11px] text-[var(--color-text-tertiary)]">
                    {t(`settings.memory.autoLog.trigger.${entry.trigger}` as never)}
                  </span>
                  <span className="text-[11px] text-[var(--color-text-tertiary)]">
                    {formatMemoryLogTime(entry.timestamp)}
                  </span>
                </div>
                <div className="mt-[8px] break-words text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
                  {entry.content || entry.oldText || entry.message}
                </div>
              </div>
            ))
          )}
        </div>
      </SettingsSection>
    </SettingsPage>
  )
}

function formatMemoryLogTime(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleString()
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
  const t = useTranslation()
  const [config, setConfig] = useState<SkillsConfig | null>(null)
  const [openingConfig, setOpeningConfig] = useState(false)

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
        <h1 className="text-[22px] font-bold tracking-normal text-[var(--color-text-primary)]">
          {t('settings.skills.title')}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] leading-[20px] text-[var(--color-text-secondary)]">
            {t('settings.skills.description')}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={openConfigDir}
            loading={openingConfig}
            icon={<Icon name="folder_open" size={14} />}
            className="h-[36px] max-w-full rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] font-mono text-[11px] font-medium normal-case tracking-normal text-[var(--color-text-secondary)]"
            aria-label={t('settings.skills.openConfigPath')}
            title={t('settings.skills.openConfigPath')}
          >
            <span className="truncate">{config?.displayPath ?? '~/.cyber/skills'}</span>
          </Button>
        </div>
      </header>
      <SkillList />
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
    updateStatus === 'checking'
      ? t('update.checking')
      : updateStatus === 'downloading'
        ? hasKnownProgress
          ? t('update.progress', { progress: String(progressPercent) })
          : t('update.progressBytes', { downloaded: downloadedText })
        : updateStatus === 'restarting'
          ? t('update.restarting')
          : updateStatus === 'available' && availableVersion
            ? t('update.newVersion', { version: availableVersion })
            : updateStatus === 'up-to-date'
              ? t('update.upToDate', { version: version || t('update.currentVersionUnknown') })
              : error
                ? t('update.failed', { error })
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
