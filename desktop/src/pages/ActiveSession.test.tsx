import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { act } from 'react'

vi.mock('../components/chat/MessageList', () => ({
  MessageList: () => <div data-testid="message-list" />,
}))

vi.mock('../components/chat/ChatInput', () => ({
  ChatInput: ({ runtimeKey }: { runtimeKey?: string }) => <div data-testid="chat-input" data-runtime-key={runtimeKey ?? ''} />,
}))

vi.mock('../components/teams/TeamStatusBar', () => ({
  TeamStatusBar: () => <div data-testid="team-status-bar" />,
}))

vi.mock('../components/chat/SessionTaskBar', () => ({
  SessionTaskBar: () => <div data-testid="session-task-bar" />,
}))

import { ActiveSession } from './ActiveSession'
import { useChatStore } from '../stores/chatStore'
import { useCLITaskStore } from '../stores/cliTaskStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { useTeamStore } from '../stores/teamStore'

const originalEnsureSessionReady = useChatStore.getState().ensureSessionReady
const originalLoadHistory = useChatStore.getState().loadHistory

afterEach(() => {
  vi.useRealTimers()
  useTabStore.setState({ tabs: [], activeTabId: null, activeTabKey: null, recentSessionIds: [], recentSessionKeys: [] })
  useSessionStore.setState({ sessions: [], activeSessionId: null, isLoading: false, error: null })
  useChatStore.setState({ sessions: {}, ensureSessionReady: originalEnsureSessionReady, loadHistory: originalLoadHistory })
  useTeamStore.setState({ teams: [], activeTeam: null, memberColors: new Map(), error: null })
})

describe('ActiveSession task polling', () => {
  it('defers session initialization while a warm panel is hidden', () => {
    const sessionId = 'warm-hidden-session'
    const ensureSessionReady = vi.fn().mockResolvedValue(undefined)
    const defaultSession = useChatStore.getState().getSession(sessionId)

    useTabStore.setState({
      tabs: [{ sessionId, title: 'Warm Hidden Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      ensureSessionReady,
      sessions: {
        [sessionId]: {
          ...defaultSession,
          connectionState: 'disconnected',
          historyLoadState: 'idle',
        },
      },
    })

    const { rerender, unmount } = render(
      <ActiveSession sessionId={sessionId} isActive={false} />,
    )

    expect(ensureSessionReady).not.toHaveBeenCalled()

    rerender(<ActiveSession sessionId={sessionId} isActive={true} />)
    expect(ensureSessionReady).toHaveBeenCalledTimes(1)
    expect(ensureSessionReady).toHaveBeenCalledWith(sessionId, undefined)
    unmount()
  })

  it('does not restart a session whose connection and history are already ready', () => {
    const sessionId = 'ready-session'
    const ensureSessionReady = vi.fn().mockResolvedValue(undefined)
    const defaultSession = useChatStore.getState().getSession(sessionId)

    useTabStore.setState({
      tabs: [{ sessionId, title: 'Ready Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      ensureSessionReady,
      sessions: {
        [sessionId]: {
          ...defaultSession,
          connectionState: 'connected',
          historyLoadState: 'loaded',
        },
      },
    })

    const { unmount } = render(<ActiveSession sessionId={sessionId} isActive={true} />)

    expect(ensureSessionReady).not.toHaveBeenCalled()
    unmount()
  })

  it('does not duplicate initialization while sidebar history loading is in flight', () => {
    const sessionId = 'loading-session'
    const ensureSessionReady = vi.fn().mockResolvedValue(undefined)
    const defaultSession = useChatStore.getState().getSession(sessionId)

    useTabStore.setState({
      tabs: [{ sessionId, title: 'Loading Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      ensureSessionReady,
      sessions: {
        [sessionId]: {
          ...defaultSession,
          connectionState: 'connecting',
          historyLoadState: 'loading',
        },
      },
    })

    const { unmount } = render(<ActiveSession sessionId={sessionId} isActive={true} />)

    expect(ensureSessionReady).not.toHaveBeenCalled()
    unmount()
  })

  it('does not loop session initialization after a history load error', () => {
    const sessionId = 'history-error-session'
    const ensureSessionReady = vi.fn().mockResolvedValue(undefined)
    const defaultSession = useChatStore.getState().getSession(sessionId)

    useTabStore.setState({
      tabs: [{ sessionId, title: 'History Error', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      ensureSessionReady,
      sessions: {
        [sessionId]: {
          ...defaultSession,
          connectionState: 'connected',
          historyLoadState: 'error',
        },
      },
    })

    const { unmount } = render(<ActiveSession sessionId={sessionId} isActive={true} />)

    expect(ensureSessionReady).not.toHaveBeenCalled()
    unmount()
  })

  it('retries a failed empty history load when a warm session becomes active again', () => {
    const sessionId = 'history-error-retry-session'
    const loadHistory = vi.fn().mockResolvedValue(undefined)
    const defaultSession = useChatStore.getState().getSession(sessionId)

    useTabStore.setState({
      tabs: [{ sessionId, title: 'History Error', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
      activeTabKey: sessionId,
    })
    useChatStore.setState({
      loadHistory,
      sessions: {
        [sessionId]: {
          ...defaultSession,
          connectionState: 'connected',
          historyLoadState: 'error',
        },
      },
    })

    const { rerender, unmount } = render(<ActiveSession sessionId={sessionId} isActive={false} />)
    expect(loadHistory).not.toHaveBeenCalled()

    rerender(<ActiveSession sessionId={sessionId} isActive={true} />)

    expect(loadHistory).toHaveBeenCalledWith(sessionId, undefined)
    unmount()
  })

  it('keeps the composer clickable and aligned with the message viewport', () => {
    const sessionId = 'clickable-composer-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Clickable Composer',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 1,
        projectPath: '',
        workDir: null,
        workDirExists: true,
        isTemporary: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Clickable Composer', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      ensureSessionReady: vi.fn().mockResolvedValue(undefined),
      sessions: {
        [sessionId]: {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    render(<ActiveSession sessionId={sessionId} isActive={true} />)

    const composerShell = screen.getByTestId('chat-input').parentElement
    const chatLayout = composerShell?.closest('[data-chat-layout]')
    expect(composerShell).toHaveClass('pointer-events-auto')
    expect(composerShell).not.toHaveClass('pointer-events-none')
    expect(chatLayout).toBeTruthy()
    expect(screen.getByTestId('chat-bottom-overlay')).toHaveClass(
      'right-[var(--chat-message-scrollbar-gutter)]',
    )
  })

  it('refreshes CLI tasks repeatedly while a turn is active', async () => {
    vi.useFakeTimers()

    const sessionId = 'polling-session'
    const originalCliTaskState = useCLITaskStore.getState()
    const fetchSessionTasks = vi.fn().mockResolvedValue(undefined)

    useCLITaskStore.setState({
      sessionId,
      tasks: [],
      fetchSessionTasks,
    })

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Polling Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 1,
        projectPath: '',
        workDir: null,
        workDirExists: true,
        isTemporary: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Polling Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      ensureSessionReady: vi.fn().mockResolvedValue(undefined),
      sessions: {
        [sessionId]: {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          chatState: 'thinking',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    const { unmount } = render(<ActiveSession sessionId={sessionId} isActive={true} />)

    expect(fetchSessionTasks).toHaveBeenCalledWith(sessionId)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2200)
    })

    expect(
      fetchSessionTasks.mock.calls.filter(([currentSessionId]) => currentSessionId === sessionId),
    ).toHaveLength(3)

    unmount()
    useCLITaskStore.setState(originalCliTaskState)
  })

  it('keeps member sessions interactive and skips leader task polling', () => {
    const memberSessionId = 'team-member:security-reviewer@test-team'
    const originalCliTaskState = useCLITaskStore.getState()
    const fetchSessionTasks = vi.fn().mockResolvedValue(undefined)

    useCLITaskStore.setState({
      sessionId: null,
      tasks: [],
      fetchSessionTasks,
    })

    useTeamStore.setState({
      teams: [],
      activeTeam: {
        name: 'test-team',
        leadAgentId: 'team-lead@test-team',
        leadSessionId: 'leader-session',
        members: [
          {
            agentId: 'team-lead@test-team',
            role: 'team-lead',
            status: 'running',
            sessionId: 'leader-session',
          },
          {
            agentId: 'security-reviewer@test-team',
            role: 'security-reviewer',
            status: 'running',
          },
        ],
      },
      memberColors: new Map(),
      error: null,
    })

    useTabStore.setState({
      tabs: [{ sessionId: memberSessionId, title: 'security-reviewer', type: 'session', status: 'idle' }],
      activeTabId: memberSessionId,
    })

    useChatStore.setState({
      ensureSessionReady: vi.fn().mockResolvedValue(undefined),
      sessions: {
        [memberSessionId]: {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          chatState: 'thinking',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    const { queryByTestId, unmount } = render(<ActiveSession sessionId={memberSessionId} isActive={true} />)

    expect(queryByTestId('chat-input')).toBeInTheDocument()
    expect(queryByTestId('session-task-bar')).not.toBeInTheDocument()
    expect(fetchSessionTasks).not.toHaveBeenCalled()

    unmount()
    useCLITaskStore.setState(originalCliTaskState)
  })

})
