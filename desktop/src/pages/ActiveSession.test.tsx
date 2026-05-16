import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { act } from 'react'

vi.mock('../components/chat/MessageList', () => ({
  MessageList: () => <div data-testid="message-list" />,
}))

vi.mock('../components/chat/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}))

vi.mock('../components/chat/FloatingThinkingPanel', () => ({
  FloatingThinkingPanel: ({
    content,
    isActive,
    identityKey,
  }: {
    content?: string
    isActive?: boolean
    identityKey?: string
  }) => (
    <div
      data-testid="floating-thinking-panel"
      data-thinking-content={content ?? ''}
      data-active={String(Boolean(isActive))}
      data-identity-key={identityKey ?? ''}
    />
  ),
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

afterEach(() => {
  vi.useRealTimers()
  useTabStore.setState({ tabs: [], activeTabId: null })
  useSessionStore.setState({ sessions: [], activeSessionId: null, isLoading: false, error: null })
  useChatStore.setState({ sessions: {}, ensureSessionReady: originalEnsureSessionReady })
  useTeamStore.setState({ teams: [], activeTeam: null, memberColors: new Map(), error: null })
})

describe('ActiveSession task polling', () => {
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

  it('passes the latest thinking message while a turn is active after activeThinkingId clears', () => {
    const sessionId = 'thinking-fallback-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Thinking Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 1,
        projectPath: '',
        workDir: null,
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Thinking Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      ensureSessionReady: vi.fn().mockResolvedValue(undefined),
      sessions: {
        [sessionId]: {
          messages: [
            { id: 'thinking-1', type: 'thinking', content: 'Reading recent context', timestamp: 1 },
          ],
          historyBuffer: [],
          recentBuffer: [],
          chatState: 'streaming',
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

    expect(screen.getByTestId('floating-thinking-panel')).toHaveAttribute('data-thinking-content', 'Reading recent context')
    expect(screen.getByTestId('floating-thinking-panel')).toHaveAttribute('data-active', 'true')

    unmount()
  })

  it('passes fresh thinking once even if a fast turn has already returned to idle', () => {
    const sessionId = 'fast-thinking-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Fast Thinking Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 2,
        projectPath: '',
        workDir: null,
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Fast Thinking Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      ensureSessionReady: vi.fn().mockResolvedValue(undefined),
      sessions: {
        [sessionId]: {
          messages: [
            { id: 'thinking-1', type: 'thinking', content: 'Brief reasoning burst', timestamp: Date.now() },
            { id: 'assistant-1', type: 'assistant_text', content: 'Done', timestamp: Date.now() },
          ],
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

    const { unmount } = render(<ActiveSession sessionId={sessionId} isActive={true} />)

    expect(screen.getByTestId('floating-thinking-panel')).toHaveAttribute('data-thinking-content', 'Brief reasoning burst')
    expect(screen.getByTestId('floating-thinking-panel')).toHaveAttribute('data-active', 'false')

    unmount()
  })

  it('does not reuse previous thinking after a new user message starts the next turn', () => {
    const sessionId = 'new-turn-thinking-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'New Turn Thinking Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 3,
        projectPath: '',
        workDir: null,
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'New Turn Thinking Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      ensureSessionReady: vi.fn().mockResolvedValue(undefined),
      sessions: {
        [sessionId]: {
          messages: [
            { id: 'thinking-old', type: 'thinking', content: 'Old reasoning cache', timestamp: 1 },
            { id: 'assistant-old', type: 'assistant_text', content: 'Previous answer', timestamp: 2 },
            { id: 'user-new', type: 'user_text', content: 'Next request', timestamp: 3 },
          ],
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

    expect(screen.getByTestId('floating-thinking-panel')).toHaveAttribute('data-thinking-content', '')
    expect(screen.getByTestId('floating-thinking-panel')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('floating-thinking-panel')).toHaveAttribute('data-identity-key', `${sessionId}:user-new`)

    unmount()
  })
})
