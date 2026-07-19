import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'

const { createProjectFolderMock, getRecentProjectsMock, openDialogMock } = vi.hoisted(() => ({
  createProjectFolderMock: vi.fn(),
  getRecentProjectsMock: vi.fn(),
  openDialogMock: vi.fn(),
}))

vi.mock('./ProjectFilter', () => ({
  ProjectFilter: () => <button type="button" aria-label="All projects" />,
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    createProjectFolder: createProjectFolderMock,
    getRecentProjects: getRecentProjectsMock,
  },
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openDialogMock,
}))

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string) => {
    const translations: Record<string, string> = {
      'sidebar.newSession': 'New Session',
      'sidebar.scheduled': 'Scheduled',
      'sidebar.terminal': 'Terminal',
      'sidebar.settings': 'Settings',
      'sidebar.searchPlaceholder': 'Search sessions',
      'sidebar.allProjects': 'All projects',
      'sidebar.allSessions': 'All sessions',
      'sidebar.temporarySessions': 'Temporary sessions',
      'sidebar.sessionScope': 'Session scope',
      'sidebar.other': 'Other',
      'sidebar.projectSessionCount': '{count}',
      'sidebar.removeProject': 'Remove project from sidebar',
      'sidebar.noSessions': 'No sessions',
      'sidebar.noMatching': 'No matching sessions',
      'sidebar.sessionListFailed': 'Session list failed',
      'session.untitled': 'New Session',
      'newSession.title': 'New Session',
      'newSession.currentProject': 'Current project',
      'newSession.recentProjects': 'Recent projects',
      'newSession.noRecentProjects': 'No recent projects',
      'newSession.chooseFolder': 'Choose folder...',
      'newSession.createProject': 'Create new project',
      'newSession.createProjectAction': 'Create project',
      'newSession.projectName': 'Project name',
      'newSession.projectNamePlaceholder': 'Project name',
      'newSession.parentFolder': 'Project creation path',
      'newSession.parentFolderPlaceholder': 'Click to choose project creation path',
      'newSession.chooseParentFolder': 'Choose project creation path',
      'newSession.folderPickerUnavailable': 'Unable to open the folder picker. Please use this in the desktop app.',
      'newSession.temporary': 'Temporary Session',
      'newSession.create': 'Create Session',
      'newSession.selectedWorkspace': 'Selected workspace',
      'newSession.sessionCount': '{count} sessions',
      'common.retry': 'Retry',
      'common.cancel': 'Cancel',
      'common.delete': 'Delete',
      'common.close': 'Close',
      'common.rename': 'Rename',
      'common.loading': 'Loading',
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
  const prefetchHistory = vi.fn(async () => {})
  const disconnectSession = vi.fn()
  const fetchSessions = vi.fn()
  const createSession = vi.fn()
  const deleteSession = vi.fn()
  const renameSession = vi.fn()
  const addToast = vi.fn()

  beforeEach(() => {
    connectToSession.mockReset()
    ensureSessionReady.mockReset()
    prefetchHistory.mockReset()
    disconnectSession.mockReset()
    fetchSessions.mockReset()
    createSession.mockReset()
    deleteSession.mockReset()
    renameSession.mockReset()
    addToast.mockReset()
    createProjectFolderMock.mockReset()
    getRecentProjectsMock.mockReset()
    getRecentProjectsMock.mockResolvedValue({ projects: [] })
    openDialogMock.mockReset()
    delete (window as typeof window & { __TAURI__?: unknown }).__TAURI__

    localStorage.clear()
    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      error: null,
      selectedProjects: [],
      selectedSessionScope: 'all',
      availableProjects: [],
      hiddenProjectPaths: [],
      projectDisplayNames: {},
      fetchSessions,
      createSession,
      deleteSession,
      renameSession,
    })
    useChatStore.setState({
      connectToSession,
      ensureSessionReady,
      prefetchHistory,
      disconnectSession,
    } as Partial<ReturnType<typeof useChatStore.getState>>)
    useUIStore.setState({
      sidebarOpen: true,
      settingsOpen: false,
      addToast,
    } as Partial<ReturnType<typeof useUIStore.getState>>)
  })

  afterEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    localStorage.clear()
  })

  it('places the new-session action below the search field with matching dimensions', () => {
    render(<Sidebar />)

    const controls = screen.getByTestId('sidebar-session-controls')
    const search = screen.getByPlaceholderText('Search sessions')
    const newSessionButton = screen.getByRole('button', { name: 'New Session' })

    expect(search).toHaveClass('h-[44px]', 'w-full', 'rounded-full')
    expect(newSessionButton).toHaveClass('h-[44px]', 'w-full', 'rounded-full')
    expect(search.parentElement).not.toContainElement(newSessionButton)
    expect(controls.lastElementChild).toBe(newSessionButton)
    expect(newSessionButton).toHaveAttribute('aria-haspopup', 'menu')
    expect(newSessionButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('new-session-default-icon')).toHaveClass(
      'absolute',
      'left-1/2',
      'top-1/2',
      '-translate-x-1/2',
      '-translate-y-1/2',
    )
    expect(screen.getByRole('tooltip')).toHaveTextContent('New Session')
    expect(screen.getByTestId('new-session-tooltip')).toHaveClass(
      'opacity-0',
      'group-hover:opacity-100',
      'group-hover:delay-[888ms]',
    )
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

  it('closes the new-session menu when a settings panel opens', async () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    expect(await screen.findByRole('menu', { name: 'New Session' })).toBeInTheDocument()

    act(() => useUIStore.getState().openSettings('agentMigration'))

    await waitFor(() => {
      expect(screen.queryByRole('menu', { name: 'New Session' })).not.toBeInTheDocument()
    })
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
      fireEvent.click(within(menu).getByRole('menuitem', { name: /^project/ }))
    })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith('/workspace/project')
      expect(ensureSessionReady).toHaveBeenCalledWith('session-new-project', undefined)
    })
    expect(screen.queryByRole('menu', { name: 'New Session' })).not.toBeInTheDocument()
  })

  it('creates a new project folder from the plus menu before opening a session', async () => {
    ;(window as typeof window & { __TAURI__?: unknown }).__TAURI__ = {}
    openDialogMock.mockResolvedValue('/workspace')
    createProjectFolderMock.mockResolvedValue({ path: '/workspace/new-app', existed: false })
    createSession.mockResolvedValue('session-new-project')

    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    const menu = await screen.findByRole('menu', { name: 'New Session' })
    await act(async () => {
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Create new project' }))
    })

    expect(screen.queryByRole('menu', { name: 'New Session' })).not.toBeInTheDocument()
    const dialog = await screen.findByRole('dialog', { name: 'Create new project' })
    fireEvent.change(within(dialog).getByPlaceholderText('Project name'), {
      target: { value: 'new-app' },
    })

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Choose project creation path' }))
    })

    await waitFor(() => {
      expect(within(dialog).getByPlaceholderText('Click to choose project creation path')).toHaveValue('/workspace')
    })

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }))
    })

    await waitFor(() => {
      expect(openDialogMock).toHaveBeenCalledWith({
        directory: true,
        multiple: false,
        title: 'Choose project creation path',
      })
      expect(createProjectFolderMock).toHaveBeenCalledWith({
        parentDir: '/workspace',
        name: 'new-app',
      })
      expect(createSession).toHaveBeenCalledWith('/workspace/new-app')
      expect(ensureSessionReady).toHaveBeenCalledWith('session-new-project', undefined)
    })
  })

  it('keeps the current project filter when creating from a project in the plus menu', async () => {
    const now = new Date().toISOString()
    getRecentProjectsMock.mockResolvedValue({
      projects: [
        {
          projectPath: '-workspace-alpha',
          realPath: '/workspace/alpha',
          projectName: 'alpha',
          isGit: true,
          repoName: 'Alpha Repo',
          branch: 'main',
          modifiedAt: now,
          sessionCount: 0,
        },
      ],
    })
    createSession.mockImplementation(async (input) => {
      expect(input).toBe('/workspace/alpha')
      useSessionStore.setState((state) => ({
        sessions: [
          {
            id: 'session-created-alpha',
            title: 'New Session',
            lastMessage: 'created alpha transcript',
            createdAt: now,
            modifiedAt: now,
            messageCount: 0,
            projectPath: '-workspace-alpha',
            workDir: '/workspace/alpha',
            workDirExists: true,
            isTemporary: false,
          },
          ...state.sessions,
        ],
        availableProjects: ['-workspace-alpha', '-workspace-beta'],
      }))
      return 'session-created-alpha'
    })
    useSessionStore.setState({
      sessions: [
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
      availableProjects: ['-workspace-beta'],
    })

    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    const menu = await screen.findByRole('menu', { name: 'New Session' })
    const alphaProject = await within(menu).findByRole('menuitem', { name: /Alpha Repo/i })

    await act(async () => {
      fireEvent.click(alphaProject)
    })

    await waitFor(() => {
      expect(useSessionStore.getState().selectedProjects).toEqual([])
      expect(ensureSessionReady).toHaveBeenCalledWith('session-created-alpha', '-workspace-alpha')
    })

    expect(screen.getByText('created alpha transcript')).toBeInTheDocument()
    expect(screen.getByText('beta transcript')).toBeInTheDocument()
    expect(screen.getByText('temp transcript')).toBeInTheDocument()
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

  it('keeps project and session paths in hover titles instead of visible rows', () => {
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-path-tooltip',
          title: 'Project Session',
          lastMessage: 'Discuss release',
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

    expect(screen.queryByText('/workspace/project')).not.toBeInTheDocument()
    expect(screen.getByText('project').closest('button')).toHaveAttribute('title', '/workspace/project')
    const sessionRow = screen.getByText('Discuss release').closest('button')
    expect(sessionRow).toHaveAttribute('title', '/workspace/project')
    expect(sessionRow).toHaveClass('px-[15px]', 'py-[11px]')
    expect(within(sessionRow!).queryByText('P', { exact: true })).not.toBeInTheDocument()
  })

  it('renames a project display name without changing its path', () => {
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-project-rename',
          title: 'Project Session',
          lastMessage: 'Recent work',
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

    fireEvent.click(screen.getByRole('button', { name: 'Rename: project' }))
    const input = screen.getByRole('textbox', { name: 'Rename: project' })
    fireEvent.change(input, { target: { value: 'Client Portal' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByText('Client Portal')).toBeInTheDocument()
    expect(screen.getByText('Client Portal').closest('button')).toHaveAttribute('title', '/workspace/project')
    expect(useSessionStore.getState().projectDisplayNames).toEqual({
      '-workspace-project': 'Client Portal',
    })
  })

  it('renames a session from its hover action and updates the open tab title', async () => {
    const now = new Date().toISOString()
    renameSession.mockImplementation(async (id, title, projectPath) => {
      useSessionStore.setState((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === id && session.projectPath === projectPath
            ? { ...session, title }
            : session,
        ),
      }))
    })
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-title-rename',
          title: 'Original Session',
          lastMessage: 'Recent work remains visible',
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
    useTabStore.setState({
      tabs: [{
        sessionId: 'session-title-rename',
        projectPath: '-workspace-project',
        title: 'Original Session',
        type: 'session',
        status: 'idle',
      }],
      activeTabId: 'session-title-rename',
    })

    render(<Sidebar />)

    expect(screen.getByText('Original Session')).toBeInTheDocument()
    expect(screen.getByText('Recent work remains visible')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rename: Original Session' }))
    const input = screen.getByRole('textbox', { name: 'Rename: Original Session' })
    fireEvent.change(input, { target: { value: 'Renamed Session' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(renameSession).toHaveBeenCalledTimes(1)
      expect(renameSession).toHaveBeenCalledWith(
        'session-title-rename',
        'Renamed Session',
        '-workspace-project',
      )
      expect(screen.getByText('Renamed Session')).toBeInTheDocument()
    })
    expect(useTabStore.getState().tabs[0]?.title).toBe('Renamed Session')
  })

  it('cancels project and session renames without saving draft names', () => {
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-rename-cancel',
          title: 'Original Session',
          lastMessage: 'Recent work',
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

    fireEvent.click(screen.getByRole('button', { name: 'Rename: project' }))
    const projectInput = screen.getByRole('textbox', { name: 'Rename: project' })
    fireEvent.change(projectInput, { target: { value: 'Unsaved Project' } })
    fireEvent.keyDown(projectInput, { key: 'Escape' })

    expect(screen.getByText('project')).toBeInTheDocument()
    expect(useSessionStore.getState().projectDisplayNames).toEqual({})

    fireEvent.click(screen.getByRole('button', { name: 'Rename: Original Session' }))
    const sessionInput = screen.getByRole('textbox', { name: 'Rename: Original Session' })
    fireEvent.change(sessionInput, { target: { value: 'Unsaved Session' } })
    fireEvent.keyDown(sessionInput, { key: 'Escape' })

    expect(screen.getByText('Original Session')).toBeInTheDocument()
    expect(renameSession).not.toHaveBeenCalled()
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
    fireEvent.pointerEnter(betaRow!)

    expect(prefetchHistory).toHaveBeenCalledWith('session-dup', '-project-beta')

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

  it('groups sessions by project, keeps temporary sessions last, and supports collapse/search/remove', async () => {
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-alpha',
          title: 'Alpha Session',
          lastMessage: 'alpha transcript',
          createdAt: '2026-01-01T00:00:00.000Z',
          modifiedAt: '2026-01-01T00:03:00.000Z',
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
          createdAt: '2026-01-01T00:00:00.000Z',
          modifiedAt: '2026-01-01T00:02:00.000Z',
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
          modifiedAt: '2026-01-01T00:05:00.000Z',
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

    const list = screen.getByTestId('sidebar-session-list-section')
    let sections = within(list).getAllByRole('region')
    expect(sections.map((section) => section.getAttribute('aria-label'))).toEqual([
      'alpha',
      'beta',
      'Temporary sessions',
    ])
    expect(screen.getByText('alpha transcript')).toBeInTheDocument()
    expect(screen.getByText('beta transcript')).toBeInTheDocument()
    expect(screen.getByText('temp transcript')).toBeInTheDocument()

    await act(async () => {
      useSessionStore.getState().setSelectedProjects(['-workspace-beta'])
    })

    sections = within(list).getAllByRole('region')
    expect(sections.map((section) => section.getAttribute('aria-label'))).toEqual(['beta'])
    expect(screen.queryByText('alpha transcript')).not.toBeInTheDocument()
    expect(screen.getByText('beta transcript')).toBeInTheDocument()
    expect(screen.queryByText('temp transcript')).not.toBeInTheDocument()

    await act(async () => {
      useSessionStore.getState().setSelectedProjects([])
    })

    sections = within(list).getAllByRole('region')
    expect(sections.map((section) => section.getAttribute('aria-label'))).toEqual([
      'alpha',
      'beta',
      'Temporary sessions',
    ])

    await act(async () => {
      useSessionStore.getState().setSessionFilterScope('temporary')
    })

    sections = within(list).getAllByRole('region')
    expect(sections.map((section) => section.getAttribute('aria-label'))).toEqual(['Temporary sessions'])
    expect(screen.queryByText('alpha transcript')).not.toBeInTheDocument()
    expect(screen.queryByText('beta transcript')).not.toBeInTheDocument()
    expect(screen.getByText('temp transcript')).toBeInTheDocument()

    await act(async () => {
      useSessionStore.getState().setSessionFilterScope('all')
    })

    sections = within(list).getAllByRole('region')
    expect(sections.map((section) => section.getAttribute('aria-label'))).toEqual([
      'alpha',
      'beta',
      'Temporary sessions',
    ])

    await act(async () => {
      fireEvent.click(within(sections[0]!).getAllByRole('button')[0]!)
    })

    expect(screen.queryByText('alpha transcript')).not.toBeInTheDocument()
    expect(screen.getByText('beta transcript')).toBeInTheDocument()
    expect(screen.getByText('temp transcript')).toBeInTheDocument()

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Search sessions'), {
        target: { value: 'alpha' },
      })
    })

    expect(screen.getByText('alpha transcript')).toBeInTheDocument()
    expect(screen.queryByText('beta transcript')).not.toBeInTheDocument()
    expect(screen.queryByText('temp transcript')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Search sessions'), {
        target: { value: '' },
      })
    })

    const alphaHeader = within(screen.getByRole('region', { name: 'alpha' })).getAllByRole('button')[0]!
    fireEvent.contextMenu(alphaHeader, { clientX: 100, clientY: 100 })
    await act(async () => {
      fireEvent.click(screen.getByText('Remove project from sidebar'))
    })

    expect(useSessionStore.getState().hiddenProjectPaths).toEqual(['-workspace-alpha'])
    expect(screen.queryByText('alpha transcript')).not.toBeInTheDocument()
    expect(screen.getByText('beta transcript')).toBeInTheDocument()
    expect(screen.getByText('temp transcript')).toBeInTheDocument()
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
