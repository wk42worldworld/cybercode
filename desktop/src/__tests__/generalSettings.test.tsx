import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'

import { ProviderSettings, Settings } from '../pages/Settings'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { useUpdateStore } from '../stores/updateStore'
import type { SavedProvider } from '../types/provider'
import type { ProviderPreset } from '../types/providerPreset'

const MOCK_DELETE_PROVIDER = vi.fn()
const MOCK_GET_SETTINGS = vi.fn()
const MOCK_UPDATE_SETTINGS = vi.fn()
const MOCK_DISCOVER_MODELS = vi.fn()
const providerStoreState = {
  providers: [] as SavedProvider[],
  activeId: null as string | null,
  hasLoadedProviders: true,
  presets: [] as ProviderPreset[],
  isLoading: false,
  isPresetsLoading: false,
  fetchProviders: vi.fn(),
  fetchPresets: vi.fn(),
  deleteProvider: MOCK_DELETE_PROVIDER,
  activateProvider: vi.fn(),
  activateOfficial: vi.fn(),
  testProvider: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  testConfig: vi.fn(),
}

vi.mock('../api/agents', () => ({
  agentsApi: {
    list: vi.fn().mockResolvedValue({ activeAgents: [], allAgents: [] }),
  },
}))

vi.mock('../stores/providerStore', () => ({
  useProviderStore: () => providerStoreState,
}))

vi.mock('../api/providers', () => ({
  providersApi: {
    getSettings: MOCK_GET_SETTINGS,
    updateSettings: MOCK_UPDATE_SETTINGS,
    discoverModels: MOCK_DISCOVER_MODELS,
  },
}))

vi.mock('../components/settings/ClaudeOfficialLogin', () => ({
  ClaudeOfficialLogin: () => <div data-testid="claude-official-login" />,
}))

vi.mock('../pages/AdapterSettings', () => ({
  AdapterSettings: () => <div>Adapter Settings Mock</div>,
}))

vi.mock('../stores/agentStore', () => ({
  useAgentStore: () => ({
    activeAgents: [],
    allAgents: [],
    isLoading: false,
    error: null,
    selectedAgent: null,
    fetchAgents: vi.fn(),
    selectAgent: vi.fn(),
  }),
}))

vi.mock('../stores/skillStore', () => ({
  useSkillStore: () => ({
    skills: [],
    selectedSkill: null,
    isLoading: false,
    isDetailLoading: false,
    error: null,
    fetchSkills: vi.fn(),
    fetchSkillDetail: vi.fn(),
    clearSelection: vi.fn(),
  }),
}))

vi.mock('../components/chat/CodeViewer', () => ({
  CodeViewer: ({ code }: { code: string }) => <pre data-testid="code-viewer">{code}</pre>,
}))

describe('Settings > General tab', () => {
  beforeEach(() => {
    MOCK_DELETE_PROVIDER.mockReset()
    MOCK_GET_SETTINGS.mockResolvedValue({})
    MOCK_UPDATE_SETTINGS.mockResolvedValue({})
    MOCK_DISCOVER_MODELS.mockReset()
    providerStoreState.providers = []
    providerStoreState.activeId = null
    providerStoreState.hasLoadedProviders = true
    providerStoreState.presets = []
    providerStoreState.isLoading = false
    providerStoreState.isPresetsLoading = false
    providerStoreState.fetchProviders = vi.fn()
    providerStoreState.fetchPresets = vi.fn()
    providerStoreState.activateProvider = vi.fn()
    providerStoreState.activateOfficial = vi.fn()
    providerStoreState.testProvider = vi.fn()
    providerStoreState.createProvider = vi.fn()
    providerStoreState.updateProvider = vi.fn()
    providerStoreState.testConfig = vi.fn()

    useSettingsStore.setState({
      locale: 'en',
      skipWebFetchPreflight: true,
      setSkipWebFetchPreflight: vi.fn().mockImplementation(async (enabled: boolean) => {
        useSettingsStore.setState({ skipWebFetchPreflight: enabled })
      }),
    })

    useUIStore.setState({ pendingSettingsTab: null })
    useUpdateStore.setState({
      status: 'idle',
      availableVersion: null,
      releaseNotes: null,
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: false,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })
  })

  it('shows WebFetch preflight toggle enabled by default', () => {
    render(<Settings />)

    fireEvent.click(screen.getByText('General'))

    const toggle = screen.getByLabelText('Skip WebFetch domain preflight')
    expect(toggle).toBeChecked()
  })

  it('offers English, Chinese, Japanese, and Korean language choices', () => {
    render(<Settings />)

    fireEvent.click(screen.getByText('General'))

    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '中文' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '日本語' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '한국어' })).toBeInTheDocument()
  })

  it('lets the user disable WebFetch preflight skipping', () => {
    render(<Settings />)

    fireEvent.click(screen.getByText('General'))

    const toggle = screen.getByLabelText('Skip WebFetch domain preflight')
    fireEvent.click(toggle)

    expect(useSettingsStore.getState().setSkipWebFetchPreflight).toHaveBeenCalledWith(false)
  })

  it('omits rail-owned extension tabs from the settings home', () => {
    render(<Settings />)

    expect(screen.queryByText('Install')).not.toBeInTheDocument()
    expect(screen.queryByText('Terminal')).not.toBeInTheDocument()
    expect(screen.queryByText('MCP')).not.toBeInTheDocument()
    expect(screen.queryByText('Plugins')).not.toBeInTheDocument()
    expect(screen.queryByText('Providers')).not.toBeInTheDocument()
    expect(screen.queryByText('Skills')).not.toBeInTheDocument()
  })
})

describe('Settings > Providers tab', () => {
  beforeEach(() => {
    MOCK_DELETE_PROVIDER.mockReset()
    MOCK_GET_SETTINGS.mockResolvedValue({})
    MOCK_UPDATE_SETTINGS.mockResolvedValue({})
    MOCK_DISCOVER_MODELS.mockReset()
    useSettingsStore.setState({ locale: 'en' })
    providerStoreState.providers = [
      {
        id: 'provider-1',
        name: 'MiniMax-M2.7-highspeed(openai)',
        presetId: 'custom',
        apiKey: '***',
        baseUrl: 'https://api.minimaxi.com',
        apiFormat: 'openai_chat',
        models: {
          main: 'MiniMax-M2.7-highspeed',
          haiku: '',
          sonnet: '',
          opus: '',
        },
        notes: '',
      },
    ]
    providerStoreState.activeId = null
    providerStoreState.hasLoadedProviders = true
  })

  it('does not query official OAuth status before providers finish loading', () => {
    providerStoreState.providers = []
    providerStoreState.activeId = null
    providerStoreState.hasLoadedProviders = false

    render(<ProviderSettings />)

    expect(screen.queryByTestId('claude-official-login')).not.toBeInTheDocument()
  })

  it('shows official OAuth status only after official provider is confirmed active', () => {
    providerStoreState.providers = []
    providerStoreState.activeId = null
    providerStoreState.hasLoadedProviders = true

    render(<ProviderSettings />)

    expect(screen.getByTestId('claude-official-login')).toBeInTheDocument()
  })

  it('requires confirmation before deleting a provider', async () => {
    render(<ProviderSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(MOCK_DELETE_PROVIDER).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Delete provider "MiniMax-M2.7-highspeed(openai)"? This cannot be undone.')).toBeInTheDocument()

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(MOCK_DELETE_PROVIDER).toHaveBeenCalledWith('provider-1')
  })

  it('uses the shared dropdown for API format in the provider form', () => {
    providerStoreState.presets = [
      {
        id: 'custom',
        name: 'Custom',
        baseUrl: 'https://api.example.com/anthropic',
        apiFormat: 'anthropic',
        defaultModels: {
          main: 'custom-main',
          haiku: '',
          sonnet: '',
          opus: '',
        },
        needsApiKey: true,
        websiteUrl: '',
      },
    ]

    render(<ProviderSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /Configure/i })[0]!)

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Configure Custom')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /Anthropic Messages \(native\)/i }))
    fireEvent.click(within(dialog).getByRole('button', { name: /OpenAI Responses API \(proxy\)/i }))

    expect(within(dialog).getByRole('button', { name: /OpenAI Responses API \(proxy\)/i })).toBeInTheDocument()
    expect(within(dialog).getByText('Requests will be translated via the local proxy')).toBeInTheDocument()
  })

  it('opens a provider-specific form with base URL and main model prefilled', () => {
    providerStoreState.providers = []
    providerStoreState.presets = [
      {
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiFormat: 'anthropic',
        defaultModels: {
          main: 'deepseek-v4-pro[1m]',
          haiku: 'deepseek-v4-flash',
          sonnet: 'deepseek-v4-pro[1m]',
          opus: 'deepseek-v4-pro[1m]',
        },
        modelOptions: [
          {
            id: 'deepseek-v4-pro[1m]',
            label: 'DeepSeek V4 Pro 1M',
            contextWindow: 1_000_000,
          },
          {
            id: 'deepseek-v4-flash',
            label: 'DeepSeek V4 Flash',
            contextWindow: 1_000_000,
          },
        ],
        needsApiKey: true,
        websiteUrl: 'https://platform.deepseek.com',
        apiKeyUrl: 'https://platform.deepseek.com/api_keys',
      },
      {
        id: 'custom',
        name: 'Custom',
        baseUrl: '',
        apiFormat: 'anthropic',
        defaultModels: {
          main: '',
          haiku: '',
          sonnet: '',
          opus: '',
        },
        needsApiKey: true,
        websiteUrl: '',
      },
    ]

    render(<ProviderSettings />)

    expect(screen.getByAltText('DeepSeek logo')).toHaveAttribute('src', '/provider-icons/styled/cybercode-deepseek.png')
    expect(screen.getByAltText('DeepSeek logo')).toHaveStyle({
      objectFit: 'contain',
    })
    expect(screen.getByAltText('DeepSeek logo').parentElement).toHaveAttribute('data-provider-logo', 'deepseek')

    fireEvent.click(screen.getAllByRole('button', { name: /Configure/i })[0]!)

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Configure DeepSeek')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'DeepSeek' })).not.toBeInTheDocument()
    expect(within(dialog).getByDisplayValue('https://api.deepseek.com/anthropic')).toBeInTheDocument()
    expect(within(dialog).getByDisplayValue('deepseek-v4-pro[1m]')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /Select model: Main Model/i }))
    fireEvent.click(within(dialog).getByRole('button', { name: /DeepSeek V4 Flash/i }))

    expect(within(dialog).getByDisplayValue('deepseek-v4-flash')).toBeInTheDocument()
  })

  it('does not expose or overwrite the global managed settings JSON in a provider form', async () => {
    MOCK_GET_SETTINGS.mockResolvedValue({
      model: 'kimi-k2.6',
      modelContext: '1m',
      skipWebFetchPreflight: true,
      env: {
        ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'old-kimi-key',
        ANTHROPIC_MODEL: 'kimi-k2.6',
      },
    })
    providerStoreState.providers = []
    providerStoreState.presets = [
      {
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiFormat: 'anthropic',
        defaultModels: {
          main: 'deepseek-v4-pro[1m]',
          haiku: 'deepseek-v4-flash',
          sonnet: 'deepseek-v4-pro[1m]',
          opus: 'deepseek-v4-pro[1m]',
        },
        modelOptions: [
          {
            id: 'deepseek-v4-pro[1m]',
            label: 'DeepSeek V4 Pro 1M',
            contextWindow: 1_000_000,
          },
        ],
        needsApiKey: true,
        websiteUrl: 'https://platform.deepseek.com',
      },
      {
        id: 'custom',
        name: 'Custom',
        baseUrl: '',
        apiFormat: 'anthropic',
        defaultModels: {
          main: '',
          haiku: '',
          sonnet: '',
          opus: '',
        },
        needsApiKey: true,
        websiteUrl: '',
      },
    ]

    render(<ProviderSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /Configure/i })[0]!)
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Advanced settings/i }))

    expect(within(dialog).queryByText('Settings JSON')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('textbox', { name: /Settings JSON/i })).not.toBeInTheDocument()
    expect(MOCK_GET_SETTINGS).not.toHaveBeenCalled()
    expect(MOCK_UPDATE_SETTINGS).not.toHaveBeenCalled()
  })

  it('discovers provider models and adds them to the model picker', async () => {
    MOCK_DISCOVER_MODELS.mockResolvedValue({
      result: {
        models: [
          { id: 'dynamic-text', contextWindow: 128_000 },
          { id: 'dynamic-vision', contextWindow: 256_000, supportsImages: true },
        ],
        endpoint: 'https://api.example.com/v1/models',
        cached: false,
      },
    })
    providerStoreState.providers = []
    providerStoreState.presets = [{
      id: 'custom',
      name: 'Custom',
      baseUrl: 'https://api.example.com',
      apiFormat: 'openai_chat',
      defaultModels: {
        main: 'custom-main',
        haiku: '',
        sonnet: '',
        opus: '',
      },
      needsApiKey: false,
      websiteUrl: '',
    }]

    render(<ProviderSettings />)
    fireEvent.click(screen.getByRole('button', { name: /Configure/i }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discover models' }))

    expect(await within(dialog).findByText('Found 2 models')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /Select model: Main Model/i }))
    expect(within(dialog).getByText('dynamic-vision')).toBeInTheDocument()
  })

  it('shows separate Kimi Code and Kimi API presets with different default models', () => {
    providerStoreState.providers = []
    providerStoreState.presets = [
      {
        id: 'kimi-code',
        name: 'Kimi Code',
        baseUrl: 'https://api.kimi.com/coding/',
        apiFormat: 'anthropic',
        defaultModels: {
          main: 'kimi-for-coding',
          haiku: 'kimi-for-coding',
          sonnet: 'kimi-for-coding',
          opus: 'kimi-for-coding',
        },
        modelOptions: [
          { id: 'kimi-for-coding', label: 'Kimi for Coding', contextWindow: 256_000, supportsImages: true },
          { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', contextWindow: 256_000, supportsImages: true },
          { id: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code Highspeed', contextWindow: 256_000, supportsImages: true },
        ],
        supportsImages: true,
        needsApiKey: true,
        websiteUrl: 'https://www.kimi.com/coding/docs/',
        apiKeyUrl: 'https://www.kimi.com/coding',
      },
      {
        id: 'kimi',
        name: 'Kimi API',
        baseUrl: 'https://api.moonshot.cn/anthropic',
        apiFormat: 'anthropic',
        defaultModels: {
          main: 'kimi-k2.6',
          haiku: 'kimi-k2.6',
          sonnet: 'kimi-k2.6',
          opus: 'kimi-k2.6',
        },
        modelOptions: [
          { id: 'kimi-k2.6', label: 'Kimi K2.6', contextWindow: 256_000 },
        ],
        supportsImages: true,
        needsApiKey: true,
        websiteUrl: 'https://platform.kimi.com',
        apiKeyUrl: 'https://platform.kimi.com/console/api-keys',
      },
      {
        id: 'custom',
        name: 'Custom',
        baseUrl: '',
        apiFormat: 'anthropic',
        defaultModels: {
          main: '',
          haiku: '',
          sonnet: '',
          opus: '',
        },
        needsApiKey: true,
        websiteUrl: '',
      },
    ]

    render(<ProviderSettings />)

    expect(screen.getByText('Kimi Code')).toBeInTheDocument()
    expect(screen.getByText('https://api.kimi.com/coding/ · kimi-for-coding')).toBeInTheDocument()
    expect(screen.getByText('Kimi API')).toBeInTheDocument()
    expect(screen.getByText('https://api.moonshot.cn/anthropic · kimi-k2.6')).toBeInTheDocument()
  })

  it('hides the API key by default and reveals it from the eye button', () => {
    providerStoreState.presets = [
      {
        id: 'custom',
        name: 'Custom',
        baseUrl: 'https://api.example.com/anthropic',
        apiFormat: 'anthropic',
        defaultModels: {
          main: 'custom-main',
          haiku: '',
          sonnet: '',
          opus: '',
        },
        needsApiKey: true,
        websiteUrl: '',
      },
    ]

    render(<ProviderSettings />)

    fireEvent.click(screen.getByRole('button', { name: /Configure/i }))

    const dialog = screen.getByRole('dialog')
    const apiKeyInput = within(dialog).getByPlaceholderText('sk-...')

    expect(apiKeyInput).toHaveAttribute('type', 'password')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Show API Key' }))

    expect(apiKeyInput).toHaveAttribute('type', 'text')
    expect(within(dialog).getByRole('button', { name: 'Hide API Key' })).toBeInTheDocument()
  })

  it('never places a masked saved API key into the editable key field', () => {
    render(<ProviderSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByPlaceholderText('sk-...')).toHaveValue('')
  })
})

describe('Settings > About tab', () => {
  beforeEach(() => {
    useUIStore.setState({ pendingSettingsTab: 'about' })
    useUpdateStore.setState({
      status: 'available',
      availableVersion: '0.1.5',
      releaseNotes: '# CyberCode v0.1.5\n\n- Fixed updater rendering\n- Added markdown support',
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })
  })

  it('renders release notes with markdown formatting', async () => {
    render(<Settings />)

    expect(await screen.findByRole('heading', { name: 'CyberCode v0.1.5' })).toBeInTheDocument()
    expect(screen.getByText('Fixed updater rendering')).toBeInTheDocument()
    expect(screen.getByText('Added markdown support')).toBeInTheDocument()
  })

  it('shows downloaded bytes instead of a fake zero percent when total size is unknown', async () => {
    useUpdateStore.setState({
      status: 'downloading',
      availableVersion: '0.1.5',
      releaseNotes: '# CyberCode v0.1.5',
      progressPercent: 0,
      downloadedBytes: 1536,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })

    render(<Settings />)

    expect(await screen.findByText('Downloading update... 1.5 KB downloaded')).toBeInTheDocument()
    expect(screen.queryByText('Downloading update... 0%')).not.toBeInTheDocument()
  })
})
