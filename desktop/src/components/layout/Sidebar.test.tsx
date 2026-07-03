import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'

const { getRecentProjectsMock } = vi.hoisted(() => ({
  getRecentProjectsMock: vi.fn(),
}))

vi.mock('./ProjectFilter', () => ({
  ProjectFilter: () => <div data-testid="project-filter" />,
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getRecentProjects: getRecentProjectsMock,
  },
}))

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string) => {
    const translations: Record<string, string> = {
      'sidebar.newSession': 'New Session',
      'sidebar.scheduled': 'Scheduled',
      'sidebar.terminal': 'Terminal',
      'sidebar.settings': 'Settings',
      'sidebar.searchPlaceholder': 'Search sessions',
      'sidebar.allSessions': 'All sessions',
      'sidebar.temporarySessions': 'Temporary sessions',
      'sidebar.sessionScope': 'Session scope',
      'sidebar.other': 'Other',
      'sidebar.noSessions': 'No sessions',
      'sidebar.noMatching': 'No matching sessions',
      'sidebar.sessionListFailed': 'Session list failed',
      'session.untitled': 'New Session',
      'newSession.title': 'New Session',
      'newSession.currentProject': 'Current project',
      'newSession.recentProjects': 'Recent projects',
      'newSession.noRecentProjects': 'No recent projects',
      'newSession.chooseFolder': 'Choose folder...',
      'newSession.temporary': 'Temporary Session',
      'newSession.create': 'Create Session',
      'newSession.selectedWorkspace': 'Selected workspace',
      'newSession.sessionCount': '{count} sessions',
      'common.retry': 'Retry',
      'common.cancel': 'Cancel',
      'common.delete': 'Delete',
      'common.rename': 'Rename',
      'sidebar.timeGroup.today': 'Today',
      'sidebar.timeGroup.yesterday': 'Yesterday',
      'sidebar.timeGroup.last7days': 'Last 7 Days',
      'sidebar.timeGroup.last30days': 'Last 30 Days',
      'sidebar.timeGroup.older': 'Older',
      'sidebar.missingDir': 'Missing',
      'sidebar.confirmDelete': 'Delete this session? This cannot be undone.',
      'sidebar.collapse': 'Collapse sidebar',
      'sidebar.expand': 'Expand sidebar',
    }

    return translations[key] ?? key
  },
}))

import { Sidebar } from './Sidebar'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'

describe('Sidebar', () => {
  const connectToSession = vi.fn()
  const ensureSessionReady = vi.fn()
  const disconnectSession = vi.fn()
  const fetchSessions = vi.fn()
  const createSession = vi.fn()
  const deleteSession = vi.fn()
  const addToast = vi.fn()

  beforeEach(() => {
    connectToSession.mockReset()
    ensureSessionReady.mockReset()
    disconnectSession.mockReset()
    fetchSessions.mockReset()
    createSession.mockReset()
    deleteSession.mockReset()
    addToast.mockReset()
    getRecentProjectsMock.mockReset()
    getRecentProjectsMock.mockResolvedValue({ projects: [] })

    localStorage.clear()
    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      error: null,
      selectedProjects: [],
      availableProjects: [],
      fetchSessions,
      createSession,
      deleteSession,
    })
    useChatStore.setState({
      connectToSession,
      ensureSessionReady,
      disconnectSession,
    } as Partial<ReturnType<typeof useChatStore.getState>>)
    useUIStore.setState({
      sidebarOpen: true,
      addToast,
    } as Partial<ReturnType<typeof useUIStore.getState>>)
  })

  afterEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    localStorage.clear()
  })

  it('opens a new tab when creating a session from the sidebar', async () => {
    createSession.mockResolvedValue('session-new-1')

    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    expect(await screen.findByRole('menu', { name: 'New Session' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Temporary Session' }))
    })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith({ temporary: true })
      expect(ensureSessionReady).toHaveBeenCalledWith('session-new-1', undefined)
    })

    expect(useTabStore.getState().tabs).toEqual([
      { sessionId: 'session-new-1', projectPath: undefined, title: 'New Session', type: 'session', status: 'idle' },
    ])
    expect(useTabStore.getState().activeTabId).toBe('session-new-1')
    expect(screen.getByRole('complementary')).not.toHaveAttribute('data-tauri-drag-region')
  })

  it('shows a toast when session creation fails', async () => {
    createSession.mockRejectedValue(new Error('boom'))

    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Temporary Session' }))
    })

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith({
        type: 'error',
        message: 'boom',
      })
    })

    expect(useTabStore.getState().tabs).toEqual([])
  })

  it('offers the selected project workspace first before creating', async () => {
    createSession.mockResolvedValue('session-new-project')
    const now = new Date().toISOString()
    useSessionStore.setState({
      selectedProjects: ['-workspace-project'],
      sessions: [
        {
          id: 'session-existing',
          title: 'Existing Session',
          createdAt: now,
          modifiedAt: now,
          messageCount: 1,
          projectPath: '-workspace-project',
          workDir: '/workspace/project',
          workDirExists: true,
          isTemporary: false,
        },
      ],
    })

    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    const menu = await screen.findByRole('menu', { name: 'New Session' })
    expect(createSession).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(within(menu).getByRole('menuitem', { name: /project/ }))
    })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith('/workspace/project')
      expect(ensureSessionReady).toHaveBeenCalledWith('session-new-project', undefined)
    })
    expect(screen.queryByRole('menu', { name: 'New Session' })).not.toBeInTheDocument()
  })

  it('requires confirmation before deleting a session from the hover action', async () => {
    deleteSession.mockResolvedValue(undefined)
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          title: 'Open Session',
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
          messageCount: 1,
          projectPath: '-workspace-project',
          workDir: '/workspace/project',
          workDirExists: true,
          isTemporary: false,
        },
      ],
    })
    useTabStore.setState({
      tabs: [{ sessionId: 'session-1', title: 'Open Session', type: 'session', status: 'idle' }],
      activeTabId: 'session-1',
    })

    render(<Sidebar />)

    const sessionCard = screen.getByText('Open Session').closest('button')
    expect(sessionCard).toBeTruthy()
    fireEvent.mouseEnter(sessionCard!)
    fireEvent.click(screen.getByRole('button', { name: 'Delete: Open Session' }))

    expect(deleteSession).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Delete this session? This cannot be undone.')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    })

    await waitFor(() => {
      expect(deleteSession).toHaveBeenCalledWith('session-1', '-workspace-project')
      expect(disconnectSession).toHaveBeenCalledWith('session-1')
    })

    expect(useTabStore.getState().tabs).toEqual([])
    expect(useTabStore.getState().activeTabId).toBeNull()
  })

  it('passes the selected projectPath locator when opening duplicate session ids', async () => {
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-dup',
          title: 'Project Alpha',
          lastMessage: 'alpha transcript',
          createdAt: now,
          modifiedAt: now,
          messageCount: 1,
          projectPath: '-project-alpha',
          workDir: '/workspace/alpha',
          workDirExists: true,
          isTemporary: false,
        },
        {
          id: 'session-dup',
          title: 'Project Beta',
          lastMessage: 'beta transcript',
          createdAt: now,
          modifiedAt: now,
          messageCount: 1,
          projectPath: '-project-beta',
          workDir: '/workspace/beta',
          workDirExists: true,
          isTemporary: false,
        },
      ],
    })

    await act(async () => {
      render(<Sidebar />)
    })

    const betaRow = screen.getByText('beta transcript').closest('button')
    expect(betaRow).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(betaRow!)
    })

    expect(ensureSessionReady).toHaveBeenCalledWith('session-dup', '-project-beta')
    expect(useTabStore.getState().tabs).toMatchObject([
      { sessionId: 'session-dup', projectPath: '-project-beta', title: 'Project Beta' },
    ])
  })

  it('does not render when the sidebar is closed', () => {
    useUIStore.setState({ sidebarOpen: false } as Partial<ReturnType<typeof useUIStore.getState>>)

    render(<Sidebar />)

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('filters sessions by all sessions, temporary sessions, and project', async () => {
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-alpha',
          title: 'Alpha Session',
          lastMessage: 'alpha transcript',
          createdAt: now,
          modifiedAt: now,
          messageCount: 1,
          projectPath: '-workspace-alpha',
          workDir: '/workspace/alpha',
          workDirExists: true,
          isTemporary: false,
        },
        {
          id: 'session-beta',
          title: 'Beta Session',
          lastMessage: 'beta transcript',
          createdAt: now,
          modifiedAt: now,
          messageCount: 1,
          projectPath: '-workspace-beta',
          workDir: '/workspace/beta',
          workDirExists: true,
          isTemporary: false,
        },
        {
          id: 'session-temp',
          title: 'Temporary Session',
          lastMessage: 'temp transcript',
          createdAt: now,
          modifiedAt: now,
          messageCount: 1,
          projectPath: '-Users-test',
          workDir: '/Users/test',
          workDirExists: true,
          isTemporary: true,
        },
      ],
      availableProjects: [
        '-workspace-alpha',
        '-workspace-beta',
      ],
    })

    render(<Sidebar />)

    expect(screen.getByText('alpha transcript')).toBeInTheDocument()
    expect(screen.getByText('beta transcript')).toBeInTheDocument()
    expect(screen.getByText('temp transcript')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /All sessions/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Temporary sessions/ }))
    })

    expect(screen.queryByText('alpha transcript')).not.toBeInTheDocument()
    expect(screen.queryByText('beta transcript')).not.toBeInTheDocument()
    expect(screen.getByText('temp transcript')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Temporary sessions/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: /alpha/ }))
    })

    expect(screen.getByText('alpha transcript')).toBeInTheDocument()
    expect(screen.queryByText('beta transcript')).not.toBeInTheDocument()
    expect(screen.queryByText('temp transcript')).not.toBeInTheDocument()
  })

  it('keeps the session list section in a constrained flex column for scrolling', () => {
    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-session-list-section')).toHaveClass(
      'flex-1',
      'overflow-y-auto',
      'no-scrollbar',
      'scroll-smooth',
    )
  })
})
