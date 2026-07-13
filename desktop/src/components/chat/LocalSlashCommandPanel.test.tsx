import { render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionsApi } from '../../api/sessions'
import { useChatStore, type PerSessionState } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { LocalSlashCommandPanel } from './LocalSlashCommandPanel'
import { TokenUsageIndicator } from './TokenUsageIndicator'
import { clearSessionUsageCache, writeCachedSessionUsage } from './sessionUsageCache'

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getInspection: vi.fn(),
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
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
    usageRevision: 0,
    elapsedSeconds: 0,
    statusVerb: '',
    slashCommands: [],
    agentTaskNotifications: {},
    elapsedTimer: null,
    ...overrides,
  }
}

describe('LocalSlashCommandPanel compact usage panel', () => {
  beforeEach(() => {
    clearSessionUsageCache()
    useChatStore.setState({ sessions: {} })
    useSettingsStore.setState({ locale: 'zh' })
    vi.mocked(sessionsApi.getInspection).mockReset()
    vi.mocked(sessionsApi.getUsage).mockReset()
    vi.mocked(sessionsApi.getUsage).mockResolvedValue({
      usage: {
        source: 'current_process',
        totalCostUSD: 0.12,
        costDisplay: '$0.1200',
        hasUnknownModelCost: false,
        totalAPIDuration: 12,
        totalDuration: 18,
        totalLinesAdded: 24,
        totalLinesRemoved: 7,
        totalInputTokens: 1_000,
        totalOutputTokens: 300,
        totalCacheReadInputTokens: 500,
        totalCacheCreationInputTokens: 200,
        totalWebSearchRequests: 2,
        models: [{
          model: 'test-model',
          displayName: 'Test Model',
          inputTokens: 1_000,
          outputTokens: 300,
          cacheReadInputTokens: 500,
          cacheCreationInputTokens: 200,
          webSearchRequests: 2,
          costUSD: 0.12,
          costDisplay: '$0.1200',
          contextWindow: 8_000,
          maxOutputTokens: 2_000,
        }],
      },
      context: {
        model: 'test-model',
        usedTokens: 2_000,
        contextWindow: 8_000,
        percentage: 25,
        latestTurn: {
          inputTokens: 100,
          outputTokens: 30,
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 20,
        },
      },
    })
  })

  it('shows only the compact context and core token metrics', async () => {
    render(
      <LocalSlashCommandPanel
        command="cost"
        sessionId="session-1"
        projectPath="/tmp/project"
        onClose={() => {}}
      />,
    )

    expect(await screen.findByTestId('compact-token-usage-panel')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('compact-token-context')).toHaveTextContent('25%'))
    expect(screen.getByTestId('compact-token-context')).toHaveTextContent('2,000 / 8,000')
    expect(screen.getByTestId('compact-token-metric-turn')).toHaveTextContent('本轮200')
    expect(screen.getByTestId('compact-token-metric-session')).toHaveTextContent('会话2K')
    expect(screen.getByTestId('compact-token-metric-input')).toHaveTextContent('输入（含缓存）170')
    expect(screen.getByTestId('compact-token-metric-output')).toHaveTextContent('输出30')
    const breakdown = screen.getByTestId('compact-token-input-breakdown')
    expect(within(breakdown).getByText('普通输入').nextSibling).toHaveTextContent('100')
    expect(within(breakdown).getByText('缓存读取').nextSibling).toHaveTextContent('50')
    expect(within(breakdown).getByText('缓存写入').nextSibling).toHaveTextContent('20')
    expect(screen.queryByTestId('usage-composition-ring')).not.toBeInTheDocument()
    expect(screen.queryByTestId('usage-model-chart')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '状态' })).not.toBeInTheDocument()
    await waitFor(() => expect(sessionsApi.getUsage).toHaveBeenCalledWith('session-1', {
      projectPath: '/tmp/project',
    }))
    expect(sessionsApi.getInspection).not.toHaveBeenCalled()
  })

  it('shows cached usage immediately while refreshing in the background', () => {
    writeCachedSessionUsage('cached-session', '/tmp/project', {
      usage: {
        source: 'transcript',
        totalCostUSD: 0,
        costDisplay: '$0.0000',
        hasUnknownModelCost: false,
        totalAPIDuration: 0,
        totalDuration: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        totalInputTokens: 800,
        totalOutputTokens: 200,
        totalCacheReadInputTokens: 0,
        totalCacheCreationInputTokens: 0,
        totalWebSearchRequests: 0,
        models: [],
      },
      context: {
        model: 'test-model',
        usedTokens: 1_000,
        contextWindow: 10_000,
        percentage: 10,
        latestTurn: {
          inputTokens: 650,
          outputTokens: 150,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
    }, 0)
    vi.mocked(sessionsApi.getUsage).mockImplementationOnce(() => new Promise(() => {}))

    render(
      <LocalSlashCommandPanel
        command="cost"
        sessionId="cached-session"
        projectPath="/tmp/project"
        onClose={() => {}}
      />,
    )

    expect(screen.getByTestId('compact-token-context')).toHaveTextContent('10%')
    expect(screen.getByTestId('compact-token-metric-session')).toHaveTextContent('会话1K')
    expect(screen.getByTestId('compact-token-metric-input')).toHaveTextContent('输入（含缓存）650')
    expect(screen.queryByText('--')).not.toBeInTheDocument()
  })

  it('keeps the input counter and opened panel on the same live turn snapshot', () => {
    const cachedUsage = {
      usage: {
        source: 'transcript' as const,
        totalCostUSD: 0,
        costDisplay: '$0.0000',
        hasUnknownModelCost: false,
        totalAPIDuration: 0,
        totalDuration: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        totalInputTokens: 1_000,
        totalOutputTokens: 300,
        totalCacheReadInputTokens: 500,
        totalCacheCreationInputTokens: 200,
        totalWebSearchRequests: 0,
        models: [],
      },
      context: {
        model: 'test-model',
        usedTokens: 2_000,
        contextWindow: 8_000,
        percentage: 25,
        latestTurn: {
          inputTokens: 100,
          outputTokens: 30,
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 20,
        },
      },
    }
    writeCachedSessionUsage('live-session', '/tmp/project', cachedUsage, 1)
    useChatStore.setState({
      sessions: {
        'live-session': makeSession({
          chatState: 'streaming',
          usageRevision: 1,
          tokenUsage: {
            input_tokens: 4_016,
            output_tokens: 14,
            cache_read_input_tokens: 29_248,
            cache_creation_input_tokens: 0,
          },
        }),
      },
    })
    vi.mocked(sessionsApi.getUsage).mockImplementation(() => new Promise(() => {}))

    render(
      <>
        <TokenUsageIndicator
          sessionId="live-session"
          projectPath="/tmp/project"
          onOpenDetails={() => {}}
        />
        <LocalSlashCommandPanel
          command="cost"
          sessionId="live-session"
          projectPath="/tmp/project"
          onClose={() => {}}
        />
      </>,
    )

    const panel = screen.getByTestId('compact-token-usage-panel')
    expect(screen.getByTestId('token-turn-total')).toHaveTextContent('33.3K')
    expect(within(panel).getByTestId('compact-token-metric-turn')).toHaveTextContent('本轮33.3K')
    expect(screen.getByTestId('token-session-total')).toHaveTextContent('35.3K')
    expect(within(panel).getByTestId('compact-token-metric-session')).toHaveTextContent('会话35.3K')
    expect(within(panel).getByTestId('compact-token-metric-input')).toHaveTextContent('输入（含缓存）33.3K')
    expect(within(panel).getByTestId('compact-token-metric-output')).toHaveTextContent('输出14')
    expect(within(panel).getByTestId('compact-token-metric-turn-exact')).toHaveTextContent('33,278')
    expect(within(panel).getByTestId('compact-token-metric-input-exact')).toHaveTextContent('33,264')
    const breakdown = within(panel).getByTestId('compact-token-input-breakdown')
    expect(within(breakdown).getByText('普通输入').nextSibling).toHaveTextContent('4K')
    expect(within(breakdown).getByText('缓存读取').nextSibling).toHaveTextContent('29.2K')
    expect(within(breakdown).getByText('缓存写入').nextSibling).toHaveTextContent('0')
    expect(within(breakdown).getByTestId('compact-token-input-uncached-exact')).toHaveTextContent('4,016')
    expect(within(breakdown).getByTestId('compact-token-input-cache-read-exact')).toHaveTextContent('29,248')
  })
})
