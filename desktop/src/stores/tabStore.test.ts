import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTabStore } from './tabStore'
import { sessionsApi } from '../api/sessions'

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    list: vi.fn(async () => ({ sessions: [] })),
  },
}))

describe('tabStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useTabStore.setState({ tabs: [], activeTabId: null, recentSessionIds: [] })
  })

  it('opens tabs without replacing existing tabs', () => {
    useTabStore.getState().openTab('session-1', 'Session 1')
    useTabStore.getState().openTab('session-2', 'Session 2')

    expect(useTabStore.getState().tabs).toMatchObject([
      { sessionId: 'session-1', title: 'Session 1', type: 'session' },
      { sessionId: 'session-2', title: 'Session 2', type: 'session' },
    ])
    expect(useTabStore.getState().activeTabId).toBe('session-2')
    expect(useTabStore.getState().recentSessionIds).toEqual(['session-2', 'session-1'])
  })

  it('creates first-class terminal tabs with stable incrementing titles', () => {
    const firstId = useTabStore.getState().openTerminalTab()
    const secondId = useTabStore.getState().openTerminalTab()

    expect(firstId).not.toBe(secondId)
    expect(useTabStore.getState().tabs.filter((tab) => tab.type === 'terminal')).toMatchObject([
      { sessionId: firstId, title: 'Terminal 1' },
      { sessionId: secondId, title: 'Terminal 2' },
    ])
    expect(useTabStore.getState().activeTabId).toBe(secondId)

    useTabStore.getState().closeTab(firstId)
    const thirdId = useTabStore.getState().openTerminalTab()

    expect(thirdId).not.toBe(secondId)
    expect(useTabStore.getState().tabs.filter((tab) => tab.type === 'terminal')).toMatchObject([
      { sessionId: secondId, title: 'Terminal 2' },
      { sessionId: thirdId, title: 'Terminal 3' },
    ])
  })

  it('closes arbitrary tabs and keeps a sensible active tab', () => {
    useTabStore.getState().openTab('session-1', 'Session 1')
    useTabStore.getState().openTab('session-2', 'Session 2')
    useTabStore.getState().openTab('session-3', 'Session 3')

    useTabStore.getState().closeTab('session-2')
    expect(useTabStore.getState().tabs.map((tab) => tab.sessionId)).toEqual(['session-1', 'session-3'])
    expect(useTabStore.getState().activeTabId).toBe('session-3')

    useTabStore.getState().closeTab('session-3')
    expect(useTabStore.getState().activeTabId).toBe('session-1')
  })

  it('persists and restores the projectPath locator for session tabs', async () => {
    vi.mocked(sessionsApi.list).mockResolvedValueOnce({
      total: 1,
      sessions: [
        {
          id: 'session-1',
          title: 'Restored Session',
          lastMessage: '',
          createdAt: '2026-01-01T00:00:00.000Z',
          modifiedAt: '2026-01-01T00:00:00.000Z',
          messageCount: 1,
          projectPath: '-project-a',
          workDir: '/project/a',
          workDirExists: true,
        },
      ],
    })

    useTabStore.getState().openTab('session-1', 'Session 1', 'session', '-project-a')
    useTabStore.setState({ tabs: [], activeTabId: null, recentSessionIds: [] })

    await useTabStore.getState().restoreTabs()

    expect(useTabStore.getState().tabs).toMatchObject([
      { sessionId: 'session-1', projectPath: '-project-a', title: 'Restored Session' },
    ])
  })
})
