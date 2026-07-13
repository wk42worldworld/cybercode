import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageList } from './MessageList'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import type { PerSessionState } from '../../stores/chatStore'
import type { UIMessage } from '../../types/chat'

const virtuosoMock = vi.hoisted(() => {
  let latestProps: any = null
  let autoSettle = true

  return {
    autoscrollToBottom: vi.fn(),
    getAutoSettle: () => autoSettle,
    getLatestProps: () => latestProps,
    reset: () => {
      latestProps = null
      autoSettle = true
    },
    scrollToIndex: vi.fn(),
    setAutoSettle: (value: boolean) => {
      autoSettle = value
    },
    setLatestProps: (props: any) => {
      latestProps = props
    },
  }
})

vi.mock('react-virtuoso', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  const Virtuoso = React.forwardRef(function MockVirtuoso(props: any, ref) {
    virtuosoMock.setLatestProps(props)

    React.useImperativeHandle(ref, () => ({
      autoscrollToBottom: virtuosoMock.autoscrollToBottom,
      getState: () => undefined,
      scrollBy: () => undefined,
      scrollIntoView: () => undefined,
      scrollTo: () => undefined,
      scrollToIndex: virtuosoMock.scrollToIndex,
    }))

    React.useEffect(() => {
      if (!virtuosoMock.getAutoSettle()) return
      const items = props.data ?? []
      if (items.length === 0) return
      const firstItemIndex = props.firstItemIndex ?? 0
      const lastItemIndex = firstItemIndex + items.length - 1

      props.rangeChanged?.({ startIndex: firstItemIndex, endIndex: lastItemIndex })
      props.itemsRendered?.(
        items.map((data: unknown, index: number) => ({
          data,
          index: firstItemIndex + index,
          offset: index * 40,
          size: 40,
        })),
      )
      props.totalListHeightChanged?.(items.length * 40)
      props.atBottomStateChange?.(true)
    }, [
      props.data,
      props.firstItemIndex,
      props.rangeChanged,
      props.itemsRendered,
      props.totalListHeightChanged,
      props.atBottomStateChange,
    ])

    const firstItemIndex = props.firstItemIndex ?? 0
    const children = (props.data ?? []).map((item: unknown, index: number) =>
      React.createElement(
        'div',
        { key: props.computeItemKey?.(firstItemIndex + index, item) ?? index },
        props.itemContent?.(firstItemIndex + index, item),
      ),
    )
    const Footer = props.components?.Footer

    return React.createElement(
      'div',
      { 'data-testid': 'mock-virtuoso' },
      ...children,
      Footer ? React.createElement(Footer) : null,
    )
  })

  return { Virtuoso }
})

function makeSessionState(overrides: Partial<PerSessionState> = {}): PerSessionState {
  return {
    messages: [],
    historyBuffer: [],
    recentBuffer: [],
    allMessagesLoaded: true,
    historyLoadState: 'loaded',
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

function userMessage(id: string, content: string, timestamp = 1): UIMessage {
  return {
    id,
    type: 'user_text',
    content,
    timestamp,
  }
}

function assistantMessage(id: string, content: string, timestamp = 1): UIMessage {
  return {
    id,
    type: 'assistant_text',
    content,
    timestamp,
  }
}

function thinkingMessage(id: string, content: string, timestamp = 1): UIMessage {
  return {
    id,
    type: 'thinking',
    content,
    timestamp,
  }
}

describe('MessageList initial bottom positioning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    virtuosoMock.reset()
    useSettingsStore.setState({ locale: 'en' })
    useTabStore.setState({
      activeTabId: 'session-a',
      tabs: [
        { sessionId: 'session-a', title: 'A', type: 'session', status: 'idle' },
        { sessionId: 'session-b', title: 'B', type: 'session', status: 'idle' },
      ],
    })
    useChatStore.setState({
      loadHistory: vi.fn().mockResolvedValue(undefined),
      loadMoreHistory: vi.fn().mockResolvedValue(undefined),
      loadMoreRecent: vi.fn(),
      sessions: {
        'session-a': makeSessionState({
          messages: [
            userMessage('a-1', 'old session'),
            userMessage('a-2', 'old session latest', 2),
          ],
        }),
        'session-b': makeSessionState({
          messages: [
            userMessage('b-1', 'new session'),
            userMessage('b-2', 'new session latest', 2),
          ],
        }),
      },
    })
  })

  it('forces the newest message into view after switching sessions', async () => {
    const { rerender } = render(<MessageList sessionId="session-a" projectPath="/tmp/a" />)

    await waitFor(() => {
      expect(virtuosoMock.scrollToIndex).toHaveBeenCalledWith({
        index: 'LAST',
        align: 'end',
        behavior: 'auto',
      })
    })

    virtuosoMock.scrollToIndex.mockClear()

    rerender(<MessageList sessionId="session-b" projectPath="/tmp/b" />)

    await waitFor(() => {
      expect(virtuosoMock.scrollToIndex).toHaveBeenCalledWith({
        index: 'LAST',
        align: 'end',
        behavior: 'auto',
      })
    })
  })

  it('waits for async-loaded history before doing the initial bottom scroll', async () => {
    useChatStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        'session-b': makeSessionState({
          allMessagesLoaded: false,
          historyLoadState: 'loading',
          messages: [],
        }),
      },
    }))

    render(<MessageList sessionId="session-b" projectPath="/tmp/b" />)

    expect(virtuosoMock.scrollToIndex).not.toHaveBeenCalled()

    act(() => {
      useChatStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          'session-b': makeSessionState({
            messages: [
              userMessage('b-1', 'loaded session'),
              userMessage('b-2', 'loaded session latest', 2),
            ],
          }),
        },
      }))
    })

    await waitFor(() => {
      expect(virtuosoMock.scrollToIndex).toHaveBeenCalledWith({
        index: 'LAST',
        align: 'end',
        behavior: 'auto',
      })
    })
  })

  it('does not load older history while the initial bottom lock is active', async () => {
    virtuosoMock.setAutoSettle(false)
    const loadMoreHistory = vi.fn().mockResolvedValue(undefined)
    useChatStore.setState((state) => ({
      loadMoreHistory,
      sessions: {
        ...state.sessions,
        'session-b': makeSessionState({
          allMessagesLoaded: false,
          historyBuffer: [userMessage('older-1', 'older')],
          messages: [userMessage('b-1', 'new session')],
        }),
      },
    }))

    render(<MessageList sessionId="session-b" projectPath="/tmp/b" />)

    await waitFor(() => {
      expect(virtuosoMock.getLatestProps()).toBeTruthy()
    })

    act(() => {
      virtuosoMock.getLatestProps().startReached?.(0)
    })

    expect(loadMoreHistory).not.toHaveBeenCalled()
    expect(virtuosoMock.getLatestProps().followOutput(false)).toBe('auto')
  })

  it('keeps the newest message pinned when the bottom overlay height changes', async () => {
    const { rerender } = render(
      <MessageList sessionId="session-a" projectPath="/tmp/a" bottomOverlayHeight={120} />,
    )

    await waitFor(() => {
      expect(virtuosoMock.scrollToIndex).toHaveBeenCalledWith({
        index: 'LAST',
        align: 'end',
        behavior: 'auto',
      })
    })

    virtuosoMock.scrollToIndex.mockClear()

    rerender(
      <MessageList sessionId="session-a" projectPath="/tmp/a" bottomOverlayHeight={220} />,
    )

    await waitFor(() => {
      expect(virtuosoMock.scrollToIndex).toHaveBeenCalledWith({
        index: 'LAST',
        align: 'end',
        behavior: 'auto',
      })
    })
  })

  it('toggles the floating scroll control between top and bottom', async () => {
    render(<MessageList sessionId="session-a" projectPath="/tmp/a" />)

    const jumpToTop = await screen.findByRole('button', { name: 'Scroll to top' })

    virtuosoMock.scrollToIndex.mockClear()
    fireEvent.click(jumpToTop)

    expect(virtuosoMock.scrollToIndex).toHaveBeenCalledWith({
      index: 0,
      align: 'start',
      behavior: 'smooth',
    })

    const jumpToBottom = await screen.findByRole('button', { name: 'Scroll to bottom' })

    virtuosoMock.scrollToIndex.mockClear()
    fireEvent.click(jumpToBottom)

    expect(virtuosoMock.scrollToIndex).toHaveBeenCalledWith({
      index: 'LAST',
      align: 'end',
      behavior: 'smooth',
    })
  })

  it('scrolls to the bottom when the user sends a new message from the middle', async () => {
    render(<MessageList sessionId="session-a" projectPath="/tmp/a" />)

    await waitFor(() => {
      expect(virtuosoMock.scrollToIndex).toHaveBeenCalledWith({
        index: 'LAST',
        align: 'end',
        behavior: 'auto',
      })
    })

    await waitFor(() => {
      expect(virtuosoMock.getLatestProps().followOutput(false)).toBe(false)
    })

    virtuosoMock.scrollToIndex.mockClear()

    act(() => {
      useChatStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          'session-a': makeSessionState({
            messages: [
              userMessage('a-1', 'old session'),
              userMessage('a-2', 'old session latest', 2),
              userMessage('a-3', 'new user message', 3),
            ],
          }),
        },
      }))
    })

    await waitFor(() => {
      expect(virtuosoMock.scrollToIndex).toHaveBeenCalledWith({
        index: 'LAST',
        align: 'end',
        behavior: 'smooth',
      })
    })
  })

  it('keeps following streamed AI text after the user sends from the middle', async () => {
    render(<MessageList sessionId="session-a" projectPath="/tmp/a" />)

    await waitFor(() => {
      expect(virtuosoMock.scrollToIndex).toHaveBeenCalledWith({
        index: 'LAST',
        align: 'end',
        behavior: 'auto',
      })
    })

    await waitFor(() => {
      expect(virtuosoMock.getLatestProps().followOutput(false)).toBe(false)
    })

    act(() => {
      useChatStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          'session-a': makeSessionState({
            messages: [
              userMessage('a-1', 'old session'),
              userMessage('a-2', 'old session latest', 2),
              userMessage('a-3', 'new user message', 3),
            ],
            chatState: 'thinking',
          }),
        },
      }))
    })

    await waitFor(() => {
      expect(virtuosoMock.getLatestProps().followOutput(false)).toBe('smooth')
    })
    await waitFor(() => {
      const startupScrolls = virtuosoMock.scrollToIndex.mock.calls.filter(
        ([options]) => options.behavior === 'smooth',
      )
      expect(startupScrolls.length).toBeGreaterThanOrEqual(2)
    })

    virtuosoMock.scrollToIndex.mockClear()

    act(() => {
      useChatStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          'session-a': makeSessionState({
            messages: [
              userMessage('a-1', 'old session'),
              userMessage('a-2', 'old session latest', 2),
              userMessage('a-3', 'new user message', 3),
            ],
            chatState: 'streaming',
            streamingText: 'AI reply grows',
          }),
        },
      }))
    })

    await waitFor(() => {
      expect(virtuosoMock.scrollToIndex).toHaveBeenCalledWith({
        index: 'LAST',
        align: 'end',
        behavior: 'auto',
      })
    })
    expect(virtuosoMock.scrollToIndex).not.toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    )
  })

  it('does not pass thinking messages to the virtual list as hidden rows', async () => {
    useChatStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        'session-a': makeSessionState({
          messages: [
            assistantMessage('assistant-1', 'first assistant reply', 1),
            thinkingMessage('thinking-1', 'hidden thinking text', 2),
            assistantMessage('assistant-2', 'second assistant reply', 3),
          ],
        }),
      },
    }))

    render(<MessageList sessionId="session-a" projectPath="/tmp/a" />)

    await waitFor(() => {
      expect(virtuosoMock.getLatestProps()).toBeTruthy()
    })

    const data = virtuosoMock.getLatestProps().data as Array<{ kind: string; message?: UIMessage }>
    expect(data).toHaveLength(2)
    expect(data.map((item) => item.message?.id)).toEqual(['assistant-1', 'assistant-2'])
    expect(screen.getByText('first assistant reply')).toBeTruthy()
    expect(screen.getByText('second assistant reply')).toBeTruthy()
    expect(screen.queryByText('hidden thinking text')).toBeNull()
  })
})
