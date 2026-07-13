import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionsApi } from '../../api/sessions'
import { useSettingsStore } from '../../stores/settingsStore'
import { useChatStore, type PerSessionState } from '../../stores/chatStore'
import { TokenUsageIndicator } from './TokenUsageIndicator'
import {
  calculateContextUsagePercent,
  formatCompactTokenCount,
  getContextTokenTotal,
  getTurnInputTokenTotal,
  getTurnTokenTotal,
} from './tokenUsage'
import { clearSessionUsageCache } from './sessionUsageCache'

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getUsage: vi.fn(),
  },
}))

function makeSession(overrides: Partial<PerSessionState> = {}): PerSessionState {
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
    pendingSteers: [],
    tokenUsage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 },
    usageRevision: 1,
    elapsedSeconds: 0,
    statusVerb: '',
    slashCommands: [],
    agentTaskNotifications: {},
    elapsedTimer: null,
    ...overrides,
  }
}

describe('TokenUsageIndicator', () => {
  beforeEach(() => {
    clearSessionUsageCache()
    useSettingsStore.setState({ locale: 'zh' })
    useChatStore.setState({
      sessions: {
        'session-1': makeSession(),
      },
    })
    vi.mocked(sessionsApi.getUsage).mockReset()
    vi.mocked(sessionsApi.getUsage).mockResolvedValue({
      usage: {
        source: 'transcript',
        totalCostUSD: 0,
        costDisplay: '$0.0000',
        hasUnknownModelCost: false,
        totalAPIDuration: 0,
        totalDuration: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        totalInputTokens: 1_000,
        totalOutputTokens: 200,
        totalCacheReadInputTokens: 100,
        totalCacheCreationInputTokens: 50,
        totalWebSearchRequests: 0,
        models: [],
      },
      context: {
        model: 'test-model',
        usedTokens: 40_000,
        contextWindow: 200_000,
        percentage: 20,
        latestTurn: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 20,
          cacheCreationInputTokens: 10,
        },
      },
    })
  })

  it('shows turn and cumulative usage and opens the detailed usage panel', async () => {
    const onOpenDetails = vi.fn()
    render(<TokenUsageIndicator sessionId="session-1" projectPath="/tmp/project" onOpenDetails={onOpenDetails} />)

    const button = await screen.findByRole('button')
    expect(screen.getByTestId('token-turn-total')).toHaveTextContent('180')
    await waitFor(() => {
      expect(button).toHaveTextContent('本轮180')
      expect(button).toHaveTextContent('会话1.4K')
      expect(button).toHaveTextContent('20%')
      expect(screen.getByTestId('token-context-ring')).toHaveAttribute('data-context-percent', '20')
    })
    expect(screen.getByTestId('token-context-summary')).toContainElement(screen.getByTestId('token-context-ring'))
    expect(screen.getByTestId('token-context-summary')).toHaveTextContent('20%')
    expect(screen.getByTestId('token-turn-summary').className).toContain('w-[58px]')
    expect(screen.getByTestId('token-session-summary').className).toContain('w-[58px]')
    expect(button.className).toContain('w-[200px]')
    expect(button).toHaveStyle({ contain: 'layout paint' })
    expect(button).toHaveAccessibleName(/\u8f93\u5165\u603b\u8ba1 130/)
    expect(button).toHaveAccessibleName(/\u666e\u901a\u8f93\u5165 100/)
    expect(button).toHaveAccessibleName(/\u672c\u8f6e 180 Token/)
    expect(button).toHaveAccessibleName(/\u5f53\u524d\u4e0a\u4e0b\u6587 40,000\/200,000/)
    expect(sessionsApi.getUsage).toHaveBeenCalledWith('session-1', { projectPath: '/tmp/project' })

    fireEvent.click(button)
    expect(onOpenDetails).toHaveBeenCalledTimes(1)
  })

  it('reserves enough width for the exact compact turn value', () => {
    useChatStore.setState({
      sessions: {
        'session-1': makeSession({
          chatState: 'streaming',
          usageRevision: 0,
          tokenUsage: {
            input_tokens: 10_000,
            output_tokens: 1_400,
            cache_read_input_tokens: 700,
            cache_creation_input_tokens: 300,
          },
        }),
      },
    })
    vi.mocked(sessionsApi.getUsage).mockImplementationOnce(() => new Promise(() => {}))

    render(<TokenUsageIndicator sessionId="session-1" onOpenDetails={() => {}} />)

    const turnTotal = screen.getByTestId('token-turn-total')
    expect(turnTotal).toHaveTextContent('12.4K')
    expect(turnTotal.className).toContain('min-w-[34px]')
    expect(turnTotal.className).toContain('shrink-0')
  })

  it('adds live turn usage to the persisted session total while generating', async () => {
    useChatStore.setState({
      sessions: {
        'session-1': makeSession({ chatState: 'streaming', usageRevision: 0 }),
      },
    })

    render(<TokenUsageIndicator sessionId="session-1" onOpenDetails={() => {}} />)

    const button = await screen.findByRole('button')
    await waitFor(() => {
      expect(button).toHaveTextContent('本轮180')
      expect(button).toHaveTextContent('会话1.5K')
    })
  })

  it('restores the latest turn total from the transcript after a restart', async () => {
    useChatStore.setState({
      sessions: {
        'session-1': makeSession({
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          usageRevision: 0,
        }),
      },
    })

    render(<TokenUsageIndicator sessionId="session-1" onOpenDetails={() => {}} />)

    const button = await screen.findByRole('button')
    await waitFor(() => {
      expect(button).toHaveTextContent('本轮180')
      expect(button).toHaveTextContent('会话1.4K')
      expect(button).toHaveAccessibleName(/输入总计 130/)
      expect(button).toHaveAccessibleName(/普通输入 100/)
      expect(button).toHaveAccessibleName(/输出 50/)
      expect(button).toHaveAccessibleName(/缓存读取 20/)
      expect(button).toHaveAccessibleName(/缓存写入 10/)
    })
  })

  it('keeps non-zero live usage in the hover details', async () => {
    useChatStore.setState({
      sessions: {
        'session-1': makeSession({
          tokenUsage: {
            input_tokens: 210,
            output_tokens: 90,
            cache_read_input_tokens: 30,
            cache_creation_input_tokens: 15,
          },
        }),
      },
    })

    render(<TokenUsageIndicator sessionId="session-1" onOpenDetails={() => {}} />)

    const button = await screen.findByRole('button')
    await waitFor(() => {
      expect(button).toHaveAccessibleName(/输入总计 255/)
      expect(button).toHaveAccessibleName(/普通输入 210/)
      expect(button).toHaveAccessibleName(/输出 90/)
      expect(button).toHaveAccessibleName(/缓存读取 30/)
      expect(button).toHaveAccessibleName(/缓存写入 15/)
    })
  })

  it('does not flash the previous cumulative total when switching sessions', async () => {
    const { rerender } = render(
      <TokenUsageIndicator sessionId="session-1" onOpenDetails={() => {}} />,
    )
    const button = await screen.findByRole('button')
    await waitFor(() => expect(button).toHaveTextContent('1.4K'))

    useChatStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        'session-2': makeSession({
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          usageRevision: 0,
        }),
      },
    }))
    vi.mocked(sessionsApi.getUsage).mockImplementationOnce(() => new Promise(() => {}))
    rerender(<TokenUsageIndicator sessionId="session-2" onOpenDetails={() => {}} />)

    const switchedButton = screen.getByRole('button')
    expect(switchedButton).toHaveTextContent('本轮0')
    expect(switchedButton).toHaveTextContent('会话0')
    expect(switchedButton).not.toHaveTextContent('1.4K')
  })

  it('shows zero percent for a new session without usage data', async () => {
    useChatStore.setState({
      sessions: {
        'session-1': makeSession({
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          usageRevision: 0,
        }),
      },
    })
    vi.mocked(sessionsApi.getUsage).mockResolvedValueOnce({ usage: null, context: null })

    render(<TokenUsageIndicator sessionId="session-1" onOpenDetails={() => {}} />)

    const button = await screen.findByRole('button')
    await waitFor(() => expect(sessionsApi.getUsage).toHaveBeenCalled())
    expect(button).toHaveTextContent('0%')
    expect(button).not.toHaveTextContent('--')
    expect(screen.getByTestId('token-context-ring')).toHaveAttribute('data-context-percent', '0')
  })

  it('formats compact values and counts cache tokens', () => {
    expect(formatCompactTokenCount(999)).toBe('999')
    expect(formatCompactTokenCount(12_400)).toBe('12.4K')
    expect(formatCompactTokenCount(2_000_000)).toBe('2M')
    expect(getTurnTokenTotal({
      input_tokens: 10,
      output_tokens: 20,
      cache_read_tokens: 30,
      cache_creation_tokens: 40,
    })).toBe(100)
    expect(getTurnInputTokenTotal({
      input_tokens: 10,
      output_tokens: 20,
      cache_read_tokens: 30,
      cache_creation_tokens: 40,
    })).toBe(80)
    expect(getContextTokenTotal({
      input_tokens: 10,
      output_tokens: 20,
      cache_read_tokens: 30,
      cache_creation_tokens: 40,
    })).toBe(80)
    expect(calculateContextUsagePercent(40_000, 200_000)).toBe(20)
    expect(calculateContextUsagePercent(220_000, 200_000)).toBe(100)
    expect(calculateContextUsagePercent(100, 0)).toBeNull()
  })
})
