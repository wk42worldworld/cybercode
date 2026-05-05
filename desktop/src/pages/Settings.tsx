import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useProviderStore } from '../stores/providerStore'
import { useTranslation } from '../i18n'
import { Modal } from '../components/shared/Modal'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { Input } from '../components/shared/Input'
import { Button } from '../components/shared/Button'
import { Dropdown } from '../components/shared/Dropdown'
import type { PermissionMode, EffortLevel, ThemeMode } from '../types/settings'
import type { Locale } from '../i18n'
import type { SavedProvider, UpdateProviderInput, ProviderTestResult, ModelMapping, ApiFormat } from '../types/provider'
import type { ProviderPreset } from '../types/providerPreset'
import { AdapterSettings } from './AdapterSettings'
import { useAgentStore } from '../stores/agentStore'
import { useSessionStore } from '../stores/sessionStore'
import type { AgentDefinition, AgentSource } from '../api/agents'
import { MarkdownRenderer } from '../components/markdown/MarkdownRenderer'
import { useSkillStore } from '../stores/skillStore'
import { SkillList } from '../components/skills/SkillList'
import { SkillDetail } from '../components/skills/SkillDetail'
import { usePluginStore } from '../stores/pluginStore'
import { PluginList } from '../components/plugins/PluginList'
import { PluginDetail } from '../components/plugins/PluginDetail'
import { ComputerUseSettings } from './ComputerUseSettings'
import { McpSettings } from './McpSettings'
import { TerminalSettings } from './TerminalSettings'
import { useUIStore, type SettingsTab } from '../stores/uiStore'
import { ClaudeOfficialLogin } from '../components/settings/ClaudeOfficialLogin'
import { SettingsPage, SettingsSection, SettingsRow, SegmentedControl, Switch } from '../components/settings/SettingsLayout'
import { useUpdateStore } from '../stores/updateStore'
import { formatBytes } from '../lib/formatBytes'
import { isTauriRuntime } from '../lib/desktopRuntime'
import { Icon } from '../components/shared/Icon'

export function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers')
  const pendingSettingsTab = useUIStore((s) => s.pendingSettingsTab)
  const t = useTranslation()

  useEffect(() => {
    if (!pendingSettingsTab) return
    setActiveTab(pendingSettingsTab)
    useUIStore.getState().setPendingSettingsTab(null)
  }, [pendingSettingsTab])

  const tabTitle = t(`settings.tab.${activeTab}` as never) as string

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#050505]">
      {/* Top toolbar — title on the left, close affordance on the right */}
      <header className="h-12 flex items-center justify-between px-5 border-b border-black/[0.12] dark:border-white/[0.12] bg-white dark:bg-[#050505] shrink-0 z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => useUIStore.getState().closeSettings()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-black/65 dark:text-white/65 hover:text-black/90 dark:hover:text-white/90 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            aria-label={t('settings.back')}
            title={t('settings.back')}
          >
            <Icon name="arrow_back" size={20} />
          </button>
          <span className="text-[13px] font-semibold tracking-tight text-black/90 dark:text-white/90 truncate">
            {t('sidebar.settings')}
            <span className="mx-2 opacity-30">/</span>
            <span className="text-black/70 dark:text-white/70 font-normal">{tabTitle}</span>
          </span>
        </div>
        <button
          onClick={() => useUIStore.getState().closeSettings()}
          className="flex h-7 w-7 items-center justify-center rounded-full text-black/65 dark:text-white/65 hover:text-black/90 dark:hover:text-white/90 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          aria-label="Close"
          title="Esc"
        >
          <Icon name="close" size={18} />
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar nav — grouped, Apple-style */}
        <nav className="w-[228px] shrink-0 overflow-y-auto bg-black/[0.02] dark:bg-white/[0.02] border-r border-black/[0.12] dark:border-white/[0.12] py-4 px-3 space-y-5">
          <NavGroup>
            <NavItem icon="dns"          label={t('settings.tab.providers')}   active={activeTab === 'providers'}   onClick={() => setActiveTab('providers')} />
            <NavItem icon="shield"       label={t('settings.tab.permissions')} active={activeTab === 'permissions'} onClick={() => setActiveTab('permissions')} />
          </NavGroup>

          <NavGroup>
            <NavItem icon="tune"         label={t('settings.tab.general')}     active={activeTab === 'general'}     onClick={() => setActiveTab('general')} />
            <NavItem icon="terminal"     label={t('settings.tab.terminal')}    active={activeTab === 'terminal'}    onClick={() => setActiveTab('terminal')} />
          </NavGroup>

          <NavGroup>
            <NavItem icon="chat"         label={t('settings.tab.adapters')}    active={activeTab === 'adapters'}    onClick={() => setActiveTab('adapters')} />
            <NavItem icon="hub"          label={t('settings.tab.mcp')}         active={activeTab === 'mcp'}         onClick={() => setActiveTab('mcp')} />
            <NavItem icon="smart_toy"    label={t('settings.tab.agents')}      active={activeTab === 'agents'}      onClick={() => setActiveTab('agents')} />
            <NavItem icon="auto_awesome" label={t('settings.tab.skills')}      active={activeTab === 'skills'}      onClick={() => setActiveTab('skills')} />
            <NavItem icon="extension"    label={t('settings.tab.plugins')}     active={activeTab === 'plugins'}     onClick={() => setActiveTab('plugins')} />
            <NavItem icon="mouse"        label={t('settings.tab.computerUse')} active={activeTab === 'computerUse'} onClick={() => setActiveTab('computerUse')} />
          </NavGroup>

          <NavGroup>
            <NavItem icon="info"         label={t('settings.tab.about')}       active={activeTab === 'about'}       onClick={() => setActiveTab('about')} />
          </NavGroup>
        </nav>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-10 py-10">
          {activeTab === 'providers' && <ProviderSettings />}
          {activeTab === 'permissions' && <PermissionSettings />}
          {activeTab === 'general' && <GeneralSettings />}
          {activeTab === 'adapters' && <AdapterSettings />}
          {activeTab === 'terminal' && <TerminalSettings />}
          {activeTab === 'mcp' && <McpSettings />}
          {activeTab === 'agents' && <AgentsSettings />}
          {activeTab === 'skills' && <SkillSettings />}
          {activeTab === 'plugins' && <PluginSettings />}
          {activeTab === 'computerUse' && <ComputerUseSettings />}
          {activeTab === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  )
}

function NavGroup({ children }: { children: ReactNode }) {
  return <div className="space-y-0.5">{children}</div>
}

function NavItem({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 h-10 px-3.5 rounded-md text-[13px] font-medium tracking-[-0.01em] transition-all duration-200 ${
        active
          ? 'bg-[var(--color-spacex-accent)]/10 text-[var(--color-spacex-accent)]'
          : 'text-black/65 dark:text-white/65 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-black/80 dark:hover:text-white/80'
      }`}
    >
      <Icon name={icon} size={20} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

// ─── Provider Settings ──────────────────────────────────────

function ProviderSettings() {
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
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [pendingDeleteProvider, setPendingDeleteProvider] = useState<SavedProvider | null>(null)
  const [isDeletingProvider, setIsDeletingProvider] = useState(false)
  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; result?: ProviderTestResult }>>({})

  useEffect(() => {
    void fetchProviders()
    void fetchPresets()
  }, [fetchPresets, fetchProviders])

  const presetMap = useMemo(
    () => new Map(presets.map((preset) => [preset.id, preset])),
    [presets],
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

  return (
    <SettingsPage
      icon="dns"
      title={t('settings.providers.title')}
      description={t('settings.providers.description')}
    >
      {/* Official provider */}
      <div
        className={`group relative overflow-hidden rounded-lg border-2 transition-all cursor-pointer ${
          isOfficialActive
            ? 'border-black dark:border-white bg-black/[0.02] dark:bg-white/[0.02]'
            : 'border-black/30 dark:border-white/30 hover:border-black dark:hover:border-white'
        }`}
        onClick={() => !isOfficialActive && handleActivateOfficial()}
      >
        <div className="flex items-center gap-5 px-5 py-4">
          {/* Avatar */}
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[17px] font-bold ${
            isOfficialActive
              ? 'bg-black dark:bg-white text-white dark:text-black'
              : 'bg-black/10 dark:bg-white/20 text-black dark:text-white'
          }`}>
            A
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[15px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                {t('settings.providers.officialName')}
              </span>
              {isOfficialActive && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {t('settings.providers.default')}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
              {t('settings.providers.officialDesc')}
            </p>
          </div>
          {!isOfficialActive && (
            <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); handleActivateOfficial() }}>
              {t('settings.providers.setDefault')}
            </Button>
          )}
        </div>
        {isOfficialActive && (
          <div className="px-5 pb-5 pt-1 border-t border-black/[0.10] dark:border-white/[0.10]">
            <ClaudeOfficialLogin />
          </div>
        )}
      </div>

      {/* Saved providers */}
      <button
        onClick={() => setShowCreateModal(true)}
        disabled={isPresetsLoading || presets.length === 0}
        className="w-full flex items-center gap-4 px-5 py-4 rounded-lg border-2 border-dashed border-black/50 dark:border-white/50 text-[var(--color-text-secondary)] hover:border-black dark:hover:border-white hover:text-[var(--color-text-primary)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-black/40 dark:border-white/40">
          <Icon name="add" size={18} />
        </div>
        <div className="text-left">
          <div className="text-[14px] font-semibold tracking-tight">{t('settings.providers.addProvider')}</div>
          <div className="text-[12px] text-[var(--color-text-tertiary)] mt-0.5">{t('settings.providers.description')}</div>
        </div>
      </button>

      {isLoading && providers.length === 0 ? (
        <div className="flex justify-center py-10">
          <Icon name="loading" size={24} className="animate-spin text-[var(--color-text-tertiary)]" />
        </div>
      ) : providers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-black/[0.10] dark:border-white/[0.10] py-10 text-center text-[13px] text-[var(--color-text-tertiary)]">
          {t('settings.providers.addProvider')} →
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {providers.map((provider) => {
            const isActive = activeId === provider.id
            const test = testResults[provider.id]
            const preset = presetMap.get(provider.presetId)
            const initials = provider.name.slice(0, 2).toUpperCase()
            return (
              <div
                key={provider.id}
                className={`relative rounded-lg border-2 transition-all ${
                  isActive
                    ? 'border-black dark:border-white bg-black/[0.02] dark:bg-white/[0.02]'
                    : 'border-black/30 dark:border-white/30 hover:border-black dark:hover:border-white'
                }`}
              >
                <div className="flex items-center gap-4 px-5 py-4">
                  {/* Avatar */}
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold tracking-wider ${
                    isActive
                      ? 'bg-black dark:bg-white text-white dark:text-black'
                      : 'bg-black/10 dark:bg-white/20 text-black dark:text-white'
                  }`}>
                    {initials}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                        {provider.name}
                      </span>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          {t('settings.providers.default')}
                        </span>
                      )}
                      {preset && preset.id !== 'custom' && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-black/[0.05] dark:bg-white/[0.06] text-[var(--color-text-tertiary)]">
                          {preset.name}
                        </span>
                      )}
                      {provider.apiFormat && provider.apiFormat !== 'anthropic' && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                          {provider.apiFormat === 'openai_chat' ? 'OpenAI Chat' : 'OpenAI Responses'}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)] truncate">
                      {provider.baseUrl} · {provider.models.main}
                    </p>
                    {test && !test.loading && test.result && (
                      <p className={`mt-1 text-[11px] ${test.result.connectivity.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--color-error)]'}`}>
                        {test.result.connectivity.success
                          ? t('settings.providers.connectivityOk', { latency: String(test.result.connectivity.latencyMs) })
                          : t('settings.providers.connectivityFailed', { error: test.result.connectivity.error || '' })}
                      </p>
                    )}
                  </div>

                  {/* Actions — always visible */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isActive && (
                      <Button variant="secondary" size="sm" onClick={() => handleActivate(provider.id)}>
                        {t('settings.providers.setDefault')}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => handleTest(provider)} loading={test?.loading}>
                      {t('settings.providers.test')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingProvider(provider)}>
                      <Icon name="edit" size={14} />
                    </Button>
                    {!isActive && (
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(provider)} className="text-[var(--color-error)]/70 hover:text-[var(--color-error)]">
                        <Icon name="delete" size={14} />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Modal — conditionally rendered so state resets on close */}
      {showCreateModal && (
        <ProviderFormModal open={true} onClose={() => setShowCreateModal(false)} mode="create" presets={presets} />
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

// ─── Provider Form Modal ──────────────────────────────────────

type ProviderFormProps = {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  provider?: SavedProvider
  presets: ProviderPreset[]
}

function requirePreset(preset: ProviderPreset | undefined): ProviderPreset {
  if (!preset) {
    throw new Error('Provider presets are not configured')
  }
  return preset
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

function ProviderFormModal({ open, onClose, mode, provider, presets }: ProviderFormProps) {
  const { createProvider, updateProvider, testConfig } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()

  const availablePresets = presets.filter((p) => p.id !== 'official')
  const regularPresets = availablePresets.filter((p) => !p.featured)
  const featuredPresets = availablePresets.filter((p) => p.featured)
  const presetDefaultEnvKeys = useMemo(
    () => new Set(presets.flatMap((preset) => Object.keys(preset.defaultEnv ?? {}))),
    [presets],
  )
  const fallbackPreset = provider
    ? buildFallbackPreset(provider)
    : requirePreset(availablePresets[availablePresets.length - 1])
  const initialPreset = requirePreset(
    provider
      ? availablePresets.find((p) => p.id === provider.presetId) ?? fallbackPreset
      : availablePresets[0] ?? fallbackPreset,
  )

  const [selectedPreset, setSelectedPreset] = useState<ProviderPreset>(initialPreset)
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
  const jsonPastedRef = useRef(false)

  // Load current settings.json and merge provider env vars
  useEffect(() => {
    // Skip if JSON was just populated by user paste
    if (jsonPastedRef.current) {
      jsonPastedRef.current = false
      return
    }
    import('../api/providers').then(({ providersApi }) => {
      providersApi.getSettings().then((settings) => {
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
        setSettingsJson(JSON.stringify({}, null, 2))
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPreset.id])

  const handlePresetChange = (preset: ProviderPreset) => {
    setSelectedPreset(preset)
    setName(preset.name)
    setBaseUrl(preset.baseUrl)
    setApiFormat(preset.apiFormat ?? 'anthropic')
    setModels({ ...preset.defaultModels })
    setTestResult(null)
    if (preset.id === 'custom') setShowAdvanced(true)
  }

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
  const renderPresetButton = (preset: ProviderPreset) => (
    <button
      key={preset.id}
      onClick={() => handlePresetChange(preset)}
      className={`px-3 py-1.5 text-[12px] font-medium rounded-full border transition-all ${
        selectedPreset.id === preset.id
          ? 'border-[var(--color-brand)] bg-[var(--color-surface-container-high)] text-[var(--color-brand)] shadow-[var(--shadow-focus-ring)]'
          : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      {preset.name}
    </button>
  )

  const handleSubmit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      // Write the edited cybercode settings.json first so provider-specific model
      // settings never conflict with the user's global ~/.claude/settings.json.
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
      title={mode === 'create' ? t('settings.providers.addTitle') : t('settings.providers.editTitle')}
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
        {/* Preset chips */}
        {mode === 'create' && (
          <div>
            <label className="text-[14px] font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.preset')}</label>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                {regularPresets.map(renderPresetButton)}
              </div>
              {featuredPresets.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)]/60 pt-2">
                  {featuredPresets.map(renderPresetButton)}
                </div>
              )}
            </div>
          </div>
        )}

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
                className="h-10 w-full rounded-[var(--radius-md)] border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-3 pr-10 text-[14px] text-[var(--color-text-primary)] outline-none transition-colors duration-150 placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((visible) => !visible)}
                aria-label={showApiKey ? 'Hide API Key' : 'Show API Key'}
                className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)]"
              >
                <Icon name={showApiKey ? 'visibility_off' : 'visibility'} size={16} />
              </button>
            </div>
            {apiKeyUrl && (
              <button
                type="button"
                onClick={() => openExternalUrl(apiKeyUrl)}
                className="h-10 flex-shrink-0 cursor-pointer rounded-[var(--radius-md)] border-2 border-[var(--color-border)] bg-transparent px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)] disabled:cursor-default disabled:opacity-40"
              >
                {t('settings.providers.getApiKey')}
              </button>
            )}
            <button
              type="button"
              onClick={handleTest}
              disabled={isTesting || !baseUrl.trim() || !models.main.trim()}
              className="h-10 flex-shrink-0 cursor-pointer rounded-[var(--radius-md)] border-2 border-[var(--color-border)] bg-transparent px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)] disabled:cursor-default disabled:opacity-40"
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
            className="group flex w-full cursor-pointer items-start gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-brand)]/25 bg-[var(--color-brand)]/8 px-2.5 py-1.5 text-left text-[11px] leading-5 text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-brand)]/45 hover:bg-[var(--color-brand)]/12 focus:outline-none focus:shadow-[var(--shadow-focus-ring)] disabled:cursor-default disabled:hover:border-[var(--color-brand)]/25 disabled:hover:bg-[var(--color-brand)]/8"
          >
            <Icon name="tips_and_updates" size={18} className="mt-0.5 text-[13px] text-[var(--color-brand)]" />
            <span>{promoText}</span>
            {apiKeyUrl && (
              <Icon name="arrow_outward" size={18} className="ml-auto mt-1 text-[10px] text-[var(--color-brand)] opacity-45 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
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

              <Input label={t('settings.providers.baseUrl')} required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t('settings.providers.baseUrlPlaceholder')} />

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
                        className="flex h-10 w-full items-center gap-3 rounded-[var(--radius-md)] border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-left text-[14px] text-[var(--color-text-primary)] outline-none transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-container-low)] focus-visible:border-[var(--color-border-focus)] focus-visible:shadow-[var(--shadow-focus-ring)]"
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
                  <div className="text-[12px] text-[var(--color-text-tertiary)] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] border-2 border-[var(--color-border)]">
                    {apiFormat === 'openai_chat' ? t('settings.providers.apiFormatOpenaiChat') : t('settings.providers.apiFormatOpenaiResponses')}
                  </div>
                </div>
              ) : null}

              {/* Model Mapping */}
              <div>
                <label className="text-[14px] font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.modelMapping')}</label>
                <div className="grid grid-cols-2 gap-2">
                  <Input label={t('settings.providers.mainModel')} required value={models.main} onChange={(e) => setModels({ ...models, main: e.target.value })} placeholder="Model ID" />
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
                          // Auto-switch to matching preset or Custom
                          if (mode === 'create') {
                            const matchedPreset = availablePresets.find((p) => p.id !== 'custom' && p.baseUrl === env.ANTHROPIC_BASE_URL)
                            const targetPreset = requirePreset(
                              matchedPreset ?? availablePresets.find((p) => p.id === 'custom'),
                            )
                            if (targetPreset.id !== selectedPreset.id) {
                              jsonPastedRef.current = true
                              setSelectedPreset(targetPreset)
                            }
                          }
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
                  className={`w-full text-[12px] px-3 py-3 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] border font-mono leading-relaxed resize-y text-[var(--color-text-secondary)] outline-none ${
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

function PermissionSettings() {
  const { permissionMode, setPermissionMode } = useSettingsStore()
  const t = useTranslation()

  const MODES: Array<{ mode: PermissionMode; icon: string; label: string; desc: string }> = [
    { mode: 'default', icon: 'verified_user', label: t('settings.permissions.default'), desc: t('settings.permissions.defaultDesc') },
    { mode: 'acceptEdits', icon: 'edit_note', label: t('settings.permissions.acceptEdits'), desc: t('settings.permissions.acceptEditsDesc') },
    { mode: 'plan', icon: 'architecture', label: t('settings.permissions.plan'), desc: t('settings.permissions.planDesc') },
    { mode: 'bypassPermissions', icon: 'bolt', label: t('settings.permissions.bypass'), desc: t('settings.permissions.bypassDesc') },
  ]

  return (
    <SettingsPage icon="shield" title={t('settings.permissions.title')} description={t('settings.permissions.description')}>
      <div className="flex flex-col gap-1.5">
        {MODES.map(({ mode, icon, label, desc }) => {
          const isSelected = permissionMode === mode
          return (
            <button
              key={mode}
              onClick={() => setPermissionMode(mode)}
              className={`flex items-center gap-3 rounded-md border-2 px-4 py-3 text-left transition-all duration-200 ${
                isSelected
                  ? 'border-black dark:border-white bg-black/[0.02] dark:bg-white/[0.02]'
                  : 'border-black/25 dark:border-white/25 hover:border-black dark:hover:border-white'
              }`}
            >
              <Icon
                name={icon}
                size={20}
                className={isSelected ? 'text-black/80 dark:text-white/80' : 'text-black/60 dark:text-white/60'}
              />
              <div className="flex-1">
                <div className={`text-[14px] font-semibold tracking-[-0.01em] ${isSelected ? 'text-black dark:text-white' : 'text-black/85 dark:text-white/85'}`}>{label}</div>
                <div className={`text-[12px] mt-0.5 ${isSelected ? 'text-black/70 dark:text-white/70' : 'text-black/60 dark:text-white/60'}`}>{desc}</div>
              </div>
              {isSelected && (
                <Icon name="check_circle" size={18} className="text-[var(--color-spacex-accent)]" />
              )}
            </button>
          )
        })}
      </div>
    </SettingsPage>
  )
}

// ─── General Settings ──────────────────────────────────────

function GeneralSettings() {
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

  const localeItems: Array<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh', label: '中文' },
  ]

  const effortItems: Array<{ value: EffortLevel; label: string }> = [
    { value: 'low', label: t('settings.general.effort.low') },
    { value: 'medium', label: t('settings.general.effort.medium') },
    { value: 'high', label: t('settings.general.effort.high') },
    { value: 'max', label: t('settings.general.effort.max') },
  ]

  return (
    <SettingsPage icon="tune" title={t('settings.tab.general')}>
      <SettingsSection>
        <SettingsRow label={t('settings.general.appearanceTitle')} hint={t('settings.general.appearanceDescription')}>
          <SegmentedControl items={themeItems} value={theme} onChange={(v) => void setTheme(v)} />
        </SettingsRow>
        <SettingsRow label={t('settings.general.languageTitle')} hint={t('settings.general.languageDescription')}>
          <SegmentedControl items={localeItems} value={locale} onChange={(v) => setLocale(v)} />
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

function AgentsSettings() {
  const {
    activeAgents,
    allAgents,
    isLoading,
    error,
    selectedAgent,
    selectedAgentReturnTab,
    fetchAgents,
    selectAgent,
  } = useAgentStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const t = useTranslation()

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined

  useEffect(() => {
    void fetchAgents(currentWorkDir)
  }, [fetchAgents, currentWorkDir])

  const groupedAgents = useMemo(() => {
    const groups: Partial<Record<AgentSource, AgentDefinition[]>> = {}
    for (const agent of allAgents) {
      ;(groups[agent.source] ??= []).push(agent)
    }
    return groups
  }, [allAgents])

  const sourceCount = AGENT_SOURCE_ORDER.filter((source) => (groupedAgents[source] ?? []).length > 0).length

  const handleAgentBack = () => {
    const returnTab = selectedAgentReturnTab
    selectAgent(null)
    if (returnTab === 'plugins') {
      useUIStore.getState().setPendingSettingsTab('plugins')
    }
  }

  if (selectedAgent) {
    return (
      <div className="w-full min-w-0">
        <AgentDetailView agent={selectedAgent} onBack={handleAgentBack} />
      </div>
    )
  }

  return (
    <SettingsPage
      icon="smart_toy"
      title={t('settings.tab.agents')}
    >
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
      ) : allAgents.length === 0 ? (
        <div className="text-center py-12 px-4 rounded-lg border-2 border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
          <Icon name="smart_toy" size={40} className="text-[var(--color-text-tertiary)] mb-3 block" />
          <p className="text-[14px] text-[var(--color-text-secondary)] mb-1">{t('settings.agents.empty')}</p>
          <p className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.agents.emptyHint')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 min-w-0">
          <section className="rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface-container-low)] overflow-hidden">
            <div className="grid gap-4 px-5 py-5 min-w-0 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] xl:items-end">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] mb-2">
                  {t('settings.agents.browserEyebrow')}
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <Icon name="smart_toy" size={22} className="text-[var(--color-brand)]" />
                  <h3 className="text-[18px] font-semibold text-[var(--color-text-primary)]">
                    {t('settings.agents.browserTitle')}
                  </h3>
                </div>
                <p className="text-[14px] leading-6 text-[var(--color-text-secondary)] max-w-3xl">
                  {t('settings.agents.description')}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 min-w-0 sm:grid-cols-3">
                <SummaryCard
                  label={t('settings.agents.summary.totalAgents')}
                  value={String(allAgents.length)}
                  icon="smart_toy"
                />
                <SummaryCard
                  label={t('settings.agents.summary.activeAgents')}
                  value={String(activeAgents.length)}
                  icon="bolt"
                />
                <SummaryCard
                  label={t('settings.agents.summary.sources')}
                  value={String(sourceCount)}
                  icon="layers"
                  className="col-span-2 sm:col-span-1"
                />
              </div>
            </div>
          </section>

          <div className={`grid gap-4 ${sourceCount >= 2 ? 'xl:grid-cols-2' : ''}`}>
            {AGENT_SOURCE_ORDER.map((source) => {
              const group = groupedAgents[source]
              if (!group?.length) return null

              const sourceLabel = t(`settings.agents.source.${source}`)
              return (
                <section
                  key={source}
                  className="rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden min-w-0"
                >
                  <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${getAgentSourceAccentClass(source)}`}>
                          <Icon name={getAgentSourceIcon(source)} size={16} />
                        </span>
                        <h4 className="text-[14px] font-semibold text-[var(--color-text-primary)]">
                          {sourceLabel}
                        </h4>
                        <span className="text-[12px] text-[var(--color-text-tertiary)]">
                          {group.length}
                        </span>
                      </div>
                      <p className="text-[12px] leading-5 text-[var(--color-text-tertiary)]">
                        {t('settings.agents.groupHint', {
                          source: sourceLabel,
                          count: String(group.length),
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col p-2">
                    {group.map((agent) => (
                      <button
                        key={`${agent.source}-${agent.agentType}`}
                        onClick={() => selectAgent(agent, 'agents')}
                        className="group rounded-md border border-transparent px-3 py-3 text-left transition-all hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-black/15 dark:focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className="mt-0.5 flex-shrink-0 inline-flex items-center justify-center"
                            style={{ color: getAgentDotColor(agent.color) }}
                          >
                            <Icon name="smart_toy" size={18} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[14px] font-bold text-[var(--color-text-primary)] break-all">
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
                          <Icon name="chevron_right" size={18} className="text-[var(--color-text-tertiary)] opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" />
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}
    </SettingsPage>
  )
}

function AgentDetailView({ agent, onBack }: { agent: AgentDefinition; onBack: () => void }) {
  const t = useTranslation()
  const sourceLabel = t(`settings.agents.source.${agent.source}`)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 min-w-0">
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[14px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-black/15 dark:focus-visible:ring-white/20"
        >
          <Icon name="arrow_back" size={16} />
          {t('settings.agents.backToList')}
        </button>
      </div>

      <section className="rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface-container-low)] overflow-hidden">
        <div className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.9fr)] lg:items-start">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] mb-2">
              {t('settings.agents.entryEyebrow')}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span
                className="h-3 w-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: getAgentDotColor(agent.color) }}
              />
              <h3 className="text-[22px] font-semibold leading-tight text-[var(--color-text-primary)] break-all">
                {agent.agentType}
              </h3>
              <MetaPill>{sourceLabel}</MetaPill>
              {agent.modelDisplay && <MetaPill>{agent.modelDisplay}</MetaPill>}
              <MetaPill>
                {agent.isActive
                  ? t('settings.agents.status.active')
                  : t('settings.agents.status.available')}
              </MetaPill>
              {agent.overriddenBy && (
                <MetaPill>
                  {t('settings.agents.overriddenByShort', {
                    source: t(`settings.agents.source.${agent.overriddenBy}`),
                  })}
                </MetaPill>
              )}
            </div>
            <div className="max-w-4xl text-[14px] leading-6 text-[var(--color-text-secondary)]">
              <MarkdownRenderer
                content={agent.description || t('settings.agents.noDescription')}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-[var(--color-text-tertiary)]">
              <span>
                {agent.tools?.length
                  ? t('settings.agents.toolCount', { count: String(agent.tools.length) })
                  : t('settings.agents.noTools')}
              </span>
              {agent.baseDir && <span className="break-all">{agent.baseDir}</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            <DetailStat
              label={t('settings.agents.summary.source')}
              value={sourceLabel}
              icon="layers"
            />
            <DetailStat
              label={t('settings.agents.summary.model')}
              value={agent.modelDisplay || '—'}
              icon="psychology"
            />
            <DetailStat
              label={t('settings.agents.summary.tools')}
              value={String(agent.tools?.length ?? 0)}
              icon="build"
            />
            <DetailStat
              label={t('settings.agents.summary.status')}
              value={agent.isActive ? t('settings.agents.status.active') : t('settings.agents.status.available')}
              icon="bolt"
            />
          </div>
        </div>
      </section>

      {agent.tools && agent.tools.length > 0 && (
        <section className="rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="build" size={18} className="text-[var(--color-text-tertiary)]" />
            <h4 className="text-[14px] font-semibold text-[var(--color-text-primary)]">
              {t('settings.agents.tools')}
            </h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {agent.tools.map((tool) => (
              <MetaPill key={tool}>{tool}</MetaPill>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-1 min-h-0 min-w-0 overflow-hidden rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] font-mono text-[var(--color-text-secondary)] break-all">
                  {agent.baseDir || sourceLabel}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                {t('settings.agents.promptHint')}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[var(--color-surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] border-2 border-[var(--color-border)]">
                {t('settings.agents.systemPrompt')}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-surface-container-lowest)]">
            {agent.systemPrompt ? (
              <div className="px-6 py-5 lg:px-8">
                <MarkdownRenderer
                  content={agent.systemPrompt}
                  variant="document"
                  className="mx-auto max-w-[72ch]"
                />
              </div>
            ) : (
              <div className="px-6 py-10 text-center">
                <Icon name="article" size={32} className="text-[var(--color-text-tertiary)] mb-2 block" />
                <p className="text-[14px] text-[var(--color-text-tertiary)]">
                  {t('settings.agents.noSystemPrompt')}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function getAgentDotColor(color?: string) {
  return color && AGENT_COLORS[color] ? AGENT_COLORS[color] : 'var(--color-text-tertiary)'
}

function getAgentSourceIcon(source: AgentSource) {
  switch (source) {
    case 'userSettings':
      return 'person'
    case 'projectSettings':
      return 'folder'
    case 'localSettings':
      return 'folder_lock'
    case 'policySettings':
      return 'shield'
    case 'plugin':
      return 'extension'
    case 'flagSettings':
      return 'terminal'
    case 'built-in':
      return 'inventory_2'
  }
}

function getAgentSourceAccentClass(source: AgentSource) {
  switch (source) {
    case 'userSettings':
      return 'bg-[var(--color-primary-fixed)] text-[var(--color-brand)]'
    case 'projectSettings':
      return 'bg-[var(--color-success-container)] text-[var(--color-success)]'
    case 'localSettings':
      return 'bg-[var(--color-info-container)] text-[var(--color-info)]'
    case 'policySettings':
      return 'bg-[var(--color-warning-container)] text-[var(--color-warning)]'
    case 'plugin':
      return 'bg-[var(--color-warning-container)] text-[var(--color-warning)]'
    case 'flagSettings':
      return 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
    case 'built-in':
      return 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'
  }
}

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
      {children}
    </span>
  )
}

function SummaryCard({
  label,
  value,
  icon,
  className = '',
}: {
  label: string
  value: string
  icon: string
  className?: string
}) {
  return (
    <div className={`rounded-md border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 min-w-0 ${className}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] min-w-0">
        <Icon name={icon} size={14} className="flex-shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 text-[18px] font-semibold text-[var(--color-text-primary)] truncate">
        {value}
      </div>
    </div>
  )
}

function DetailStat({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: string
}) {
  return (
    <div className="rounded-md border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
        <Icon name={icon} size={14} />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-[16px] font-semibold text-[var(--color-text-primary)] break-all">
        {value}
      </div>
    </div>
  )
}
// ─── Skill Settings ──────────────────────────────────────

function SkillSettings() {
  const selectedSkill = useSkillStore((s) => s.selectedSkill)
  const t = useTranslation()

  if (selectedSkill) {
    return (
      <div className="w-full min-w-0">
        <SkillDetail />
      </div>
    )
  }

  return (
    <SettingsPage icon="auto_awesome" title={t('settings.skills.title')} description={t('settings.skills.description')}>
      <SkillList />
    </SettingsPage>
  )
}

function PluginSettings() {
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

function AboutSettings() {
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
      <h1 className="text-[26px] font-semibold tracking-tight text-black/90 dark:text-white/90">CyberCode</h1>
      {version && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-black/60 dark:text-white/60">
          <span>{t('settings.about.version')} {version}</span>
          <span className="text-black/60 dark:text-white/60">·</span>
          <button
            onClick={() => openUrl(GITHUB_RELEASES)}
            className="rounded text-[var(--color-spacex-accent)] transition-colors hover:underline focus:outline-none"
          >
            {t('settings.about.changelog')}
          </button>
        </div>
      )}

      {/* GitHub Repo */}
      <div className="mt-6 w-full">
        <button
          onClick={() => openUrl(GITHUB_STAR_URL)}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-md border-2 border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
        >
          <img src="/icons/github.svg" alt="GitHub" className="w-5 h-5 opacity-70" />
          <div className="flex-1 text-left">
            <div className="text-[14px] font-medium text-[var(--color-text-primary)]">wk42worldworld/cybercode</div>
            <div className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.about.starHint')}</div>
          </div>
        </button>
      </div>

      <div className="mt-4 w-full rounded-md border-2 border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
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

        <div className="mt-4 rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
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
            <div className="mt-3 rounded-lg bg-[var(--color-surface-container-low)] px-3 py-3">
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
          className="w-full flex items-center gap-3 px-4 py-3 rounded-md border-2 border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
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

