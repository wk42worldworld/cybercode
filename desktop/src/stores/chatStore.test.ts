import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageEntry } from '../types/session'
import { useSessionRuntimeStore } from './sessionRuntimeStore'
import { sessionsApi } from '../api/sessions'
import { wsManager } from '../api/websocket'
import { useSettingsStore } from './settingsStore'
import { ApiError } from '../api/client'

const {
  sendMock,
  getMemberBySessionIdMock,
  sendMessageToMemberMock,
  handleTeamCreatedMock,
  handleTeamUpdateMock,
  handleTeamDeletedMock,
  fetchSessionTasksMock,
  clearTasksMock,
  setTasksFromTodosMock,
  markCompletedAndDismissedMock,
  resetCompletedTasksMock,
  refreshTasksMock,
  cliTaskStoreSnapshot,
  updateTabTitleMock,
  updateTabStatusMock,
  tabStoreSnapshot,
  updateSessionTitleMock,
  sessionStoreSnapshot,
} = vi.hoisted(() => ({
  sendMock: vi.fn(),
  getMemberBySessionIdMock: vi.fn<(sessionId: string) => any>(() => null),
  sendMessageToMemberMock: vi.fn(async () => {}),
  handleTeamCreatedMock: vi.fn(),
  handleTeamUpdateMock: vi.fn(),
  handleTeamDeletedMock: vi.fn(),
  fetchSessionTasksMock: vi.fn(),
  clearTasksMock: vi.fn(),
  setTasksFromTodosMock: vi.fn(),
  markCompletedAndDismissedMock: vi.fn(),
  resetCompletedTasksMock: vi.fn(async () => {}),
  refreshTasksMock: vi.fn(),
  cliTaskStoreSnapshot: {
    tasks: [] as Array<{ id: string; subject: string; status: string; activeForm?: string }>,
    sessionId: null as string | null,
  },
  updateTabTitleMock: vi.fn(),
  updateTabStatusMock: vi.fn(),
  tabStoreSnapshot: {
    tabs: [] as Array<{ sessionId: string; title: string; type: string; status: string }>,
    activeTabId: null as string | null,
  },
  updateSessionTitleMock: vi.fn(),
  sessionStoreSnapshot: {
    sessions: [] as Array<{ id: string; title: string }>,
  },
}))

vi.mock('../api/websocket', () => ({
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    onStateChange: vi.fn(() => () => {}),
    clearHandlers: vi.fn(),
    send: sendMock,
  },
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    getMessages: vi.fn(async () => ({ messages: [], hasMore: false })),
    getSlashCommands: vi.fn(async () => ({ commands: [] })),
    getAnchors: vi.fn(async () => ({ anchors: [] })),
  },
}))

vi.mock('./teamStore', () => ({
  useTeamStore: {
    getState: () => ({
      getMemberBySessionId: getMemberBySessionIdMock,
      sendMessageToMember: sendMessageToMemberMock,
      handleTeamCreated: handleTeamCreatedMock,
      handleTeamUpdate: handleTeamUpdateMock,
      handleTeamDeleted: handleTeamDeletedMock,
    }),
  },
}))

vi.mock('./tabStore', () => ({
  useTabStore: {
    getState: () => ({
      tabs: tabStoreSnapshot.tabs,
      activeTabId: tabStoreSnapshot.activeTabId,
      updateTabStatus: updateTabStatusMock,
      updateTabTitle: updateTabTitleMock,
    }),
  },
}))

vi.mock('./sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      sessions: sessionStoreSnapshot.sessions,
      updateSessionTitle: updateSessionTitleMock,
    }),
  },
}))

vi.mock('./cliTaskStore', () => ({
  useCLITaskStore: {
    getState: () => ({
      fetchSessionTasks: fetchSessionTasksMock,
      tasks: cliTaskStoreSnapshot.tasks,
      sessionId: cliTaskStoreSnapshot.sessionId,
      clearTasks: clearTasksMock,
      setTasksFromTodos: setTasksFromTodosMock,
      markCompletedAndDismissed: markCompletedAndDismissedMock,
      resetCompletedTasks: resetCompletedTasksMock,
      refreshTasks: refreshTasksMock,
    }),
  },
}))

import { mapHistoryMessagesToUiMessages, useChatStore, type PerSessionState } from './chatStore'

const TEST_SESSION_ID = 'test-session-1'
const initialState = useChatStore.getState()

function makeSessionState(overrides: Partial<PerSessionState> = {}): PerSessionState {
  return {
    messages: [],
    historyBuffer: [],
    recentBuffer: [],
    historyLoadState: 'loaded',
    allMessagesLoaded: true,
    chatState: 'idle',
    turnCompletionPending: false,
    completionUnread: false,
    connectionState: 'connected',
    streamingText: '',
    streamingToolInput: '',
    activeToolUseId: null,
    activeToolName: null,
    activeThinkingId: null,
    pendingPermission: null,
    pendingComputerUsePermission: null,
    pendingSteers: [],
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
    elapsedSeconds: 0,
    statusVerb: '',
    turnStartedAt: null,
    lastModelActivityAt: null,
    lastConnectionActivityAt: null,
    slashCommands: [],
    agentTaskNotifications: {},
    elapsedTimer: null,
    ...overrides,
  }
}

describe('chatStore history mapping', () => {
  beforeEach(() => {
    for (const session of Object.values(useChatStore.getState().sessions)) {
      if (session.elapsedTimer) clearInterval(session.elapsedTimer)
    }
    sendMock.mockReset()
    vi.mocked(wsManager.connect).mockClear()
    vi.mocked(wsManager.disconnect).mockClear()
    vi.mocked(wsManager.clearHandlers).mockClear()
    getMemberBySessionIdMock.mockReset()
    getMemberBySessionIdMock.mockReturnValue(null)
    sendMessageToMemberMock.mockReset()
    fetchSessionTasksMock.mockReset()
    clearTasksMock.mockReset()
    setTasksFromTodosMock.mockReset()
    markCompletedAndDismissedMock.mockReset()
    resetCompletedTasksMock.mockReset()
    refreshTasksMock.mockReset()
    updateTabTitleMock.mockReset()
    updateTabStatusMock.mockReset()
    updateSessionTitleMock.mockReset()
    tabStoreSnapshot.tabs = []
    tabStoreSnapshot.activeTabId = null
    sessionStoreSnapshot.sessions = []
    cliTaskStoreSnapshot.tasks = []
    cliTaskStoreSnapshot.sessionId = null
    useSessionRuntimeStore.setState({ selections: {} })
    localStorage.clear()
    useChatStore.setState({
      ...initialState,
      sessions: {},
    })
  })

  it('preserves thinking blocks when restoring transcript history', () => {
    const messages: MessageEntry[] = [
      {
        id: 'assistant-1',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:00.000Z',
        model: 'opus',
        parentToolUseId: 'agent-1',
        content: [
          { type: 'thinking', thinking: 'internal reasoning' },
          { type: 'text', text: '目录结构分析' },
          { type: 'tool_use', name: 'Read', id: 'tool-1', input: { file_path: 'src/App.tsx' } },
        ],
      },
      {
        id: 'user-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:01.000Z',
        parentToolUseId: 'agent-1',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'ok', is_error: false },
        ],
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped.map((message) => message.type)).toEqual([
      'thinking',
      'assistant_text',
      'tool_use',
      'tool_result',
    ])
    expect(mapped[2]).toMatchObject({ parentToolUseId: 'agent-1' })
    expect(mapped[3]).toMatchObject({ parentToolUseId: 'agent-1' })
  })

  it('merges consecutive assistant text blocks when restoring transcript history', () => {
    const messages: MessageEntry[] = [
      {
        id: 'assistant-merge-1',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:00.000Z',
        model: 'opus',
        content: [
          { type: 'text', text: '第一段：Windows 下的桌面端输出。' },
          { type: 'text', text: '\r\n第二段：刷新后也不应该被拆开。' },
        ],
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped).toMatchObject([
      {
        type: 'assistant_text',
        content: '第一段：Windows 下的桌面端输出。\r\n第二段：刷新后也不应该被拆开。',
      },
    ])
  })

  it('surfaces teammate prompt content when mapping member transcript history', () => {
    const messages: MessageEntry[] = [
      {
        id: 'user-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: '<teammate-message teammate_id="security-reviewer">Review the auth diff and call out risks.</teammate-message>',
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages, {
      includeTeammateMessages: true,
    })

    expect(mapped).toMatchObject([
      {
        type: 'user_text',
        content: 'Review the auth diff and call out risks.',
      },
    ])
  })

  it('preserves source user ids when restoring array-content user prompts', () => {
    const messages: MessageEntry[] = [
      {
        id: 'user-with-attachment',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: [
          { type: 'text', text: '请看这个文件' },
          { type: 'file', name: 'report.md' },
        ],
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped).toMatchObject([
      {
        id: 'user-with-attachment',
        type: 'user_text',
        content: '请看这个文件',
        attachments: [{ type: 'file', name: 'report.md' }],
      },
    ])
  })

  it('uses the first user message as the initial session tab title', () => {
    tabStoreSnapshot.tabs = [{
      sessionId: TEST_SESSION_ID,
      title: '新会话',
      type: 'session',
      status: 'idle',
    }]
    sessionStoreSnapshot.sessions = [{ id: TEST_SESSION_ID, title: '新会话' }]

    useChatStore.getState().sendMessage(
      TEST_SESSION_ID,
      '现在 会话选项卡的 标题 要是用户发的第一句话\n而不是 AI 回复',
    )

    const expectedTitle = '现在 会话选项卡的 标题 要是用户发的第一句话 而不是 AI 回复'
    expect(updateSessionTitleMock).toHaveBeenCalledWith(TEST_SESSION_ID, expectedTitle)
    expect(updateTabTitleMock).toHaveBeenCalledWith(TEST_SESSION_ID, expectedTitle)
  })

  it('resets the per-turn token counter when the next message starts', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          tokenUsage: {
            input_tokens: 1_200,
            output_tokens: 240,
            cache_read_input_tokens: 600,
          },
          usageRevision: 2,
        }),
      },
    })

    useChatStore.getState().sendMessage(TEST_SESSION_ID, 'Continue')

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.tokenUsage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.usageRevision).toBe(2)
  })

  it('keeps a turn active until the backend confirms stop and refreshes usage after a forced stop', () => {
    const elapsedTimer = setInterval(() => {}, 1_000)
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          chatState: 'tool_executing',
          streamingText: '已完成一部分',
          streamingToolInput: '{"url":"https://example.com"}',
          activeToolUseId: 'browser-tool-1',
          activeToolName: 'mcp__agent-browser__agent_browser_open',
          elapsedTimer,
          usageRevision: 3,
        }),
      },
    })

    useChatStore.getState().stopGeneration(TEST_SESSION_ID)

    expect(sendMock).toHaveBeenLastCalledWith(TEST_SESSION_ID, {
      type: 'stop_generation',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]).toMatchObject({
      chatState: 'tool_executing',
      stopState: 'requesting',
      activeToolUseId: 'browser-tool-1',
      usageRevision: 3,
    })

    useChatStore.getState().stopGeneration(TEST_SESSION_ID)
    expect(sendMock).toHaveBeenCalledTimes(1)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'generation_stop_requested',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.stopState).toBe('stopping')

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'generation_stopped',
      forced: true,
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]).toMatchObject({
      chatState: 'idle',
      stopState: 'idle',
      streamingText: '',
      streamingToolInput: '',
      activeToolUseId: null,
      activeToolName: null,
      elapsedTimer: null,
      usageRevision: 4,
      messages: [
        {
          type: 'assistant_text',
          content: '已完成一部分',
        },
      ],
    })
  })

  it('keeps local image previews on the user message shown in the transcript', () => {
    useChatStore.getState().sendMessage(TEST_SESSION_ID, '看下这张图', [
      {
        type: 'image',
        name: 'mockup.png',
        path: '/Users/wang/Pictures/mockup.png',
        previewUrl: 'asset://localhost/%2FUsers%2Fwang%2FPictures%2Fmockup.png',
        mimeType: 'image/png',
      },
    ])

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'user_text',
        content: '看下这张图',
        attachments: [
          {
            type: 'image',
            name: 'mockup.png',
            path: '/Users/wang/Pictures/mockup.png',
            previewUrl: 'asset://localhost/%2FUsers%2Fwang%2FPictures%2Fmockup.png',
            mimeType: 'image/png',
          },
        ],
      },
    ])

    const payload = sendMock.mock.calls[sendMock.mock.calls.length - 1]?.[1]
    expect(payload.attachments?.[0]).toMatchObject({
      type: 'image',
      name: 'mockup.png',
      path: '/Users/wang/Pictures/mockup.png',
      mimeType: 'image/png',
    })
    expect(payload.attachments?.[0]).not.toHaveProperty('previewUrl')
  })

  it('keeps title updates tied to the first local user message', () => {
    tabStoreSnapshot.tabs = [{
      sessionId: TEST_SESSION_ID,
      title: 'AI reply first sentence',
      type: 'session',
      status: 'idle',
    }]
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          messages: [
            {
              id: 'user-1',
              type: 'user_text',
              content: '用户发的第一句话',
              timestamp: 1,
            },
            {
              id: 'assistant-1',
              type: 'assistant_text',
              content: 'AI reply first sentence',
              timestamp: 2,
            },
          ],
        }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'session_title_updated',
      sessionId: TEST_SESSION_ID,
      title: 'AI reply first sentence',
    })

    expect(updateSessionTitleMock).toHaveBeenCalledWith(TEST_SESSION_ID, '用户发的第一句话')
    expect(updateTabTitleMock).toHaveBeenCalledWith(TEST_SESSION_ID, '用户发的第一句话')
  })

  it('keeps parent tool linkage for live tool events', () => {
    // Initialize the session first
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          historyLoadState: 'loaded' as const,
          allMessagesLoaded: true,
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
          slashCommands: [{ name: 'old-command', description: 'Old command' }],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_use_complete',
      toolName: 'Read',
      toolUseId: 'tool-1',
      input: { file_path: 'src/App.tsx' },
      parentToolUseId: 'agent-1',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_result',
      toolUseId: 'tool-1',
      content: 'ok',
      isError: false,
      parentToolUseId: 'agent-1',
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'tool_use',
        toolUseId: 'tool-1',
        parentToolUseId: 'agent-1',
      },
      {
        type: 'tool_result',
        toolUseId: 'tool-1',
        parentToolUseId: 'agent-1',
      },
    ])
  })

  it('keeps a parallel tool batch active until every result arrives', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          chatState: 'tool_executing',
          messages: [
            {
              id: 'user-1',
              type: 'user_text',
              content: 'github 上今天的趋势榜',
              timestamp: Date.now(),
            },
          ],
        }),
      },
    })

    for (const toolUseId of ['fetch-1', 'fetch-2']) {
      useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
        type: 'tool_use_complete',
        toolName: 'WebFetch',
        toolUseId,
        input: { url: `https://example.com/${toolUseId}` },
      })
    }

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_result',
      toolUseId: 'fetch-1',
      content: 'first result',
      isError: false,
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe(
      'tool_executing',
    )

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_result',
      toolUseId: 'fetch-2',
      content: 'second result',
      isError: false,
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe(
      'thinking',
    )
  })

  it('replays saved runtime selection when reconnecting a session', () => {
    useSessionRuntimeStore.getState().setSelection(TEST_SESSION_ID, {
      providerId: 'provider-1',
      modelId: 'kimi-k2.6',
    })

    useChatStore.getState().connectToSession(TEST_SESSION_ID)

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'set_runtime_config',
      providerId: 'provider-1',
      modelId: 'kimi-k2.6',
    })
    expect(sendMock.mock.calls).toEqual([
      [
        TEST_SESSION_ID,
        {
          type: 'set_runtime_config',
          providerId: 'provider-1',
          modelId: 'kimi-k2.6',
        },
      ],
    ])
  })

  it('replays a saved smart route without inventing a provider id', () => {
    useSessionRuntimeStore.getState().setSelection(TEST_SESSION_ID, {
      kind: 'route',
      providerId: null,
      routeId: 'coding-first',
      modelId: 'cybercode-route-coding-first',
    })

    useChatStore.getState().connectToSession(TEST_SESSION_ID)

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'set_runtime_config',
      kind: 'route',
      providerId: null,
      routeId: 'coding-first',
      modelId: 'cybercode-route-coding-first',
    })
  })

  it('does not start a CLI process merely to browse a session', () => {
    useChatStore.getState().connectToSession(TEST_SESSION_ID)

    expect(sendMock).not.toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'prewarm_session',
    })
  })

  it('prewarms a regular desktop session after explicit composer intent', () => {
    useChatStore.getState().prewarmSession(TEST_SESSION_ID)

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'prewarm_session',
    })
  })

  it('queues pending steering input and sends it with the selected priority', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({ chatState: 'streaming' }),
      },
    })

    const steerId = useChatStore.getState().queuePendingSteer(TEST_SESSION_ID, '补充一下这个约束', [
      { type: 'file', name: 'notes.txt', path: '/tmp/notes.txt' },
    ])

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingSteers).toMatchObject([
      {
        id: steerId,
        content: '补充一下这个约束',
        status: 'draft',
      },
    ])

    useChatStore.getState().sendPendingSteers(TEST_SESSION_ID, 'now')

    const payload = sendMock.mock.calls[sendMock.mock.calls.length - 1]?.[1]
    expect(payload).toMatchObject({
      type: 'user_steer',
      steerId,
      content: '补充一下这个约束',
      priority: 'now',
    })
    expect(payload.attachments).toMatchObject([
      { type: 'file', name: 'notes.txt', path: '/tmp/notes.txt' },
    ])
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingSteers).toMatchObject([
      {
        id: steerId,
        status: 'queued',
        priority: 'now',
        published: true,
      },
    ])
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toContainEqual(
      expect.objectContaining({
        id: `steer:${steerId}`,
        type: 'user_text',
        content: '补充一下这个约束',
        serverId: steerId,
      }),
    )

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'steer_status',
      steerId,
      status: 'failed',
      message: 'Queue rejected',
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingSteers).toMatchObject([
      {
        id: steerId,
        status: 'failed',
        published: false,
        error: 'Queue rejected',
      },
    ])
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).not.toContainEqual(
      expect.objectContaining({ serverId: steerId }),
    )

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'steer_status',
      steerId,
      status: 'processed',
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingSteers).toEqual([])
  })

  it('cancels a queued steering input through the websocket', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({ chatState: 'streaming' }),
      },
    })

    const steerId = useChatStore.getState().queuePendingSteer(TEST_SESSION_ID, '下一轮再说')
    useChatStore.getState().sendPendingSteers(TEST_SESSION_ID, 'later')
    sendMock.mockClear()

    useChatStore.getState().cancelPendingSteer(TEST_SESSION_ID, steerId)

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'cancel_steer',
      steerId,
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingSteers).toEqual([])
  })

  it('sends only the selected pending steering input when steer ids are provided', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({ chatState: 'streaming' }),
      },
    })

    const firstId = useChatStore.getState().queuePendingSteer(TEST_SESSION_ID, '第一条补充')
    const secondId = useChatStore.getState().queuePendingSteer(TEST_SESSION_ID, '第二条补充')
    sendMock.mockClear()

    useChatStore.getState().sendPendingSteers(TEST_SESSION_ID, 'now', [secondId])

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'user_steer',
      steerId: secondId,
      content: '第二条补充',
      attachments: undefined,
      priority: 'now',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingSteers).toMatchObject([
      {
        id: firstId,
        status: 'draft',
      },
      {
        id: secondId,
        status: 'queued',
        priority: 'now',
        published: true,
      },
    ])
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        id: `steer:${secondId}`,
        type: 'user_text',
        content: '第二条补充',
      },
    ])
  })

  it('keeps an immediate steer visible when the interrupted turn completes first', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          chatState: 'streaming',
          pendingSteers: [{
            id: 'steer-now',
            content: 'Apply this immediately',
            createdAt: 1,
            status: 'queued',
            priority: 'now',
          }, {
            id: 'steer-after',
            content: 'Apply this after the steer',
            createdAt: 2,
            status: 'draft',
          }],
        }),
      },
    })
    sendMock.mockClear()

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingSteers).toMatchObject([
      { id: 'steer-now', status: 'queued', priority: 'now' },
      { id: 'steer-after', status: 'draft' },
    ])
    expect(sendMock).not.toHaveBeenCalled()

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'steer_status',
      steerId: 'steer-now',
      status: 'processing',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingSteers).toMatchObject([
      { id: 'steer-now', status: 'processing' },
      { id: 'steer-after', status: 'draft' },
    ])

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'steer_status',
      steerId: 'steer-now',
      status: 'processed',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingSteers).toMatchObject([
      { id: 'steer-after', status: 'draft' },
    ])

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 2, output_tokens: 2 },
    })
    expect(sendMock).toHaveBeenLastCalledWith(TEST_SESSION_ID, {
      type: 'user_message',
      content: 'Apply this after the steer',
      attachments: undefined,
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingSteers).toEqual([])
  })

  it('publishes an immediate steer on click and keeps later confirmations idempotent', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          chatState: 'streaming',
          streamingText: 'The answer before the new requirement.',
        }),
      },
    })

    const steerId = useChatStore.getState().queuePendingSteer(
      TEST_SESSION_ID,
      'Also verify the image pipeline',
      [{
        type: 'image',
        name: 'pipeline.png',
        data: 'data:image/png;base64,AAAA',
        mimeType: 'image/png',
      }],
    )
    useChatStore.getState().sendPendingSteers(TEST_SESSION_ID, 'now', [steerId])

    const clickedSession = useChatStore.getState().sessions[TEST_SESSION_ID]!
    expect(clickedSession.streamingText).toBe('')
    expect(clickedSession.messages).toMatchObject([
      {
        type: 'assistant_text',
        content: 'The answer before the new requirement.',
      },
      {
        id: `steer:${steerId}`,
        type: 'user_text',
        content: 'Also verify the image pipeline',
        serverId: steerId,
      },
    ])
    expect(clickedSession.pendingSteers).toMatchObject([
      { id: steerId, status: 'queued', priority: 'now', published: true },
    ])

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'steer_status',
      steerId,
      status: 'queued',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'steer_status',
      steerId,
      status: 'processing',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'steer_status',
      steerId,
      status: 'processing',
    })

    const processingSession = useChatStore.getState().sessions[TEST_SESSION_ID]!
    expect(processingSession.streamingText).toBe('')
    expect(processingSession.messages).toMatchObject([
      {
        type: 'assistant_text',
        content: 'The answer before the new requirement.',
      },
      {
        id: `steer:${steerId}`,
        type: 'user_text',
        content: 'Also verify the image pipeline',
        serverId: steerId,
        attachments: [{
          type: 'image',
          name: 'pipeline.png',
          data: 'data:image/png;base64,AAAA',
          mimeType: 'image/png',
        }],
      },
    ])
    expect(processingSession.messages.filter((message) =>
      message.type === 'user_text' && message.serverId === steerId
    )).toHaveLength(1)
    expect(processingSession.pendingSteers).toMatchObject([
      { id: steerId, status: 'processing', priority: 'now', published: true },
    ])

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'steer_status',
      steerId,
      status: 'processed',
    })

    const completedSession = useChatStore.getState().sessions[TEST_SESSION_ID]!
    expect(completedSession.pendingSteers).toEqual([])
    expect(completedSession.messages.filter((message) =>
      message.type === 'user_text' && message.serverId === steerId
    )).toHaveLength(1)
  })

  it('publishes a processed steer when the processing event was missed', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          chatState: 'streaming',
          streamingText: 'Answer produced after the accepted input.',
          pendingSteers: [{
            id: 'steer-from-older-client',
            content: 'Keep this visible in history',
            createdAt: 1,
            status: 'queued',
            priority: 'now',
          }],
        }),
      },
    })

    const steerId = 'steer-from-older-client'
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'steer_status',
      steerId,
      status: 'processed',
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]!
    expect(session.pendingSteers).toEqual([])
    expect(session.streamingText).toBe('Answer produced after the accepted input.')
    expect(session.messages).toContainEqual(expect.objectContaining({
      id: `steer:${steerId}`,
      type: 'user_text',
      content: 'Keep this visible in history',
      serverId: steerId,
    }))

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        id: `steer:${steerId}`,
        type: 'user_text',
        content: 'Keep this visible in history',
      },
      {
        type: 'assistant_text',
        content: 'Answer produced after the accepted input.',
      },
    ])
  })

  it('moves draft steering input back into the composer for editing', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({ chatState: 'streaming' }),
      },
    })

    const steerId = useChatStore.getState().queuePendingSteer(TEST_SESSION_ID, '先改一下这个补充', [
      { type: 'file', name: 'notes.txt', path: '/tmp/notes.txt' },
    ])

    useChatStore.getState().editPendingSteer(TEST_SESSION_ID, steerId)

    expect(sendMock).not.toHaveBeenCalled()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingSteers).toEqual([])
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.composerPrefill).toMatchObject({
      text: '先改一下这个补充',
      attachments: [
        { type: 'file', name: 'notes.txt', path: '/tmp/notes.txt' },
      ],
    })
  })

  it('reorders actionable steering inputs without moving an input already in progress', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          chatState: 'streaming',
          pendingSteers: [
            {
              id: 'steer-1',
              content: '第一条补充',
              createdAt: 1,
              status: 'draft',
            },
            {
              id: 'steer-running',
              content: '正在处理的补充',
              createdAt: 2,
              status: 'processing',
            },
            {
              id: 'steer-2',
              content: '第二条补充',
              createdAt: 3,
              status: 'draft',
            },
          ],
        }),
      },
    })

    useChatStore.getState().reorderPendingSteer(TEST_SESSION_ID, 'steer-2', 'steer-1')

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingSteers?.map((steer) => steer.id)).toEqual([
      'steer-2',
      'steer-running',
      'steer-1',
    ])
  })

  it('auto-sends draft steering input in the user-defined order after message completion', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          chatState: 'streaming',
          streamingText: '当前回复完成。',
          pendingSteers: [
            {
              id: 'steer-1',
              content: '第一条补充',
              createdAt: 1,
              status: 'draft',
            },
            {
              id: 'steer-2',
              content: '第二条补充',
              attachments: [
                { type: 'file', name: 'notes.txt', path: '/tmp/notes.txt' },
              ],
              createdAt: 2,
              status: 'draft',
            },
            {
              id: 'steer-failed',
              content: '失败项需要人工处理',
              createdAt: 3,
              status: 'failed',
              error: 'Queue rejected',
            },
          ],
        }),
      },
    })

    useChatStore.getState().reorderPendingSteer(TEST_SESSION_ID, 'steer-2', 'steer-1')
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 10, output_tokens: 20 },
    })

    expect(sendMock).toHaveBeenLastCalledWith(TEST_SESSION_ID, {
      type: 'user_message',
      content: '第二条补充\n\n第一条补充',
      attachments: [
        { type: 'file', name: 'notes.txt', path: '/tmp/notes.txt', data: undefined, mimeType: undefined },
      ],
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      { type: 'assistant_text', content: '当前回复完成。' },
      {
        type: 'user_text',
        content: '第二条补充\n\n第一条补充',
        attachments: [
          { type: 'file', name: 'notes.txt', path: '/tmp/notes.txt' },
        ],
      },
    ])
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingSteers).toMatchObject([
      {
        id: 'steer-failed',
        status: 'failed',
        error: 'Queue rejected',
      },
    ])
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('thinking')

    const timer = useChatStore.getState().sessions[TEST_SESSION_ID]?.elapsedTimer
    if (timer) clearInterval(timer)
  })

  it('passes the projectPath locator when loading history', async () => {
    vi.mocked(sessionsApi.getMessages).mockResolvedValueOnce({
      hasMore: false,
      messages: [
        {
          id: 'user-1',
          type: 'user',
          timestamp: '2026-01-01T00:00:00.000Z',
          content: 'hello from project a',
        },
      ],
    })

    useChatStore.getState().connectToSession(TEST_SESSION_ID, '-project-a')
    await useChatStore.getState().loadHistory(TEST_SESSION_ID, '-project-a')

    expect(sessionsApi.getMessages).toHaveBeenCalledWith(TEST_SESSION_ID, {
      limit: 80,
      projectPath: '-project-a',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.projectPath).toBe('-project-a')
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      { type: 'user_text', content: 'hello from project a' },
    ])
  })

  it('reuses a prefetched local history page when opening a session', async () => {
    const sessionId = 'prefetched-session'
    const getMessagesMock = vi.mocked(sessionsApi.getMessages)
    getMessagesMock.mockReset()
    getMessagesMock.mockResolvedValueOnce({
      hasMore: false,
      messages: [
        {
          id: 'prefetched-user',
          type: 'user',
          timestamp: '2026-01-01T00:00:00.000Z',
          content: 'ready before click',
        },
      ],
    })

    await useChatStore.getState().prefetchHistory(sessionId, '-project-prefetch')
    useChatStore.getState().connectToSession(sessionId, '-project-prefetch')
    await useChatStore.getState().loadHistory(sessionId, '-project-prefetch')

    expect(getMessagesMock).toHaveBeenCalledOnce()
    expect(useChatStore.getState().sessions[sessionId]?.messages).toMatchObject([
      { type: 'user_text', content: 'ready before click' },
    ])
    useChatStore.getState().disconnectSession(sessionId)
  })

  it('keeps recent history warm when older background sessions fill the cache', async () => {
    const recentSessionId = 'protected-recent-session'
    const backgroundIds = Array.from({ length: 96 }, (_, index) => `background-cache-${index}`)
    const getMessagesMock = vi.mocked(sessionsApi.getMessages)
    getMessagesMock.mockReset()
    getMessagesMock.mockImplementation(async (sessionId) => ({
      hasMore: false,
      messages: [{
        id: `${sessionId}-user`,
        type: 'user',
        timestamp: '2026-01-01T00:00:00.000Z',
        content: `history for ${sessionId}`,
      }],
    }))

    await useChatStore.getState().prefetchHistory(recentSessionId, '-recent-project', {
      priority: 'recent',
    })
    for (const sessionId of backgroundIds) {
      await useChatStore.getState().prefetchHistory(sessionId, '-background-project', {
        priority: 'background',
      })
    }
    const callsBeforeOpen = getMessagesMock.mock.calls.length

    useChatStore.getState().connectToSession(recentSessionId, '-recent-project')
    await useChatStore.getState().loadHistory(recentSessionId, '-recent-project')

    expect(getMessagesMock).toHaveBeenCalledTimes(callsBeforeOpen)
    expect(useChatStore.getState().sessions[recentSessionId]?.messages).toMatchObject([
      { type: 'user_text', content: `history for ${recentSessionId}` },
    ])

    useChatStore.getState().disconnectSession(recentSessionId)
    for (const sessionId of backgroundIds) {
      useChatStore.getState().disconnectSession(sessionId)
    }
  })

  it('does not let a stalled background prefetch block a foreground history load', async () => {
    vi.useFakeTimers()
    const sessionId = 'prefetch-priority-session'
    const getMessagesMock = vi.mocked(sessionsApi.getMessages)
    type MessagesResponse = Awaited<ReturnType<typeof sessionsApi.getMessages>>
    let resolvePrefetch!: (value: MessagesResponse) => void

    try {
      getMessagesMock.mockReset()
      getMessagesMock
        .mockImplementationOnce(() => new Promise((resolve) => { resolvePrefetch = resolve }))
        .mockResolvedValueOnce({
          hasMore: false,
          messages: [{
            id: 'foreground-user',
            type: 'user',
            timestamp: '2026-01-01T00:00:00.000Z',
            content: 'foreground wins',
          }],
        })

      const prefetch = useChatStore.getState().prefetchHistory(sessionId, '-project-priority')
      await Promise.resolve()
      useChatStore.getState().connectToSession(sessionId, '-project-priority', { deferSocket: true })
      const foregroundLoad = useChatStore.getState().loadHistory(sessionId, '-project-priority')

      await vi.advanceTimersByTimeAsync(100)
      await foregroundLoad

      expect(getMessagesMock).toHaveBeenCalledTimes(2)
      expect(getMessagesMock).toHaveBeenNthCalledWith(1, sessionId, {
        limit: 80,
        projectPath: '-project-priority',
      }, { timeout: 4_000, recoverConnection: false })
      expect(getMessagesMock).toHaveBeenNthCalledWith(2, sessionId, {
        limit: 80,
        projectPath: '-project-priority',
      })
      expect(useChatStore.getState().sessions[sessionId]?.messages).toMatchObject([
        { type: 'user_text', content: 'foreground wins' },
      ])

      resolvePrefetch({ hasMore: false, messages: [] })
      await prefetch
      useChatStore.getState().disconnectSession(sessionId)
    } finally {
      vi.useRealTimers()
    }
  })

  it('loads uncached history before opening a socket and suspends only idle old sessions', async () => {
    const sessionId = 'socket-priority-session'
    const getMessagesMock = vi.mocked(sessionsApi.getMessages)
    type MessagesResponse = Awaited<ReturnType<typeof sessionsApi.getMessages>>
    let resolveHistory!: (value: MessagesResponse) => void
    getMessagesMock.mockReset()
    getMessagesMock.mockImplementationOnce(() => new Promise((resolve) => { resolveHistory = resolve }))

    useChatStore.setState({
      sessions: {
        'old-idle-session': makeSessionState({ connectionState: 'connected', chatState: 'idle' }),
        'old-running-session': makeSessionState({ connectionState: 'connected', chatState: 'thinking' }),
      },
    })

    const ready = useChatStore.getState().ensureSessionReady(sessionId, '-project-socket-priority')
    const duplicateReady = useChatStore.getState().ensureSessionReady(sessionId, '-project-socket-priority')
    await Promise.resolve()

    expect(getMessagesMock).toHaveBeenCalledOnce()
    expect(wsManager.disconnect).toHaveBeenCalledWith('old-idle-session')
    expect(wsManager.disconnect).not.toHaveBeenCalledWith('old-running-session')
    expect(wsManager.connect).not.toHaveBeenCalledWith(sessionId)
    expect(useChatStore.getState().sessions['old-idle-session']?.connectionState).toBe('disconnected')
    expect(useChatStore.getState().sessions['old-running-session']?.connectionState).toBe('connected')

    resolveHistory({ hasMore: false, messages: [] })
    await Promise.all([ready, duplicateReady])

    expect(wsManager.connect).toHaveBeenCalledWith(sessionId)
    expect(useChatStore.getState().sessions[sessionId]?.historyLoadState).toBe('loaded')
    useChatStore.getState().disconnectSession(sessionId)
  })

  it('does not reconnect a late history request after the user switches away', async () => {
    const getMessagesMock = vi.mocked(sessionsApi.getMessages)
    type MessagesResponse = Awaited<ReturnType<typeof sessionsApi.getMessages>>
    let resolveFirst!: (value: MessagesResponse) => void
    let resolveSecond!: (value: MessagesResponse) => void
    getMessagesMock.mockReset()
    getMessagesMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))

    const firstReady = useChatStore.getState().ensureSessionReady('late-session-a', '-project-a')
    await Promise.resolve()
    const secondReady = useChatStore.getState().ensureSessionReady('active-session-b', '-project-b')
    await Promise.resolve()

    resolveSecond({ hasMore: false, messages: [] })
    await secondReady
    expect(wsManager.connect).toHaveBeenCalledWith('active-session-b')

    resolveFirst({ hasMore: false, messages: [] })
    await firstReady
    expect(wsManager.connect).not.toHaveBeenCalledWith('late-session-a')

    useChatStore.getState().disconnectSession('late-session-a')
    useChatStore.getState().disconnectSession('active-session-b')
  })

  it('falls back to UUID lookup when a restored project locator is stale', async () => {
    const sessionId = 'stale-locator-session'
    const getMessagesMock = vi.mocked(sessionsApi.getMessages)
    getMessagesMock.mockReset()
    getMessagesMock
      .mockRejectedValueOnce(new ApiError(404, {
        error: 'NOT_FOUND',
        message: 'Session not found in project',
      }))
      .mockResolvedValueOnce({
        hasMore: false,
        messages: [
          {
            id: 'recovered-user',
            type: 'user',
            timestamp: '2026-01-01T00:00:00.000Z',
            content: 'recovered transcript',
          },
        ],
      })

    useChatStore.getState().connectToSession(sessionId, '-stale-project')
    await useChatStore.getState().loadHistory(sessionId, '-stale-project')

    expect(getMessagesMock).toHaveBeenNthCalledWith(1, sessionId, {
      limit: 80,
      projectPath: '-stale-project',
    })
    expect(getMessagesMock).toHaveBeenNthCalledWith(2, sessionId, {
      limit: 80,
      projectPath: undefined,
    })
    expect(useChatStore.getState().sessions[sessionId]?.messages).toMatchObject([
      { type: 'user_text', content: 'recovered transcript' },
    ])
  })

  it('does not refetch an empty session history after it has loaded successfully', async () => {
    const getMessagesMock = vi.mocked(sessionsApi.getMessages)
    getMessagesMock.mockReset()
    getMessagesMock
      .mockResolvedValueOnce({ hasMore: false, messages: [] })
      .mockRejectedValueOnce(new Error('should not refetch empty history'))

    useChatStore.getState().connectToSession(TEST_SESSION_ID, '-project-empty')
    await useChatStore.getState().loadHistory(TEST_SESSION_ID, '-project-empty')
    await useChatStore.getState().loadHistory(TEST_SESSION_ID, '-project-empty')

    expect(getMessagesMock).toHaveBeenCalledOnce()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.historyLoadState).toBe('loaded')
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toEqual([])
  })

  it('treats a missing empty transcript as a loaded empty history', async () => {
    const getMessagesMock = vi.mocked(sessionsApi.getMessages)
    getMessagesMock.mockReset()
    getMessagesMock.mockRejectedValueOnce(new ApiError(404, {
      error: 'NOT_FOUND',
      message: 'Session not found',
    }))

    useChatStore.getState().connectToSession(TEST_SESSION_ID)
    await useChatStore.getState().loadHistory(TEST_SESSION_ID)

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(getMessagesMock).toHaveBeenCalledOnce()
    expect(session?.historyLoadState).toBe('loaded')
    expect(session?.allMessagesLoaded).toBe(true)
    expect(session?.messages).toEqual([])
  })

  it('ignores a stale history response after the session project locator changes', async () => {
    type MessagesResponse = Awaited<ReturnType<typeof sessionsApi.getMessages>>
    const getMessagesMock = vi.mocked(sessionsApi.getMessages)
    let resolveProjectA!: (value: MessagesResponse) => void
    let resolveProjectB!: (value: MessagesResponse) => void
    getMessagesMock.mockReset()
    getMessagesMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveProjectA = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveProjectB = resolve }))

    useChatStore.getState().connectToSession(TEST_SESSION_ID, '-project-a')
    const firstLoad = useChatStore.getState().loadHistory(TEST_SESSION_ID, '-project-a')
    await Promise.resolve()

    useChatStore.getState().connectToSession(TEST_SESSION_ID, '-project-b')
    const secondLoad = useChatStore.getState().loadHistory(TEST_SESSION_ID, '-project-b')
    await Promise.resolve()

    resolveProjectA({
      hasMore: false,
      messages: [
        {
          id: 'project-a-user',
          type: 'user',
          timestamp: '2026-01-01T00:00:00.000Z',
          content: 'old project history',
        },
      ],
    })
    await firstLoad

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.projectPath).toBe('-project-b')
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toEqual([])

    resolveProjectB({
      hasMore: false,
      messages: [
        {
          id: 'project-b-user',
          type: 'user',
          timestamp: '2026-01-01T00:00:01.000Z',
          content: 'current project history',
        },
      ],
    })
    await secondLoad

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      { type: 'user_text', content: 'current project history' },
    ])
  })

  it('does not prewarm team member sessions', () => {
    getMemberBySessionIdMock.mockReturnValue({
      agentId: 'reviewer@test-team',
      role: 'reviewer',
      status: 'running',
    })

    useChatStore.getState().prewarmSession(TEST_SESSION_ID)

    expect(sendMock).not.toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'prewarm_session',
    })
  })

  it('does not prewarm synthetic app tabs', () => {
    useChatStore.getState().prewarmSession('__settings__')

    expect(sendMock).not.toHaveBeenCalledWith('__settings__', {
      type: 'prewarm_session',
    })
  })

  it('sends explicit runtime overrides over websocket', () => {
    useChatStore.getState().setSessionRuntime(TEST_SESSION_ID, {
      providerId: null,
      modelId: 'claude-opus-4-7',
    })

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'set_runtime_config',
      providerId: null,
      modelId: 'claude-opus-4-7',
    })
  })

  it('keeps AskUserQuestion permission requests out of the message list while tracking the pending request', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [
            {
              id: 'ask-1',
              type: 'tool_use',
              toolName: 'AskUserQuestion',
              toolUseId: 'tool-ask-1',
              input: {
                questions: [
                  {
                    question: 'Should we persist data?',
                    options: [{ label: 'No' }, { label: 'Yes' }],
                  },
                ],
              },
              timestamp: 1,
            },
          ],
          historyBuffer: [],
          recentBuffer: [],
          historyLoadState: 'loaded' as const,
          allMessagesLoaded: true,
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

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'permission_request',
      requestId: 'perm-ask-1',
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-ask-1',
      input: {
        questions: [
          {
            question: 'Should we persist data?',
            options: [{ label: 'No' }, { label: 'Yes' }],
          },
        ],
      },
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.pendingPermission).toMatchObject({
      requestId: 'perm-ask-1',
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-ask-1',
    })
    expect(session?.messages).toHaveLength(1)
    expect(session?.messages[0]).toMatchObject({
      type: 'tool_use',
      toolUseId: 'tool-ask-1',
    })
  })

  it('sends permission mode updates to the active session only', () => {
    useChatStore.getState().setSessionPermissionMode('nonexistent-session', 'acceptEdits')
    expect(sendMock).not.toHaveBeenCalled()

    useChatStore.setState({
      sessions: {
        'session-1': {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          historyLoadState: 'loaded' as const,
          allMessagesLoaded: true,
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
    useChatStore.getState().setSessionPermissionMode('session-1', 'acceptEdits')

    expect(sendMock).toHaveBeenCalledWith('session-1', {
      type: 'set_permission_mode',
      mode: 'acceptEdits',
    })
  })

  it('stores terminal task notifications for agent tool cards', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          historyLoadState: 'loaded' as const,
          allMessagesLoaded: true,
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

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'task_notification',
      data: {
        task_id: 'agent-task-1',
        tool_use_id: 'agent-tool-1',
        status: 'completed',
        summary: 'Agent "修复异常处理" completed',
        output_file: '/tmp/agent-output.txt',
      },
    })

    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.agentTaskNotifications[
        'agent-tool-1'
      ],
    ).toMatchObject({
      taskId: 'agent-task-1',
      toolUseId: 'agent-tool-1',
      status: 'completed',
      summary: 'Agent "修复异常处理" completed',
      outputFile: '/tmp/agent-output.txt',
    })
  })

  it('clears local desktop chat state when the server confirms /clear', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [
            { id: 'u1', type: 'user_text', content: '/clear', timestamp: Date.now() },
            { id: 'a1', type: 'assistant_text', content: 'old context', timestamp: Date.now() },
          ],
          historyBuffer: [],
          recentBuffer: [],
          historyLoadState: 'loaded' as const,
          allMessagesLoaded: true,
          chatState: 'thinking',
          connectionState: 'connected',
          streamingText: 'pending',
          streamingToolInput: 'tool',
          activeToolUseId: 'tool-1',
          activeToolName: 'Read',
          activeThinkingId: 'thinking-1',
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 12, output_tokens: 34 },
          elapsedSeconds: 5,
          statusVerb: 'Thinking',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'session_cleared',
      message: 'Conversation cleared',
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.messages).toEqual([])
    expect(session?.streamingText).toBe('')
    expect(session?.chatState).toBe('idle')
    expect(session?.tokenUsage).toEqual({ input_tokens: 0, output_tokens: 0 })
    expect(session?.slashCommands).toEqual([])
    expect(clearTasksMock).toHaveBeenCalled()
  })

  it('renders compact boundary notifications as system messages', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          historyLoadState: 'loaded' as const,
          allMessagesLoaded: true,
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

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'compact_boundary',
      message: 'Context compacted',
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      { type: 'system', content: 'Context compacted' },
    ])
  })

  it('renders prompt memory update notifications as lightweight system messages', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState(),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'prompt_memory_updated',
      message: '提示记忆已更新：USER，将在新会话生效。',
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      { type: 'system', content: '提示记忆已更新：USER，将在新会话生效。' },
    ])
  })

  it('flushes the previous assistant draft before starting a new user turn', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          historyLoadState: 'loaded' as const,
          allMessagesLoaded: true,
          chatState: 'streaming',
          connectionState: 'connected',
          streamingText: '上一次分析结果 **还在流式区域**',
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

    useChatStore.getState().sendMessage(TEST_SESSION_ID, '你是什么模型？')

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'assistant_text',
        content: '上一次分析结果 **还在流式区域**',
      },
      {
        type: 'user_text',
        content: '你是什么模型？',
      },
    ])
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.streamingText).toBe('')
  })

  it('resets completed CLI tasks before continuing the next user turn', () => {
    cliTaskStoreSnapshot.sessionId = TEST_SESSION_ID
    cliTaskStoreSnapshot.tasks = [
      { id: '1', subject: 'Existing completed task', status: 'completed' },
      { id: '2', subject: 'Another completed task', status: 'completed' },
    ]

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          historyLoadState: 'loaded' as const,
          allMessagesLoaded: true,
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

    useChatStore.getState().sendMessage(TEST_SESSION_ID, '继续下一轮')

    expect(resetCompletedTasksMock).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'task_summary',
        tasks: [
          { id: '1', subject: 'Existing completed task', status: 'completed' },
          { id: '2', subject: 'Another completed task', status: 'completed' },
        ],
      },
      {
        type: 'user_text',
        content: '继续下一轮',
      },
    ])
  })

  it('tracks Computer Use approval requests separately from generic tool permissions', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          historyLoadState: 'loaded' as const,
          allMessagesLoaded: true,
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

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'computer_use_permission_request',
      requestId: 'cu-1',
      request: {
        requestId: 'cu-1',
        reason: 'Open Finder and inspect a file',
        apps: [
          {
            requestedName: 'Finder',
            resolved: {
              bundleId: 'com.apple.finder',
              displayName: 'Finder',
            },
            isSentinel: false,
            alreadyGranted: false,
            proposedTier: 'full',
          },
        ],
        requestedFlags: { clipboardRead: true },
        screenshotFiltering: 'native',
      },
    })

    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingComputerUsePermission,
    ).toMatchObject({
      requestId: 'cu-1',
      request: {
        reason: 'Open Finder and inspect a file',
      },
    })
    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState,
    ).toBe('permission_pending')
  })

  it('tracks quiet turns without treating websocket pongs as model activity', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-19T00:00:00.000Z'))

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState(),
      },
    })

    useChatStore.getState().sendMessage(TEST_SESSION_ID, 'hello')

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.turnStartedAt).toBe(Date.now())
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.lastConnectionActivityAt).toBe(Date.now())
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.lastModelActivityAt).toBeNull()

    vi.setSystemTime(new Date('2026-06-19T00:00:30.000Z'))
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, { type: 'pong' })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.lastConnectionActivityAt).toBe(Date.now())
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.lastModelActivityAt).toBeNull()

    const timer = useChatStore.getState().sessions[TEST_SESSION_ID]?.elapsedTimer
    if (timer) clearInterval(timer)
    vi.useRealTimers()
  })

  it('records real model activity when thinking content arrives', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-19T00:00:10.000Z'))

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          chatState: 'thinking',
          turnStartedAt: Date.now() - 10_000,
          lastConnectionActivityAt: Date.now() - 10_000,
        }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'thinking',
      text: 'Inspecting the current workspace',
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.lastConnectionActivityAt).toBe(Date.now())
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.lastModelActivityAt).toBe(Date.now())

    vi.setSystemTime(new Date('2026-06-19T00:00:40.000Z'))
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, { type: 'pong' })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.lastConnectionActivityAt).toBe(Date.now())
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.lastModelActivityAt).toBe(
      new Date('2026-06-19T00:00:10.000Z').getTime(),
    )

    vi.useRealTimers()
  })

  it('keeps a completed reply in the visual handoff until its reveal catches up', () => {
    vi.useFakeTimers()
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          chatState: 'streaming',
          streamingText: '从第一个字开始顺序显示。',
        }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 4, output_tokens: 8 },
    })

    const completed = useChatStore.getState().sessions[TEST_SESSION_ID]
    const message = completed?.messages[0]
    expect(message).toMatchObject({
      type: 'assistant_text',
      content: '从第一个字开始顺序显示。',
    })
    expect(completed?.streamingText).toBe('')
    expect(completed?.settlingAssistant).toEqual({
      messageId: message?.id,
      content: '从第一个字开始顺序显示。',
    })

    useChatStore.getState().completeStreamingReveal(
      TEST_SESSION_ID,
      completed!.settlingAssistant!.messageId,
    )
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.settlingAssistant).toBeNull()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('keeps delayed text blocks from one streamed assistant turn in a single message', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          historyLoadState: 'loaded' as const,
          allMessagesLoaded: true,
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

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'text',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: '第一段：先到达。',
    })
    vi.advanceTimersByTime(60)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'text',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: '\r\n第二段：稍后到达，但仍属于同一轮回复。',
    })
    vi.advanceTimersByTime(60)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'assistant_text',
        content: '第一段：先到达。\r\n第二段：稍后到达，但仍属于同一轮回复。',
      },
    ])

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('does not split one streamed markdown reply when task progress arrives mid-stream', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          historyLoadState: 'loaded' as const,
          allMessagesLoaded: true,
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

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'text',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: '1. **`core/audio/waveform.py:19-31`** — 同步阻塞 I/O。',
    })
    vi.advanceTimersByTime(60)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'tool_executing',
      verb: 'Task in progress',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: ' 建议直接用 `subprocess.PIPE` 流式处理。',
    })
    vi.advanceTimersByTime(60)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'assistant_text',
        content:
          '1. **`core/audio/waveform.py:19-31`** — 同步阻塞 I/O。 建议直接用 `subprocess.PIPE` 流式处理。',
      },
    ])

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('keeps throttled streaming deltas isolated per session', () => {
    vi.useFakeTimers()

    const otherSessionId = 'test-session-2'
    const emptySession = {
      messages: [],
      historyBuffer: [],
      recentBuffer: [],
      historyLoadState: 'loaded' as const,
      allMessagesLoaded: true,
      chatState: 'idle' as const,
      connectionState: 'connected' as const,
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
    }

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: { ...emptySession },
        [otherSessionId]: { ...emptySession },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'text',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: 'session one',
    })
    useChatStore.getState().handleServerMessage(otherSessionId, {
      type: 'content_start',
      blockType: 'text',
    })
    useChatStore.getState().handleServerMessage(otherSessionId, {
      type: 'content_delta',
      text: 'session two',
    })

    vi.advanceTimersByTime(60)

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.streamingText).toBe('session one')
    expect(useChatStore.getState().sessions[otherSessionId]?.streamingText).toBe('session two')

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      { type: 'assistant_text', content: 'session one' },
    ])
    expect(useChatStore.getState().sessions[otherSessionId]?.messages).toEqual([])
    expect(useChatStore.getState().sessions[otherSessionId]?.streamingText).toBe('session two')

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('sends Computer Use approval payloads back over websocket', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          historyLoadState: 'loaded' as const,
          allMessagesLoaded: true,
          chatState: 'permission_pending',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: {
            requestId: 'cu-1',
            request: {
              requestId: 'cu-1',
              reason: 'Open Finder',
              apps: [],
              requestedFlags: {},
              screenshotFiltering: 'native',
            },
          },
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().respondToComputerUsePermission(TEST_SESSION_ID, 'cu-1', {
      granted: [],
      denied: [],
      flags: {
        clipboardRead: true,
        clipboardWrite: false,
        systemKeyCombos: false,
      },
      userConsented: true,
    })

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'computer_use_permission_response',
      requestId: 'cu-1',
      response: {
        granted: [],
        denied: [],
        flags: {
          clipboardRead: true,
          clipboardWrite: false,
          systemKeyCombos: false,
        },
        userConsented: true,
      },
    })
    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingComputerUsePermission,
    ).toBeNull()
    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState,
    ).toBe('tool_executing')
  })

  it('routes member-session messages through team mailbox delivery instead of websocket', async () => {
    const memberSessionId = 'team-member:security-reviewer@test-team'
    getMemberBySessionIdMock.mockReturnValue({
      agentId: 'security-reviewer@test-team',
      role: 'security-reviewer',
      status: 'running',
    })

    useChatStore.setState({
      sessions: {
        [memberSessionId]: {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          historyLoadState: 'loaded' as const,
          allMessagesLoaded: true,
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

    useChatStore.getState().sendMessage(memberSessionId, 'Check the latest regression')
    await Promise.resolve()

    expect(sendMessageToMemberMock).toHaveBeenCalledWith(
      memberSessionId,
      'Check the latest regression',
    )
    expect(sendMock).not.toHaveBeenCalled()
    const sessionMessages = useChatStore.getState().sessions[memberSessionId]?.messages ?? []

    expect(sessionMessages[sessionMessages.length - 1]).toMatchObject({
      type: 'user_text',
      content: 'Check the latest regression',
      pending: true,
    })
  })

  it('refreshes CLI tasks when switching to an already-connected session', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          historyLoadState: 'loaded' as const,
          allMessagesLoaded: true,
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

    useChatStore.getState().connectToSession(TEST_SESSION_ID)

    expect(fetchSessionTasksMock).toHaveBeenCalledWith(TEST_SESSION_ID)
  })
})

describe('completion sound on turn finish', () => {
  const soundPlayMock = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.useFakeTimers()
    soundPlayMock.mockClear()
    tabStoreSnapshot.activeTabId = null
    vi.stubGlobal('Audio', class {
      currentTime = 0
      constructor(public src: string) {}
      play() { return soundPlayMock() }
    })
    useSettingsStore.setState({
      completionSoundEnabled: true,
      completionSoundId: 'ding',
      completionSoundCustomData: null,
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  const completeTurn = () => {
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 1 },
    })
  }

  const settleCompletionSound = () => {
    vi.advanceTimersByTime(1_000)
  }

  it('plays when a working turn finishes', () => {
    useChatStore.setState({
      sessions: { [TEST_SESSION_ID]: makeSessionState({ chatState: 'streaming' }) },
    })
    completeTurn()
    expect(soundPlayMock).not.toHaveBeenCalled()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]).toMatchObject({
      chatState: 'thinking',
      turnCompletionPending: true,
      completionUnread: false,
    })
    settleCompletionSound()
    expect(soundPlayMock).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]).toMatchObject({
      chatState: 'idle',
      turnCompletionPending: false,
      completionUnread: true,
    })
  })

  it('does not mark the currently selected session as unread when it finishes', () => {
    tabStoreSnapshot.activeTabId = TEST_SESSION_ID
    useChatStore.setState({
      sessions: { [TEST_SESSION_ID]: makeSessionState({ chatState: 'streaming' }) },
    })

    completeTurn()
    settleCompletionSound()

    expect(soundPlayMock).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]).toMatchObject({
      chatState: 'idle',
      completionUnread: false,
    })
  })

  it('clears the completion marker when the user sends or queues a new message', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({ completionUnread: true }),
      },
    })

    useChatStore.getState().sendMessage(TEST_SESSION_ID, 'Continue')
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.completionUnread).toBe(false)

    useChatStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        [TEST_SESSION_ID]: {
          ...state.sessions[TEST_SESSION_ID]!,
          completionUnread: true,
        },
      },
    }))
    useChatStore.getState().queuePendingSteer(TEST_SESSION_ID, 'One more requirement')
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.completionUnread).toBe(false)
  })

  it('stays silent while a steer is queued or processing upstream', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          chatState: 'streaming',
          pendingSteers: [{
            id: 'steer-queued',
            content: 'Apply this immediately',
            createdAt: 1,
            status: 'queued',
            priority: 'now',
          }],
        }),
      },
    })
    completeTurn()
    settleCompletionSound()
    expect(soundPlayMock).not.toHaveBeenCalled()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('thinking')
  })

  it('stays silent when a draft steer auto-continues the turn', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          chatState: 'streaming',
          pendingSteers: [{
            id: 'steer-draft',
            content: 'Send this next',
            createdAt: 1,
            status: 'draft',
          }],
        }),
      },
    })
    completeTurn()
    settleCompletionSound()
    expect(soundPlayMock).not.toHaveBeenCalled()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('thinking')
  })

  it('plays when only a failed steer remains for the user to retry', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          chatState: 'streaming',
          pendingSteers: [{
            id: 'steer-failed',
            content: 'Retry me manually',
            createdAt: 1,
            status: 'failed',
          }],
        }),
      },
    })
    completeTurn()
    settleCompletionSound()
    expect(soundPlayMock).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('idle')
  })

  it('waits for every launched background Agent task to reach a terminal state', () => {
    const launchResult =
      'Async agent launched successfully. The agent is working in the background. You will be notified automatically when it completes.'
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          chatState: 'streaming',
          messages: [
            { id: 'user-1', type: 'user_text', content: 'Run both checks', timestamp: 1 },
            { id: 'agent-use-1', type: 'tool_use', toolName: 'Agent', toolUseId: 'agent-1', input: {}, timestamp: 2 },
            { id: 'agent-result-1', type: 'tool_result', toolUseId: 'agent-1', content: launchResult, isError: false, timestamp: 3 },
            { id: 'agent-use-2', type: 'tool_use', toolName: 'Agent', toolUseId: 'agent-2', input: {}, timestamp: 4 },
            { id: 'agent-result-2', type: 'tool_result', toolUseId: 'agent-2', content: launchResult, isError: false, timestamp: 5 },
          ],
        }),
      },
    })

    completeTurn()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]).toMatchObject({
      chatState: 'tool_executing',
      turnCompletionPending: true,
    })
    settleCompletionSound()
    expect(soundPlayMock).not.toHaveBeenCalled()

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'tool_executing',
      verb: 'Background checks running',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'task_notification',
      data: { tool_use_id: 'agent-1', task_id: 'task-1', status: 'completed' },
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]).toMatchObject({
      chatState: 'tool_executing',
      turnCompletionPending: false,
    })
    settleCompletionSound()
    expect(soundPlayMock).not.toHaveBeenCalled()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('tool_executing')

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'task_notification',
      data: { tool_use_id: 'agent-2', task_id: 'task-2', status: 'completed' },
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]).toMatchObject({
      chatState: 'thinking',
      turnCompletionPending: true,
    })
    settleCompletionSound()
    expect(soundPlayMock).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('idle')
  })

  it('cancels an early completion candidate when the same turn resumes', () => {
    useChatStore.setState({
      sessions: { [TEST_SESSION_ID]: makeSessionState({ chatState: 'streaming' }) },
    })

    completeTurn()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('thinking')
    vi.advanceTimersByTime(300)
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'text',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]).toMatchObject({
      chatState: 'streaming',
      turnCompletionPending: false,
    })
    settleCompletionSound()
    expect(soundPlayMock).not.toHaveBeenCalled()

    completeTurn()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('thinking')
    settleCompletionSound()
    expect(soundPlayMock).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('idle')
  })

  it('does not expose a transient idle status before the turn is stable', () => {
    useChatStore.setState({
      sessions: { [TEST_SESSION_ID]: makeSessionState({ chatState: 'streaming' }) },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'idle',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]).toMatchObject({
      chatState: 'thinking',
      turnCompletionPending: true,
    })

    vi.advanceTimersByTime(300)
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'thinking',
      text: 'Continuing the same turn',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]).toMatchObject({
      chatState: 'thinking',
      turnCompletionPending: false,
    })

    settleCompletionSound()
    expect(soundPlayMock).not.toHaveBeenCalled()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('thinking')

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'idle',
    })
    settleCompletionSound()
    expect(soundPlayMock).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('idle')
  })

  it('auto-sends input queued during the final settle window without exposing idle', () => {
    useChatStore.setState({
      sessions: { [TEST_SESSION_ID]: makeSessionState({ chatState: 'streaming' }) },
    })
    sendMock.mockClear()

    completeTurn()
    vi.advanceTimersByTime(300)
    useChatStore.getState().queuePendingSteer(TEST_SESSION_ID, 'Continue immediately')

    settleCompletionSound()

    expect(soundPlayMock).not.toHaveBeenCalled()
    expect(sendMock).toHaveBeenLastCalledWith(TEST_SESSION_ID, {
      type: 'user_message',
      content: 'Continue immediately',
      attachments: undefined,
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]).toMatchObject({
      chatState: 'thinking',
      turnCompletionPending: false,
      pendingSteers: [],
    })
  })

  it('waits for background shell commands to report completion', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          chatState: 'streaming',
          messages: [
            { id: 'user-shell', type: 'user_text', content: 'Run the build', timestamp: 1 },
            {
              id: 'bash-use',
              type: 'tool_use',
              toolName: 'Bash',
              toolUseId: 'bash-background',
              input: { command: 'bun run build', run_in_background: true },
              timestamp: 2,
            },
            {
              id: 'bash-result',
              type: 'tool_result',
              toolUseId: 'bash-background',
              content: 'Command running in background with ID: shell-1.',
              isError: false,
              timestamp: 3,
            },
          ],
        }),
      },
    })

    completeTurn()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('tool_executing')
    settleCompletionSound()
    expect(soundPlayMock).not.toHaveBeenCalled()

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'task_notification',
      data: { tool_use_id: 'bash-background', task_id: 'shell-1', status: 'completed' },
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('thinking')
    settleCompletionSound()
    expect(soundPlayMock).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('idle')
  })

  it('waits for unresolved tool calls before playing', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          chatState: 'tool_executing',
          messages: [
            { id: 'user-tool', type: 'user_text', content: 'Read it', timestamp: 1 },
            { id: 'tool-use', type: 'tool_use', toolName: 'Read', toolUseId: 'read-1', input: {}, timestamp: 2 },
          ],
        }),
      },
    })

    completeTurn()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('tool_executing')
    settleCompletionSound()
    expect(soundPlayMock).not.toHaveBeenCalled()

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_result',
      toolUseId: 'read-1',
      content: 'done',
      isError: false,
    })
    completeTurn()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('thinking')
    settleCompletionSound()
    expect(soundPlayMock).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('idle')
  })

  it('stays silent when the sound is disabled', () => {
    useSettingsStore.setState({ completionSoundEnabled: false })
    useChatStore.setState({
      sessions: { [TEST_SESSION_ID]: makeSessionState({ chatState: 'streaming' }) },
    })
    completeTurn()
    settleCompletionSound()
    expect(soundPlayMock).not.toHaveBeenCalled()
  })

  it('stays silent when the session was already idle', () => {
    useChatStore.setState({
      sessions: { [TEST_SESSION_ID]: makeSessionState({ chatState: 'idle' }) },
    })
    completeTurn()
    settleCompletionSound()
    expect(soundPlayMock).not.toHaveBeenCalled()
  })
})

describe('chatStore history pagination EOF', () => {
  beforeEach(() => {
    vi.mocked(sessionsApi.getMessages).mockReset()
  })

  function seedSession(overrides: Partial<PerSessionState> = {}) {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          allMessagesLoaded: false,
          historyBuffer: [],
          recentBuffer: [],
          messages: [{
            id: 'ui-newest',
            type: 'user_text',
            content: 'newest loaded question',
            timestamp: 100,
            serverId: 'raw-newest',
          }],
          ...overrides,
        }),
      },
    })
  }

  it('latches allMessagesLoaded when the server returns an empty final page', async () => {
    seedSession()
    vi.mocked(sessionsApi.getMessages).mockResolvedValueOnce({ messages: [], hasMore: false })

    await useChatStore.getState().loadMoreHistory(TEST_SESSION_ID)

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]!
    expect(session.allMessagesLoaded).toBe(true)
    expect(session.messages).toHaveLength(1)
    expect(sessionsApi.getMessages).toHaveBeenCalledWith(TEST_SESSION_ID, {
      limit: 50,
      before: 'raw-newest',
      projectPath: undefined,
    })

    // A subsequent call must not hit the server again.
    await useChatStore.getState().loadMoreHistory(TEST_SESSION_ID)
    expect(sessionsApi.getMessages).toHaveBeenCalledTimes(1)
  })

  it('advances the raw cursor past pages that map to zero UI messages', async () => {
    seedSession()
    const getMessagesMock = vi.mocked(sessionsApi.getMessages)
    getMessagesMock
      // Page of entries that historyParser drops entirely (pure teammate
      // messages), but the server says there is more.
      .mockResolvedValueOnce({
        hasMore: true,
        messages: [{
          id: 'raw-teammate-page',
          type: 'user',
          timestamp: '2026-01-01T00:00:00.000Z',
          content: '<teammate-message teammate_id="a">hi</teammate-message>',
        }],
      })
      .mockResolvedValueOnce({ messages: [], hasMore: false })

    await useChatStore.getState().loadMoreHistory(TEST_SESSION_ID)
    let session = useChatStore.getState().sessions[TEST_SESSION_ID]!
    expect(session.allMessagesLoaded).toBe(false)
    expect(session.historyCursor).toBe('raw-teammate-page')
    expect(session.messages).toHaveLength(1)

    await useChatStore.getState().loadMoreHistory(TEST_SESSION_ID)
    expect(getMessagesMock).toHaveBeenNthCalledWith(2, TEST_SESSION_ID, {
      limit: 50,
      before: 'raw-teammate-page',
      projectPath: undefined,
    })
    session = useChatStore.getState().sessions[TEST_SESSION_ID]!
    expect(session.allMessagesLoaded).toBe(true)
  })
})

describe('chatStore loadHistoryUntil', () => {
  beforeEach(() => {
    vi.mocked(sessionsApi.getMessages).mockReset()
  })

  function seedSession() {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSessionState({
          allMessagesLoaded: false,
          historyBuffer: [],
          recentBuffer: [],
          messages: [{
            id: 'ui-newest',
            type: 'user_text',
            content: 'newest loaded question',
            timestamp: 100,
            serverId: 'raw-newest',
          }],
        }),
      },
    })
  }

  it('pages until the target message enters the window', async () => {
    seedSession()
    vi.mocked(sessionsApi.getMessages)
      // Seek attempt: server reports target not found, forcing the paging path.
      .mockResolvedValueOnce({
        hasMore: false,
        seekFound: false,
        messages: [],
      })
      .mockResolvedValueOnce({
        hasMore: true,
        messages: [{
          id: 'raw-middle',
          type: 'user',
          timestamp: '2026-01-01T00:00:00.000Z',
          content: 'middle question',
        }],
      })
      .mockResolvedValueOnce({
        hasMore: false,
        messages: [{
          id: 'raw-target',
          type: 'user',
          timestamp: '2025-12-31T00:00:00.000Z',
          content: 'target question',
        }],
      })

    const found = await useChatStore.getState().loadHistoryUntil(TEST_SESSION_ID, 'raw-target')

    expect(found).toBe(true)
    const session = useChatStore.getState().sessions[TEST_SESSION_ID]!
    expect(session.allMessagesLoaded).toBe(true)
    expect(session.messages.map((m) => m.id)).toEqual(['raw-target', 'raw-middle', 'ui-newest'])
  })

  it('seeks directly to the target window in one request', async () => {
    seedSession()
    const seekSpy = vi.mocked(sessionsApi.getMessages).mockResolvedValueOnce({
      hasMore: true,
      hasMoreAfter: true,
      seekFound: true,
      messages: [
        {
          id: 'raw-older',
          type: 'user',
          timestamp: '2025-12-30T00:00:00.000Z',
          content: 'older question',
        },
        {
          id: 'raw-target',
          type: 'user',
          timestamp: '2025-12-31T00:00:00.000Z',
          content: 'target question',
        },
        {
          id: 'raw-newer',
          type: 'user',
          timestamp: '2026-01-01T00:00:00.000Z',
          content: 'newer question',
        },
      ],
    })

    const found = await useChatStore.getState().loadHistoryUntil(TEST_SESSION_ID, 'raw-target')

    expect(found).toBe(true)
    // One seek request, zero paging requests.
    expect(seekSpy).toHaveBeenCalledTimes(1)
    expect(seekSpy).toHaveBeenCalledWith(
      TEST_SESSION_ID,
      expect.objectContaining({ seek: 'raw-target' }),
    )
    const session = useChatStore.getState().sessions[TEST_SESSION_ID]!
    expect(session.messages.map((m) => m.id)).toEqual(['raw-older', 'raw-target', 'raw-newer'])
    expect(session.historyCursor).toBe('raw-older')
    expect(session.forwardCursor).toBe('raw-newer')
    expect(session.hasMoreRecent).toBe(true)
    expect(session.allMessagesLoaded).toBe(false)
  })

  it('resolves false when history is exhausted before the target appears', async () => {
    seedSession()
    vi.mocked(sessionsApi.getMessages).mockResolvedValueOnce({ messages: [], hasMore: false })

    const found = await useChatStore.getState().loadHistoryUntil(TEST_SESSION_ID, 'missing')
    expect(found).toBe(false)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]!.allMessagesLoaded).toBe(true)
  })

  it('stops early instead of burning the page budget on stuck empty hasMore pages', async () => {
    seedSession()
    // Server keeps returning empty pages that claim hasMore (unknown cursor in
    // the transcript while recentHistory reports earlier entries): the cursor
    // cannot advance, so the loop must bail immediately, not after 40 pages.
    vi.mocked(sessionsApi.getMessages).mockResolvedValue({ messages: [], hasMore: true })

    const found = await useChatStore.getState().loadHistoryUntil(TEST_SESSION_ID, 'missing')

    expect(found).toBe(false)
    expect(vi.mocked(sessionsApi.getMessages).mock.calls.length).toBeLessThanOrEqual(2)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]!.allMessagesLoaded).toBe(true)
  })

  it('serializes concurrent calls and dedupes already-loaded targets', async () => {
    seedSession()
    vi.mocked(sessionsApi.getMessages).mockResolvedValueOnce({
      hasMore: false,
      messages: [{
        id: 'raw-target',
        type: 'user',
        timestamp: '2025-12-31T00:00:00.000Z',
        content: 'target question',
      }],
    })

    const [first, second] = await Promise.all([
      useChatStore.getState().loadHistoryUntil(TEST_SESSION_ID, 'raw-target'),
      useChatStore.getState().loadHistoryUntil(TEST_SESSION_ID, 'raw-target'),
    ])

    expect(first).toBe(true)
    expect(second).toBe(true)
    // The second call queued behind the first and found the target already
    // loaded, so only one page was ever fetched.
    expect(sessionsApi.getMessages).toHaveBeenCalledTimes(1)
  })

  it('resolves immediately for a message that is already loaded', async () => {
    seedSession()
    const found = await useChatStore.getState().loadHistoryUntil(TEST_SESSION_ID, 'raw-newest')
    expect(found).toBe(true)
    expect(sessionsApi.getMessages).not.toHaveBeenCalled()
  })
})
