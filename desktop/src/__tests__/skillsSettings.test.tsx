import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { SkillSettings } from '../pages/Settings'
import { useSkillStore } from '../stores/skillStore'
import { useSkillLearningStore } from '../stores/skillLearningStore'
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
const MOCK_FETCH_LEARNING = vi.fn()
const MOCK_SET_LEARNING_MODE = vi.fn()
const MOCK_APPROVE_CANDIDATE = vi.fn()
const MOCK_REJECT_CANDIDATE = vi.fn()
const MOCK_TAURI_INVOKE = vi.hoisted(() => vi.fn())
const MOCK_TAURI_OPEN = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: MOCK_TAURI_INVOKE,
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: MOCK_TAURI_OPEN,
}))

describe('Settings > Skills tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
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
          isTemporary: false,
        },
      ],
      activeSessionId: 'session-1',
      isLoading: false,
      error: null,
      selectedProjects: [],
      availableProjects: ['/workspace/project'],
    })
    useTabStore.setState({ tabs: [], activeTabId: null })
    useUIStore.setState({ pendingSettingsTab: null, toasts: [] })
    useSkillLearningStore.setState({
      overview: {
        config: {
          version: 1,
          mode: 'suggest',
          minToolUses: 6,
          minConfidence: 0.78,
          autoApproveConfidence: 0.92,
        },
        pendingCandidates: [],
        recentCandidates: [],
        events: [],
        memories: [],
      },
      isLoading: false,
      pendingCandidateId: null,
      error: null,
      fetchOverview: MOCK_FETCH_LEARNING,
      setMode: MOCK_SET_LEARNING_MODE,
      approveCandidate: MOCK_APPROVE_CANDIDATE,
      rejectCandidate: MOCK_REJECT_CANDIDATE,
    })
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

  afterEach(() => {
    vi.unstubAllGlobals()
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
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
    expect(screen.getByRole('button', { name: 'Open skills folder' })).toHaveTextContent('~/.cyber/skills')
    expect(screen.getByText('Alpha Skill')).toBeInTheDocument()
    expect(screen.getByText('Second skill description')).toBeInTheDocument()
    expect(screen.getAllByText('Plugin').length).toBeGreaterThan(0)
    expect(screen.getByText('Telegram Access')).toBeInTheDocument()
  })

  it('shows learned Skill drafts and approves them into the installed list', async () => {
    useSkillLearningStore.setState((state) => ({
      ...state,
      overview: {
        ...state.overview!,
        pendingCandidates: [
          {
            version: 1,
            id: 'candidate-123',
            status: 'pending',
            action: 'create',
            scope: 'project',
            projectRoot: '/workspace/project',
            name: 'project-verification',
            description: 'Verify project changes consistently',
            whenToUse: 'Use after changing this project.',
            reason: 'The workflow was repeated and verified.',
            evidence: ['Focused tests and build passed'],
            confidence: 0.94,
            markdown: '# Project Verification',
            sourceSessionId: 'session-1',
            sourceFingerprint: 'fingerprint-1',
            sourceToolUses: 8,
            createdAt: '2026-07-11T08:00:00.000Z',
            updatedAt: '2026-07-11T08:00:00.000Z',
          },
        ],
      },
    }))

    render(<SkillSettings />)
    fireEvent.click(screen.getByRole('button', { name: /Pending/ }))

    expect(screen.getByText('/project-verification')).toBeInTheDocument()
    expect(screen.getByText('Verify project changes consistently')).toBeInTheDocument()
    expect(screen.getByText('94% confidence')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(MOCK_APPROVE_CANDIDATE).toHaveBeenCalledWith(
        'candidate-123',
        '/workspace/project',
      )
      expect(MOCK_FETCH_SKILLS).toHaveBeenCalledWith('/workspace/project')
    })
    expect(useUIStore.getState().toasts).toContainEqual(
      expect.objectContaining({ type: 'success', message: '/project-verification was saved' }),
    )
  })

  it('switches Skill learning mode without affecting the selected project', async () => {
    render(<SkillSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'Auto' }))

    await waitFor(() => {
      expect(MOCK_SET_LEARNING_MODE).toHaveBeenCalledWith(
        'auto',
        '/workspace/project',
      )
    })
  })

  it('shows recent generated Skills and explains skipped reviews', async () => {
    useSkillLearningStore.setState((state) => ({
      ...state,
      overview: {
        ...state.overview!,
        recentCandidates: [
          {
            version: 1,
            id: 'candidate-recent',
            status: 'approved',
            action: 'create',
            scope: 'project',
            projectRoot: '/workspace/project',
            name: 'release-check',
            description: 'Verify release artifacts consistently',
            whenToUse: 'Use before publishing a release.',
            reason: 'Repeated and verified workflow',
            evidence: ['Four platforms passed'],
            confidence: 0.95,
            markdown: '# Release Check',
            sourceSessionId: 'session-1',
            sourceFingerprint: 'fingerprint-recent',
            sourceToolUses: 8,
            createdAt: '2026-07-11T08:00:00.000Z',
            updatedAt: '2026-07-11T08:01:00.000Z',
          },
        ],
        events: [
          {
            id: 'event-skipped',
            kind: 'review-skipped',
            createdAt: '2026-07-11T09:00:00.000Z',
            message: 'Task used 2 tools; 6 required.',
            toolUseCount: 2,
          },
        ],
      },
    }))

    render(<SkillSettings />)
    fireEvent.click(screen.getByRole('button', { name: /Learning history/ }))

    expect(screen.getByText('/release-check')).toBeInTheDocument()
    expect(screen.getByText('Verify release artifacts consistently')).toBeInTheDocument()
    expect(screen.getByText('Not reviewed this turn: 2 tool calls, 6 required')).toBeInTheDocument()
    await waitFor(() => {
      expect(MOCK_FETCH_SKILLS).toHaveBeenCalledWith('/workspace/project')
    })
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

  it('opens the skills folder through Tauri on desktop', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    })
    MOCK_TAURI_INVOKE.mockResolvedValue(undefined)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        config: {
          userSkillsDir: '/Users/wang/.cyber/skills',
          displayPath: '~/.cyber/skills',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<SkillSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'Open skills folder' }))

    await waitFor(() => {
      expect(MOCK_TAURI_INVOKE).toHaveBeenCalledWith('open_skills_config_dir')
    })
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/skills/open-config'),
      expect.anything(),
    )
  })

  it('falls back to Tauri shell open instead of HTTP when the desktop command is unavailable', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    })
    MOCK_TAURI_INVOKE.mockRejectedValue(new Error('unknown command'))
    MOCK_TAURI_OPEN.mockResolvedValue(undefined)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        config: {
          userSkillsDir: '/Users/wang/custom-claude/skills',
          displayPath: '~/custom-claude/skills',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<SkillSettings />)

    await screen.findByText('~/custom-claude/skills')
    fireEvent.click(screen.getByRole('button', { name: 'Open skills folder' }))

    await waitFor(() => {
      expect(MOCK_TAURI_OPEN).toHaveBeenCalledWith('/Users/wang/custom-claude/skills')
    })
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/skills/open-config'),
      expect.anything(),
    )
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
