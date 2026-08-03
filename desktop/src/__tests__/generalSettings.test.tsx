import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
const MOCK_WARMUP_PROVIDER = vi.fn()
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
  syncProviderModels: vi.fn(),
  setProviderModelAutoSync: vi.fn(),
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
    warmupProvider: MOCK_WARMUP_PROVIDER,
  },
}))

vi.mock('../api/mediaProviders', () => ({
  mediaProvidersApi: {
    peekCatalog: vi.fn(() => undefined),
    catalog: vi.fn(() => new Promise(() => {})),
    save: vi.fn(),
    disconnect: vi.fn(),
    test: vi.fn(),
  },
}))

vi.mock('../api/webSessionProviders', () => ({
  webSessionProvidersApi: {
    peekCatalog: vi.fn(() => undefined),
    catalog: vi.fn(() => new Promise(() => {})),
    save: vi.fn(),
    disconnect: vi.fn(),
    activate: vi.fn(),
    test: vi.fn(),
    testAll: vi.fn(),
  },
}))

vi.mock('../components/providers/MediaProviderCatalog', () => ({
  MediaProviderCatalog: ({ labels }: { labels: { title: string } }) => (
    <section>
      <h2>{labels.title}</h2>
      <div
        data-provider-catalog="media"
        data-provider-catalog-kind="video"
        data-provider-catalog-layout="comfortable"
      />
    </section>
  ),
}))

vi.mock('../components/providers/WebSessionProviderCatalog', () => ({
  WebSessionProviderCatalog: ({ labels }: { labels: { title: string } }) => (
    <section>
      <h2>{labels.title}</h2>
      <div
        data-provider-catalog="web-session"
        data-provider-catalog-layout="comfortable"
      />
    </section>
  ),
}))

vi.mock('../api/providerOAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/providerOAuth')>()
  return {
    ...actual,
    providerOAuthApi: {
      ...actual.providerOAuthApi,
      catalog: vi.fn().mockResolvedValue({
        supportedProviders: [],
        capabilities: [],
        statuses: [],
      }),
    },
  }
})

vi.mock('../components/settings/ClaudeOfficialLogin', () => ({
  ClaudeOAuthDialog: ({ open }: { open: boolean }) => (
    open
      ? <div role="dialog" aria-label="Claude Code" data-testid="claude-oauth-dialog" />
      : null
  ),
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
    MOCK_WARMUP_PROVIDER.mockReset()
    MOCK_WARMUP_PROVIDER.mockResolvedValue({ ok: true, started: true })
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
    providerStoreState.syncProviderModels = vi.fn()
    providerStoreState.setProviderModelAutoSync = vi.fn()

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
    MOCK_WARMUP_PROVIDER.mockReset()
    MOCK_WARMUP_PROVIDER.mockResolvedValue({ ok: true, started: true })
    providerStoreState.syncProviderModels.mockReset()
    providerStoreState.setProviderModelAutoSync.mockReset()
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

  it('places the renamed primary views in the left sidebar', () => {
    render(<ProviderSettings />)

    const sidebar = screen.getByRole('complementary', { name: 'Model access views' })
    expect(within(sidebar).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Model providers',
      'Agent routing',
      'Model sharing',
      'Runtime status',
    ])
    expect(screen.queryByRole('heading', { name: 'Models & Routing' })).not.toBeInTheDocument()
  }, 15_000)

  it('places no-auth and local providers directly after OAuth', () => {
    const makePreset = (
      id: string,
      name: string,
      needsApiKey = true,
    ): ProviderPreset => ({
      id,
      name,
      baseUrl: `https://api.${id}.example/v1`,
      apiFormat: 'openai_chat',
      defaultModels: {
        main: `${id}-main`,
        haiku: `${id}-fast`,
        sonnet: `${id}-main`,
        opus: `${id}-main`,
      },
      needsApiKey,
      websiteUrl: `https://${id}.example`,
    })
    providerStoreState.providers = [
      {
        id: 'legacy-gateway',
        name: 'Legacy Gateway',
        presetId: 'custom',
        apiKey: '***',
        baseUrl: 'https://gateway.example.com/v1',
        apiFormat: 'openai_chat',
        models: {
          main: 'legacy-main',
          haiku: '',
          sonnet: '',
          opus: '',
        },
        notes: '',
      },
      {
        id: 'legacy-volcengine',
        name: '火山',
        presetId: 'custom',
        apiKey: '***',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        apiFormat: 'openai_chat',
        models: {
          main: 'doubao-seed-1-6',
          haiku: '',
          sonnet: '',
          opus: '',
        },
        notes: '',
      },
    ]
    providerStoreState.presets = [
      makePreset('perplexity', 'Perplexity'),
      makePreset('openrouter', 'OpenRouter'),
      makePreset('siliconflow', 'SiliconFlow'),
      makePreset('anthropic-api', 'Anthropic API'),
      makePreset('openai', 'OpenAI'),
      {
        ...makePreset('volcengine', 'Volcengine Ark'),
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      },
      makePreset('lmstudio', 'LM Studio', false),
      makePreset('custom', 'Custom'),
    ]

    const { container } = render(<ProviderSettings />)

    expect(screen.getByRole('heading', { name: 'OAuth providers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No-auth providers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Official API providers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Model aggregators' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Image, video & audio providers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Custom providers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Local models' })).toBeInTheDocument()
    expect(screen.queryByText('Free does not mean keyless')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Model source categories' })).not.toBeInTheDocument()
    expect(
      Array.from(container.querySelectorAll('[data-provider-catalog]')).map(
        (catalog) => catalog.getAttribute('data-provider-catalog'),
      ),
    ).toEqual([
      'custom',
      'api-key',
      'aggregators-gateways',
      'oauth',
      'no-auth',
      'local',
      'web-session',
      'media',
    ])

    const apiCatalog = container.querySelector('[data-provider-catalog="api-key"]')
    const apiCards = Array.from(apiCatalog!.querySelectorAll('[data-provider-card-layout="catalog"]'))
    expect(apiCards).toEqual([
      screen.getByText('OpenAI').closest('[data-provider-card-layout="catalog"]'),
      screen.getByText('Anthropic API').closest('[data-provider-card-layout="catalog"]'),
      screen.getByText('Perplexity').closest('[data-provider-card-layout="catalog"]'),
    ])
    expect(within(apiCatalog as HTMLElement).queryByText('Legacy Gateway')).not.toBeInTheDocument()
    expect(within(apiCatalog as HTMLElement).queryByText('SiliconFlow')).not.toBeInTheDocument()
    expect(within(apiCatalog as HTMLElement).queryByText('Volcengine Ark')).not.toBeInTheDocument()
    expect(within(apiCatalog as HTMLElement).queryByText('火山')).not.toBeInTheDocument()
    expect(apiCatalog).toHaveAttribute('data-provider-catalog-layout', 'comfortable')

    const aggregatorCatalog = container.querySelector(
      '[data-provider-catalog="aggregators-gateways"]',
    )
    expect(aggregatorCatalog).toHaveAttribute('data-provider-catalog-layout', 'comfortable')
    expect(within(aggregatorCatalog as HTMLElement).getByText('OpenRouter')).toBeInTheDocument()
    expect(within(aggregatorCatalog as HTMLElement).getByText('SiliconFlow')).toBeInTheDocument()
    expect(within(aggregatorCatalog as HTMLElement).getByText('Volcengine Ark')).toBeInTheDocument()
    expect(within(
      screen.getByText('Volcengine Ark').closest('[data-provider-card-layout="catalog"]')!,
    ).getByText('Configured')).toBeInTheDocument()
    expect(within(apiCatalog as HTMLElement).queryByText('OpenRouter')).not.toBeInTheDocument()
    expect(within(aggregatorCatalog!.closest('section') as HTMLElement).getByText(
      /^1\/\d+$/,
    )).toBeInTheDocument()

    const customCatalog = container.querySelector('[data-provider-catalog="custom"]')
    expect(customCatalog).toHaveAttribute('data-provider-catalog-layout', 'comfortable')
    expect(within(customCatalog as HTMLElement).getByText('Legacy Gateway')).toBeInTheDocument()
    expect(within(customCatalog as HTMLElement).getByText('Custom')).toBeInTheDocument()

    const localCatalog = container.querySelector('[data-provider-catalog="local"]')
    expect(localCatalog).toHaveAttribute('data-provider-catalog-layout', 'comfortable')
    expect(within(localCatalog as HTMLElement).getByText('LM Studio')).toBeInTheDocument()
    expect(within(localCatalog as HTMLElement).queryByText('Custom')).not.toBeInTheDocument()
    expect(within(localCatalog as HTMLElement).queryByText('Legacy Gateway')).not.toBeInTheDocument()
  }, 15_000)

  it('opens a complete OAuth wizard before the server capability catalog arrives', () => {
    render(<ProviderSettings />)

    fireEvent.click(screen.getByRole('button', {
      name: 'Amazon Q: Ready to connect',
    }))

    expect(screen.getByRole('dialog', { name: 'Amazon Q' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect account' })).toBeEnabled()
    expect(screen.queryByText(/Loading this provider’s connection method/)).not.toBeInTheDocument()
  }, 15_000)

  it('uses official Chinese brand names without translating global-only brands', () => {
    const makePreset = (id: string, name: string): ProviderPreset => ({
      id,
      name,
      baseUrl: `https://api.${id}.example/v1`,
      apiFormat: 'openai_chat',
      defaultModels: {
        main: `${id}-main`,
        haiku: `${id}-fast`,
        sonnet: `${id}-main`,
        opus: `${id}-main`,
      },
      needsApiKey: true,
      websiteUrl: `https://${id}.example`,
    })
    useSettingsStore.setState({ locale: 'zh' })
    providerStoreState.providers = []
    providerStoreState.presets = [
      makePreset('openai', 'OpenAI'),
      makePreset('groq', 'Groq'),
      makePreset('alibaba', 'Alibaba Qwen'),
      makePreset('volcengine', 'Volcengine Ark'),
      makePreset('qianfan', 'Baidu Qianfan'),
      makePreset('siliconflow', 'SiliconFlow'),
      makePreset('zhipuglm', '智谱 GLM'),
      makePreset('xiaomimimo', '小米 MiMo'),
    ]

    const { container } = render(<ProviderSettings />)

    const apiCatalog = container.querySelector('[data-provider-catalog="api-key"]') as HTMLElement
    const aggregatorCatalog = container.querySelector(
      '[data-provider-catalog="aggregators-gateways"]',
    ) as HTMLElement

    expect(within(aggregatorCatalog).getByRole('button', { name: '配置 阿里云百炼' })).toBeInTheDocument()
    expect(within(aggregatorCatalog).getByRole('button', { name: '配置 火山方舟' })).toBeInTheDocument()
    expect(within(aggregatorCatalog).getByRole('button', { name: '配置 百度千帆' })).toBeInTheDocument()
    expect(within(aggregatorCatalog).getByRole('button', { name: '配置 硅基流动' })).toBeInTheDocument()
    expect(within(aggregatorCatalog).getByRole('button', { name: '配置 Groq' })).toBeInTheDocument()
    expect(within(apiCatalog).getByRole('button', { name: '配置 智谱 GLM' })).toBeInTheDocument()
    expect(within(apiCatalog).getByRole('button', { name: '配置 小米 MiMo' })).toBeInTheDocument()
    expect(within(apiCatalog).getByRole('button', { name: '配置 OpenAI' })).toBeInTheDocument()
    expect(within(apiCatalog).queryByRole('button', { name: '配置 Groq' })).not.toBeInTheDocument()
    expect(screen.queryByText('Alibaba Qwen')).not.toBeInTheDocument()
    expect(screen.queryByText('Volcengine Ark')).not.toBeInTheDocument()

    const providerSearch = screen.getByRole('searchbox', {
      name: '搜索所有提供商或模型',
    })
    fireEvent.change(providerSearch, {
      target: { value: '火山方舟' },
    })
    expect(screen.getByRole('button', { name: '配置 火山方舟' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '配置 阿里云百炼' })).not.toBeInTheDocument()

    fireEvent.change(providerSearch, {
      target: { value: 'Alibaba Cloud' },
    })
    expect(screen.getByRole('button', { name: '配置 阿里云百炼' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '配置 火山方舟' })).not.toBeInTheDocument()
  })

  it('finds Chinese provider names while the interface is English', () => {
    providerStoreState.providers = []
    providerStoreState.presets = [
      {
        id: 'alibaba',
        name: 'Alibaba Qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiFormat: 'openai_chat',
        defaultModels: {
          main: 'qwen-max',
          haiku: 'qwen-turbo',
          sonnet: 'qwen-plus',
          opus: 'qwen-max',
        },
        needsApiKey: true,
        websiteUrl: 'https://bailian.console.aliyun.com',
      },
      {
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        apiFormat: 'openai_chat',
        defaultModels: {
          main: 'deepseek-chat',
          haiku: 'deepseek-chat',
          sonnet: 'deepseek-chat',
          opus: 'deepseek-reasoner',
        },
        needsApiKey: true,
        websiteUrl: 'https://platform.deepseek.com',
      },
    ]

    const { container } = render(<ProviderSettings />)

    fireEvent.change(screen.getByRole('searchbox', {
      name: 'Search all providers or models',
    }), {
      target: { value: '阿里云百炼' },
    })

    const catalogs = Array.from(
      container.querySelectorAll('[data-provider-catalog]'),
    ).map((catalog) => catalog.getAttribute('data-provider-catalog'))
    expect(catalogs).toEqual(['aggregators-gateways'])
    expect(screen.getByRole('button', {
      name: 'Configure Alibaba Cloud Model Studio',
    })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configure DeepSeek' })).not.toBeInTheDocument()
  })

  it('filters all provider catalogs by access type without a search query', () => {
    const { container } = render(<ProviderSettings />)

    const searchbox = screen.getByRole('searchbox', {
      name: 'Search all providers or models',
    })
    expect(searchbox).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const filterDialog = screen.getByRole('dialog', { name: 'Filter providers' })
    fireEvent.click(within(filterDialog).getByRole('checkbox', { name: 'OAuth' }))

    expect(searchbox).toHaveValue('')
    expect(
      Array.from(container.querySelectorAll('[data-provider-catalog]')).map(
        (catalog) => catalog.getAttribute('data-provider-catalog'),
      ),
    ).toEqual(['oauth'])
    expect(screen.getAllByText('16 providers').length).toBeGreaterThan(0)
  })

  it('filters custom providers and local models independently without a search query', () => {
    const makePreset = (
      id: string,
      name: string,
      needsApiKey: boolean,
    ): ProviderPreset => ({
      id,
      name,
      baseUrl: `https://api.${id}.example/v1`,
      apiFormat: 'openai_chat',
      defaultModels: {
        main: `${id}-main`,
        haiku: `${id}-fast`,
        sonnet: `${id}-main`,
        opus: `${id}-main`,
      },
      needsApiKey,
      websiteUrl: `https://${id}.example`,
    })
    providerStoreState.providers = [
      {
        id: 'company-gateway',
        name: 'Company Gateway',
        presetId: 'custom',
        apiKey: '***',
        baseUrl: 'https://gateway.example.com/v1',
        apiFormat: 'openai_chat',
        models: {
          main: 'company-main',
          haiku: '',
          sonnet: '',
          opus: '',
        },
        notes: '',
      },
    ]
    providerStoreState.presets = [
      makePreset('custom', 'Custom', true),
      makePreset('lmstudio', 'LM Studio', false),
      makePreset('openai', 'OpenAI', true),
    ]

    const { container } = render(<ProviderSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const filterDialog = screen.getByRole('dialog', { name: 'Filter providers' })
    fireEvent.click(within(filterDialog).getByRole('checkbox', { name: 'Custom' }))

    expect(
      Array.from(container.querySelectorAll('[data-provider-catalog]')).map(
        (catalog) => catalog.getAttribute('data-provider-catalog'),
      ),
    ).toEqual(['custom'])
    expect(screen.getByText('Company Gateway')).toBeInTheDocument()
    expect(screen.queryByText('LM Studio')).not.toBeInTheDocument()

    fireEvent.click(within(filterDialog).getByRole('checkbox', { name: 'Custom' }))
    fireEvent.click(within(filterDialog).getByRole('checkbox', { name: 'Local' }))

    expect(
      Array.from(container.querySelectorAll('[data-provider-catalog]')).map(
        (catalog) => catalog.getAttribute('data-provider-catalog'),
      ),
    ).toEqual(['local', 'media'])
    expect(screen.getByText('LM Studio')).toBeInTheDocument()
    expect(screen.queryByText('Company Gateway')).not.toBeInTheDocument()
  })

  it('combines access, cost, and modality filters', () => {
    const makePreset = (
      id: string,
      name: string,
      cost: ProviderPreset['cost'],
      supportsImages: boolean,
    ): ProviderPreset => ({
      id,
      name,
      baseUrl: `https://api.${id}.example/v1`,
      apiFormat: 'openai_chat',
      defaultModels: {
        main: `${id}-main`,
        haiku: `${id}-fast`,
        sonnet: `${id}-main`,
        opus: `${id}-main`,
      },
      supportsImages,
      needsApiKey: true,
      websiteUrl: `https://${id}.example`,
      cost,
    })
    providerStoreState.providers = []
    providerStoreState.presets = [
      makePreset('free-vision', 'Free Vision', 'recurring-free', true),
      makePreset('paid-text', 'Paid Text', 'paid', false),
    ]

    const { container } = render(<ProviderSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const filterDialog = screen.getByRole('dialog', { name: 'Filter providers' })
    fireEvent.click(within(filterDialog).getByRole('checkbox', { name: 'API key' }))
    fireEvent.click(within(filterDialog).getByRole('checkbox', {
      name: 'Recurring free allowance',
    }))
    fireEvent.click(within(filterDialog).getByRole('checkbox', { name: 'Multimodal' }))

    expect(
      Array.from(container.querySelectorAll('[data-provider-catalog]')).map(
        (catalog) => catalog.getAttribute('data-provider-catalog'),
      ),
    ).toEqual(['api-key'])
    expect(screen.getByRole('button', { name: 'Configure Free Vision' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configure Paid Text' })).not.toBeInTheDocument()
  })

  it('keeps the Claude OAuth dialog closed while providers load', () => {
    providerStoreState.providers = []
    providerStoreState.activeId = null
    providerStoreState.hasLoadedProviders = false

    render(<ProviderSettings />)

    expect(screen.queryByTestId('claude-oauth-dialog')).not.toBeInTheDocument()
  })

  it('opens Claude OAuth in the same dialog pattern as other providers', () => {
    providerStoreState.providers = []
    providerStoreState.activeId = null
    providerStoreState.hasLoadedProviders = true

    render(<ProviderSettings />)

    expect(screen.queryByTestId('claude-oauth-dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Claude OAuth login' }))
    expect(screen.getByRole('dialog', { name: 'Claude Code' })).toBeInTheDocument()
    expect(screen.queryByText('Claude Official')).not.toBeInTheDocument()
  })

  it('requires confirmation before deleting a provider', async () => {
    render(<ProviderSettings />)

    fireEvent.click(screen.getByRole('button', {
      name: 'More actions for MiniMax-M2.7-highspeed(openai)',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))

    expect(MOCK_DELETE_PROVIDER).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Delete provider "MiniMax-M2.7-highspeed(openai)"? This cannot be undone.')).toBeInTheDocument()

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(MOCK_DELETE_PROVIDER).toHaveBeenCalledWith('provider-1')
  })

  it('shows a single connection result on configured provider cards', async () => {
    providerStoreState.presets = [
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
    providerStoreState.testProvider = vi.fn().mockResolvedValue({
      connectivity: {
        success: true,
        latencyMs: 22,
        modelUsed: 'MiniMax-M2.7-highspeed',
      },
      modelChecks: [
        {
          roles: ['main'],
          requestedModel: 'MiniMax-M2.7-highspeed',
          result: {
            success: true,
            latencyMs: 22,
            modelUsed: 'MiniMax-M2.7-highspeed',
          },
        },
      ],
      imageCapability: {
        modelId: 'MiniMax-M2.7-highspeed',
        status: 'unsupported',
        source: 'probe',
      },
      allModelsPassed: true,
    })

    render(<ProviderSettings />)
    fireEvent.click(screen.getByRole('button', {
      name: 'More actions for MiniMax-M2.7-highspeed(openai)',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Test' }))

    expect(await screen.findByText('Connection successful (22ms)')).toBeInTheDocument()
    expect(screen.queryByText(/Connection successful \(22ms\).*MiniMax/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Image input · MiniMax/)).not.toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Configure Custom' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog.parentElement).toHaveClass('z-[10000]')
    expect(within(dialog).getByText('Configure Custom')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument()
    expect(dialog.querySelector('select')).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /Anthropic Messages \(native\)/i }))
    fireEvent.click(screen.getByRole('option', { name: /OpenAI Responses API \(proxy\)/i }))

    expect(within(dialog).getByRole('button', { name: /OpenAI Responses API \(proxy\)/i })).toBeInTheDocument()
    expect(within(dialog).getByText('Requests will be translated via the local proxy')).toBeInTheDocument()
  }, 15_000)

  it('shows only the connection result and does not request an image capability probe', async () => {
    providerStoreState.providers = []
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
    providerStoreState.testConfig = vi.fn().mockResolvedValue({
      connectivity: { success: true, latencyMs: 18, modelUsed: 'custom-main' },
      modelChecks: [
        {
          roles: ['main'],
          requestedModel: 'custom-main',
          result: { success: true, latencyMs: 18, modelUsed: 'custom-main' },
        },
      ],
      proxy: { success: true, latencyMs: 4 },
      imageCapability: {
        modelId: 'custom-main',
        status: 'supported',
        source: 'probe',
      },
      allModelsPassed: true,
    })

    render(<ProviderSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure Custom' }))

    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('sk-...'), {
      target: { value: 'sk-test' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Test Connection' }))

    expect(await within(dialog).findByText('Connection successful (18ms)')).toBeInTheDocument()
    expect(providerStoreState.testConfig).toHaveBeenCalledWith(expect.objectContaining({
      probeImages: false,
    }))
    expect(within(dialog).queryByText('Main Model: custom-main -> custom-main (18ms)')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('② Proxy pipeline (4ms)')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Image input · custom-main: supported')).not.toBeInTheDocument()
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

    const deepSeekLogo = document.querySelector('[data-provider-logo="deepseek"] img')
    expect(deepSeekLogo).toHaveAttribute('src', '/provider-icons/brands/deepseek-color.svg')
    expect(deepSeekLogo).toHaveStyle({
      objectFit: 'contain',
    })
    expect(deepSeekLogo?.parentElement).toHaveAttribute('data-provider-logo', 'deepseek')

    fireEvent.click(screen.getByRole('button', { name: 'Configure DeepSeek' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Configure DeepSeek')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'DeepSeek' })).not.toBeInTheDocument()
    expect(within(dialog).getByDisplayValue('https://api.deepseek.com/anthropic')).toBeInTheDocument()
    expect(within(dialog).getByDisplayValue('deepseek-v4-pro[1m]')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /Select model: Main Model/i }))
    fireEvent.click(within(dialog).getByRole('button', { name: /DeepSeek V4 Flash/i }))

    expect(within(dialog).getByDisplayValue('deepseek-v4-flash')).toBeInTheDocument()
  }, 15_000)

  it('groups free-tier platforms as aggregators and validates Cloudflare setup', async () => {
    const defaultModels = {
      main: 'default-model',
      haiku: 'default-model',
      sonnet: 'default-model',
      opus: 'default-model',
    }
    providerStoreState.providers = []
    providerStoreState.presets = [
      {
        id: 'cloudflare-ai',
        name: 'Cloudflare Workers AI',
        baseUrl: 'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1',
        apiFormat: 'openai_chat',
        defaultModels: {
          ...defaultModels,
          main: '@cf/moonshotai/kimi-k2.7-code',
        },
        needsApiKey: true,
        websiteUrl: 'https://developers.cloudflare.com/workers-ai/',
        cost: 'recurring-free',
        costNote: 'Includes a daily free allowance',
      },
      {
        id: 'ollama-cloud',
        name: 'Ollama Cloud',
        baseUrl: 'https://ollama.com',
        apiFormat: 'openai_chat',
        defaultModels,
        needsApiKey: true,
        websiteUrl: 'https://docs.ollama.com/cloud',
        cost: 'recurring-free',
      },
      {
        id: 'llm7',
        name: 'LLM7.io',
        baseUrl: 'https://api.llm7.io/v1',
        apiFormat: 'openai_chat',
        defaultModels,
        needsApiKey: true,
        websiteUrl: 'https://docs.llm7.io/quickstart',
        cost: 'mixed',
      },
    ]
    providerStoreState.testConfig = vi.fn().mockResolvedValue({
      connectivity: { success: true, latencyMs: 12 },
    })

    const { container } = render(<ProviderSettings />)
    const apiCatalog = container.querySelector('[data-provider-catalog="api-key"]') as HTMLElement
    const aggregatorCatalog = container.querySelector(
      '[data-provider-catalog="aggregators-gateways"]',
    ) as HTMLElement

    expect(within(apiCatalog).queryByText('Cloudflare Workers AI')).not.toBeInTheDocument()
    expect(within(aggregatorCatalog).getByRole('button', {
      name: 'Configure Cloudflare Workers AI',
    })).toBeInTheDocument()
    expect(within(aggregatorCatalog).getByRole('button', {
      name: 'Configure Ollama Cloud',
    })).toBeInTheDocument()
    expect(within(aggregatorCatalog).getByRole('button', {
      name: 'Configure LLM7.io',
    })).toBeInTheDocument()
    expect(within(aggregatorCatalog).getAllByText('Free allowance')).toHaveLength(2)
    expect(within(aggregatorCatalog).getByText('Partly free')).toBeInTheDocument()

    fireEvent.click(within(aggregatorCatalog).getByRole('button', {
      name: 'Configure Cloudflare Workers AI',
    }))
    const dialog = screen.getByRole('dialog')
    const accountIdInput = within(dialog).getByPlaceholderText('32-character Account ID')
    const apiKeyInput = within(dialog).getByPlaceholderText('sk-...')
    const addButton = within(dialog).getByRole('button', { name: 'Add' })

    expect(accountIdInput).toHaveValue('')
    expect(addButton).toBeDisabled()

    fireEvent.change(accountIdInput, { target: { value: 'invalid-id' } })
    fireEvent.change(apiKeyInput, { target: { value: 'cloudflare-token' } })
    expect(within(dialog).getByText(
      'Enter the 32-character hexadecimal Account ID',
    )).toBeInTheDocument()
    expect(addButton).toBeDisabled()

    const accountId = '0123456789abcdef0123456789abcdef'
    fireEvent.change(accountIdInput, { target: { value: accountId } })
    expect(addButton).toBeEnabled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Test Connection' }))
    expect(await within(dialog).findByText('Connection successful (12ms)')).toBeInTheDocument()
    expect(providerStoreState.testConfig).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'cloudflare-token',
      baseUrl: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
      presetId: 'cloudflare-ai',
    }))
  }, 30_000)

  it('configures a verified no-auth provider without asking for an API key', async () => {
    providerStoreState.providers = []
    providerStoreState.presets = [{
      id: 'opencode-free',
      name: 'OpenCode Free',
      baseUrl: 'https://opencode.ai/zen/v1',
      apiFormat: 'openai_chat',
      defaultModels: {
        main: 'north-mini-code-free',
        haiku: 'ling-3.0-flash-free',
        sonnet: 'north-mini-code-free',
        opus: 'mimo-v2.5-free',
      },
      defaultModelContextWindows: {
        main: 131_000,
        haiku: 131_000,
        sonnet: 131_000,
        opus: 131_000,
      },
      modelOptions: [
        { id: 'north-mini-code-free', contextWindow: 131_000 },
        { id: 'mimo-v2.5-free', contextWindow: 131_000 },
        { id: 'ling-3.0-flash-free', contextWindow: 131_000 },
      ],
      needsApiKey: false,
      websiteUrl: 'https://opencode.ai',
      cost: 'recurring-free',
    }]
    providerStoreState.testConfig = vi.fn().mockResolvedValue({
      connectivity: { success: true, latencyMs: 18 },
      proxy: { success: true, latencyMs: 20 },
    })

    const { container } = render(<ProviderSettings />)
    const noAuthCatalog = container.querySelector('[data-provider-catalog="no-auth"]') as HTMLElement
    const localCatalog = container.querySelector('[data-provider-catalog="local"]') as HTMLElement

    expect(within(noAuthCatalog).getByRole('button', {
      name: 'Configure OpenCode Free',
    })).toBeInTheDocument()
    expect(within(localCatalog).queryByText('OpenCode Free')).not.toBeInTheDocument()

    fireEvent.click(within(noAuthCatalog).getByRole('button', {
      name: 'Configure OpenCode Free',
    }))
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).queryByPlaceholderText('sk-...')).not.toBeInTheDocument()
    expect(within(dialog).getByText('No account or API key is required')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeEnabled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Test Connection' }))
    expect(await within(dialog).findByText('Connection successful (18ms)')).toBeInTheDocument()
    expect(providerStoreState.testConfig).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: '',
      baseUrl: 'https://opencode.ai/zen/v1',
      modelId: 'north-mini-code-free',
      presetId: 'opencode-free',
    }))
  }, 30_000)

  it('fills the official context window when selecting a different provider model', () => {
    providerStoreState.providers = [
      {
        id: 'zhipu-provider',
        name: 'Zhipu GLM',
        presetId: 'zhipuglm',
        apiKey: '***',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
        apiFormat: 'anthropic',
        models: {
          main: 'glm-5',
          haiku: 'glm-5',
          sonnet: 'glm-5',
          opus: 'glm-5',
        },
        modelContextWindows: {
          main: 200_000,
          haiku: 200_000,
          sonnet: 200_000,
          opus: 200_000,
        },
        notes: '',
      },
    ]
    providerStoreState.presets = [
      {
        id: 'zhipuglm',
        name: 'Zhipu GLM',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
        apiFormat: 'anthropic',
        defaultModels: {
          main: 'glm-5.2',
          haiku: 'glm-4.7',
          sonnet: 'glm-5.2',
          opus: 'glm-5.2',
        },
        defaultModelContextWindows: {
          main: 1_000_000,
          haiku: 200_000,
          sonnet: 1_000_000,
          opus: 1_000_000,
        },
        modelOptions: [
          { id: 'glm-5.2', label: 'GLM-5.2', contextWindow: 1_000_000 },
          { id: 'glm-5', label: 'GLM-5', contextWindow: 200_000 },
        ],
        needsApiKey: true,
        websiteUrl: 'https://open.bigmodel.cn',
      },
    ]

    render(<ProviderSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Zhipu GLM' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByDisplayValue('200k')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /Select model: Main Model/i }))
    fireEvent.click(within(dialog).getByRole('button', { name: /^GLM-5\.2\b/i }))

    expect(within(dialog).getByDisplayValue('glm-5.2')).toBeInTheDocument()
    expect(within(dialog).getByDisplayValue('1m')).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Configure DeepSeek' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Configure Custom' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import models' }))

    expect(
      await within(dialog).findByText(
        'Imported 2 models; choose one from the model menu above',
      ),
    ).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /Select model: Main Model/i }))
    expect(within(dialog).getByText('dynamic-vision')).toBeInTheDocument()
  }, 30_000)

  it('explains why importing models needs an API key instead of silently doing nothing', async () => {
    providerStoreState.providers = []
    providerStoreState.presets = [{
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com',
      apiFormat: 'openai_responses',
      defaultModels: {
        main: 'gpt-5.6-sol',
        haiku: 'gpt-5.6-luna',
        sonnet: 'gpt-5.6-terra',
        opus: 'gpt-5.6-sol',
      },
      needsApiKey: true,
      websiteUrl: 'https://platform.openai.com/docs/models',
    }]

    render(<ProviderSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure OpenAI' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import models' }))

    expect(
      await within(dialog).findByRole('alert'),
    ).toHaveTextContent('Enter an API key before importing models.')
    expect(MOCK_DISCOVER_MODELS).not.toHaveBeenCalled()
  }, 30_000)

  it('synchronizes a saved model catalog and enables automatic refresh', async () => {
    const originalProvider: SavedProvider = {
      id: 'provider-sync',
      name: 'Example AI',
      presetId: 'custom',
      apiKey: '***',
      baseUrl: 'https://api.example.com/v1',
      apiFormat: 'openai_chat',
      models: {
        main: 'manual-model',
        haiku: '',
        sonnet: '',
        opus: '',
      },
      modelCatalog: [{ id: 'manual-model', contextWindow: 64_000 }],
      modelSync: {
        enabled: false,
        syncedModelIds: [],
        supported: true,
      },
      notes: '',
    }
    const synchronizedProvider: SavedProvider = {
      ...originalProvider,
      modelCatalog: [
        { id: 'manual-model', contextWindow: 64_000 },
        { id: 'latest-model', contextWindow: 256_000 },
      ],
      modelSync: {
        enabled: false,
        syncedModelIds: ['latest-model'],
        supported: true,
        lastSyncedAt: '2026-07-29T00:00:00.000Z',
        endpoint: 'https://api.example.com/v1/models',
      },
    }
    providerStoreState.providers = [originalProvider]
    providerStoreState.presets = [{
      id: 'custom',
      name: 'Custom',
      baseUrl: '',
      apiFormat: 'openai_chat',
      defaultModels: {
        main: '',
        haiku: '',
        sonnet: '',
        opus: '',
      },
      needsApiKey: true,
      websiteUrl: '',
    }]
    providerStoreState.syncProviderModels.mockResolvedValue({
      provider: synchronizedProvider,
      result: {
        endpoint: 'https://api.example.com/v1/models',
        cached: false,
        total: 2,
        added: 1,
        updated: 0,
        removed: 0,
      },
    })
    providerStoreState.setProviderModelAutoSync.mockResolvedValue({
      provider: {
        ...synchronizedProvider,
        modelSync: {
          ...synchronizedProvider.modelSync,
          enabled: true,
        },
      },
    })

    render(<ProviderSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Example AI' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sync latest models' }))

    expect(
      await within(dialog).findByText('Synchronized 2 models; 1 added'),
    ).toBeInTheDocument()
    expect(providerStoreState.syncProviderModels).toHaveBeenCalledWith('provider-sync')
    fireEvent.click(within(dialog).getByRole('button', { name: /Select model: Main Model/i }))
    expect(within(dialog).getByText('latest-model')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByLabelText('Auto-sync models'))
    expect(
      await within(dialog).findByText('Auto-sync is on and the first sync completed'),
    ).toBeInTheDocument()
    expect(providerStoreState.setProviderModelAutoSync).toHaveBeenCalledWith(
      'provider-sync',
      true,
    )
  }, 15_000)

  it('refreshes the model catalog after saving any sync-enabled provider', async () => {
    const savedProvider: SavedProvider = {
      id: 'saved-deepseek',
      name: 'DeepSeek',
      presetId: 'deepseek',
      apiKey: '***',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai_chat',
      models: {
        main: 'deepseek-v4-pro',
        haiku: 'deepseek-v4-flash',
        sonnet: 'deepseek-v4-pro',
        opus: 'deepseek-v4-pro',
      },
      modelSync: {
        enabled: true,
        syncedModelIds: [],
        supported: true,
      },
    }
    providerStoreState.providers = []
    providerStoreState.presets = [{
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai_chat',
      defaultModels: savedProvider.models,
      needsApiKey: false,
      websiteUrl: 'https://platform.deepseek.com',
    }]
    providerStoreState.createProvider.mockResolvedValue(savedProvider)
    providerStoreState.syncProviderModels.mockResolvedValue({
      provider: savedProvider,
      result: {
        endpoint: 'https://api.deepseek.com/models',
        cached: false,
        total: 1,
        added: 1,
        updated: 0,
        removed: 0,
      },
    })
    useSettingsStore.setState({
      fetchAll: vi.fn().mockResolvedValue(undefined),
    })

    render(<ProviderSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure DeepSeek' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Add',
    }))

    await waitFor(() => {
      expect(providerStoreState.createProvider).toHaveBeenCalled()
      expect(providerStoreState.syncProviderModels).toHaveBeenCalledWith('saved-deepseek')
    })
    expect(MOCK_WARMUP_PROVIDER).not.toHaveBeenCalled()
  }, 15_000)

  it('warms up the default model after saving a local provider', async () => {
    const savedProvider: SavedProvider = {
      id: 'saved-ollama',
      name: 'Ollama',
      presetId: 'ollama',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:11434',
      apiFormat: 'openai_chat',
      models: {
        main: 'qwen3:8b',
        haiku: 'qwen3:8b',
        sonnet: 'qwen3:8b',
        opus: 'qwen3:8b',
      },
    }
    providerStoreState.providers = []
    providerStoreState.presets = [{
      id: 'ollama',
      name: 'Ollama',
      baseUrl: 'http://127.0.0.1:11434',
      apiFormat: 'openai_chat',
      defaultModels: savedProvider.models,
      needsApiKey: false,
      websiteUrl: 'https://ollama.com',
    }]
    providerStoreState.createProvider.mockResolvedValue(savedProvider)
    useSettingsStore.setState({
      fetchAll: vi.fn().mockResolvedValue(undefined),
    })

    render(<ProviderSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure Ollama' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Add',
    }))

    await waitFor(() => {
      expect(providerStoreState.createProvider).toHaveBeenCalled()
      expect(MOCK_WARMUP_PROVIDER).toHaveBeenCalledWith('saved-ollama', 'qwen3:8b')
    })
  }, 15_000)

  it('does not warm up remote providers after saving', async () => {
    const savedProvider: SavedProvider = {
      id: 'saved-remote',
      name: 'DeepSeek',
      presetId: 'deepseek',
      apiKey: '***',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai_chat',
      models: {
        main: 'deepseek-v4-pro',
        haiku: 'deepseek-v4-pro',
        sonnet: 'deepseek-v4-pro',
        opus: 'deepseek-v4-pro',
      },
    }
    providerStoreState.providers = []
    providerStoreState.presets = [{
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai_chat',
      defaultModels: savedProvider.models,
      needsApiKey: false,
      websiteUrl: 'https://platform.deepseek.com',
    }]
    providerStoreState.createProvider.mockResolvedValue(savedProvider)
    useSettingsStore.setState({
      fetchAll: vi.fn().mockResolvedValue(undefined),
    })

    render(<ProviderSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure DeepSeek' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Add',
    }))

    await waitFor(() => {
      expect(providerStoreState.createProvider).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(useSettingsStore.getState().fetchAll).toHaveBeenCalled()
    })
    expect(MOCK_WARMUP_PROVIDER).not.toHaveBeenCalled()
  }, 15_000)

  it('shows Kimi Code and Kimi as separate API key entries', () => {
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
          { id: 'kimi-for-coding', label: 'Kimi for Coding', contextWindow: 262_144, supportsImages: true },
          { id: 'kimi-for-coding-highspeed', label: 'Kimi for Coding HighSpeed', contextWindow: 262_144, supportsImages: true },
        ],
        supportsImages: true,
        needsApiKey: true,
        websiteUrl: 'https://www.kimi.com/coding/docs/',
        apiKeyUrl: 'https://www.kimi.com/coding',
      },
      {
        id: 'kimi',
        name: 'Kimi',
        baseUrl: 'https://api.moonshot.cn',
        apiFormat: 'openai_chat',
        defaultModels: {
          main: 'kimi-k2.7-code',
          haiku: 'kimi-k2.6',
          sonnet: 'kimi-k2.7-code',
          opus: 'kimi-k2.7-code',
        },
        modelOptions: [
          { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', contextWindow: 262_144 },
          { id: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code Highspeed', contextWindow: 262_144 },
          { id: 'kimi-k2.6', label: 'Kimi K2.6', contextWindow: 262_144 },
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

    expect(screen.getByRole('button', { name: 'Configure Kimi Code' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Configure Kimi' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage Kimi' })).not.toBeInTheDocument()
    expect(screen.queryByText('2 connection methods')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Configure Kimi Code' }))
    expect(within(screen.getByRole('dialog')).getByDisplayValue('kimi-for-coding')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'Configure Kimi' }))
    expect(within(screen.getByRole('dialog')).getByDisplayValue('kimi-k2.7-code')).toBeInTheDocument()
  }, 30_000)

  it('keeps OAuth runtime providers out of API key, aggregator, and local catalogs', () => {
    const models = {
      main: 'test-main',
      haiku: 'test-fast',
      sonnet: 'test-main',
      opus: 'test-main',
    }
    providerStoreState.providers = [
      {
        id: 'kimi-code-key',
        name: 'Kimi Code Key',
        presetId: 'kimi-code',
        apiKey: '***',
        baseUrl: 'https://api.kimi.com/coding/',
        apiFormat: 'anthropic',
        models,
        notes: '',
      },
      {
        id: 'kimi-coding-oauth',
        name: 'Kimi Coding OAuth Runtime',
        presetId: 'kimi-code',
        oauthProviderId: 'kimi-coding',
        apiKey: '',
        baseUrl: 'https://api.kimi.com/coding/',
        apiFormat: 'anthropic',
        models,
        notes: '',
      },
      {
        id: 'aggregator-oauth-runtime',
        name: 'Aggregator OAuth Runtime',
        presetId: 'openrouter',
        oauthProviderId: 'aggregator-oauth',
        apiKey: '',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiFormat: 'openai_chat',
        models,
        notes: '',
      },
      {
        id: 'local-oauth-runtime',
        name: 'Local OAuth Runtime',
        presetId: 'lmstudio',
        oauthProviderId: 'local-oauth',
        apiKey: '',
        baseUrl: 'http://localhost:1234/v1',
        apiFormat: 'openai_chat',
        models,
        notes: '',
      },
    ]
    providerStoreState.presets = [
      {
        id: 'kimi-code',
        name: 'Kimi Code',
        baseUrl: 'https://api.kimi.com/coding/',
        apiFormat: 'anthropic',
        defaultModels: models,
        needsApiKey: true,
        websiteUrl: 'https://www.kimi.com/coding',
      },
      {
        id: 'openrouter',
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiFormat: 'openai_chat',
        defaultModels: models,
        needsApiKey: true,
        websiteUrl: 'https://openrouter.ai',
      },
      {
        id: 'lmstudio',
        name: 'LM Studio',
        baseUrl: 'http://localhost:1234/v1',
        apiFormat: 'openai_chat',
        defaultModels: models,
        needsApiKey: false,
        websiteUrl: 'https://lmstudio.ai',
      },
      {
        id: 'custom',
        name: 'Custom',
        baseUrl: '',
        apiFormat: 'anthropic',
        defaultModels: models,
        needsApiKey: true,
        websiteUrl: '',
      },
    ]

    const { container } = render(<ProviderSettings />)
    const apiCatalog = container.querySelector('[data-provider-catalog="api-key"]') as HTMLElement
    const aggregatorCatalog = container.querySelector(
      '[data-provider-catalog="aggregators-gateways"]',
    ) as HTMLElement
    const localCatalog = container.querySelector('[data-provider-catalog="local"]') as HTMLElement

    expect(within(apiCatalog).getByRole('button', { name: 'Edit Kimi Code' })).toBeInTheDocument()
    expect(within(apiCatalog).queryByRole('button', { name: 'Manage Kimi Code' })).not.toBeInTheDocument()
    expect(within(apiCatalog).queryByText('2 configurations')).not.toBeInTheDocument()
    expect(within(aggregatorCatalog).getByRole('button', { name: 'Configure OpenRouter' })).toBeInTheDocument()
    expect(within(localCatalog).getByRole('button', { name: 'Configure LM Studio' })).toBeInTheDocument()
    expect(screen.queryByText('Kimi Coding OAuth Runtime')).not.toBeInTheDocument()
    expect(screen.queryByText('Aggregator OAuth Runtime')).not.toBeInTheDocument()
    expect(screen.queryByText('Local OAuth Runtime')).not.toBeInTheDocument()
  })

  it('shows one provider card for multiple saved configurations and keeps each one manageable', () => {
    providerStoreState.providers = [
      {
        id: 'openai-work',
        name: 'OpenAI Work',
        presetId: 'openai',
        apiKey: '***',
        baseUrl: 'https://api.openai.com',
        apiFormat: 'openai_responses',
        models: {
          main: 'gpt-5.4',
          haiku: 'gpt-5.4-mini',
          sonnet: 'gpt-5.4',
          opus: 'gpt-5.4',
        },
        notes: '',
      },
      {
        id: 'openai-backup',
        name: 'OpenAI Backup',
        presetId: 'openai',
        apiKey: '***',
        baseUrl: 'https://api.openai.com',
        apiFormat: 'openai_responses',
        models: {
          main: 'gpt-5.4-mini',
          haiku: 'gpt-5.4-mini',
          sonnet: 'gpt-5.4-mini',
          opus: 'gpt-5.4-mini',
        },
        notes: '',
      },
    ]
    providerStoreState.presets = [
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com',
        apiFormat: 'openai_responses',
        defaultModels: {
          main: 'gpt-5.4',
          haiku: 'gpt-5.4-mini',
          sonnet: 'gpt-5.4',
          opus: 'gpt-5.4',
        },
        needsApiKey: true,
        websiteUrl: 'https://platform.openai.com',
      },
    ]

    const { container } = render(<ProviderSettings />)
    const apiCatalog = container.querySelector('[data-provider-catalog="api-key"]') as HTMLElement

    expect(within(apiCatalog).getAllByText('OpenAI')).toHaveLength(1)
    expect(within(apiCatalog).getByText('2 configurations')).toBeInTheDocument()
    fireEvent.click(within(apiCatalog).getByRole('button', { name: 'Manage OpenAI' }))

    const dialog = screen.getByRole('dialog', { name: 'OpenAI' })
    expect(within(dialog).getByText('OpenAI Work')).toBeInTheDocument()
    expect(within(dialog).getByText('OpenAI Backup')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Edit OpenAI Work' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Edit OpenAI Backup' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add OpenAI' })).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Configure Custom' }))

    const dialog = screen.getByRole('dialog')
    const apiKeyInput = within(dialog).getByPlaceholderText('sk-...')

    expect(apiKeyInput).toHaveAttribute('type', 'password')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Show API Key' }))

    expect(apiKeyInput).toHaveAttribute('type', 'text')
    expect(within(dialog).getByRole('button', { name: 'Hide API Key' })).toBeInTheDocument()
  })

  it('never places a masked saved API key into the editable key field', () => {
    render(<ProviderSettings />)

    fireEvent.click(screen.getByRole('button', {
      name: 'Edit MiniMax-M2.7-highspeed(openai)',
    }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByPlaceholderText('sk-...')).toHaveValue('')
  })

  it('saves a readable node alias from the provider form', async () => {
    providerStoreState.updateProvider = vi.fn().mockResolvedValue({
      ...providerStoreState.providers[0],
      publicAlias: 'minimax-main',
    })

    render(<ProviderSettings />)

    fireEvent.click(screen.getByRole('button', {
      name: 'Edit MiniMax-M2.7-highspeed(openai)',
    }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Node alias' }), {
      target: { value: 'MiniMax-Main' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(providerStoreState.updateProvider).toHaveBeenCalledWith(
      'provider-1',
      expect.objectContaining({ publicAlias: 'minimax-main' }),
    ))
  })

  it('rejects a one-character node alias before submitting the provider form', () => {
    providerStoreState.updateProvider = vi.fn()
    render(<ProviderSettings />)

    fireEvent.click(screen.getByRole('button', {
      name: 'Edit MiniMax-M2.7-highspeed(openai)',
    }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Node alias' }), {
      target: { value: 'x' },
    })

    expect(within(dialog).getByText(
      'Use 2–64 lowercase letters, numbers, or hyphens.',
    )).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(providerStoreState.updateProvider).not.toHaveBeenCalled()
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
