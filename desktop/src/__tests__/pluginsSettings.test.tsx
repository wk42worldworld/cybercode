import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { PluginSettings } from '../pages/Settings'
import { PluginMarketplace } from '../components/plugins/PluginMarketplace'
import { usePluginStore } from '../stores/pluginStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useSessionStore } from '../stores/sessionStore'
import { useUIStore } from '../stores/uiStore'
import type { PluginMarketplaceCatalog, PluginMarketplaceItem } from '../types/plugin'

const MOCK_FETCH_SKILLS = vi.fn()
const MOCK_FETCH_SKILL_DETAIL = vi.fn()
const MOCK_FETCH_AGENTS = vi.fn()
const MOCK_FETCH_SERVERS = vi.fn()
const {
  MOCK_PLUGIN_MARKETPLACE,
  MOCK_INSTALL_MARKETPLACE,
} = vi.hoisted(() => ({
  MOCK_PLUGIN_MARKETPLACE: vi.fn(),
  MOCK_INSTALL_MARKETPLACE: vi.fn(),
}))

vi.mock('../api/plugins', () => ({
  pluginsApi: {
    list: vi.fn(),
    detail: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    update: vi.fn(),
    uninstall: vi.fn(),
    reload: vi.fn(),
    marketplace: MOCK_PLUGIN_MARKETPLACE,
    installMarketplaceItem: MOCK_INSTALL_MARKETPLACE,
  },
}))

vi.mock('../api/agents', () => ({
  agentsApi: {
    list: vi.fn().mockResolvedValue({ activeAgents: [], allAgents: [] }),
  },
}))

vi.mock('../stores/providerStore', () => ({
  useProviderStore: () => ({
    providers: [],
    activeId: null,
    presets: [],
    isLoading: false,
    isPresetsLoading: false,
    fetchProviders: vi.fn(),
    fetchPresets: vi.fn(),
    deleteProvider: vi.fn(),
    activateProvider: vi.fn(),
    activateOfficial: vi.fn(),
    testProvider: vi.fn(),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    testConfig: vi.fn(),
  }),
}))

vi.mock('../pages/AdapterSettings', () => ({
  AdapterSettings: () => <div>Adapter Settings Mock</div>,
}))

vi.mock('../stores/agentStore', () => ({
  useAgentStore: Object.assign((selector?: (state: any) => unknown) => {
    const state = {
      activeAgents: [],
      allAgents: [],
      isLoading: false,
      error: null,
      selectedAgent: null,
      fetchAgents: MOCK_FETCH_AGENTS,
      selectAgent: vi.fn(),
    }
    return selector ? selector(state) : state
  }, {
    getState: () => ({
      activeAgents: [],
      allAgents: [],
      isLoading: false,
      error: null,
      selectedAgent: null,
      fetchAgents: MOCK_FETCH_AGENTS,
      selectAgent: vi.fn(),
    }),
  }),
}))

vi.mock('../stores/skillStore', () => ({
  useSkillStore: Object.assign((selector?: (state: any) => unknown) => {
    const state = {
      skills: [],
      selectedSkill: null,
      isLoading: false,
      isDetailLoading: false,
      error: null,
      fetchSkills: MOCK_FETCH_SKILLS,
      fetchSkillDetail: MOCK_FETCH_SKILL_DETAIL,
      clearSelection: vi.fn(),
    }
    return selector ? selector(state) : state
  }, {
    getState: () => ({
      skills: [],
      selectedSkill: null,
      isLoading: false,
      isDetailLoading: false,
      error: null,
      fetchSkills: MOCK_FETCH_SKILLS,
      fetchSkillDetail: MOCK_FETCH_SKILL_DETAIL,
      clearSelection: vi.fn(),
    }),
  }),
}))

vi.mock('../stores/mcpStore', () => ({
  useMcpStore: Object.assign((selector?: (state: any) => unknown) => {
    const state = {
      servers: [],
      selectedServer: null,
      isLoading: false,
      error: null,
      fetchServers: MOCK_FETCH_SERVERS,
      createServer: vi.fn(),
      updateServer: vi.fn(),
      deleteServer: vi.fn(),
      toggleServer: vi.fn(),
      reconnectServer: vi.fn(),
      selectServer: vi.fn(),
    }
    return selector ? selector(state) : state
  }, {
    getState: () => ({
      servers: [],
      selectedServer: null,
      isLoading: false,
      error: null,
      fetchServers: MOCK_FETCH_SERVERS,
      createServer: vi.fn(),
      updateServer: vi.fn(),
      deleteServer: vi.fn(),
      toggleServer: vi.fn(),
      reconnectServer: vi.fn(),
      selectServer: vi.fn(),
    }),
  }),
}))

const noop = vi.fn()

function marketplaceItem(
  displayName: string,
  overrides: Partial<PluginMarketplaceItem> = {},
): PluginMarketplaceItem {
  const name = displayName.toLowerCase().replace(/\s+/g, '-')
  return {
    id: `${name}@test-market`,
    name,
    displayName,
    description: `${displayName} plugin description`,
    version: '1.0.0',
    author: 'Test Author',
    category: 'general',
    tags: [],
    sourceId: 'test',
    sourceName: 'Test Market',
    sourceUrl: 'https://example.test/plugins',
    features: ['plugin'],
    compatible: true,
    revision: 'revision-1',
    installations: [],
    ...overrides,
  }
}

function marketplaceCatalog(...items: PluginMarketplaceItem[]): PluginMarketplaceCatalog {
  return {
    sources: [
      {
        id: 'test',
        name: 'Test Market',
        homepage: 'https://example.test/plugins',
        status: 'ready',
        itemCount: items.length,
      },
    ],
    items,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('Settings > Plugins tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'en' })
    useUIStore.setState({ pendingSettingsTab: null, toasts: [] })
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          title: 'Active session',
          createdAt: '2026-04-20T00:00:00.000Z',
          modifiedAt: '2026-04-20T00:00:00.000Z',
          messageCount: 1,
          projectPath: '/workspace/project',
          workDir: '/workspace/project',
          workDirExists: true,
          isTemporary: false,
        },
      ],
      activeSessionId: 'session-1',
      isLoading: false,
      error: null,
    })
    usePluginStore.setState({
      plugins: [],
      marketplaces: [],
      summary: { total: 0, enabled: 0, errorCount: 0, marketplaceCount: 0 },
      selectedPlugin: null,
      lastReloadSummary: null,
      isLoading: false,
      isDetailLoading: false,
      isApplying: false,
      error: null,
      fetchPlugins: noop,
      fetchPluginDetail: noop,
      reloadPlugins: vi.fn().mockResolvedValue({
        enabled: 1,
        disabled: 0,
        skills: 2,
        agents: 1,
        hooks: 0,
        mcpServers: 1,
        lspServers: 0,
        errors: 0,
      }),
      enablePlugin: vi.fn().mockResolvedValue('enabled'),
      disablePlugin: vi.fn().mockResolvedValue('disabled'),
      updatePlugin: vi.fn().mockResolvedValue('updated'),
      uninstallPlugin: vi.fn().mockResolvedValue('uninstalled'),
      clearSelection: vi.fn(),
    })
    MOCK_PLUGIN_MARKETPLACE.mockResolvedValue({
      catalog: { items: [], sources: [] },
    })
    MOCK_INSTALL_MARKETPLACE.mockResolvedValue({
      ok: true,
      item: {},
      updated: false,
      message: 'installed',
    })
  })

  it('loads the plugin market on demand and installs a compatible plugin', async () => {
    MOCK_PLUGIN_MARKETPLACE.mockResolvedValue({
      catalog: {
        sources: [
          {
            id: 'openai',
            name: 'Codex Official',
            homepage: 'https://github.com/openai/plugins',
            status: 'ready',
            itemCount: 2,
          },
        ],
        items: [
          {
            id: 'github@openai-plugins',
            name: 'github',
            displayName: 'GitHub',
            description: 'Triage pull requests and issues.',
            version: '1.0.0',
            author: 'OpenAI',
            category: 'Developer Tools',
            tags: ['github'],
            sourceId: 'openai',
            sourceName: 'Codex Official',
            sourceUrl: 'https://github.com/openai/plugins',
            features: ['skills', 'mcpServers'],
            compatible: true,
            revision: '1.0.0',
            installations: [],
          },
          {
            id: 'hosted@openai-plugins',
            name: 'hosted',
            displayName: 'Hosted Connector',
            description: 'Codex hosted connector.',
            category: 'Productivity',
            tags: [],
            sourceId: 'openai',
            sourceName: 'Codex Official',
            sourceUrl: 'https://github.com/openai/plugins',
            features: [],
            compatible: false,
            revision: '1.0.0',
            installations: [],
          },
        ],
      },
    })

    render(<PluginSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Plugin Market' }))

    expect(await screen.findByText('GitHub')).toBeInTheDocument()
    expect(screen.getByText('Hosted Connector')).toBeInTheDocument()
    expect(screen.getByText('Connector only')).toBeInTheDocument()
    expect(MOCK_PLUGIN_MARKETPLACE).toHaveBeenCalledWith(false, expect.any(AbortSignal))

    fireEvent.click(screen.getByRole('button', { name: 'Install GitHub' }))
    await waitFor(() => {
      expect(MOCK_INSTALL_MARKETPLACE).toHaveBeenCalledWith('github@openai-plugins')
    })
    expect(usePluginStore.getState().reloadPlugins).toHaveBeenCalledWith('/workspace/project')
  }, 15_000)

  it('keeps the newest catalog when an older request resolves last', async () => {
    const cwd = '/workspace/plugin-market-race'
    const cachedCatalog = marketplaceCatalog(marketplaceItem('Cached Plugin'))
    MOCK_PLUGIN_MARKETPLACE.mockResolvedValue({ catalog: cachedCatalog })
    const seeded = render(<PluginMarketplace cwd={cwd} />)
    expect(await screen.findByText('Cached Plugin')).toBeInTheDocument()
    seeded.unmount()

    const staleRequest = deferred<{ catalog: PluginMarketplaceCatalog }>()
    const freshCatalog = marketplaceCatalog(marketplaceItem('Fresh Plugin'))
    MOCK_PLUGIN_MARKETPLACE.mockReset()
    MOCK_PLUGIN_MARKETPLACE
      .mockImplementationOnce(() => staleRequest.promise)
      .mockResolvedValueOnce({ catalog: freshCatalog })

    render(<PluginMarketplace cwd={cwd} />)
    await waitFor(() => expect(MOCK_PLUGIN_MARKETPLACE).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh plugin directories' }))

    expect(await screen.findByText('Fresh Plugin')).toBeInTheDocument()
    await act(async () => {
      staleRequest.resolve({
        catalog: marketplaceCatalog(marketplaceItem('Stale Plugin')),
      })
      await staleRequest.promise
    })

    expect(screen.queryByText('Stale Plugin')).not.toBeInTheDocument()
    expect(screen.getByText('Fresh Plugin')).toBeInTheDocument()
  }, 15_000)

  it('cancels the active catalog request when the marketplace unmounts', async () => {
    let observedSignal: AbortSignal | undefined
    MOCK_PLUGIN_MARKETPLACE.mockImplementation((_: boolean, signal?: AbortSignal) => {
      observedSignal = signal
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    })

    const view = render(<PluginMarketplace cwd="/workspace/plugin-market-unmount" />)
    await waitFor(() => expect(observedSignal).toBeDefined())
    view.unmount()

    expect(observedSignal?.aborted).toBe(true)
  })

  it('shows loading on first retry and keeps cached results visible after refresh failure', async () => {
    const retryRequest = deferred<{ catalog: PluginMarketplaceCatalog }>()
    MOCK_PLUGIN_MARKETPLACE.mockReset()
    MOCK_PLUGIN_MARKETPLACE
      .mockRejectedValueOnce(new Error('initial directory failure'))
      .mockImplementationOnce(() => retryRequest.promise)

    render(<PluginMarketplace cwd="/workspace/plugin-market-retry" />)
    expect(await screen.findByText('Could not load the plugin market')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Loading official plugin directories…')).toBeInTheDocument()

    await act(async () => {
      retryRequest.resolve({
        catalog: marketplaceCatalog(marketplaceItem('Retained Plugin')),
      })
      await retryRequest.promise
    })
    expect(await screen.findByText('Retained Plugin')).toBeInTheDocument()

    MOCK_PLUGIN_MARKETPLACE.mockRejectedValueOnce(new Error('refresh unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh plugin directories' }))

    const warning = await screen.findByRole('alert')
    expect(warning).toHaveTextContent('refresh unavailable')
    expect(screen.getByText('Retained Plugin')).toBeInTheDocument()
  }, 15_000)

  it('serializes installs and separates installation success from runtime sync failure', async () => {
    const alpha = marketplaceItem('Alpha Plugin')
    const beta = marketplaceItem('Beta Plugin')
    const installedAlpha = {
      ...alpha,
      installations: [{ scope: 'user' as const, version: '1.0.0', updateAvailable: false }],
    }
    const installRequest = deferred<{
      ok: true
      item: PluginMarketplaceItem
      updated: boolean
      message: string
    }>()
    MOCK_PLUGIN_MARKETPLACE.mockReset()
    MOCK_PLUGIN_MARKETPLACE
      .mockResolvedValueOnce({ catalog: marketplaceCatalog(alpha, beta) })
      .mockRejectedValueOnce(new Error('catalog sync failed'))
    MOCK_INSTALL_MARKETPLACE.mockReturnValueOnce(installRequest.promise)
    usePluginStore.setState({
      reloadPlugins: vi.fn().mockRejectedValue(new Error('runtime reload failed')),
    })

    render(<PluginMarketplace cwd="/workspace/plugin-market-install" />)
    const alphaButton = await screen.findByRole('button', { name: 'Install Alpha Plugin' })
    fireEvent.click(alphaButton)

    const betaButton = screen.getByRole('button', { name: 'Install Beta Plugin' })
    expect(betaButton).toBeDisabled()
    fireEvent.click(betaButton)
    expect(MOCK_INSTALL_MARKETPLACE).toHaveBeenCalledTimes(1)

    await act(async () => {
      installRequest.resolve({
        ok: true,
        item: installedAlpha,
        updated: false,
        message: 'installed',
      })
      await installRequest.promise
    })

    await waitFor(() => {
      expect(useUIStore.getState().toasts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'success', message: 'Alpha Plugin: Installed' }),
        expect.objectContaining({ type: 'error', message: 'Apply changes: runtime reload failed' }),
      ]))
    })
    expect(await screen.findByText('Installed')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('catalog sync failed')
    expect(screen.getByRole('button', { name: 'Install Beta Plugin' })).toBeEnabled()
  }, 15_000)

  it('resets a failed logo when its URL changes and searches localized labels', async () => {
    useSettingsStore.setState({ locale: 'zh' })
    const localizedDescriptions = { zh: '用于验证图标更新的插件。' }
    const first = marketplaceItem('Logo Plugin', {
      iconUrl: 'https://example.test/old.png',
      localizedDescriptions,
      category: 'Developer Tools',
      sourceName: 'Codex Official',
    })
    const second = marketplaceItem('Logo Plugin', {
      iconUrl: 'https://example.test/new.png',
      localizedDescriptions,
      category: 'Developer Tools',
      sourceName: 'Codex Official',
    })
    MOCK_PLUGIN_MARKETPLACE.mockReset()
    MOCK_PLUGIN_MARKETPLACE
      .mockResolvedValueOnce({ catalog: marketplaceCatalog(first) })
      .mockResolvedValueOnce({ catalog: marketplaceCatalog(second) })

    const view = render(<PluginMarketplace cwd="/workspace/plugin-market-logo" />)
    expect(await screen.findByText('用于验证图标更新的插件。')).toBeInTheDocument()
    expect(screen.getByText('开发工具')).toBeInTheDocument()
    expect(screen.getByText('Codex 官方')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '推荐' })).toBeInTheDocument()
    expect(screen.queryByText('Developer Tools')).not.toBeInTheDocument()
    expect(screen.queryByText('Codex Official')).not.toBeInTheDocument()
    expect(screen.queryByText('Logo Plugin plugin description')).not.toBeInTheDocument()
    const oldLogo = await waitFor(() => {
      const image = view.container.querySelector('img[src="https://example.test/old.png"]')
      expect(image).not.toBeNull()
      return image as HTMLImageElement
    })
    fireEvent.error(oldLogo)
    expect(screen.getByText('LO')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '刷新插件目录' }))
    await waitFor(() => {
      expect(view.container.querySelector('img[src="https://example.test/new.png"]')).not.toBeNull()
    })
    expect(screen.queryByText('LO')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '完整插件' } })
    expect(screen.getByText('Logo Plugin')).toBeInTheDocument()
  }, 15_000)

  it('sorts marketplace cards by newest and popular signals', async () => {
    useSettingsStore.setState({ locale: 'zh' })
    MOCK_PLUGIN_MARKETPLACE.mockResolvedValue({
      catalog: marketplaceCatalog(
        marketplaceItem('Stable Plugin', {
          version: '1.0.0',
          updatedAt: '2026-01-01T00:00:00.000Z',
          popularity: 100,
        }),
        marketplaceItem('Newest Plugin', {
          version: '3.0.0',
          updatedAt: '2026-07-01T00:00:00.000Z',
          popularity: 10,
        }),
        marketplaceItem('Popular Plugin', {
          version: '2.0.0',
          updatedAt: '2026-04-01T00:00:00.000Z',
          popularity: 500,
        }),
      ),
    })

    const view = render(<PluginMarketplace cwd="/workspace/plugin-market-sort" />)
    expect(await screen.findByText('Stable Plugin')).toBeInTheDocument()

    const knownNames = ['Stable Plugin', 'Newest Plugin', 'Popular Plugin']
    const cardNames = () => Array.from(view.container.querySelectorAll('ul > li'))
      .map((row) => knownNames.find((name) => row.textContent?.includes(name)))
      .filter(Boolean)

    fireEvent.click(screen.getByRole('button', { name: '推荐' }))
    fireEvent.click(await screen.findByRole('option', { name: '最新' }))
    expect(cardNames()).toEqual(['Newest Plugin', 'Popular Plugin', 'Stable Plugin'])

    fireEvent.click(screen.getByRole('button', { name: '最新' }))
    fireEvent.click(await screen.findByRole('option', { name: '最热' }))
    expect(cardNames()).toEqual(['Popular Plugin', 'Stable Plugin', 'Newest Plugin'])
  })

  it('renders plugin browser summary and grouped cards', () => {
    usePluginStore.setState({
      plugins: [
        {
          id: 'github@claude-plugins-official',
          name: 'github',
          marketplace: 'claude-plugins-official',
          scope: 'user',
          enabled: true,
          hasErrors: false,
          isBuiltin: false,
          version: '1.2.3',
          description: 'GitHub integration',
          authorName: 'Anthropic',
          componentCounts: {
            commands: 1,
            agents: 1,
            skills: 2,
            hooks: 0,
            mcpServers: 1,
            lspServers: 0,
          },
          errors: [],
        },
        {
          id: 'pyright-lsp@claude-plugins-official',
          name: 'pyright-lsp',
          marketplace: 'claude-plugins-official',
          scope: 'project',
          enabled: false,
          hasErrors: true,
          isBuiltin: false,
          description: 'Python language tooling',
          componentCounts: {
            commands: 0,
            agents: 0,
            skills: 0,
            hooks: 0,
            mcpServers: 0,
            lspServers: 1,
          },
          errors: ['Executable not found in $PATH'],
        },
      ],
      marketplaces: [
        {
          name: 'claude-plugins-official',
          source: 'github:anthropics/claude-plugins-official',
          autoUpdate: true,
          installedCount: 2,
        },
      ],
      summary: { total: 2, enabled: 1, errorCount: 1, marketplaceCount: 1 },
    })

    render(<PluginSettings />)

    expect(screen.getByText('Browse installed plugins')).toBeInTheDocument()
    expect(screen.getByText('Plugin Manager')).toBeInTheDocument()
    expect(screen.getAllByText('Needs attention').length).toBeGreaterThan(0)
    expect(screen.getByText('github')).toBeInTheDocument()
    expect(screen.getByText('Python language tooling')).toBeInTheDocument()
    expect(screen.getByText('Known marketplaces')).toBeInTheDocument()
  })

  it('renders plugin detail with bundled capability sections', () => {
    usePluginStore.setState({
      selectedPlugin: {
        id: 'github@claude-plugins-official',
        name: 'github',
        marketplace: 'claude-plugins-official',
        scope: 'user',
        enabled: true,
        hasErrors: false,
        isBuiltin: false,
        version: '1.2.3',
        description: 'GitHub integration',
        authorName: 'Anthropic',
        installPath: '/Users/test/.cyber/plugins/cache/github',
        componentCounts: {
          commands: 1,
          agents: 1,
          skills: 2,
          hooks: 1,
          mcpServers: 1,
          lspServers: 0,
        },
        capabilities: {
          commands: ['review-pr'],
          agents: ['pr-reviewer'],
          skills: ['commit', 'create-pr'],
          hooks: ['SessionStart'],
          mcpServers: ['github-api'],
          lspServers: [],
        },
        commandEntries: [
          {
            name: 'review-pr',
            description: 'Review the current pull request.',
          },
        ],
        agentEntries: [
          {
            name: 'pr-reviewer',
            description: 'Review pull request quality and risk.',
          },
        ],
        hookEntries: [
          {
            event: 'SessionStart',
            matcher: 'Write',
            actions: ['echo preparing plugin runtime'],
          },
        ],
        skillEntries: [
          {
            name: 'create-pr',
            description: 'Create a pull request from the current branch.',
          },
          {
            name: 'commit',
            description: 'Commit the current staged changes.',
            version: '1.0.0',
          },
        ],
        mcpServerEntries: [
          {
            name: 'plugin:github:github-api',
            displayName: 'github-api',
            transport: 'http',
            summary: 'https://api.github.com/mcp',
          },
        ],
        errors: [],
      },
    })

    render(<PluginSettings />)

    expect(screen.getByText('Plugin Detail')).toBeInTheDocument()
    expect(screen.getByText('GitHub integration')).toBeInTheDocument()
    expect(screen.getByText('Bundled capabilities')).toBeInTheDocument()
    expect(screen.getByText('/review-pr')).toBeInTheDocument()
    expect(screen.getByText('Review pull request quality and risk.')).toBeInTheDocument()
    expect(screen.getByText('echo preparing plugin runtime')).toBeInTheDocument()
    expect(screen.getByText('Create a pull request from the current branch.')).toBeInTheDocument()
    expect(screen.getByText('https://api.github.com/mcp')).toBeInTheDocument()
    expect(screen.getByText('Apply changes')).toBeInTheDocument()
    expect(screen.getByText('Uninstall')).toBeInTheDocument()
  })

  it('keeps plugin detail hook order stable while the selected plugin reloads', () => {
    usePluginStore.setState({
      selectedPlugin: {
        id: 'github@claude-plugins-official',
        name: 'github',
        marketplace: 'claude-plugins-official',
        scope: 'user',
        enabled: false,
        hasErrors: false,
        isBuiltin: false,
        description: 'GitHub integration',
        componentCounts: {
          commands: 1,
          agents: 0,
          skills: 0,
          hooks: 0,
          mcpServers: 0,
          lspServers: 0,
        },
        capabilities: {
          commands: ['review-pr'],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: [],
          lspServers: [],
        },
        commandEntries: [
          {
            name: 'review-pr',
            description: 'Review the current pull request.',
          },
        ],
        agentEntries: [],
        hookEntries: [],
        skillEntries: [],
        mcpServerEntries: [],
        errors: [],
      },
    })

    const { container } = render(<PluginSettings />)

    expect(screen.getByText('GitHub integration')).toBeInTheDocument()

    act(() => {
      usePluginStore.setState({ isDetailLoading: true })
    })

    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('navigates plugin skills into the shared Skills page flow', () => {
    usePluginStore.setState({
      selectedPlugin: {
        id: 'telegram@claude-plugins-official',
        name: 'telegram',
        marketplace: 'claude-plugins-official',
        scope: 'user',
        enabled: true,
        hasErrors: false,
        isBuiltin: false,
        description: 'Telegram integration',
        componentCounts: {
          commands: 0,
          agents: 0,
          skills: 1,
          hooks: 0,
          mcpServers: 0,
          lspServers: 0,
        },
        capabilities: {
          commands: [],
          agents: [],
          skills: ['telegram:access'],
          hooks: [],
          mcpServers: [],
          lspServers: [],
        },
        commandEntries: [],
        agentEntries: [],
        hookEntries: [],
        skillEntries: [
          {
            name: 'telegram:access',
            displayName: 'access',
            description: 'Manage Telegram access.',
            pluginName: 'telegram',
          },
        ],
        mcpServerEntries: [],
        errors: [],
      },
    })

    render(<PluginSettings />)

    fireEvent.click(screen.getByText('access'))

    expect(MOCK_FETCH_SKILL_DETAIL).toHaveBeenCalledWith('plugin', 'telegram:access', '/workspace/project', 'plugins')
  })

  it('disables shared navigation cards for disabled plugins', () => {
    usePluginStore.setState({
      selectedPlugin: {
        id: 'codex@openai-codex',
        name: 'codex',
        marketplace: 'openai-codex',
        scope: 'user',
        enabled: false,
        hasErrors: false,
        isBuiltin: false,
        description: 'Use Codex from Claude Code',
        componentCounts: {
          commands: 0,
          agents: 1,
          skills: 1,
          hooks: 0,
          mcpServers: 0,
          lspServers: 0,
        },
        capabilities: {
          commands: [],
          agents: ['codex:codex-rescue'],
          skills: ['codex:gpt-5-4-prompting'],
          hooks: [],
          mcpServers: [],
          lspServers: [],
        },
        commandEntries: [],
        agentEntries: [
          {
            name: 'codex:codex-rescue',
            displayName: 'codex-rescue',
            description: 'Delegate to Codex.',
          },
        ],
        hookEntries: [],
        skillEntries: [
          {
            name: 'codex:gpt-5-4-prompting',
            displayName: 'gpt-5-4-prompting',
            description: 'Prompting guide.',
          },
        ],
        mcpServerEntries: [],
        errors: [],
      },
    })

    render(<PluginSettings />)

    expect(screen.getAllByText('Enable this plugin and apply changes before opening its skills, agents, or MCP entries in the shared management pages.').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /codex-rescue/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /gpt-5-4-prompting/i })).toBeDisabled()
  })
})
