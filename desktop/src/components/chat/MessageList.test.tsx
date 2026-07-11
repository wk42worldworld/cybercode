import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MessageList, buildRenderModel } from './MessageList'
import { sessionsApi } from '../../api/sessions'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
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

    render(<MessageList __testInitialItemCount={100} />)

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
      expect(screen.getByText('正在生成回复')).toBeTruthy()
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
      <MessageList __testInitialItemCount={100} />,
    )

    expect(container.querySelector('[data-running="true"]')).toBeNull()
    expect(container.querySelector('[data-interrupted="true"]')).toBeTruthy()
    expect(container.querySelector('.tool-running-text')).toBeNull()
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

    const { container } = render(<MessageList __testInitialItemCount={100} />)

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

    render(<MessageList __testInitialItemCount={100} />)

    expect(screen.getByText('Stopped')).toBeTruthy()
    expect(screen.queryByText('Running')).toBeNull()
  })

  it('keeps root tool runs split when nested child tool calls appear between them', () => {
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

    expect(toolGroups).toHaveLength(2)
    expect(toolGroups.map((item) => item.toolCalls[0]?.toolUseId)).toEqual(['agent-1', 'write-1'])
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

    render(<MessageList __testInitialItemCount={100} />)

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

    render(<MessageList __testInitialItemCount={100} />)

    expect(screen.getByText('Done')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View result' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'View result' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/第二段补充内容用于验证 dialog 展示的是完整结果而不是截断摘要。/)).toBeTruthy()
    expect(within(dialog).queryByText(/agentId:/)).toBeNull()
    expect(within(dialog).queryByText(/total_tokens/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeTruthy()
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

    render(<MessageList __testInitialItemCount={100} />)

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

    render(<MessageList __testInitialItemCount={100} />)

    expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeTruthy()

    // Messages render in chronological order: oldest at top, newest at bottom.
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy reply' })[0]!)

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('先看 CLI 和服务端入口。')
    })
    expect(writeText).not.toHaveBeenCalledWith(
      '先看 CLI 和服务端入口。\n再看 desktop 前后端边界。'
    )
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

    const { container } = render(<MessageList __testInitialItemCount={100} />)
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
      expect(screen.getByText('streaming new token')).toBeTruthy()
    })
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

    render(<MessageList __testInitialItemCount={100} />)

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
      expect(screen.getByText('streaming next token')).toBeTruthy()
    })
  })

  it('keeps user actions anchored to the right bubble and assistant actions to the left bubble', () => {
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

    render(<MessageList __testInitialItemCount={100} />)

    const userShell = screen.getByText('请把这条 prompt 放在右侧').closest('[data-message-shell="user"]')
    const assistantShell = screen.getByText('这条回复应该停在左侧。').closest('[data-message-shell="assistant"]')
    const userBubble = screen.getByText('请把这条 prompt 放在右侧').closest('[data-message-bubble="user"]')
    const assistantBubble = screen.getByText('这条回复应该停在左侧。').closest('[data-message-bubble="assistant"]')
    const userActions = screen.getByRole('button', { name: 'Copy prompt' }).closest('[data-message-actions]')
    const assistantActions = screen.getByRole('button', { name: 'Copy reply' }).closest('[data-message-actions]')

    expect(userShell).toBeTruthy()
    expect(userShell?.className).toContain('items-end')
    expect(assistantShell).toBeTruthy()
    expect(assistantShell?.className).not.toContain('items-end')
    expect(assistantShell?.className).not.toContain('ml-10')
    expect(userBubble?.className).toContain('px-[24px]')
    expect(userBubble?.className).toContain('py-[16px]')
    expect(assistantBubble?.className).toContain('px-[24px]')
    expect(assistantBubble?.className).toContain('py-[16px]')
    expect(assistantBubble?.className).not.toContain('p-[20px]')
    expect(userActions?.getAttribute('data-align')).toBe('end')
    expect(assistantActions?.getAttribute('data-align')).toBe('start')
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

    render(<MessageList __testInitialItemCount={100} />)

    const assistantShell = screen.getByText('交付结果').closest('[data-message-shell="assistant"]')
    const assistantBubble = screen.getByText('交付结果').closest('[data-message-bubble="assistant"]')
    expect(assistantShell?.getAttribute('data-layout')).toBe('document')
    expect(assistantShell?.className).toContain('w-full')
    expect(assistantShell?.className).not.toContain('ml-10')
    expect(assistantBubble?.className).toContain('px-[24px]')
    expect(assistantBubble?.className).toContain('py-[16px]')
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
              id: 'user-1',
              type: 'user_text',
              content: '回到这一步重做',
              timestamp: 1,
            },
          ],
        }),
      },
    })

    render(<MessageList __testInitialItemCount={100} />)

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
        expectedContent: '回到这一步重做',
        dryRun: true,
      },
      { projectPath: undefined },
    )
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

    render(<MessageList __testInitialItemCount={100} />)

    const buttons = screen.getAllByRole('button', { name: 'Rewind to here' })
    // Messages render in chronological order, so user-2 is the second rewind action.
    fireEvent.click(buttons[1]!)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Rewind here/ }))

    await waitFor(() => {
      expect(sessionsApi.rewind).toHaveBeenLastCalledWith(
        ACTIVE_TAB,
        {
          targetUserMessageId: 'user-2',
          userMessageIndex: 1,
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
                'CLI exited during startup (code 1): Claude Code on Windows requires git-bash (https://git-scm.com/downloads/win).',
              timestamp: 1,
            },
          ],
        }),
      },
    })

    const { container } = render(<MessageList __testInitialItemCount={100} />)

    expect(screen.getByText('Failed to start CLI process.')).toBeTruthy()
    expect(
      screen.getByText(
        'CLI exited during startup (code 1): Claude Code on Windows requires git-bash (https://git-scm.com/downloads/win).',
      ),
    ).toBeTruthy()
    expect(container.querySelector('[data-message-shell="error"]')?.className).toContain('max-w-[878px]')
    expect(container.querySelector('[data-message-error]')?.className).toContain('[overflow-wrap:anywhere]')
    expect(container.querySelector<HTMLElement>('[data-message-error]')?.style.color).toBe('var(--color-error)')
    expect(container.querySelector<HTMLElement>('[data-message-error-detail]')?.style.color).toBe('var(--color-error)')
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

    const { container } = render(<MessageList __testInitialItemCount={100} />)

    expect(screen.getByText(/API Error: 400/)).toBeTruthy()
    expect(container.querySelector('[data-message-shell="assistant"]')).toBeNull()
    expect(container.querySelector('[data-message-shell="error"]')?.className).toContain('max-w-[878px]')
    expect(container.querySelector<HTMLElement>('[data-message-error]')?.style.color).toBe('var(--color-error)')
  })
})
