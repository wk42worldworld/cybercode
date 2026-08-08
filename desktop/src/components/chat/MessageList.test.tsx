import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  MessageBlock,
  MessageList,
  buildRenderModel,
  findVisibleRenderItemRange,
  syncChatScrollbarGutter,
} from './MessageList'
import { ApiError } from '../../api/client'
import { sessionsApi } from '../../api/sessions'
import { useChatStore } from '../../stores/chatStore'
import { useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import type { UIMessage } from '../../types/chat'
import type { PerSessionState } from '../../stores/chatStore'

const ACTIVE_TAB = 'active-tab'

function makeSessionState(overrides: Partial<PerSessionState> = {}): PerSessionState {
  return {
    messages: [],
    historyBuffer: [],
    recentBuffer: [],
    allMessagesLoaded: true,
    historyLoadState: 'loaded' as const,
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
    composerPrefill: null,
    ...overrides,
  }
}

describe('MessageList nested tool calls', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useSettingsStore.setState({ locale: 'en' })
    useTabStore.setState({ activeTabId: ACTIVE_TAB, tabs: [{ sessionId: ACTIVE_TAB, title: 'Test', type: 'session' as const, status: 'idle' }] })
    useChatStore.setState({ sessions: { [ACTIVE_TAB]: makeSessionState() } })
    useSessionRuntimeStore.setState({ selections: {} })
    useSessionStore.setState({ sessions: [], isLoading: false, error: null })
    useUIStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('aligns the chat layout to the measured scrollbar gutter', () => {
    const layout = document.createElement('section')
    const scroller = document.createElement('div')
    layout.dataset.chatLayout = ''
    layout.appendChild(scroller)
    Object.defineProperty(scroller, 'offsetWidth', { configurable: true, value: 876 })
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 861 })

    syncChatScrollbarGutter(scroller)

    expect(layout.style.getPropertyValue('--chat-message-scrollbar-gutter')).toBe('15px')
  })

  it('finds visible messages without scanning the entire transcript', () => {
    let layoutReads = 0
    const items = Array.from({ length: 2048 }, (_, index) => ({
      get offsetTop() {
        layoutReads += 1
        return index * 100
      },
      get offsetHeight() {
        layoutReads += 1
        return 80
      },
    }))

    expect(findVisibleRenderItemRange(items, 100_050, 100_420)).toEqual({
      start: 1000,
      end: 1004,
    })
    expect(layoutReads).toBeLessThan(80)
    expect(findVisibleRenderItemRange([], 0, 600)).toBeNull()
  })

  it('describes history failures as local reads without implying internet access', () => {
    useSettingsStore.setState({ locale: 'zh' })
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          allMessagesLoaded: false,
          historyLoadState: 'error',
        }),
      },
    })

    render(<MessageList />)

    expect(screen.getByText('本地聊天记录读取失败')).toBeTruthy()
    expect(screen.getByText('聊天记录仍保存在这台电脑上，请重试。')).toBeTruthy()
    expect(screen.queryByText(/network|网络/i)).toBeNull()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('does not flash a loading indicator for fast local history reads', () => {
    vi.useFakeTimers()
    try {
      useChatStore.setState({
        sessions: {
          [ACTIVE_TAB]: makeSessionState({
            allMessagesLoaded: false,
            historyLoadState: 'loading',
          }),
        },
      })

      render(<MessageList bottomOverlayHeight={120} />)

      expect(screen.queryByTestId('session-history-loading')).toBeNull()
      act(() => vi.advanceTimersByTime(799))
      expect(screen.queryByTestId('session-history-loading')).toBeNull()
      act(() => vi.advanceTimersByTime(1))
      const loading = screen.getByTestId('session-history-loading')
      expect(loading.getAttribute('aria-label')).toBe('Loading local chat history...')
      expect(loading.className).toContain('absolute')
      expect(loading.className).toContain('left-0 right-0 top-0')
      expect(loading.className).toContain('grid place-items-center')
      expect(loading.style.bottom).toBe('120px')
      expect(loading.querySelector('.session-history-loading-wordmark-light')).toBeTruthy()
      expect(loading.querySelector('.session-history-loading-wordmark-shine')).toBeTruthy()
      expect(loading.querySelector('[src="/app-icon.png"]')).toBeNull()
      expect(loading.querySelector('.animate-spin')).toBeNull()
      expect(loading.textContent).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows localized activity after the user message until the AI turn completes', async () => {
    const userMessage: UIMessage = {
      id: 'user-status',
      type: 'user_text',
      content: '请检查这个问题',
      timestamp: 1,
    }
    useSettingsStore.setState({ locale: 'zh' })
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [userMessage],
          chatState: 'thinking',
          statusVerb: 'Accomplishing',
        }),
      },
    })

    render(<MessageList />)

    const status = screen.getByTestId('streaming-indicator')
    expect(status.textContent).not.toContain('Accomplishing')
    expect(screen.getByText('请检查这个问题').compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    act(() => {
      useChatStore.setState({
        sessions: {
          [ACTIVE_TAB]: makeSessionState({
            messages: [userMessage],
            chatState: 'thinking',
            statusVerb: 'Baking',
            elapsedSeconds: 12,
            tokenUsage: { input_tokens: 80, output_tokens: 24 },
          }),
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('streaming-indicator')).toBe(status)
      expect(status.textContent).toContain('正在烘焙灵感')
      expect(status.textContent).toContain('12秒')
    })

    act(() => {
      useChatStore.setState({
        sessions: {
          [ACTIVE_TAB]: makeSessionState({
            messages: [userMessage],
            chatState: 'streaming',
            streamingText: '正在生成回复',
            statusVerb: 'Accomplishing',
          }),
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('streaming-indicator')).toBeTruthy()
      expect(screen.getByTestId('smooth-streaming-text').textContent).toBe('正在生成回复')
    })

    act(() => {
      useChatStore.setState({
        sessions: {
          [ACTIVE_TAB]: makeSessionState({
            messages: [
              userMessage,
              {
                id: 'assistant-status',
                type: 'assistant_text',
                content: '回复完成',
                timestamp: 2,
              },
            ],
            chatState: 'idle',
          }),
        },
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('streaming-indicator')).toBeNull()
      expect(screen.getByText('回复完成')).toBeTruthy()
    })
  })

  it('keeps one live assistant bubble while a completed reply finishes revealing', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const completedMessage: UIMessage = {
      id: 'assistant-settling',
      type: 'assistant_text',
      content: '从第一个字开始顺序显示。',
      timestamp: 2,
    }
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'user-settling',
              type: 'user_text',
              content: '请检查过渡顺序',
              timestamp: 0,
            },
            {
              id: 'thinking-settling',
              type: 'thinking',
              content: '正在整理结果',
              timestamp: 1,
            },
            completedMessage,
            {
              id: 'tool-settling',
              type: 'tool_use',
              toolName: 'Read',
              toolUseId: 'tool-settling-id',
              input: { file_path: '/tmp/settling.ts' },
              timestamp: 3,
            },
            {
              id: 'tool-result-settling',
              type: 'tool_result',
              toolUseId: 'tool-settling-id',
              content: 'ok',
              isError: false,
              timestamp: 4,
            },
          ],
          settlingAssistant: {
            messageId: completedMessage.id,
            content: completedMessage.content,
          },
        }),
      },
    })

    const { container, unmount } = render(
      <MessageList />,
    )

    try {
      expect(container.querySelectorAll('[data-message-bubble="assistant"]')).toHaveLength(1)
      expect(screen.getByTestId('smooth-streaming-text')).toBeTruthy()
      const liveBubble = screen
        .getByTestId('smooth-streaming-text')
        .closest('[data-message-bubble="assistant"]')
      const thinking = screen.getByTestId('thinking-message-panel')
      const activity = container.querySelector('[data-tool-activity-container]')
      expect(activity).toBeTruthy()
      expect(
        liveBubble!.compareDocumentPosition(thinking)
        & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(
        thinking.compareDocumentPosition(activity!)
        & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    } finally {
      unmount()
      vi.unstubAllGlobals()
    }
  })

  it('renders an orphaned WebFetch as interrupted after reconnecting idle', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          chatState: 'idle',
          messages: [
            {
              id: 'user-trending',
              type: 'user_text',
              content: 'github 上今天的趋势榜',
              timestamp: 1,
            },
            {
              id: 'fetch-trending',
              type: 'tool_use',
              toolName: 'WebFetch',
              toolUseId: 'fetch-trending-tool',
              input: { url: 'https://github.com/trending' },
              timestamp: 2,
            },
          ],
        }),
      },
    })

    const { container } = render(
      <MessageList />,
    )

    expect(container.querySelector('[data-running="true"]')).toBeNull()
    expect(container.querySelector('[data-interrupted="true"]')).toBeTruthy()
    expect(container.querySelector('.tool-running-text')).toBeNull()
  })

  it('keeps pending tool sweep active across streaming state transitions', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          chatState: 'streaming',
          messages: [
            {
              id: 'user-running-tool',
              type: 'user_text',
              content: 'Inspect the current file',
              timestamp: 1,
            },
            {
              id: 'assistant-before-running-tool',
              type: 'assistant_text',
              content: 'I will inspect it now.',
              timestamp: 2,
            },
            {
              id: 'running-read',
              type: 'tool_use',
              toolName: 'Read',
              toolUseId: 'running-read-id',
              input: { file_path: '/tmp/current.ts' },
              timestamp: 3,
            },
          ],
        }),
      },
    })

    const { container } = render(<MessageList />)
    const activity = container.querySelector('[data-tool-activity-container]')
    const activitySummary = container.querySelector('[data-tool-activity-summary]')
    const runningRows = container.querySelectorAll('[data-running="true"]')

    expect(activity?.getAttribute('data-running')).toBe('true')
    expect(activitySummary?.className).toContain('tool-running-text')
    expect(runningRows.length).toBeGreaterThanOrEqual(2)
    expect(container.querySelectorAll('.tool-running-text').length).toBeGreaterThanOrEqual(3)
  })

  it('renders sub-agent tool calls inline beneath the parent agent tool call', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          chatState: 'tool_executing',
          messages: [
            {
              id: 'tool-agent',
              type: 'tool_use',
              toolName: 'Agent',
              toolUseId: 'agent-1',
              input: { description: 'Inspect src/components' },
              timestamp: 1,
            },
            {
              id: 'tool-read',
              type: 'tool_use',
              toolName: 'Read',
              toolUseId: 'read-1',
              input: { file_path: '/tmp/example.ts' },
              timestamp: 2,
              parentToolUseId: 'agent-1',
            },
            {
              id: 'result-read',
              type: 'tool_result',
              toolUseId: 'read-1',
              content: 'const answer = 42',
              isError: false,
              timestamp: 3,
              parentToolUseId: 'agent-1',
            },
          ],
        }),
      },
    })

    const { container } = render(<MessageList />)

    expect(screen.getAllByText('Running').length).toBeGreaterThan(0)
    expect(screen.getByText(/Read .*example\.ts.*done/i)).toBeTruthy()
    expect(container.textContent).toContain('Agent')
  })

  it('marks a resultless historical agent as stopped after its turn is idle', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'tool-agent',
              type: 'tool_use',
              toolName: 'Agent',
              toolUseId: 'agent-orphan',
              input: { description: 'Inspect an interrupted task' },
              timestamp: 1,
            },
          ],
        }),
      },
    })

    const { container } = render(<MessageList />)

    expect(screen.getByTitle('Stopped')).toBeTruthy()
    expect(screen.queryByText('Running')).toBeNull()
    expect(container.querySelector('[data-tool-activity-details]')).toBeNull()
  })

  it('places completed thinking beneath the final assistant bubble', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'user-thinking-order',
              type: 'user_text',
              content: 'Explain the change',
              timestamp: 1,
            },
            {
              id: 'thinking-order',
              type: 'thinking',
              content: 'Inspecting the relevant files',
              timestamp: 2,
            },
            {
              id: 'assistant-thinking-order',
              type: 'assistant_text',
              content: 'Here is the explanation.',
              timestamp: 3,
            },
          ],
          chatState: 'idle',
          activeThinkingId: null,
        }),
      },
    })

    const { container } = render(<MessageList />)
    const panel = screen.getByTestId('thinking-message-panel')
    const userText = screen.getByText('Explain the change')
    const assistantText = screen.getByText('Here is the explanation.')

    expect(panel.closest('[data-chat-content-column]')?.className).toContain('max-w-[878px]')
    expect(panel.closest('[data-thinking-message-shell]')?.className).not.toContain('absolute')
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy()
    expect(screen.getByTestId('thinking-message-panel-title').textContent).toBe('Thinking complete')
    expect(screen.queryByText('Inspecting the relevant files')).toBeNull()
    expect(userText.compareDocumentPosition(assistantText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(assistantText.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { expanded: false }))

    expect(container.textContent).toContain('Inspecting the relevant files')
  })

  it('treats thinking and tool controls as AI content when spacing chat turns', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            { id: 'user-spacing-1', type: 'user_text', content: 'First user message', timestamp: 1 },
            { id: 'user-spacing-2', type: 'user_text', content: 'Second user message', timestamp: 2 },
            {
              id: 'thinking-spacing',
              type: 'thinking',
              content: 'Finishing the assistant turn',
              timestamp: 3,
            },
            {
              id: 'tool-spacing',
              type: 'tool_use',
              toolName: 'Read',
              toolUseId: 'tool-spacing-id',
              input: { file_path: '/tmp/spacing.ts' },
              timestamp: 4,
            },
            {
              id: 'tool-result-spacing',
              type: 'tool_result',
              toolUseId: 'tool-spacing-id',
              content: 'ok',
              isError: false,
              timestamp: 5,
            },
            { id: 'user-spacing-3', type: 'user_text', content: 'Third user message', timestamp: 6 },
            { id: 'assistant-spacing-1', type: 'assistant_text', content: 'First assistant reply', timestamp: 7 },
            { id: 'assistant-spacing-2', type: 'assistant_text', content: 'Second assistant reply', timestamp: 8 },
            { id: 'user-spacing-4', type: 'user_text', content: 'Fourth user message', timestamp: 9 },
          ],
        }),
      },
    })

    const { container } = render(<MessageList />)
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-render-index]'))

    expect(rows.map((row) => row.dataset.chatTurnRole)).toEqual([
      'user',
      'user',
      'assistant',
      'assistant',
      'user',
      'assistant',
      'assistant',
      'user',
    ])
    expect(rows.map((row) => row.getAttribute('data-chat-role-transition'))).toEqual([
      null,
      null,
      'true',
      null,
      'true',
      'true',
      null,
      'true',
    ])
    for (const row of rows.filter((item) => item.dataset.chatRoleTransition === 'true')) {
      expect(row.className).toContain('mt-[16px]')
    }
  })

  it('shows active thinking expanded with the existing live treatment', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'user-active-thinking',
              type: 'user_text',
              content: 'Inspect this',
              timestamp: 1,
            },
            {
              id: 'active-thinking',
              type: 'thinking',
              content: 'Reading the project context',
              timestamp: 2,
            },
          ],
          chatState: 'thinking',
          activeThinkingId: 'active-thinking',
        }),
      },
    })

    render(<MessageList />)

    expect(screen.getByRole('button', { expanded: true })).toBeTruthy()
    expect(screen.getByText('Reading the project context')).toBeTruthy()
    expect(document.querySelector('[data-thinking-sweep-label="true"]')?.className).toContain(
      'ai-thinking-sweep-label',
    )
  })

  it('merges every thinking wave in one user turn and collapses only when the turn ends', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-multi-thinking',
        type: 'user_text',
        content: 'Inspect and fix this',
        timestamp: 1,
      },
      {
        id: 'thinking-first',
        type: 'thinking',
        content: 'Reading the relevant files',
        timestamp: 2,
      },
      {
        id: 'assistant-progress',
        type: 'assistant_text',
        content: 'I found the first area.',
        timestamp: 3,
      },
      {
        id: 'tool-between-thinking',
        type: 'tool_use',
        toolName: 'Read',
        toolUseId: 'tool-between-thinking-id',
        input: { file_path: '/tmp/thinking.ts' },
        timestamp: 4,
      },
      {
        id: 'tool-between-thinking-result',
        type: 'tool_result',
        toolUseId: 'tool-between-thinking-id',
        content: 'ok',
        isError: false,
        timestamp: 5,
      },
      {
        id: 'thinking-second',
        type: 'thinking',
        content: 'Planning the final edit',
        timestamp: 6,
      },
      {
        id: 'assistant-final',
        type: 'assistant_text',
        content: 'The fix is ready.',
        timestamp: 7,
      },
    ]
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages,
          chatState: 'streaming',
          activeThinkingId: null,
        }),
      },
    })

    render(<MessageList />)

    expect(screen.getAllByTestId('thinking-message-panel')).toHaveLength(1)
    expect(screen.getByTestId('thinking-message-panel-title').textContent).toBe('Thinking')
    expect(document.querySelector('[data-thinking-sweep-label="true"]')?.className).toContain(
      'ai-thinking-sweep-label',
    )
    expect(screen.getByTestId('thinking-message-panel-content').textContent).toContain(
      'Reading the relevant files',
    )
    expect(screen.getByTestId('thinking-message-panel-content').textContent).toContain(
      'Planning the final edit',
    )
    expect(screen.getByTestId('thinking-message-panel').className).not.toContain('shadow-')
    expect(screen.getByTestId('thinking-message-panel-body').className).toContain('border-t')
    const activeFinalAssistant = screen.getByText('The fix is ready.')
    const activeThinking = screen.getByTestId('thinking-message-panel')
    const activeActivity = document.querySelector('[data-tool-activity-container]')
    expect(
      activeFinalAssistant.compareDocumentPosition(activeThinking)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(activeActivity).toBeTruthy()
    expect(
      activeThinking.compareDocumentPosition(activeActivity!)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    act(() => {
      useChatStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          [ACTIVE_TAB]: {
            ...state.sessions[ACTIVE_TAB]!,
            chatState: 'idle',
          },
        },
      }))
    })

    expect(screen.getAllByTestId('thinking-message-panel')).toHaveLength(1)
    expect(screen.getByTestId('thinking-message-panel-title').textContent).toBe('Thinking complete')
    expect(document.querySelector('[data-thinking-sweep-label="true"]')).toBeNull()
    expect(
      screen.getByTestId('thinking-message-panel').querySelector('button')?.getAttribute('aria-expanded'),
    ).toBe('false')
    expect(screen.queryByTestId('thinking-message-panel-content')).toBeNull()
    const finalAssistant = screen.getByText('The fix is ready.')
    const completedThinking = screen.getByTestId('thinking-message-panel')
    const completedActivity = document.querySelector('[data-tool-activity-container]')
    expect(
      finalAssistant.compareDocumentPosition(completedThinking)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(completedActivity).toBeTruthy()
    expect(
      completedThinking.compareDocumentPosition(completedActivity!)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('moves live thinking and tool activity beneath each newly appended assistant bubble', () => {
    const initialMessages: UIMessage[] = [
      { id: 'user-follow', type: 'user_text', content: 'Keep me updated', timestamp: 1 },
      {
        id: 'thinking-follow',
        type: 'thinking',
        content: 'Inspecting the first area',
        timestamp: 2,
      },
      {
        id: 'assistant-follow-first',
        type: 'assistant_text',
        content: 'I found the first area.',
        timestamp: 3,
      },
      {
        id: 'tool-follow',
        type: 'tool_use',
        toolName: 'Read',
        toolUseId: 'tool-follow-id',
        input: { file_path: '/tmp/follow.ts' },
        timestamp: 4,
      },
      {
        id: 'tool-follow-result',
        type: 'tool_result',
        toolUseId: 'tool-follow-id',
        content: 'ok',
        isError: false,
        timestamp: 5,
      },
    ]
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: initialMessages,
          chatState: 'streaming',
        }),
      },
    })

    const { container } = render(<MessageList />)
    const firstAssistant = screen.getByText('I found the first area.')
    const initialThinking = screen.getByTestId('thinking-message-panel')
    const initialActivity = container.querySelector('[data-tool-activity-container]')
    expect(
      firstAssistant.compareDocumentPosition(initialThinking)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      initialThinking.compareDocumentPosition(initialActivity!)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    act(() => {
      useChatStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          [ACTIVE_TAB]: {
            ...state.sessions[ACTIVE_TAB]!,
            messages: [
              ...initialMessages,
              {
                id: 'assistant-follow-second',
                type: 'assistant_text',
                content: 'I also checked the second area.',
                timestamp: 6,
              },
            ],
          },
        },
      }))
    })

    const latestAssistant = screen.getByText('I also checked the second area.')
    const movedThinking = screen.getByTestId('thinking-message-panel')
    const movedActivity = container.querySelector('[data-tool-activity-container]')
    expect(
      latestAssistant.compareDocumentPosition(movedThinking)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      movedThinking.compareDocumentPosition(movedActivity!)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(movedThinking.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
    expect(movedActivity?.getAttribute('data-layout')).toBe('expanded')
  })

  it('places the live assistant bubble above thinking and tool activity from its first streamed text', async () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          chatState: 'streaming',
          streamingText: 'The live answer has started.',
          messages: [
            {
              id: 'user-live-order',
              type: 'user_text',
              content: 'Keep the activity below the answer',
              timestamp: 1,
            },
            {
              id: 'thinking-live-order',
              type: 'thinking',
              content: 'Inspecting the request',
              timestamp: 2,
            },
            {
              id: 'tool-live-order',
              type: 'tool_use',
              toolName: 'Read',
              toolUseId: 'tool-live-order-id',
              input: { file_path: '/tmp/live.ts' },
              timestamp: 3,
            },
            {
              id: 'tool-result-live-order',
              type: 'tool_result',
              toolUseId: 'tool-live-order-id',
              content: 'ok',
              isError: false,
              timestamp: 4,
            },
          ],
        }),
      },
    })

    const { container } = render(<MessageList />)
    const initialStreamingText = screen.getByTestId('smooth-streaming-text')
    const initialBubble = initialStreamingText.closest('[data-message-bubble="assistant"]')
    const initialThinking = screen.getByTestId('thinking-message-panel')
    const initialActivity = container.querySelector('[data-tool-activity-container]')

    expect(initialBubble).toBeTruthy()
    expect(initialActivity).toBeTruthy()
    expect(
      initialBubble!.compareDocumentPosition(initialThinking)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      initialThinking.compareDocumentPosition(initialActivity!)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    act(() => {
      useChatStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          [ACTIVE_TAB]: {
            ...state.sessions[ACTIVE_TAB]!,
            streamingText: 'The live answer has started now.',
          },
        },
      }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('smooth-streaming-text').textContent).toBe(
        'The live answer has started now.',
      )
    }, { timeout: 3_000 })
    expect(
      screen.getByTestId('smooth-streaming-text').closest('[data-message-bubble="assistant"]'),
    ).toBe(initialBubble)
    expect(
      initialBubble!.compareDocumentPosition(screen.getByTestId('thinking-message-panel'))
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('merges adjacent root tool runs when nested child calls appear between them', () => {
    const messages: UIMessage[] = [
      {
        id: 'tool-agent',
        type: 'tool_use',
        toolName: 'Agent',
        toolUseId: 'agent-1',
        input: { description: 'Inspect src/components' },
        timestamp: 1,
      },
      {
        id: 'tool-read',
        type: 'tool_use',
        toolName: 'Read',
        toolUseId: 'read-1',
        input: { file_path: '/tmp/example.ts' },
        timestamp: 2,
        parentToolUseId: 'agent-1',
      },
      {
        id: 'result-read',
        type: 'tool_result',
        toolUseId: 'read-1',
        content: 'const answer = 42',
        isError: false,
        timestamp: 3,
        parentToolUseId: 'agent-1',
      },
      {
        id: 'tool-write',
        type: 'tool_use',
        toolName: 'Write',
        toolUseId: 'write-1',
        input: { file_path: '/tmp/out.ts', content: 'export const value = 1' },
        timestamp: 4,
      },
    ]

    const { renderItems } = buildRenderModel(messages)
    const toolGroups = renderItems.filter((item) => item.kind === 'tool_group')

    expect(toolGroups).toHaveLength(1)
    expect(toolGroups[0]?.toolCalls.map((toolCall) => toolCall.toolUseId)).toEqual([
      'agent-1',
      'write-1',
    ])
  })

  it('aggregates tool waves separated by assistant commentary into one turn activity group', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        type: 'user_text',
        content: 'Inspect and fix it',
        timestamp: 1,
      },
      {
        id: 'assistant-check',
        type: 'assistant_text',
        content: 'I will inspect the project first.',
        timestamp: 2,
      },
      {
        id: 'tool-check',
        type: 'tool_use',
        toolName: 'Bash',
        toolUseId: 'check-tool',
        input: { command: 'git status --short' },
        timestamp: 3,
      },
      {
        id: 'result-check',
        type: 'tool_result',
        toolUseId: 'check-tool',
        content: 'ok',
        isError: false,
        timestamp: 4,
      },
      {
        id: 'assistant-test',
        type: 'assistant_text',
        content: 'The fix is in place. I will run the tests now.',
        timestamp: 5,
      },
      {
        id: 'tool-test',
        type: 'tool_use',
        toolName: 'Bash',
        toolUseId: 'test-tool',
        input: { command: 'bun test' },
        timestamp: 6,
      },
      {
        id: 'result-test',
        type: 'tool_result',
        toolUseId: 'test-tool',
        content: 'pass',
        isError: false,
        timestamp: 7,
      },
      {
        id: 'assistant-done',
        type: 'assistant_text',
        content: 'Everything passes.',
        timestamp: 8,
      },
    ]

    const { renderItems } = buildRenderModel(messages)
    const activityGroups = renderItems.flatMap((item) => {
      if (item.kind === 'tool_group') return [item.toolCalls]
      return item.activityToolCalls ? [item.activityToolCalls] : []
    })
    const firstAssistant = renderItems.find(
      (item) => item.kind === 'message' && item.message.id === 'assistant-check',
    )
    const secondAssistant = renderItems.find(
      (item) => item.kind === 'message' && item.message.id === 'assistant-test',
    )

    expect(activityGroups).toHaveLength(1)
    expect(activityGroups[0]?.map((toolCall) => toolCall.toolUseId)).toEqual([
      'check-tool',
      'test-tool',
    ])
    expect(firstAssistant).toMatchObject({
      kind: 'message',
      toolCalls: [{ toolUseId: 'check-tool' }],
    })
    expect(secondAssistant).toMatchObject({
      kind: 'message',
      toolCalls: [{ toolUseId: 'test-tool' }],
    })
  })

  it('renders only one combined command activity control in a user turn', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'user-1',
              type: 'user_text',
              content: 'Run both checks',
              timestamp: 1,
            },
            {
              id: 'assistant-first',
              type: 'assistant_text',
              content: 'Running the first check.',
              timestamp: 2,
            },
            {
              id: 'tool-first',
              type: 'tool_use',
              toolName: 'Bash',
              toolUseId: 'first-tool',
              input: { command: 'bun run lint' },
              timestamp: 3,
            },
            {
              id: 'result-first',
              type: 'tool_result',
              toolUseId: 'first-tool',
              content: 'ok',
              isError: false,
              timestamp: 4,
            },
            {
              id: 'assistant-second',
              type: 'assistant_text',
              content: 'Now running the test suite.',
              timestamp: 5,
            },
            {
              id: 'tool-second',
              type: 'tool_use',
              toolName: 'Bash',
              toolUseId: 'second-tool',
              input: { command: 'bun run test' },
              timestamp: 6,
            },
            {
              id: 'result-second',
              type: 'tool_result',
              toolUseId: 'second-tool',
              content: 'pass',
              isError: false,
              timestamp: 7,
            },
            {
              id: 'assistant-done',
              type: 'assistant_text',
              content: 'Both checks pass.',
              timestamp: 8,
            },
          ],
        }),
      },
    })

    const { container } = render(<MessageList />)
    const activitySummaries = container.querySelectorAll('[data-tool-activity-summary]')

    expect(activitySummaries).toHaveLength(1)
    expect(activitySummaries[0]?.textContent).toBe(
      'Used 2 tools · Ran 2 commands',
    )
    const activityContainer = activitySummaries[0]?.closest('[data-tool-activity-container]')
    const chatColumn = activitySummaries[0]?.closest('[data-chat-content-column]')
    expect(activityContainer?.className).toContain('w-full')
    expect(chatColumn?.className).toContain('w-full')
    expect(chatColumn?.className).toContain('max-w-[878px]')

    fireEvent.click(activitySummaries[0]!.closest('button')!)

    expect(container.textContent).toContain('bun run lint')
    expect(container.textContent).toContain('bun run test')
  })

  it('keeps completed tool activity expanded until the whole assistant turn is idle', () => {
    const messages: UIMessage[] = [
      { id: 'user-live', type: 'user_text', content: 'Inspect the project', timestamp: 1 },
      { id: 'assistant-live', type: 'assistant_text', content: 'I checked it.', timestamp: 2 },
      {
        id: 'tool-live',
        type: 'tool_use',
        toolName: 'Read',
        toolUseId: 'tool-live-id',
        input: { file_path: '/tmp/project.ts' },
        timestamp: 3,
      },
      {
        id: 'result-live',
        type: 'tool_result',
        toolUseId: 'tool-live-id',
        content: 'ok',
        isError: false,
        timestamp: 4,
      },
    ]
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages,
          chatState: 'streaming',
        }),
      },
    })

    const { container } = render(<MessageList />)
    const activityContainer = container.querySelector('[data-tool-activity-container]')
    const activityButton = container.querySelector('[data-tool-activity-container] button')

    expect(activityContainer?.getAttribute('data-layout')).toBe('expanded')
    expect(activityContainer?.getAttribute('data-running')).toBeNull()
    expect(activityButton?.getAttribute('aria-expanded')).toBe('true')

    act(() => {
      useChatStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          [ACTIVE_TAB]: {
            ...state.sessions[ACTIVE_TAB]!,
            chatState: 'idle',
          },
        },
      }))
    })

    const completedActivityContainer = container.querySelector('[data-tool-activity-container]')
    const completedActivityButton = completedActivityContainer?.querySelector('button')
    const finalAssistant = screen.getByText('I checked it.')
    expect(completedActivityContainer).toBe(activityContainer)
    expect(completedActivityContainer?.getAttribute('data-layout')).toBe('collapsed')
    expect(completedActivityButton?.getAttribute('aria-expanded')).toBe('false')
    expect(
      finalAssistant.compareDocumentPosition(completedActivityContainer!)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('starts a new activity aggregate for the next user turn', () => {
    const messages: UIMessage[] = [
      { id: 'user-1', type: 'user_text', content: 'First task', timestamp: 1 },
      { id: 'assistant-1', type: 'assistant_text', content: 'First check.', timestamp: 2 },
      {
        id: 'tool-1',
        type: 'tool_use',
        toolName: 'Bash',
        toolUseId: 'tool-1-id',
        input: { command: 'pwd' },
        timestamp: 3,
      },
      { id: 'user-2', type: 'user_text', content: 'Second task', timestamp: 4 },
      { id: 'assistant-2', type: 'assistant_text', content: 'Second check.', timestamp: 5 },
      {
        id: 'tool-2',
        type: 'tool_use',
        toolName: 'Bash',
        toolUseId: 'tool-2-id',
        input: { command: 'ls' },
        timestamp: 6,
      },
    ]

    const { renderItems } = buildRenderModel(messages)
    const activityGroups = renderItems.flatMap((item) => {
      if (item.kind === 'tool_group') return [item.toolCalls]
      return item.activityToolCalls ? [item.activityToolCalls] : []
    })

    expect(activityGroups.map((group) => group.map((toolCall) => toolCall.toolUseId))).toEqual([
      ['tool-1-id'],
      ['tool-2-id'],
    ])
  })

  it('keeps later nested tool calls under their parent after an interleaved user message', () => {
    const messages: UIMessage[] = [
      {
        id: 'tool-agent',
        type: 'tool_use',
        toolName: 'Agent',
        toolUseId: 'agent-1',
        input: { description: 'Inspect src/components' },
        timestamp: 1,
      },
      {
        id: 'tool-read',
        type: 'tool_use',
        toolName: 'Read',
        toolUseId: 'read-1',
        input: { file_path: '/tmp/example.ts' },
        timestamp: 2,
        parentToolUseId: 'agent-1',
      },
      {
        id: 'user-follow-up',
        type: 'user_text',
        content: '顺便把刚才的问题也处理掉',
        timestamp: 3,
      },
      {
        id: 'tool-write',
        type: 'tool_use',
        toolName: 'Write',
        toolUseId: 'write-1',
        input: { file_path: '/tmp/out.ts', content: 'export const value = 1' },
        timestamp: 4,
        parentToolUseId: 'agent-1',
      },
    ]

    const { renderItems, childToolCallsByParent } = buildRenderModel(messages)
    const renderedKinds = renderItems.map((item) =>
      item.kind === 'tool_group'
        ? `tool:${item.toolCalls[0]?.toolUseId}`
        : `message:${item.message.id}`,
    )

    expect(renderedKinds).toEqual([
      'tool:agent-1',
      'message:user-follow-up',
    ])
    expect(
      (childToolCallsByParent.get('agent-1') ?? []).map((toolCall) => toolCall.toolUseId),
    ).toEqual(['read-1', 'write-1'])
  })

  it('does not render parented orphan tool results as root session messages', () => {
    const messages: UIMessage[] = [
      {
        id: 'tool-agent',
        type: 'tool_use',
        toolName: 'Agent',
        toolUseId: 'agent-1',
        input: { description: 'Inspect src/components' },
        timestamp: 1,
      },
      {
        id: 'result-child',
        type: 'tool_result',
        toolUseId: 'grep-1',
        content: 'Found 22 files',
        isError: false,
        timestamp: 2,
        parentToolUseId: 'agent-1',
      },
    ]

    const { renderItems } = buildRenderModel(messages)

    expect(renderItems).toHaveLength(1)
    expect(renderItems[0]).toMatchObject({ kind: 'tool_group' })
  })

  it('shows failed agent status and compact unavailable summary for Explore launch errors', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'tool-agent',
              type: 'tool_use',
              toolName: 'Agent',
              toolUseId: 'agent-1',
              input: { description: '探索整体架构', subagent_type: 'Explore' },
              timestamp: 1,
            },
            {
              id: 'result-agent',
              type: 'tool_result',
              toolUseId: 'agent-1',
              content: `Agent type 'Explore' not found. Available agents: general-purpose`,
              isError: true,
              timestamp: 2,
            },
          ],
        }),
      },
    })

    const { container } = render(<MessageList />)

    expect(container.querySelector('.codicon-error')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText('Explore agent unavailable in this session')).toBeTruthy()
  })

  it('shows completed agent output when no nested tool activity is available', () => {
    const longResult = '探索完成。让我将结果整合写入计划文件。第二段补充内容用于验证 dialog 展示的是完整结果而不是截断摘要。'

    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'tool-agent',
              type: 'tool_use',
              toolName: 'Agent',
              toolUseId: 'agent-1',
              input: { description: '探索整体架构' },
              timestamp: 1,
            },
            {
              id: 'result-agent',
              type: 'tool_result',
              toolUseId: 'agent-1',
              content: {
                status: 'completed',
                content: [
                  { type: 'text', text: longResult },
                  {
                    type: 'text',
                    text: "agentId: a0c0c732f61442dc1 (use SendMessage with to: 'a0c0c732f61442dc1' to continue this agent)\n<usage>total_tokens: 17195\ntool_uses: 2\nduration_ms: 41368</usage>",
                  },
                ],
              },
              isError: false,
              timestamp: 2,
            },
          ],
        }),
      },
    })

    render(<MessageList />)

    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Done')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View result' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'View result' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/第二段补充内容用于验证 dialog 展示的是完整结果而不是截断摘要。/)).toBeTruthy()
    expect(within(dialog).queryByText(/agentId:/)).toBeNull()
    expect(within(dialog).queryByText(/total_tokens/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('keeps async launched agents in running state until a terminal notification arrives', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'tool-agent',
              type: 'tool_use',
              toolName: 'Agent',
              toolUseId: 'agent-1',
              input: { description: '修复临时文件泄漏' },
              timestamp: 1,
            },
            {
              id: 'result-agent',
              type: 'tool_result',
              toolUseId: 'agent-1',
              content:
                "Async agent launched successfully.\nagentId: a29934b04b20ed564 (internal ID - do not mention to user. Use SendMessage with to: 'a29934b04b20ed564' to continue this agent.)\nThe agent is working in the background. You will be notified automatically when it completes.",
              isError: false,
              timestamp: 2,
            },
          ],
        }),
      },
    })

    render(<MessageList />)

    expect(screen.getAllByText('Running').length).toBeGreaterThan(0)
    expect(screen.queryByText('Done')).toBeNull()
    expect(screen.queryByRole('button', { name: 'View result' })).toBeNull()
  })

  it('renders copy controls for user messages and scopes assistant copy to a single reply', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    })

    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'user-1',
              type: 'user_text',
              content: '请帮我探索整体架构',
              timestamp: 1,
            },
            {
              id: 'assistant-1',
              type: 'assistant_text',
              content: '先看 CLI 和服务端入口。',
              timestamp: 2,
            },
            {
              id: 'assistant-2',
              type: 'assistant_text',
              content: '再看 desktop 前后端边界。',
              timestamp: 3,
            },
          ],
        }),
      },
    })

    render(<MessageList />)

    expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Branch from this reply' })).toHaveLength(2)

    // Messages render in chronological order: oldest at top, newest at bottom.
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy reply' })[0]!)

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('先看 CLI 和服务端入口。')
    })
    expect(writeText).not.toHaveBeenCalledWith(
      '先看 CLI 和服务端入口。\n再看 desktop 前后端边界。'
    )
  })

  it('localizes selected-text actions and copies the exact chat selection', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    useSettingsStore.setState({ locale: 'zh' })
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [{
            id: 'assistant-selection',
            type: 'assistant_text',
            content: '这段文字应该显示中文右键菜单。',
            timestamp: 1,
          }],
        }),
      },
    })

    render(<MessageList />)

    const messageText = screen.getByText('这段文字应该显示中文右键菜单。')
    const range = document.createRange()
    range.selectNodeContents(messageText)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    fireEvent.contextMenu(messageText, { clientX: 40, clientY: 50 })

    expect(screen.getByRole('menu', { name: '选中文字操作' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '复制' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '复制为引用' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '选择整条消息' })).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: '复制' }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('这段文字应该显示中文右键菜单。')
    })
  })

  it('creates a branch from a saved assistant reply and inherits the runtime selection', async () => {
    const projectPath = '-tmp-branch-project'
    const branchSessionId = 'branch-session-id'
    const sourceSelection = {
      providerId: 'deepseek',
      modelId: 'deepseek-v4-pro',
      contextWindow: 200_000,
    }
    useSessionRuntimeStore.getState().setSelection(ACTIVE_TAB, sourceSelection)
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'assistant-live-id',
              type: 'assistant_text',
              content: 'This answer just finished.',
              timestamp: new Date('2026-04-06T00:00:00.000Z').getTime(),
            },
          ],
        }),
      },
    })
    vi.spyOn(sessionsApi, 'getMessages').mockResolvedValue({
      messages: [
        {
          id: 'assistant-server-id',
          type: 'assistant',
          content: 'This answer just finished.',
          timestamp: '2026-04-06T00:00:00.000Z',
        },
      ],
      hasMore: false,
    })
    const branchSpy = vi.spyOn(sessionsApi, 'branch').mockResolvedValue({
      sessionId: branchSessionId,
      sourceSessionId: ACTIVE_TAB,
      targetAssistantMessageId: 'assistant-server-id',
      session: {
        id: branchSessionId,
        title: 'Test (Branch)',
        lastMessage: 'This answer just finished.',
        createdAt: '2026-04-06T00:00:00.000Z',
        modifiedAt: '2026-04-06T00:00:00.000Z',
        messageCount: 1,
        projectPath,
        workDir: '/tmp/branch-project',
        workDirExists: true,
        isTemporary: false,
      },
    })
    vi.spyOn(sessionsApi, 'list').mockResolvedValue({ sessions: [], total: 0 })

    render(
      <MessageList
        sessionId={ACTIVE_TAB}
        projectPath={projectPath}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Branch from this reply' }))

    await waitFor(() => {
      expect(branchSpy).toHaveBeenCalledWith(
        ACTIVE_TAB,
        {
          targetAssistantMessageId: 'assistant-server-id',
          expectedContent: 'This answer just finished.',
        },
        { projectPath },
      )
    })
    expect(useSessionRuntimeStore.getState().selections[branchSessionId]).toEqual(sourceSelection)
    expect(useTabStore.getState().activeTabId).toBe(branchSessionId)
    expect(useTabStore.getState().tabs).toContainEqual(
      expect.objectContaining({
        sessionId: branchSessionId,
        title: 'Test (Branch)',
        projectPath,
      }),
    )
  })

  it('branches after attached tool results instead of stopping at the preceding text', async () => {
    const getMessagesSpy = vi.spyOn(sessionsApi, 'getMessages')
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'assistant-with-tool',
              type: 'assistant_text',
              content: 'I will inspect that file.',
              timestamp: 1,
              serverId: 'assistant-text-server-id',
            },
            {
              id: 'tool-read',
              type: 'tool_use',
              toolName: 'Read',
              toolUseId: 'tool-read-id',
              input: { file_path: 'src/app.ts' },
              timestamp: 2,
              serverId: 'assistant-tool-server-id',
            },
            {
              id: 'tool-result',
              type: 'tool_result',
              toolUseId: 'tool-read-id',
              content: 'ok',
              isError: false,
              timestamp: 3,
            },
          ],
        }),
      },
    })
    const branchSpy = vi.spyOn(sessionsApi, 'branch').mockResolvedValue({
      sessionId: 'tool-branch-session',
      sourceSessionId: ACTIVE_TAB,
      targetAssistantMessageId: 'assistant-tool-server-id',
      session: {
        id: 'tool-branch-session',
        title: 'Test (Branch)',
        lastMessage: 'ok',
        createdAt: '2026-04-06T00:00:00.000Z',
        modifiedAt: '2026-04-06T00:00:00.000Z',
        messageCount: 3,
        projectPath: '-tmp-tool-project',
        workDir: '/tmp/tool-project',
        workDirExists: true,
        isTemporary: false,
      },
    })
    vi.spyOn(sessionsApi, 'list').mockResolvedValue({ sessions: [], total: 0 })

    render(<MessageList sessionId={ACTIVE_TAB} />)
    fireEvent.click(screen.getByRole('button', { name: 'Branch from this reply' }))

    await waitFor(() => {
      expect(branchSpy).toHaveBeenCalledWith(
        ACTIVE_TAB,
        { targetAssistantMessageId: 'assistant-tool-server-id' },
        { projectPath: undefined },
      )
    })
    expect(getMessagesSpy).not.toHaveBeenCalled()
  })

  it('resolves a newly streamed tool call before branching from mixed saved and live state', async () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'assistant-saved-text',
              type: 'assistant_text',
              content: 'I will run the tests.',
              timestamp: 1,
              serverId: 'assistant-saved-text-server',
            },
            {
              id: 'tool-live',
              type: 'tool_use',
              toolName: 'Bash',
              toolUseId: 'tool-live-id',
              input: { command: 'bun test' },
              timestamp: 2,
            },
            {
              id: 'tool-live-result',
              type: 'tool_result',
              toolUseId: 'tool-live-id',
              content: 'pass',
              isError: false,
              timestamp: 3,
            },
          ],
        }),
      },
    })
    const getMessagesSpy = vi.spyOn(sessionsApi, 'getMessages').mockResolvedValue({
      messages: [
        {
          id: 'assistant-saved-text-server',
          type: 'assistant',
          content: 'I will run the tests.',
          timestamp: '2026-04-06T00:00:00.000Z',
        },
        {
          id: 'assistant-live-tool-server',
          type: 'tool_use',
          content: [
            { type: 'tool_use', id: 'tool-live-id', name: 'Bash', input: { command: 'bun test' } },
          ],
          timestamp: '2026-04-06T00:00:01.000Z',
        },
        {
          id: 'tool-live-result-server',
          type: 'tool_result',
          content: [
            { type: 'tool_result', tool_use_id: 'tool-live-id', content: 'pass' },
          ],
          timestamp: '2026-04-06T00:00:02.000Z',
        },
      ],
      hasMore: false,
    })
    const branchSpy = vi.spyOn(sessionsApi, 'branch').mockResolvedValue({
      sessionId: 'mixed-state-branch',
      sourceSessionId: ACTIVE_TAB,
      targetAssistantMessageId: 'assistant-live-tool-server',
      session: {
        id: 'mixed-state-branch',
        title: 'Test (Branch)',
        lastMessage: 'pass',
        createdAt: '2026-04-06T00:00:00.000Z',
        modifiedAt: '2026-04-06T00:00:02.000Z',
        messageCount: 3,
        projectPath: '-tmp-mixed-project',
        workDir: '/tmp/mixed-project',
        workDirExists: true,
        isTemporary: false,
      },
    })
    vi.spyOn(sessionsApi, 'list').mockResolvedValue({ sessions: [], total: 0 })

    render(<MessageList sessionId={ACTIVE_TAB} />)
    fireEvent.click(screen.getByRole('button', { name: 'Branch from this reply' }))

    await waitFor(() => {
      expect(getMessagesSpy).toHaveBeenCalledWith(ACTIVE_TAB, {
        limit: 200,
        projectPath: undefined,
      })
      expect(branchSpy).toHaveBeenCalledWith(
        ACTIVE_TAB,
        { targetAssistantMessageId: 'assistant-live-tool-server' },
        { projectPath: undefined },
      )
    })
  })

  it('disables branching while the current AI turn is still running', () => {
    const branchSpy = vi.spyOn(sessionsApi, 'branch')
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          chatState: 'streaming',
          messages: [
            {
              id: 'assistant-running',
              type: 'assistant_text',
              content: 'Previous answer',
              timestamp: 1,
              serverId: 'assistant-running-server',
            },
          ],
          streamingText: 'New answer in progress',
        }),
      },
    })

    render(<MessageList sessionId={ACTIVE_TAB} />)

    const branchButton = screen.getByRole('button', { name: 'Branch from this reply' })
    expect((branchButton as HTMLButtonElement).disabled).toBe(true)
    expect(branchButton.getAttribute('title')).toBe('Wait for the current reply to finish')
    fireEvent.click(branchButton)
    expect(branchSpy).not.toHaveBeenCalled()
  })

  it('explains that the desktop service must be restarted when branch routing is outdated', async () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'assistant-outdated-sidecar',
              type: 'assistant_text',
              content: 'Saved answer',
              timestamp: 1,
              serverId: 'assistant-outdated-sidecar-server',
            },
          ],
        }),
      },
    })
    vi.spyOn(sessionsApi, 'branch').mockRejectedValue(
      new ApiError(405, { message: 'Method not allowed' }),
    )

    render(<MessageList sessionId={ACTIVE_TAB} />)
    fireEvent.click(screen.getByRole('button', { name: 'Branch from this reply' }))

    await waitFor(() => {
      expect(useUIStore.getState().toasts).toContainEqual(
        expect.objectContaining({
          type: 'error',
          message: 'The desktop service is out of date. Restart CyberCode and try again.',
        }),
      )
    })
  })

  it('does not force-scroll to the bottom while the user is reading history', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          chatState: 'streaming',
          messages: [
            {
              id: 'user-1',
              type: 'user_text',
              content: '历史消息',
              timestamp: 1,
            },
          ],
          streamingText: 'streaming',
        }),
      },
    })

    const { container } = render(<MessageList />)
    // Virtuoso renders its own scroll container; fall back to the outer overflow-y-auto div
    const scroller = container.querySelector('[data-testid="virtuoso-scroller"]') as HTMLDivElement
      ?? container.querySelector('.overflow-y-auto') as HTMLDivElement
    let scrollTop = 120
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 })
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = value
      },
    })

    scrollIntoView.mockClear()
    fireEvent.scroll(scroller)

    act(() => {
      useChatStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          [ACTIVE_TAB]: {
            ...state.sessions[ACTIVE_TAB]!,
            streamingText: 'streaming new token',
          },
        },
      }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('smooth-streaming-text').textContent).toBe('streaming new token')
    }, { timeout: 3_000 })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('keeps auto-scrolling when new output arrives while already near the bottom', async () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          chatState: 'streaming',
          messages: [
            {
              id: 'user-1',
              type: 'user_text',
              content: '最新消息',
              timestamp: 1,
            },
          ],
          streamingText: 'streaming',
        }),
      },
    })

    render(<MessageList />)

    act(() => {
      useChatStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          [ACTIVE_TAB]: {
            ...state.sessions[ACTIVE_TAB]!,
            streamingText: 'streaming next token',
          },
        },
      }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('smooth-streaming-text').textContent).toBe('streaming next token')
    }, { timeout: 3_000 })
  })

  it('places user actions left of the bubble and assistant actions right of the bubble', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'user-1',
              type: 'user_text',
              content: '请把这条 prompt 放在右侧',
              timestamp: 1,
            },
            {
              id: 'assistant-1',
              type: 'assistant_text',
              content: '这条回复应该停在左侧。',
              timestamp: 2,
            },
          ],
        }),
      },
    })

    render(<MessageList />)

    const userShell = screen.getByText('请把这条 prompt 放在右侧').closest('[data-message-shell="user"]')
    const assistantShell = screen.getByText('这条回复应该停在左侧。').closest('[data-message-shell="assistant"]')
    const userBubble = screen.getByText('请把这条 prompt 放在右侧').closest('[data-message-bubble="user"]')
    const assistantBubble = screen.getByText('这条回复应该停在左侧。').closest('[data-message-bubble="assistant"]')
    const userActions = screen.getByRole('button', { name: 'Copy prompt' }).closest('[data-message-actions]')
    const assistantActions = screen.getByRole('button', { name: 'Copy reply' }).closest('[data-message-actions]')
    const userRow = userBubble?.closest('[data-message-row="user"]')
    const assistantRow = assistantBubble?.closest('[data-message-row="assistant"]')

    expect(userShell).toBeTruthy()
    expect(userShell?.className).toContain('items-end')
    expect(assistantShell).toBeTruthy()
    expect(assistantShell?.className).not.toContain('items-end')
    expect(assistantShell?.className).not.toContain('ml-10')
    expect(userBubble?.className).toContain('px-[18px]')
    expect(userBubble?.className).toContain('py-[12px]')
    expect(assistantBubble?.className).toContain('px-[18px]')
    expect(assistantBubble?.className).toContain('py-[12px]')
    expect(assistantBubble?.className).not.toContain('p-[20px]')
    expect(assistantBubble?.className).toContain('rounded-bl-[8px]')
    expect(assistantBubble?.className).not.toContain('rounded-tl-[8px]')
    expect(userActions?.getAttribute('data-align')).toBe('end')
    expect(assistantActions?.getAttribute('data-align')).toBe('start')
    expect(userRow?.className).toContain('items-end')
    expect(userRow?.className).not.toContain('items-center')
    expect(assistantRow?.className).toContain('items-end')
    expect(assistantRow?.className).not.toContain('items-center')
    expect(userActions).toBeTruthy()
    expect(assistantActions).toBeTruthy()
    expect(userBubble).toBeTruthy()
    expect(assistantBubble).toBeTruthy()
    expect(userActions!.compareDocumentPosition(userBubble!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(assistantBubble!.compareDocumentPosition(assistantActions!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(userShell?.parentElement?.hasAttribute('data-message-hover-group')).toBe(true)
    expect(assistantShell?.parentElement?.hasAttribute('data-message-hover-group')).toBe(true)
    expect(userBubble?.hasAttribute('data-message-hover-trigger')).toBe(true)
    expect(assistantBubble?.hasAttribute('data-message-hover-trigger')).toBe(true)
    expect(userActions?.parentElement?.className).toContain('message-action-visibility')
    expect(assistantActions?.parentElement?.className).toContain('message-action-visibility')
    expect(userActions?.parentElement?.className).not.toContain('mr-[16px]')
    expect(assistantActions?.parentElement?.className).not.toContain('ml-[16px]')
    expect(assistantActions?.parentElement?.className).not.toContain('min-h-6')
    expect(userActions?.className).toContain('pointer-events-none')
    expect(assistantActions?.className).toContain('pointer-events-none')
    expect(userActions?.className).toContain('w-auto')
    expect(assistantActions?.className).toContain('w-auto')

    const userActionCluster = userActions?.querySelector('[data-message-action-cluster]')
    const assistantActionCluster = assistantActions?.querySelector('[data-message-action-cluster]')
    expect(userActionCluster?.className).toContain('pointer-events-auto')
    expect(assistantActionCluster?.className).toContain('pointer-events-auto')
    expect(userActionCluster?.className).not.toContain('pt-[8px]')
    expect(assistantActionCluster?.className).not.toContain('pt-[8px]')
  })

  it('hides the bottommost assistant actions after leaving downward', async () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'assistant-bottom',
              type: 'assistant_text',
              content: '最下方回复的操作按钮不能粘在输入框上方。',
              timestamp: 1,
            },
          ],
        }),
      },
    })

    render(<MessageList />)

    const bubble = screen
      .getByText('最下方回复的操作按钮不能粘在输入框上方。')
      .closest('[data-message-bubble="assistant"]')
    const actionCluster = screen
      .getByRole('button', { name: 'Copy reply' })
      .closest('[data-message-action-cluster]')
    const visibility = actionCluster?.closest('.message-action-visibility')

    expect(bubble).toBeTruthy()
    expect(actionCluster).toBeTruthy()
    expect(visibility?.getAttribute('data-actions-visible')).toBe('false')

    fireEvent.pointerEnter(bubble!)
    expect(visibility?.getAttribute('data-actions-visible')).toBe('true')

    fireEvent.pointerLeave(bubble!)
    await waitFor(() => {
      expect(visibility?.getAttribute('data-actions-visible')).toBe('false')
    })

    fireEvent.pointerEnter(bubble!)
    fireEvent.pointerLeave(bubble!)
    fireEvent.pointerEnter(actionCluster!)

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 90))
    })
    expect(visibility?.getAttribute('data-actions-visible')).toBe('true')

    fireEvent.pointerLeave(actionCluster!)
    await waitFor(() => {
      expect(visibility?.getAttribute('data-actions-visible')).toBe('false')
    })
  })

  it('keeps standalone message controls inside the shared chat column', () => {
    const messages: UIMessage[] = [
      {
        id: 'standalone-result',
        type: 'tool_result',
        toolUseId: 'missing-tool',
        content: 'Standalone result',
        isError: false,
        timestamp: 1,
      },
      {
        id: 'permission',
        type: 'permission_request',
        requestId: 'permission-1',
        toolName: 'Bash',
        input: { command: 'pwd' },
        timestamp: 2,
      },
      {
        id: 'summary',
        type: 'task_summary',
        tasks: [{ id: '1', subject: 'Finished task', status: 'completed' }],
        timestamp: 3,
      },
      {
        id: 'system',
        type: 'system',
        content: 'System notice',
        timestamp: 4,
      },
    ]

    for (const message of messages) {
      const { container, unmount } = render(
        <MessageBlock
          message={message}
          toolResultMap={new Map()}
          childToolCallsByParent={new Map()}
          agentTaskNotifications={{}}
        />,
      )
      const column = container.querySelector<HTMLElement>('[data-chat-content-column]')
      expect(column?.className).toContain('w-full')
      expect(column?.className).toContain('max-w-[878px]')
      expect(column?.parentElement?.className).toContain('px-[24px]')
      unmount()
    }
  })

  it('measures a short assistant bubble against the full message column', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'assistant-short',
              type: 'assistant_text',
              content: '测试通过。',
              timestamp: 1,
            },
          ],
        }),
      },
    })

    render(<MessageList />)

    const bubble = screen.getByText('测试通过。').closest('[data-message-bubble="assistant"]')
    expect(bubble?.parentElement?.className).toContain('w-full')
    expect(bubble?.className).toContain('w-fit')
  })

  it('uses the document column for markdown-heavy assistant replies', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'assistant-doc',
              type: 'assistant_text',
              content: [
                '## 交付结果',
                '',
                '已完成以下内容：',
                '',
                '- 添加任务',
                '- 删除任务',
                '',
                '```bash',
                'npm run build',
                '```',
              ].join('\n'),
              timestamp: 1,
            },
          ],
        }),
      },
    })

    render(<MessageList />)

    const assistantShell = screen.getByText('交付结果').closest('[data-message-shell="assistant"]')
    const assistantBubble = screen.getByText('交付结果').closest('[data-message-bubble="assistant"]')
    expect(assistantShell?.getAttribute('data-layout')).toBe('document')
    expect(assistantShell?.className).toContain('w-full')
    expect(assistantShell?.className).not.toContain('ml-10')
    expect(assistantBubble?.className).toContain('px-[18px]')
    expect(assistantBubble?.className).toContain('py-[12px]')
  })

  it('opens a rewind preview modal for user messages', async () => {
    vi.spyOn(sessionsApi, 'rewind').mockResolvedValue({
      target: {
        targetUserMessageId: 'user-1',
        userMessageIndex: 0,
        userMessageCount: 1,
      },
      conversation: {
        messagesRemoved: 2,
      },
      code: {
        available: true,
        filesChanged: ['src/example.ts'],
        insertions: 6,
        deletions: 2,
      },
    })

    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'ui-user-1',
              type: 'user_text',
              content: '回到这一步重做',
              timestamp: 1,
              serverId: 'user-1',
            },
          ],
        }),
      },
    })

    render(<MessageList />)

    fireEvent.click(screen.getByRole('button', { name: 'Rewind to here' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Rewind Conversation')).toBeTruthy()
    expect(within(dialog).getByText('回到这一步重做')).toBeTruthy()
    expect(within(dialog).getByText('src/example.ts')).toBeTruthy()
    expect(sessionsApi.rewind).toHaveBeenCalledWith(
      ACTIVE_TAB,
      {
        targetUserMessageId: 'user-1',
        userMessageIndex: 0,
        userMessageOffsetFromEnd: 0,
        expectedContent: '回到这一步重做',
        dryRun: true,
      },
      { projectPath: undefined },
    )
  })

  it('localizes message action hints and copy feedback in Chinese', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    useSettingsStore.setState({ locale: 'zh' })
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'localized-user',
              type: 'user_text',
              content: '从这里重做',
              timestamp: 1,
              serverId: 'localized-user-server',
            },
            {
              id: 'localized-assistant',
              type: 'assistant_text',
              content: '可以从这里创建分支',
              timestamp: 2,
              serverId: 'localized-assistant-server',
              branchServerId: 'localized-assistant-server',
            },
          ],
        }),
      },
    })

    render(<MessageList />)

    const rewindButton = screen.getByRole('button', { name: '回滚到这里' })
    const branchButton = screen.getByRole('button', { name: '从此回复创建分支' })
    const copyPromptButton = screen.getByRole('button', { name: '复制提问' })
    const copyReplyButton = screen.getByRole('button', { name: '复制回复' })
    expect(rewindButton.getAttribute('title')).toBe('回滚到这里')
    expect(branchButton.getAttribute('title')).toBe('从此回复创建分支')
    expect(copyPromptButton.getAttribute('title')).toBe('复制提问')
    expect(copyReplyButton.getAttribute('title')).toBe('复制回复')
    for (const button of [
      rewindButton,
      branchButton,
      copyPromptButton,
      copyReplyButton,
    ]) {
      expect(button.className).toContain('message-action-button')
      expect(button.className).toContain('h-[24px]')
      expect(button.className).toContain('w-[24px]')
      expect(button.className).toContain('shrink-0')
      expect(button.className).toContain('border-0')
    }
    expect(rewindButton.parentElement?.className).toContain('gap-[6px]')
    expect(branchButton.parentElement?.className).toContain('gap-[6px]')
    expect(screen.queryByText('Rewind')).toBeNull()

    fireEvent.click(copyReplyButton)
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('可以从这里创建分支')
      expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy()
    })
  })

  it('confirms rewind with the selected message id and prompt guard', async () => {
    vi.spyOn(sessionsApi, 'rewind').mockResolvedValue({
      target: {
        targetUserMessageId: 'user-2',
        userMessageIndex: 1,
        userMessageCount: 2,
      },
      conversation: {
        messagesRemoved: 2,
      },
      code: {
        available: false,
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      },
    })
    const reloadHistory = vi.fn().mockResolvedValue(undefined)
    const queueComposerPrefill = vi.fn()

    useChatStore.setState({
      reloadHistory,
      queueComposerPrefill,
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'user-1',
              type: 'user_text',
              content: '第一段',
              timestamp: 1,
            },
            {
              id: 'assistant-1',
              type: 'assistant_text',
              content: 'ok',
              timestamp: 2,
            },
            {
              id: 'user-2',
              type: 'user_text',
              content: '第二段',
              timestamp: 3,
            },
          ],
        }),
      },
    })

    const { container } = render(<MessageList />)

    const buttons = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Rewind to here"]',
    )
    // Messages render in chronological order, so user-2 is the second rewind action.
    fireEvent.click(buttons[1]!)
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    const confirmButton = [...dialog!.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('Rewind here'))
    expect(confirmButton).toBeDefined()
    await waitFor(() => expect(confirmButton?.disabled).toBe(false))
    fireEvent.click(confirmButton!)

    await waitFor(() => {
      expect(sessionsApi.rewind).toHaveBeenLastCalledWith(
        ACTIVE_TAB,
        {
          targetUserMessageId: 'user-2',
          userMessageIndex: 1,
          userMessageOffsetFromEnd: 0,
          expectedContent: '第二段',
        },
        { projectPath: undefined },
      )
    })
    expect(reloadHistory).toHaveBeenCalledWith(ACTIVE_TAB, undefined)
    expect(queueComposerPrefill).toHaveBeenCalledWith(ACTIVE_TAB, {
      text: '第二段',
      attachments: undefined,
    })
  })

  it('shows raw startup details under translated CLI startup errors', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'error-1',
              type: 'error',
              code: 'CLI_START_FAILED',
              message:
                'CLI exited during startup (code 1): CyberCode on Windows requires git-bash (https://git-scm.com/downloads/win).',
              timestamp: 1,
            },
          ],
        }),
      },
    })

    const { container } = render(<MessageList />)

    expect(screen.getByText('Failed to start CLI process.')).toBeTruthy()
    expect(
      screen.getByText(
        'CLI exited during startup (code 1): CyberCode on Windows requires git-bash (https://git-scm.com/downloads/win).',
      ),
    ).toBeTruthy()
    expect(container.querySelector('[data-message-shell="error"]')?.className).toContain('max-w-[878px]')
    expect(container.querySelector('[data-message-error]')?.className).toContain('rounded-bl-[8px]')
    expect(container.querySelector('[data-message-error]')?.className).not.toContain('rounded-tl-[8px]')
    expect(container.querySelector('[data-message-error]')?.className).toContain('[overflow-wrap:anywhere]')
    expect(container.querySelector<HTMLElement>('[data-message-error]')?.style.color).toBe('var(--color-error)')
    expect(container.querySelector<HTMLElement>('[data-message-error-detail]')?.style.color).toBe('var(--color-error)')
  })

  it('shows a localized retry message without exposing internal execution diagnostics', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'error-no-model-response',
              type: 'error',
              code: 'MODEL_NO_RESPONSE',
              message: '[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null',
              timestamp: 1,
            },
          ],
        }),
      },
    })

    const { container } = render(<MessageList />)

    expect(screen.getByText(/model connection ended/i)).toBeTruthy()
    expect(container.textContent).not.toContain('[ede_diagnostic]')
    expect(container.querySelector('[data-message-error-detail]')).toBeNull()
  })

  it('renders assistant API error text with the red error treatment', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'assistant-error-1',
              type: 'assistant_text',
              content:
                'Error: API Error: 400 {"error":{"code":"InvalidParameter","message":"Model do not support image input","type":"BadRequest"}}',
              timestamp: 1,
            },
          ],
        }),
      },
    })

    const { container } = render(<MessageList />)

    expect(screen.getByText(/API Error: 400/)).toBeTruthy()
    expect(container.querySelector('[data-message-shell="assistant"]')).toBeNull()
    expect(container.querySelector('[data-message-shell="error"]')?.className).toContain('max-w-[878px]')
    expect(container.querySelector<HTMLElement>('[data-message-error]')?.style.color).toBe('var(--color-error)')
  })

  it('retries a loaded anchor when the first WebKit scroll write is ignored', async () => {
    const originalRect = Element.prototype.getBoundingClientRect
    let scrollTop = 200
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const testId = this.getAttribute('data-testid') ?? ''
      if (testId.startsWith('message-anchor-rail')) return new DOMRect(0, 0, 24, 600)
      if (testId === 'virtuoso-scroller') return new DOMRect(0, 100, 800, 400)
      if (this.getAttribute('data-render-index') === '0') {
        return new DOMRect(0, 1_100 - scrollTop, 800, 100)
      }
      return originalRect.call(this)
    })

    try {
      useChatStore.setState({
        sessions: {
          [ACTIVE_TAB]: makeSessionState({
            messages: [
              { id: 'local-u1', serverId: 'srv-u1', type: 'user_text', content: 'first question', timestamp: 1 },
              { id: 'local-a1', type: 'assistant_text', content: 'first answer', timestamp: 2 },
              { id: 'local-u2', serverId: 'srv-u2', type: 'user_text', content: 'second question', timestamp: 3 },
              { id: 'local-a2', type: 'assistant_text', content: 'second answer', timestamp: 4 },
              { id: 'local-u3', serverId: 'srv-u3', type: 'user_text', content: 'third question', timestamp: 5 },
            ],
            anchors: [
              { seq: 0, messageId: 'srv-u1', preview: 'first question' },
              { seq: 1, messageId: 'srv-u2', preview: 'second question' },
              { seq: 2, messageId: 'srv-u3', preview: 'third question' },
            ],
            anchorsLoaded: true,
          }),
        },
      })

      const { container } = render(<MessageList />)
      const anchor = await screen.findByTestId('message-anchor-srv-u1')
      const scroller = container.querySelector<HTMLElement>('[data-testid="virtuoso-scroller"]')!
      let scrollWriteCount = 0
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 })
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1_800 })
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollWriteCount += 1
          if (scrollWriteCount > 1) scrollTop = Number(value)
        },
      })

      fireEvent.click(anchor)

      // targetTop = 200 + (900 - 100); centered by (400 - 100) / 2.
      await waitFor(() => expect(scrollTop).toBe(850))
      expect(scrollWriteCount).toBeGreaterThan(1)
      const userBubble = screen.getByText('first question').closest('[data-message-bubble="user"]')
      expect(userBubble?.classList.contains('anchor-user-bubble-highlight')).toBe(true)
      expect(userBubble?.closest('[data-render-index="0"]')?.classList.contains('anchor-jump-flash')).toBe(false)
      const firstVariant = userBubble?.classList.contains('anchor-user-bubble-highlight-even')
        ? 'anchor-user-bubble-highlight-even'
        : 'anchor-user-bubble-highlight-odd'

      fireEvent.scroll(scroller)
      await waitFor(() => {
        expect(userBubble?.classList.contains('anchor-user-bubble-highlight')).toBe(true)
      })

      fireEvent.click(anchor)
      const secondVariant = firstVariant === 'anchor-user-bubble-highlight-even'
        ? 'anchor-user-bubble-highlight-odd'
        : 'anchor-user-bubble-highlight-even'
      await waitFor(() => {
        expect(userBubble?.classList.contains(firstVariant)).toBe(false)
        expect(userBubble?.classList.contains(secondVariant)).toBe(true)
      })
    } finally {
      rectSpy.mockRestore()
    }
  })

  it('resolves a loaded anchor by stable message id when its render index is stale', async () => {
    const originalRect = Element.prototype.getBoundingClientRect
    let scrollTop = 200
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const testId = this.getAttribute('data-testid') ?? ''
      if (testId.startsWith('message-anchor-rail')) return new DOMRect(0, 0, 24, 600)
      if (testId === 'virtuoso-scroller') return new DOMRect(0, 100, 800, 400)
      if (this.getAttribute('data-message-anchor-server-id') === 'srv-u1') {
        return new DOMRect(0, 1_100 - scrollTop, 800, 100)
      }
      return originalRect.call(this)
    })

    try {
      useChatStore.setState({
        sessions: {
          [ACTIVE_TAB]: makeSessionState({
            messages: [
              { id: 'local-u1', serverId: 'srv-u1', type: 'user_text', content: 'first question', timestamp: 1 },
              { id: 'local-a1', type: 'assistant_text', content: 'first answer', timestamp: 2 },
              { id: 'local-u2', serverId: 'srv-u2', type: 'user_text', content: 'second question', timestamp: 3 },
              { id: 'local-a2', type: 'assistant_text', content: 'second answer', timestamp: 4 },
              { id: 'local-u3', serverId: 'srv-u3', type: 'user_text', content: 'third question', timestamp: 5 },
            ],
            anchors: [
              { seq: 0, messageId: 'srv-u1', preview: 'first question' },
              { seq: 1, messageId: 'srv-u2', preview: 'second question' },
              { seq: 2, messageId: 'srv-u3', preview: 'third question' },
            ],
            anchorsLoaded: true,
          }),
        },
      })

      const { container } = render(<MessageList />)
      const anchor = await screen.findByTestId('message-anchor-srv-u1')
      const target = container.querySelector<HTMLElement>(
        '[data-message-anchor-server-id="srv-u1"]',
      )!
      const staleIndexTarget = container.querySelector<HTMLElement>(
        '[data-message-anchor-server-id="srv-u2"]',
      )!
      target.dataset.renderIndex = '99'
      staleIndexTarget.dataset.renderIndex = '0'

      const scroller = container.querySelector<HTMLElement>('[data-testid="virtuoso-scroller"]')!
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 })
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1_800 })
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => { scrollTop = Number(value) },
      })

      fireEvent.click(anchor)

      expect(scrollTop).toBe(850)
    } finally {
      rectSpy.mockRestore()
    }
  })

  it('waits for a slow history target to commit before completing the anchor jump', async () => {
    const originalRect = Element.prototype.getBoundingClientRect
    let scrollTop = 50
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const testId = this.getAttribute('data-testid') ?? ''
      if (testId.startsWith('message-anchor-rail')) return new DOMRect(0, 0, 24, 600)
      if (testId === 'virtuoso-scroller') return new DOMRect(0, 100, 800, 400)
      if (this.getAttribute('data-render-index') === '0') {
        return new DOMRect(0, 850 - scrollTop, 800, 80)
      }
      return originalRect.call(this)
    })
    let resolveHistoryLoad: (value: boolean) => void = () => {}
    const historyUntilDeferred = new Promise<boolean>((resolve) => { resolveHistoryLoad = resolve })
    const loadHistoryUntilOrig = useChatStore.getState().loadHistoryUntil

    try {
      useChatStore.setState({
        loadHistoryUntil: () => historyUntilDeferred,
        sessions: {
          [ACTIVE_TAB]: makeSessionState({
            allMessagesLoaded: false,
            messages: [
              { id: 'loaded-u1', serverId: 'srv-u1', type: 'user_text', content: 'loaded one', timestamp: 1 },
              { id: 'loaded-u2', serverId: 'srv-u2', type: 'user_text', content: 'loaded two', timestamp: 2 },
              { id: 'loaded-u3', serverId: 'srv-u3', type: 'user_text', content: 'loaded three', timestamp: 3 },
            ],
            anchors: [
              { seq: 0, messageId: 'srv-old', preview: 'old question' },
              { seq: 1, messageId: 'srv-u2', preview: 'loaded two' },
              { seq: 2, messageId: 'srv-u3', preview: 'loaded three' },
            ],
            anchorsLoaded: true,
          }),
        },
      })

      const { container } = render(<MessageList />)
      const anchor = await screen.findByTestId('message-anchor-srv-old')
      const scroller = container.querySelector<HTMLElement>('[data-testid="virtuoso-scroller"]')!
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 })
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2_000 })
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => { scrollTop = Number(value) },
      })

      fireEvent.click(anchor)
      await act(async () => {
        resolveHistoryLoad(true)
        await historyUntilDeferred
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(scrollTop).not.toBe(590)
      scrollTop = 50

      act(() => {
        useChatStore.setState({
          sessions: {
            [ACTIVE_TAB]: makeSessionState({
              messages: [
                { id: 'local-old', serverId: 'srv-old', type: 'user_text', content: 'old question', timestamp: 1 },
                { id: 'local-old-answer', type: 'assistant_text', content: 'old answer', timestamp: 2 },
              ],
              anchors: [
                { seq: 0, messageId: 'srv-old', preview: 'old question' },
                { seq: 1, messageId: 'srv-u2', preview: 'loaded two' },
                { seq: 2, messageId: 'srv-u3', preview: 'loaded three' },
              ],
              anchorsLoaded: true,
            }),
          },
        })
      })

      // targetTop = 50 + (800 - 100); centered by (400 - 80) / 2.
      await waitFor(() => expect(scrollTop).toBe(590))
      expect(screen.getByTestId('message-anchor-bar-srv-old').className).not.toContain('anchor-bar-loading')
    } finally {
      act(() => {
        useChatStore.setState({ loadHistoryUntil: loadHistoryUntilOrig })
      })
      rectSpy.mockRestore()
    }
  })

  it('allows clicking a different anchor while another load is in flight (Bug 1 fix)', async () => {
    const original = Element.prototype.getBoundingClientRect
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const testId = this.getAttribute('data-testid') ?? ''
      if (testId.startsWith('message-anchor-rail')) {
        return new DOMRect(0, 0, 24, 600)
      }
      return original.call(this)
    })
    let resolveHistoryLoad: (value: boolean) => void = () => {}
    const historyUntilDeferred = new Promise<boolean>((resolve) => { resolveHistoryLoad = resolve })
    const loadHistoryUntilOrig = useChatStore.getState().loadHistoryUntil
    useChatStore.setState({
      loadHistoryUntil: () => historyUntilDeferred,
    })
    const scrollByStub = vi.fn()
    const originalScrollBy = Element.prototype.scrollBy
    Element.prototype.scrollBy = scrollByStub
    try {
      useChatStore.setState({
        sessions: {
          [ACTIVE_TAB]: makeSessionState({
            allMessagesLoaded: false,
            messages: [
              { id: 'loaded-u1', type: 'user_text', content: 'first loaded question', timestamp: 2, serverId: 'srv-u1' },
              { id: 'loaded-a1', type: 'assistant_text', content: 'answer one', timestamp: 3 },
            ],
            anchors: [
              { seq: 0, messageId: 'srv-old-1', preview: 'old question one' },
              { seq: 1, messageId: 'srv-old-2', preview: 'old question two' },
              { seq: 2, messageId: 'srv-u1', preview: 'first loaded question' },
            ],
            anchorsLoaded: true,
          }),
        },
      })

      render(<MessageList />)

      const bar1 = await screen.findByTestId('message-anchor-srv-old-1')
      const bar2 = screen.findByTestId('message-anchor-srv-old-2')

      fireEvent.click(bar1)
      fireEvent.click(await bar2)

      expect(screen.getByTestId('message-anchor-bar-srv-old-1').className).not.toContain('anchor-bar-loading')
      expect(screen.getByTestId('message-anchor-bar-srv-old-2').className).toContain('anchor-bar-loading')

      await act(async () => {
        resolveHistoryLoad(true)
        await historyUntilDeferred
      })
      await waitFor(() => {
        expect(useChatStore.getState().loadHistoryUntil).not.toBe(loadHistoryUntilOrig)
        expect(screen.getByTestId('message-anchor-bar-srv-old-2').className).toContain('anchor-bar-loading')
      })
    } finally {
      act(() => {
        useChatStore.setState({ loadHistoryUntil: loadHistoryUntilOrig })
      })
      Element.prototype.scrollBy = originalScrollBy
      rectSpy.mockRestore()
    }
  })

  it('falls back to renderItems search when anchor id mismatches (Bug 2 fix)', async () => {
    const original = Element.prototype.getBoundingClientRect
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const testId = this.getAttribute('data-testid') ?? ''
      if (testId.startsWith('message-anchor-rail')) {
        return new DOMRect(0, 0, 24, 600)
      }
      return original.call(this)
    })
    try {
      useChatStore.setState({
        sessions: {
          [ACTIVE_TAB]: makeSessionState({
            messages: [
              { id: 'local-msg-1', type: 'user_text', content: 'my first question', timestamp: 1, serverId: 'srv-msg-1' },
              { id: 'local-a-1', type: 'assistant_text', content: 'first answer', timestamp: 2 },
              { id: 'local-msg-2', type: 'user_text', content: 'my second question', timestamp: 3, serverId: 'srv-msg-2' },
              { id: 'local-a-2', type: 'assistant_text', content: 'second answer', timestamp: 4 },
              { id: 'local-msg-3', type: 'user_text', content: 'my third question', timestamp: 5, serverId: 'srv-msg-3' },
              { id: 'local-a-3', type: 'assistant_text', content: 'third answer', timestamp: 6 },
            ],
            anchors: undefined,
            anchorsLoaded: false,
          }),
        },
      })

      const { rerender } = render(<MessageList />)

      // Fallback anchors need at least 3 user messages to render the rail
      // (MessageAnchorRail hides itself when anchors.length < 3).
      const bar1 = await screen.findByTestId('message-anchor-srv-msg-1')
      expect(bar1).toBeTruthy()
      fireEvent.pointerEnter(screen.getByTestId('message-anchor-row-srv-msg-1'))
      expect((await screen.findByTestId('message-anchor-answer-preview')).textContent).toBe('first answer')
      fireEvent.pointerLeave(screen.getByTestId('message-anchor-row-srv-msg-1'))

      act(() => {
        useChatStore.setState({
          sessions: {
            [ACTIVE_TAB]: makeSessionState({
              messages: [
                { id: 'local-msg-1', type: 'user_text', content: 'my first question', timestamp: 1, serverId: 'srv-msg-1' },
                { id: 'local-a-1', type: 'assistant_text', content: 'first answer', timestamp: 2 },
                { id: 'local-msg-2', type: 'user_text', content: 'my second question', timestamp: 3, serverId: 'srv-msg-2' },
                { id: 'local-a-2', type: 'assistant_text', content: 'second answer', timestamp: 4 },
                { id: 'local-msg-3', type: 'user_text', content: 'my third question', timestamp: 5, serverId: 'srv-msg-3' },
                { id: 'local-a-3', type: 'assistant_text', content: 'third answer', timestamp: 6 },
              ],
              anchors: [
                { seq: 0, messageId: 'srv-msg-1', preview: 'my first question' },
                { seq: 1, messageId: 'srv-msg-2', preview: 'my second question' },
                { seq: 2, messageId: 'srv-msg-3', preview: 'my third question' },
              ],
              anchorsLoaded: true,
            }),
          },
        })
      })

      rerender(<MessageList />)

      await waitFor(() => {
        const srvBar1 = screen.getByTestId('message-anchor-bar-srv-msg-1')
        expect(srvBar1.getAttribute('data-loaded')).toBe('true')
      })
    } finally {
      rectSpy.mockRestore()
    }
  })
})
