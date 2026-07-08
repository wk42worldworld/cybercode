import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createMock, deleteMock, listMock, renameMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  deleteMock: vi.fn(),
  listMock: vi.fn(),
  renameMock: vi.fn(),
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    create: createMock,
    list: listMock,
    delete: deleteMock,
    rename: renameMock,
  },
}))

import { useSessionStore } from './sessionStore'
import { useSettingsStore } from './settingsStore'

const initialState = useSessionStore.getState()

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('sessionStore', () => {
  beforeEach(() => {
    createMock.mockReset()
    deleteMock.mockReset()
    listMock.mockReset()
    renameMock.mockReset()
    useSessionStore.setState({
      ...initialState,
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      error: null,
      selectedProjects: [],
      selectedSessionScope: 'all',
      availableProjects: [],
      hiddenProjectPaths: [],
    })
    useSettingsStore.setState({ locale: 'zh' })
  })

  afterEach(() => {
    useSessionStore.setState(initialState)
  })

  it('returns a new session id before the background refresh completes', async () => {
    createMock.mockResolvedValue({ sessionId: 'session-optimistic-1' })
    listMock.mockImplementation(() => new Promise(() => {}))

    const result = await Promise.race([
      useSessionStore.getState().createSession('D:/workspace/code/myself_code/cybercode'),
      delay(100).then(() => 'timed-out'),
    ])

    expect(result).toBe('session-optimistic-1')
    expect(useSessionStore.getState().activeSessionId).toBe('session-optimistic-1')
    expect(useSessionStore.getState().sessions[0]).toMatchObject({
      id: 'session-optimistic-1',
      title: '新会话',
      workDir: 'D:/workspace/code/myself_code/cybercode',
      workDirExists: true,
      isTemporary: false,
    })
    expect(listMock).toHaveBeenCalledOnce()
  })

  it('uses the server session payload for explicit temporary sessions', async () => {
    const now = '2026-01-01T00:00:00.000Z'
    createMock.mockResolvedValue({
      sessionId: 'session-temp-1',
      session: {
        id: 'session-temp-1',
        title: 'Untitled Session',
        lastMessage: '',
        createdAt: now,
        modifiedAt: now,
        messageCount: 0,
        projectPath: '-Users-test',
        workDir: '/Users/test',
        workDirExists: true,
        isTemporary: true,
      },
    })
    listMock.mockImplementation(() => new Promise(() => {}))

    const result = await useSessionStore.getState().createSession({ temporary: true })

    expect(result).toBe('session-temp-1')
    expect(createMock).toHaveBeenCalledWith({ temporary: true })
    expect(useSessionStore.getState().sessions[0]).toMatchObject({
      id: 'session-temp-1',
      projectPath: '-Users-test',
      workDir: '/Users/test',
      isTemporary: true,
    })
  })

  it('excludes temporary sessions from available projects after refresh', async () => {
    listMock.mockResolvedValue({
      sessions: [
        {
          id: 'session-project',
          title: 'Project',
          createdAt: '2026-01-01T00:00:00.000Z',
          modifiedAt: '2026-01-01T00:00:00.000Z',
          messageCount: 1,
          projectPath: '-workspace-project',
          workDir: '/workspace/project',
          workDirExists: true,
          isTemporary: false,
        },
        {
          id: 'session-temp',
          title: 'Temporary',
          createdAt: '2026-01-01T00:01:00.000Z',
          modifiedAt: '2026-01-01T00:01:00.000Z',
          messageCount: 1,
          projectPath: '-Users-test',
          workDir: '/Users/test',
          workDirExists: true,
          isTemporary: true,
        },
      ],
      total: 2,
    })

    await useSessionStore.getState().fetchSessions()

    expect(useSessionStore.getState().availableProjects).toEqual(['-workspace-project'])
  })

  it('keeps the sidebar filter scope mutually exclusive', () => {
    useSessionStore.getState().setSelectedProjects(['-workspace-alpha', '-workspace-beta'])

    expect(useSessionStore.getState().selectedProjects).toEqual(['-workspace-alpha'])
    expect(useSessionStore.getState().selectedSessionScope).toBe('project')

    useSessionStore.getState().setSessionFilterScope('temporary')

    expect(useSessionStore.getState().selectedProjects).toEqual([])
    expect(useSessionStore.getState().selectedSessionScope).toBe('temporary')

    useSessionStore.getState().setSessionFilterScope('project', '-workspace-beta')

    expect(useSessionStore.getState().selectedProjects).toEqual(['-workspace-beta'])
    expect(useSessionStore.getState().selectedSessionScope).toBe('project')

    useSessionStore.getState().setSessionFilterScope('all')

    expect(useSessionStore.getState().selectedProjects).toEqual([])
    expect(useSessionStore.getState().selectedSessionScope).toBe('all')
  })

  it('hides projects from sidebar availability without deleting their sessions', () => {
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-project',
          title: 'Project',
          createdAt: '2026-01-01T00:00:00.000Z',
          modifiedAt: '2026-01-01T00:00:00.000Z',
          messageCount: 1,
          projectPath: '-workspace-project',
          workDir: '/workspace/project',
          workDirExists: true,
          isTemporary: false,
        },
      ],
      availableProjects: ['-workspace-project'],
      selectedProjects: ['-workspace-project'],
      selectedSessionScope: 'project',
      hiddenProjectPaths: [],
    })

    useSessionStore.getState().hideProject('-workspace-project')

    expect(useSessionStore.getState().hiddenProjectPaths).toEqual(['-workspace-project'])
    expect(useSessionStore.getState().availableProjects).toEqual([])
    expect(useSessionStore.getState().selectedProjects).toEqual([])
    expect(useSessionStore.getState().selectedSessionScope).toBe('all')
    expect(useSessionStore.getState().sessions).toHaveLength(1)
  })

  it('restores a hidden project when creating a session in that project', async () => {
    const now = '2026-01-01T00:00:00.000Z'
    createMock.mockResolvedValue({
      sessionId: 'session-restored-project',
      session: {
        id: 'session-restored-project',
        title: 'Untitled Session',
        lastMessage: '',
        createdAt: now,
        modifiedAt: now,
        messageCount: 0,
        projectPath: '-workspace-project',
        workDir: '/workspace/project',
        workDirExists: true,
        isTemporary: false,
      },
    })
    listMock.mockImplementation(() => new Promise(() => {}))
    useSessionStore.setState({
      hiddenProjectPaths: ['-workspace-project'],
      availableProjects: [],
    })

    await useSessionStore.getState().createSession('/workspace/project')

    expect(useSessionStore.getState().hiddenProjectPaths).toEqual([])
    expect(useSessionStore.getState().availableProjects).toEqual(['-workspace-project'])
  })

  it('deletes only the session matching the selected projectPath locator', async () => {
    deleteMock.mockResolvedValue(undefined)
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-dup',
          title: 'Alpha',
          createdAt: '2026-01-01T00:00:00.000Z',
          modifiedAt: '2026-01-01T00:00:00.000Z',
          messageCount: 1,
          projectPath: '-project-alpha',
          workDir: '/workspace/alpha',
          workDirExists: true,
          isTemporary: false,
        },
        {
          id: 'session-dup',
          title: 'Beta',
          createdAt: '2026-01-01T00:00:00.000Z',
          modifiedAt: '2026-01-01T00:00:00.000Z',
          messageCount: 1,
          projectPath: '-project-beta',
          workDir: '/workspace/beta',
          workDirExists: true,
          isTemporary: false,
        },
      ],
      activeSessionId: 'session-dup',
    })

    await useSessionStore.getState().deleteSession('session-dup', '-project-alpha')

    expect(deleteMock).toHaveBeenCalledWith('session-dup', { projectPath: '-project-alpha' })
    expect(useSessionStore.getState().sessions).toMatchObject([
      { id: 'session-dup', title: 'Beta', projectPath: '-project-beta' },
    ])
    expect(useSessionStore.getState().activeSessionId).toBe('session-dup')
  })

  it('renames only the session matching the selected projectPath locator', async () => {
    renameMock.mockResolvedValue(undefined)
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-dup',
          title: 'Alpha',
          createdAt: '2026-01-01T00:00:00.000Z',
          modifiedAt: '2026-01-01T00:00:00.000Z',
          messageCount: 1,
          projectPath: '-project-alpha',
          workDir: '/workspace/alpha',
          workDirExists: true,
          isTemporary: false,
        },
        {
          id: 'session-dup',
          title: 'Beta',
          createdAt: '2026-01-01T00:00:00.000Z',
          modifiedAt: '2026-01-01T00:00:00.000Z',
          messageCount: 1,
          projectPath: '-project-beta',
          workDir: '/workspace/beta',
          workDirExists: true,
          isTemporary: false,
        },
      ],
    })

    await useSessionStore.getState().renameSession('session-dup', 'Renamed Alpha', '-project-alpha')

    expect(renameMock).toHaveBeenCalledWith('session-dup', 'Renamed Alpha', { projectPath: '-project-alpha' })
    expect(useSessionStore.getState().sessions).toMatchObject([
      { id: 'session-dup', title: 'Renamed Alpha', projectPath: '-project-alpha' },
      { id: 'session-dup', title: 'Beta', projectPath: '-project-beta' },
    ])
  })
})
