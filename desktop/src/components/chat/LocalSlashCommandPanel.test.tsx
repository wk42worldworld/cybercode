import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionsApi } from '../../api/sessions'
import { useSettingsStore } from '../../stores/settingsStore'
import { LocalSlashCommandPanel } from './LocalSlashCommandPanel'

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getInspection: vi.fn(),
  },
}))

describe('LocalSlashCommandPanel usage dashboard', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'zh' })
    vi.mocked(sessionsApi.getInspection).mockReset()
    vi.mocked(sessionsApi.getInspection).mockResolvedValue({
      active: true,
      status: {
        sessionId: 'session-1',
        workDir: '/tmp/project',
        permissionMode: 'default',
        model: 'test-model',
      },
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
      contextEstimate: {
        categories: [],
        totalTokens: 2_000,
        maxTokens: 8_000,
        rawMaxTokens: 8_000,
        percentage: 25,
        gridRows: [],
        model: 'test-model',
        memoryFiles: [],
        mcpTools: [],
        agents: [],
        apiUsage: null,
      },
    })
  })

  it('shows visual token composition, context capacity, and model comparison', async () => {
    render(
      <LocalSlashCommandPanel
        command="cost"
        sessionId="session-1"
        projectPath="/tmp/project"
        onClose={() => {}}
      />,
    )

    expect(await screen.findByText('本会话累计 Token')).toBeInTheDocument()
    expect(screen.getByTestId('usage-composition-ring')).toHaveTextContent('2K')
    expect(screen.getByRole('img', { name: '输入 1,000, 输出 300, 缓存读取 500, 缓存写入 200' })).toBeInTheDocument()
    expect(screen.getByTestId('usage-context-gauge')).toHaveTextContent('25%')
    expect(screen.getByTestId('usage-context-gauge')).toHaveTextContent('还可使用 6,000 Token')
    expect(screen.getByTestId('usage-model-chart')).toHaveTextContent('Test Model')
    await waitFor(() => expect(sessionsApi.getInspection).toHaveBeenCalledWith('session-1', {
      includeContext: false,
      projectPath: '/tmp/project',
    }))
  })
})
