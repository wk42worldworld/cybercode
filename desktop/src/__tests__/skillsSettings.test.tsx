import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { SkillSettings } from '../pages/Settings'
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

vi.mock('../components/chat/CodeViewer', () => ({
  CodeViewer: ({ code }: { code: string }) => <pre data-testid="code-viewer">{code}</pre>,
}))

const MOCK_FETCH_SKILLS = vi.fn()
const MOCK_FETCH_SKILL_DETAIL = vi.fn()
const MOCK_SET_SKILL_ENABLED = vi.fn()
const MOCK_CLEAR_SELECTION = vi.fn()

describe('Settings > Skills tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'en' })
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
        },
      ],
      activeSessionId: 'session-1',
      isLoading: false,
      error: null,
      selectedProjects: [],
      availableProjects: ['/workspace/project'],
    })
    useTabStore.setState({ tabs: [], activeTabId: null })
    useUIStore.setState({ pendingSettingsTab: null })
    useSkillStore.setState({
      skills: [],
      selectedSkill: null,
      selectedSkillReturnTab: 'skills',
      isLoading: false,
      isDetailLoading: false,
      error: null,
      fetchSkills: MOCK_FETCH_SKILLS,
      fetchSkillDetail: MOCK_FETCH_SKILL_DETAIL,
      setSkillEnabled: MOCK_SET_SKILL_ENABLED,
      clearSelection: MOCK_CLEAR_SELECTION,
    })
  })

  it('renders a compact grouped skill list', () => {
    useSkillStore.setState({
      skills: [
        {
          name: 'alpha',
          displayName: 'Alpha Skill',
          description: 'First skill description',
          source: 'user',
          userInvocable: true,
          version: '1.0.0',
          contentLength: 400,
          hasDirectory: true,
          enabled: true,
        },
        {
          name: 'beta',
          description: 'Second skill description',
          source: 'project',
          userInvocable: false,
          contentLength: 200,
          hasDirectory: true,
          enabled: false,
        },
        {
          name: 'telegram:access',
          displayName: 'Telegram Access',
          description: 'Plugin-provided access workflow',
          source: 'plugin',
          pluginName: 'telegram',
          userInvocable: true,
          contentLength: 280,
          hasDirectory: true,
          enabled: true,
        },
      ],
    })

    render(<SkillSettings />)

    expect(screen.getByText('Skill configuration')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open skills folder' })).toHaveTextContent('~/.claude/skills')
    expect(screen.getByText('Alpha Skill')).toBeInTheDocument()
    expect(screen.getByText('Second skill description')).toBeInTheDocument()
    expect(screen.getAllByText('Plugin').length).toBeGreaterThan(0)
    expect(screen.getByText('Telegram Access')).toBeInTheDocument()
  })

  it('uses the active session workDir when settings drawer is opened', () => {
    const fetchSkills = vi.fn()
    useSkillStore.setState({
      skills: [],
      selectedSkill: null,
      isLoading: false,
      isDetailLoading: false,
      error: null,
      fetchSkills,
      fetchSkillDetail: MOCK_FETCH_SKILL_DETAIL,
      setSkillEnabled: MOCK_SET_SKILL_ENABLED,
      clearSelection: MOCK_CLEAR_SELECTION,
    })

    render(<SkillSettings />)

    expect(fetchSkills).toHaveBeenCalledWith('/workspace/project')
  })

  it('opens skill detail with metadata cards and parsed markdown body', () => {
    useSkillStore.setState({
      selectedSkill: {
        meta: {
          name: 'alpha',
          displayName: 'Alpha Skill',
          description: 'First skill description',
          source: 'user',
          userInvocable: true,
          version: '1.0.0',
          contentLength: 400,
          hasDirectory: true,
          enabled: true,
        },
        tree: [
          { name: 'SKILL.md', path: 'SKILL.md', type: 'file' },
          { name: 'run.ts', path: 'run.ts', type: 'file' },
        ],
        files: [
          {
            path: 'SKILL.md',
            content: '# Hello\n\nBody content',
            body: '# Hello\n\nBody content',
            language: 'markdown',
            isEntry: true,
            frontmatter: {
              description: 'Frontmatter description',
              'allowed-tools': ['Read', 'Edit'],
              model: 'sonnet',
            },
          },
          {
            path: 'run.ts',
            content: 'console.log("hello")',
            language: 'typescript',
            isEntry: false,
          },
        ],
        skillRoot: '/tmp/alpha',
      },
      selectedSkillReturnTab: 'skills',
    })

    render(<SkillSettings />)

    expect(screen.getByText('Skill metadata')).toBeInTheDocument()
    expect(screen.getByText('/slash')).toBeInTheDocument()
    expect(screen.getByText('Frontmatter description')).toBeInTheDocument()
    expect(screen.getByText('Read, Edit')).toBeInTheDocument()
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.queryByText(/^---$/)).not.toBeInTheDocument()
  })

  it('toggles skill enablement from the compact list', async () => {
    useSkillStore.setState({
      skills: [
        {
          name: 'alpha',
          displayName: 'Alpha Skill',
          description: 'First skill description',
          source: 'user',
          userInvocable: true,
          contentLength: 400,
          hasDirectory: true,
          enabled: true,
        },
      ],
    })

    render(<SkillSettings />)

    fireEvent.click(screen.getByRole('switch', { name: 'Disable Alpha Skill' }))

    await waitFor(() => {
      expect(MOCK_SET_SKILL_ENABLED).toHaveBeenCalledWith(
        'user',
        'alpha',
        false,
        '/workspace/project',
      )
    })
  })

  it('returns to plugins tab when skill detail was opened from plugins', () => {
    useSkillStore.setState({
      selectedSkill: {
        meta: {
          name: 'telegram:access',
          displayName: 'Access',
          description: 'Plugin skill',
          source: 'plugin',
          userInvocable: true,
          contentLength: 200,
          hasDirectory: true,
          enabled: true,
        },
        tree: [{ name: 'SKILL.md', path: 'SKILL.md', type: 'file' }],
        files: [
          {
            path: 'SKILL.md',
            content: '# Access',
            body: '# Access',
            language: 'markdown',
            isEntry: true,
          },
        ],
        skillRoot: '/tmp/telegram-access',
      },
      selectedSkillReturnTab: 'plugins',
    })

    render(<SkillSettings />)

    fireEvent.click(screen.getByText('Back to list'))

    expect(MOCK_CLEAR_SELECTION).toHaveBeenCalled()
    expect(useUIStore.getState().pendingSettingsTab).toBe('plugins')
  })
})
