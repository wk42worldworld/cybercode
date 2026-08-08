import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
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

/** Track scrollTop assignments on the native scroller element. */
let scrollTopWrites: number[] = []
let scrollTopValue = 0

function stubScrollTop() {
  scrollTopWrites = []
  scrollTopValue = 0
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get() {
      return scrollTopValue
    },
    set(value: number) {
      scrollTopValue = value
      scrollTopWrites.push(value)
    },
  })
}

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
    stubScrollTop()
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
    it('stays pinned to the latest message while a reactivated session finishes laying out', () => {
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        cb(0)
        return 0
      })
      vi.stubGlobal('cancelAnimationFrame', vi.fn())

      let resizeObserverCallback: ResizeObserverCallback | null = null
      let resizeObserverInstance: ResizeObserver | null = null
      class ResizeObserverMock {
        constructor(callback: ResizeObserverCallback) {
          resizeObserverCallback = callback
          resizeObserverInstance = this as unknown as ResizeObserver
        }

        observe() {}
        unobserve() {}
        disconnect() {}
      }
      vi.stubGlobal('ResizeObserver', ResizeObserverMock)

      useChatStore.setState({
        sessions: {
          [ACTIVE_TAB]: makeSessionState({
            messages: buildMessages('reactivated'),
          }),
        },
      })

      const { container, rerender } = render(
        <MessageList sessionId={ACTIVE_TAB} isActive={false} />,
      )
      const scroller = container.querySelector('[data-testid="virtuoso-scroller"]') as HTMLElement
      let scrollHeight = 1_000
      Object.defineProperty(scroller, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight,
      })
      Object.defineProperty(scroller, 'clientHeight', {
        configurable: true,
        value: 300,
      })

      rerender(<MessageList sessionId={ACTIVE_TAB} isActive />)
      expect(scrollTopValue).toBe(700)
      expect(resizeObserverCallback).not.toBeNull()

      // Markdown, images, or the deferred history chunk can increase the
      // content height after activation; the latest message must stay visible.
      scrollHeight = 1_400
      act(() => {
        resizeObserverCallback?.([], resizeObserverInstance!)
      })
      expect(scrollTopValue).toBe(1_100)

      // Explicit user navigation releases the activation lock.
      fireEvent.wheel(scroller)
      scrollHeight = 1_600
      act(() => {
        resizeObserverCallback?.([], resizeObserverInstance!)
      })
      expect(scrollTopValue).toBe(1_100)
    })

    it('keeps the user pinned to the bottom when renderItems are fully replaced while at bottom', async () => {
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

      // Initial mount scrolls to the bottom (scrollHeight is 0 in jsdom, so 0).
      expect(scrollTopWrites.length).toBeGreaterThan(0)
      scrollTopWrites = []

      // Replace the entire dataset with new ids while preserving length/order.
      // The user is at the bottom (isNearBottomRef true from initial mount),
      // so the list re-pins to the bottom after replacement.
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

      expect(scrollTopWrites.length).toBeGreaterThan(0)
    })

    it('does not force-scroll when the user has scrolled up to read history', async () => {
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

      const { container } = render(<MessageList sessionId={ACTIVE_TAB} isActive />)
      const scroller = container.querySelector('[data-testid="virtuoso-scroller"]') as HTMLElement
      expect(scroller).toBeTruthy()

      // Simulate the user scrolling up: fire a scroll event with scrollTop far
      // from the bottom so isNearBottomRef flips to false.
      scrollTopValue = 0
      act(() => {
        scroller.dispatchEvent(new Event('scroll'))
      })
      scrollTopWrites = []

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

      // No forced scroll after replacement — the user's reading position is kept.
      expect(scrollTopWrites.length).toBe(0)
    })
  })
})
