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
      availableProjects: [],
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
    })
    expect(listMock).toHaveBeenCalledOnce()
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
