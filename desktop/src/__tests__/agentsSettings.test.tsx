import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { AgentsSettings, SkillSettings } from '../pages/Settings'
import { useAgentStore } from '../stores/agentStore'
import { useSkillStore } from '../stores/skillStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'

vi.mock('../api/agents', () => ({
  agentsApi: {
    list: vi.fn().mockResolvedValue({ activeAgents: [], allAgents: [] }),
  },
}))

const noopFetch = vi.fn()

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

vi.mock('../components/chat/CodeViewer', () => ({
  CodeViewer: ({ code }: { code: string }) => <pre data-testid="code-viewer">{code}</pre>,
}))

const MOCK_AGENTS = [
  {
    agentType: 'code-reviewer',
    description: 'Reviews code for quality and security',
    model: 'claude-sonnet-4-6',
    modelDisplay: 'claude-sonnet-4-6',
    tools: ['Read', 'Grep', 'Glob'],
    systemPrompt: '# Code Reviewer\n\nYou are an expert code reviewer.',
    color: 'blue',
    source: 'userSettings' as const,
    baseDir: '~/.cyber/agents',
    isActive: true,
  },
  {
    agentType: 'doc-writer',
    description: 'Writes technical documentation',
    model: 'claude-haiku-4-5',
    modelDisplay: 'claude-haiku-4-5',
    tools: ['Read'],
    systemPrompt: 'You write clear and concise docs.',
    color: 'green',
    source: 'built-in' as const,
    baseDir: 'built-in',
    isActive: true,
  },
  {
    agentType: 'plain-agent',
    description: undefined,
    model: undefined,
    modelDisplay: 'inherit',
    tools: undefined,
    systemPrompt: undefined,
    color: undefined,
    source: 'projectSettings' as const,
    baseDir: '/workspace/project/.cyber/agents',
    isActive: false,
    overriddenBy: 'userSettings' as const,
  },
  {
    agentType: 'telegram:pairing',
    description: 'Plugin agent for Telegram pairing flows',
    model: 'inherit',
    modelDisplay: 'inherit',
    tools: ['Read'],
    systemPrompt: 'Pair Telegram access for the current workspace.',
    color: 'cyan',
    source: 'plugin' as const,
    baseDir: '/Users/test/.cyber/plugins/cache/telegram',
    isActive: true,
  },
]

const MOCK_SKILL_DETAIL = {
  meta: {
    name: 'skill-docs',
    displayName: 'Skill Docs',
    description: 'A rich skill readme',
    source: 'user' as const,
    userInvocable: true,
    contentLength: 200,
    hasDirectory: true,
  },
  tree: [
    { name: 'SKILL.md', path: 'SKILL.md', type: 'file' as const },
    { name: 'helper.ts', path: 'helper.ts', type: 'file' as const },
  ],
  files: [
    {
      path: 'SKILL.md',
      language: 'markdown',
      content: '# Heading\n\nParagraph with `inline code`.\n\n## Section\n\n- First item\n- Second item\n\n> Helpful quote',
      body: '# Heading\n\nParagraph with `inline code`.\n\n## Section\n\n- First item\n- Second item\n\n> Helpful quote',
      isEntry: true,
      frontmatter: {
        description: 'A rich skill readme',
        model: 'sonnet',
      },
    },
    {
      path: 'helper.ts',
      language: 'typescript',
      content: 'export const helper = true',
      isEntry: false,
    },
  ],
  skillRoot: '/tmp/skill-docs',
}

describe('Settings > Agents tab', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useTabStore.setState({
      activeTabId: 'session-1',
      tabs: [{ sessionId: 'session-1', title: 'Test', type: 'session', status: 'idle' }],
    })
    useUIStore.setState({ pendingSettingsTab: null })
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          title: 'Test Session',
          lastMessage: '',
          createdAt: '',
          modifiedAt: '',
          messageCount: 0,
          projectPath: '/workspace/project',
          workDir: '/workspace/project',
          workDirExists: true,
        },
      ],
      activeSessionId: 'session-1',
      isLoading: false,
      error: null,
      selectedProjects: [],
      availableProjects: [],
      fetchSessions: noopFetch,
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      renameSession: vi.fn(),
      updateSessionTitle: vi.fn(),
      setActiveSession: vi.fn(),
      setSelectedProjects: vi.fn(),
    })
    useAgentStore.setState({
      activeAgents: [],
      allAgents: [],
      isLoading: false,
      error: null,
      selectedAgent: null,
      selectedAgentReturnTab: 'agents',
      fetchAgents: noopFetch,
      selectAgent: (agent) => useAgentStore.setState({ selectedAgent: agent }),
    })
    useSkillStore.setState({
      skills: [],
      selectedSkill: null,
      isLoading: false,
      isDetailLoading: false,
      error: null,
      fetchSkills: noopFetch,
      fetchSkillDetail: noopFetch,
      clearSelection: () => useSkillStore.setState({ selectedSkill: null }),
    })
  })

  it('renders the Agents settings empty state', () => {
    render(<AgentsSettings />)
    expect(screen.getByText('No agents available yet.')).toBeInTheDocument()
  })

  it('shows loading spinner when fetching agents', () => {
    useAgentStore.setState({ isLoading: true, allAgents: [], activeAgents: [], fetchAgents: noopFetch })
    render(<AgentsSettings />)

    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('uses the active session workDir when settings drawer is opened', async () => {
    const fetchAgents = vi.fn()
    useAgentStore.setState({
      allAgents: [],
      activeAgents: [],
      isLoading: false,
      fetchAgents,
    })

    render(<AgentsSettings />)

    expect(fetchAgents).toHaveBeenCalledWith('/workspace/project')
  })

  it('shows error state with retry button when API fails', () => {
    useAgentStore.setState({ allAgents: [], activeAgents: [], isLoading: false, error: 'Network error', fetchAgents: noopFetch })
    render(<AgentsSettings />)

    expect(screen.getByText('Network error')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('renders a simplified flat agent list', () => {
    useAgentStore.setState({
      allAgents: MOCK_AGENTS,
      activeAgents: MOCK_AGENTS.filter((agent) => agent.isActive),
      isLoading: false,
      fetchAgents: noopFetch,
    })
    render(<AgentsSettings />)

    expect(screen.queryByText('Browse installed agents')).not.toBeInTheDocument()
    expect(screen.queryByText('Agent Browser')).not.toBeInTheDocument()
    expect(screen.queryByText('Total agents')).not.toBeInTheDocument()
    expect(screen.getByText('code-reviewer')).toBeInTheDocument()
    expect(screen.getByText('doc-writer')).toBeInTheDocument()
    expect(screen.getByText('plain-agent')).toBeInTheDocument()
    expect(screen.getByText('Writes technical documentation')).toBeInTheDocument()
    expect(screen.getByText('telegram:pairing')).toBeInTheDocument()
    expect(screen.getAllByText('User').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Built-in').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Project').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Plugin').length).toBeGreaterThan(0)
    expect(screen.getByText('Overridden by User')).toBeInTheDocument()
  })

  it('keeps the agents tab list-only when an agent row is clicked', () => {
    useAgentStore.setState({
      allAgents: MOCK_AGENTS,
      activeAgents: MOCK_AGENTS.filter((agent) => agent.isActive),
      isLoading: false,
      fetchAgents: noopFetch,
    })
    render(<AgentsSettings />)

    fireEvent.click(screen.getByText('code-reviewer'))

    expect(screen.queryByText('Back to list')).not.toBeInTheDocument()
    expect(screen.queryByText('Agent Profile')).not.toBeInTheDocument()
    expect(screen.queryByText('System Prompt')).not.toBeInTheDocument()
    expect(screen.getByText('doc-writer')).toBeInTheDocument()
  })

  it('shows agent list data without detail-only prompt states', () => {
    useAgentStore.setState({
      allAgents: MOCK_AGENTS,
      activeAgents: MOCK_AGENTS.filter((agent) => agent.isActive),
      isLoading: false,
      fetchAgents: noopFetch,
    })
    render(<AgentsSettings />)

    expect(screen.getByText('plain-agent')).toBeInTheDocument()
    expect(screen.getByText('No description')).toBeInTheDocument()
    expect(screen.getByText('Overridden by User')).toBeInTheDocument()
    expect(screen.queryByText('No system prompt defined.')).not.toBeInTheDocument()
  })

  it('highlights the selected agent when opened from another settings section', () => {
    useAgentStore.setState({
      allAgents: MOCK_AGENTS,
      activeAgents: MOCK_AGENTS.filter((agent) => agent.isActive),
      isLoading: false,
      selectedAgent: MOCK_AGENTS[3],
      selectedAgentReturnTab: 'plugins',
      fetchAgents: noopFetch,
    })
    render(<AgentsSettings />)

    expect(screen.queryByText('Back to list')).not.toBeInTheDocument()
    expect(screen.getByText('telegram:pairing').closest('article')).toHaveAttribute('aria-current', 'true')
    expect(screen.getAllByText(/telegram:pairing|code-reviewer|doc-writer|plain-agent/)[0]).toHaveTextContent('telegram:pairing')
  })
})

describe('Settings > Skills tab', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useSkillStore.setState({
      skills: [],
      selectedSkill: null,
      isLoading: false,
      isDetailLoading: false,
      error: null,
      fetchSkills: noopFetch,
      fetchSkillDetail: noopFetch,
      clearSelection: () => useSkillStore.setState({ selectedSkill: null }),
    })
  })

  it('renders markdown skills with document styling in detail view', () => {
    useSkillStore.setState({
      selectedSkill: MOCK_SKILL_DETAIL,
      clearSelection: () => useSkillStore.setState({ selectedSkill: null }),
    })

    render(<SkillSettings />)

    expect(screen.getByText('Skill metadata')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument()

    const rendererRoot = screen.getByRole('heading', { name: 'Heading' }).closest('div[class*="prose"]')
    expect(rendererRoot?.className).toContain('max-w-[72ch]')
    expect(rendererRoot?.className).toContain('prose-h2:border-b')
    expect(rendererRoot?.className).toContain('prose-p:text-[15px]')
    expect(screen.getByText('Helpful quote')).toBeInTheDocument()
  })

  it('keeps code files rendered in CodeViewer instead of markdown prose', () => {
    useSkillStore.setState({
      selectedSkill: MOCK_SKILL_DETAIL,
      clearSelection: () => useSkillStore.setState({ selectedSkill: null }),
    })

    render(<SkillSettings />)

    fireEvent.click(screen.getAllByText('helper.ts')[0]!)

    expect(screen.getByTestId('code-viewer')).toHaveTextContent('export const helper = true')
    expect(screen.queryByRole('heading', { name: 'Heading' })).not.toBeInTheDocument()
  })
})
