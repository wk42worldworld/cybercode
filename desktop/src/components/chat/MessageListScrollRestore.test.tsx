import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { MessageList } from './MessageList'
import { mapHistoryMessages } from '../../stores/historyParser'
import { useChatStore } from '../../stores/chatStore'
import { useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import type { MessageEntry } from '../../types/session'
import type { UIMessage } from '../../types/chat'
import type { PerSessionState } from '../../stores/chatStore'

const ACTIVE_TAB = 'scroll-restore-tab'

const scrollToIndexCalls: Array<{ index: unknown; align?: string; behavior?: string }> = []
const autoscrollToBottomCalls: number[] = []

vi.mock('react-virtuoso', () => {
  const React = require('react')
  const VirtuosoMock = React.forwardRef(function VirtuosoMock(props: any, ref: any) {
    const handleRef = {
      scrollToIndex: (opts: any) => {
        scrollToIndexCalls.push({
          index: opts.index,
          align: opts.align,
          behavior: opts.behavior,
        })
      },
      autoscrollToBottom: () => {
        autoscrollToBottomCalls.push(1)
      },
    }
    if (ref) {
      if (typeof ref === 'function') {
        ref(handleRef)
      } else {
        ref.current = handleRef
      }
    }

    const ItemContainer = props.components?.List ?? 'div'
    const Scroller = props.components?.Scroller ?? 'div'
    const Header = props.components?.Header
    const Footer = props.components?.Footer

    const data = props.data ?? []
    if (data.length > 0) {
      const startIndex = props.firstItemIndex ?? 0
      const endIndex = startIndex + data.length - 1
      props.rangeChanged?.({ startIndex, endIndex })
      props.itemsRendered?.(data.map((_: any, i: number) => ({ index: startIndex + i })))
    }

    return React.createElement(
      Scroller,
      { 'data-testid': 'virtuoso-scroller' },
      Header && React.createElement(Header),
      React.createElement(
        ItemContainer,
        null,
        data.map((item: any, i: number) =>
          React.createElement(
            'div',
            { key: props.firstItemIndex + i },
            props.itemContent(props.firstItemIndex + i, item),
          ),
        ),
      ),
      Footer && React.createElement(Footer),
    )
  })
  return {
    Virtuoso: Object.assign(VirtuosoMock, { displayName: 'Virtuoso' }),
  }
})

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

function buildMessages(prefix: string): UIMessage[] {
  return [
    {
      id: `${prefix}-user-1`,
      type: 'user_text',
      content: 'hello',
      timestamp: 1,
    },
    {
      id: `${prefix}-assistant-1`,
      type: 'assistant_text',
      content: 'reply one',
      timestamp: 2,
    },
    {
      id: `${prefix}-tool-read`,
      type: 'tool_use',
      toolName: 'Read',
      toolUseId: `${prefix}-read-1`,
      input: { file_path: 'a.ts' },
      timestamp: 3,
    },
    {
      id: `${prefix}-result-read`,
      type: 'tool_result',
      toolUseId: `${prefix}-read-1`,
      content: 'ok',
      isError: false,
      timestamp: 4,
    },
    {
      id: `${prefix}-assistant-2`,
      type: 'assistant_text',
      content: 'reply two',
      timestamp: 5,
    },
  ]
}

describe('MessageList scroll restore', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    scrollToIndexCalls.length = 0
    autoscrollToBottomCalls.length = 0
    useSettingsStore.setState({ locale: 'en' })
    useTabStore.setState({
      activeTabId: ACTIVE_TAB,
      tabs: [{ sessionId: ACTIVE_TAB, title: 'Test', type: 'session' as const, status: 'idle' }],
    })
    useChatStore.setState({ sessions: { [ACTIVE_TAB]: makeSessionState() } })
    useSessionRuntimeStore.setState({ selections: {} })
    useSessionStore.setState({ sessions: [], isLoading: false, error: null })
    useUIStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('historyParser determinism', () => {
    it('produces identical ids for thinking/text/tool_use/tool_result blocks across remaps with different idGens', () => {
      const messages: MessageEntry[] = [
        {
          id: 'assistant-1',
          type: 'assistant',
          timestamp: '2026-08-03T00:00:00.000Z',
          model: 'opus',
          content: [
            { type: 'thinking', thinking: 'reasoning' },
            { type: 'text', text: 'first' },
            { type: 'text', text: 'second' },
            { type: 'tool_use', name: 'Read', id: 'tool-read-1', input: { file_path: 'a.ts' } },
          ],
        },
        {
          id: 'user-1',
          type: 'user',
          timestamp: '2026-08-03T00:00:01.000Z',
          content: [
            { type: 'tool_result', tool_use_id: 'tool-read-1', content: 'ok', is_error: false },
          ],
        },
      ]

      let firstCounter = 0
      let secondCounter = 100
      const first = mapHistoryMessages(messages, () => `gen-a-${++firstCounter}`)
      const second = mapHistoryMessages(messages, () => `gen-b-${++secondCounter}`)

      expect(first.map((m) => m.id)).toEqual([
        'assistant-1:thinking:0',
        'assistant-1:text:1',
        'assistant-1:tool:tool-read-1',
        'user-1:result:tool-read-1',
      ])
      expect(second.map((m) => m.id)).toEqual(first.map((m) => m.id))
    })

    it('falls back to idGen when source message id is missing', () => {
      const messages: MessageEntry[] = [
        {
          id: '',
          type: 'assistant',
          timestamp: '2026-08-03T00:00:00.000Z',
          content: [
            { type: 'thinking', thinking: 'reasoning' },
            { type: 'text', text: 'text' },
            { type: 'tool_use', name: 'Read', id: 'tool-read-1', input: { file_path: 'a.ts' } },
          ],
        },
        {
          id: '',
          type: 'user',
          timestamp: '2026-08-03T00:00:01.000Z',
          content: [
            { type: 'tool_result', tool_use_id: 'tool-read-1', content: 'ok', is_error: false },
          ],
        },
      ]

      let counter = 0
      const mapped = mapHistoryMessages(messages, () => `fallback-${++counter}`)
      expect(mapped.map((m) => m.id)).toEqual([
        'fallback-1',
        'fallback-2',
        'fallback-3',
        'fallback-4',
      ])
    })
  })

  describe('MessageList full dataset replacement', () => {
    it('scrolls to the latest item after renderItems are fully replaced with new ids', async () => {
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        cb(0)
        return 0
      })
      vi.stubGlobal('cancelAnimationFrame', vi.fn())

      useChatStore.setState({
        sessions: {
          [ACTIVE_TAB]: makeSessionState({
            messages: buildMessages('first'),
          }),
        },
      })

      render(<MessageList sessionId={ACTIVE_TAB} isActive />)

      // Replace the entire dataset with new ids while preserving length/order.
      act(() => {
        useChatStore.setState((state) => ({
          sessions: {
            ...state.sessions,
            [ACTIVE_TAB]: {
              ...state.sessions[ACTIVE_TAB]!,
              messages: buildMessages('second'),
            },
          },
        }))
      })

      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      })

      const lastScroll = scrollToIndexCalls[scrollToIndexCalls.length - 1]
      expect(lastScroll).toBeDefined()
      expect(lastScroll?.index).toBe('LAST')
      expect(lastScroll?.align).toBe('end')
    })

    it('does not lock to bottom when __testInitialItemCount is set during replacement', () => {
      useChatStore.setState({
        sessions: {
          [ACTIVE_TAB]: makeSessionState({
            messages: buildMessages('first'),
          }),
        },
      })

      render(<MessageList sessionId={ACTIVE_TAB} isActive __testInitialItemCount={100} />)

      act(() => {
        useChatStore.setState((state) => ({
          sessions: {
            ...state.sessions,
            [ACTIVE_TAB]: {
              ...state.sessions[ACTIVE_TAB]!,
              messages: buildMessages('second'),
            },
          },
        }))
      })

      // With __testInitialItemCount the bottom lock is disabled, so no
      // scrollToIndex calls are expected in jsdom.
      expect(scrollToIndexCalls.length).toBe(0)
    })
  })
})
