import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  tokenOptimizationApi,
  type CodeGraphData,
  type CodeGraphStatus,
} from '../api/tokenOptimization'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'
import { TokenOptimization } from './TokenOptimization'

vi.mock('../api/tokenOptimization', () => ({
  tokenOptimizationApi: {
    status: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    rebuild: vi.fn(),
    graph: vi.fn(),
    rtkStatus: vi.fn(),
    enableRtk: vi.fn(),
    disableRtk: vi.fn(),
    cavemanStatus: vi.fn(),
    enableCaveman: vi.fn(),
    disableCaveman: vi.fn(),
    liteStatus: vi.fn(),
    enableLite: vi.fn(),
    disableLite: vi.fn(),
    pruningStatus: vi.fn(),
    enablePruning: vi.fn(),
    disablePruning: vi.fn(),
    setPruningLevel: vi.fn(),
    codeGraphGlobalStatus: vi.fn(),
    enableCodeGraphGlobally: vi.fn(),
    disableCodeGraphGlobally: vi.fn(),
    ponytailStatus: vi.fn(),
    enablePonytail: vi.fn(),
    disablePonytail: vi.fn(),
  },
}))

vi.mock('../components/codegraph/CodeGraphVisualization', () => ({
  CodeGraphVisualization: ({ data }: { data: { nodes: unknown[] } }) => (
    <div data-testid="code-graph-visualization">{data.nodes.length}</div>
  ),
}))

const projectPath = '/tmp/cybercode-project'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function graphData(projectName: string, nodeCount: number): CodeGraphData {
  return {
    nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: `${projectName}-${index}`,
      kind: 'function',
      name: `${projectName}Function${index}`,
      qualifiedName: `${projectName}.function${index}`,
      filePath: `src/${projectName}.ts`,
      language: 'typescript',
      startLine: index + 1,
      endLine: index + 1,
      degree: 0,
      communityId: `module:${projectName}`,
      communityLabel: projectName,
      role: 'member',
    })),
    edges: [],
    architecture: {
      analyzedNodeCount: nodeCount,
      analyzedEdgeCount: 0,
      availableNodeCount: nodeCount,
      truncated: false,
      communities: [],
      hubNodeIds: [],
      bridgeNodeIds: [],
      confidence: { extracted: 0, inferred: 0, unknown: 0 },
    },
  }
}

function status(overrides: Partial<CodeGraphStatus> = {}): CodeGraphStatus {
  return {
    projectPath,
    indexable: true,
    enabled: false,
    state: 'disabled',
    progress: null,
    stats: null,
    error: null,
    bundledLanguages: ['TypeScript'],
    ...overrides,
  }
}

describe('TokenOptimization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({ toasts: [] })
    useSettingsStore.setState({ locale: 'zh' })
    useSessionStore.setState({
      sessions: [{
        id: 'session-1',
        title: 'Project',
        createdAt: '2026-07-12T00:00:00.000Z',
        modifiedAt: '2026-07-12T00:00:00.000Z',
        messageCount: 0,
        projectPath: '-tmp-cybercode-project',
        workDir: projectPath,
        workDirExists: true,
        isTemporary: false,
      }],
      activeSessionId: 'session-1',
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{
        sessionId: 'session-1',
        projectPath: '-tmp-cybercode-project',
        title: 'Project',
        type: 'session',
        status: 'idle',
      }],
      activeTabId: 'session-1',
    })
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(status())
    vi.mocked(tokenOptimizationApi.rtkStatus).mockResolvedValue({
      enabled: false,
      available: true,
      version: '0.43.0',
      stats: {
        totalCommands: 12,
        totalInput: 10_000,
        totalOutput: 2_000,
        totalSaved: 8_000,
        averageSavingsPercent: 80,
      },
      error: null,
    })
    vi.mocked(tokenOptimizationApi.cavemanStatus).mockResolvedValue({
      enabled: false,
      mode: 'full',
    })
    vi.mocked(tokenOptimizationApi.liteStatus).mockResolvedValue({
      enabled: false,
      mode: 'deterministic',
    })
    vi.mocked(tokenOptimizationApi.ponytailStatus).mockResolvedValue({
      enabled: false,
      mode: 'full',
    })
    vi.mocked(tokenOptimizationApi.pruningStatus).mockResolvedValue({
      enabled: false,
      level: 'balanced',
      mode: 'deterministic',
    })
    vi.mocked(tokenOptimizationApi.codeGraphGlobalStatus).mockResolvedValue({ enabled: false })
  })

  it('enables Lite deterministic cleanup globally without requiring a project', async () => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    vi.mocked(tokenOptimizationApi.enableLite).mockResolvedValue({
      enabled: true,
      mode: 'deterministic',
    })

    render(<TokenOptimization />)
    const toggle = await screen.findByRole('switch', { name: '全局启用 Lite 确定性清理' })
    await waitFor(() => expect(toggle).toBeEnabled())
    fireEvent.click(toggle)

    await waitFor(() => expect(tokenOptimizationApi.enableLite).toHaveBeenCalledOnce())
    expect(screen.getByTestId('lite-toolbar')).toHaveTextContent('Lite 确定性清理')
    expect(tokenOptimizationApi.status).not.toHaveBeenCalled()
  })

  it('enables Caveman response compression globally without requiring a project', async () => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    vi.mocked(tokenOptimizationApi.enableCaveman).mockResolvedValue({
      enabled: true,
      mode: 'full',
    })

    render(<TokenOptimization />)
    const toggle = await screen.findByRole('switch', { name: '全局启用 Caveman 响应压缩' })
    fireEvent.click(toggle)

    await waitFor(() => expect(tokenOptimizationApi.enableCaveman).toHaveBeenCalledOnce())
    expect(screen.getByTestId('caveman-toolbar')).toHaveTextContent('Caveman 响应压缩')
    expect(tokenOptimizationApi.status).not.toHaveBeenCalled()
  })

  it('enables smart pruning globally without requiring a project', async () => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    vi.mocked(tokenOptimizationApi.enablePruning).mockResolvedValue({
      enabled: true,
      level: 'balanced',
      mode: 'deterministic',
    })

    render(<TokenOptimization />)
    const toggle = await screen.findByRole('switch', { name: '全局启用智能裁剪' })
    fireEvent.click(toggle)

    await waitFor(() => expect(tokenOptimizationApi.enablePruning).toHaveBeenCalledOnce())
    expect(screen.getByTestId('pruning-toolbar')).toHaveTextContent('智能裁剪')
    expect(tokenOptimizationApi.status).not.toHaveBeenCalled()
  })

  it('updates the global pruning strength while the switch is off', async () => {
    vi.mocked(tokenOptimizationApi.setPruningLevel).mockResolvedValue({
      enabled: false,
      level: 'aggressive',
      mode: 'deterministic',
    })

    render(<TokenOptimization />)
    const strongButton = await screen.findByRole('button', { name: '强力' })
    fireEvent.click(strongButton)

    await waitFor(() => {
      expect(tokenOptimizationApi.setPruningLevel).toHaveBeenCalledWith('aggressive')
      expect(strongButton).toHaveAttribute('aria-pressed', 'true')
    })
    expect(screen.getByRole('switch', { name: '全局启用智能裁剪' })).not.toBeChecked()
  })

  it('starts smart pruning, Lazy Programmer, and Caveman disabled by default', async () => {
    render(<TokenOptimization />)

    const pruningToggle = screen.getByRole('switch', { name: '全局启用智能裁剪' })
    const cavemanToggle = screen.getByRole('switch', { name: '全局启用 Caveman 响应压缩' })
    const ponytailToggle = screen.getByRole('switch', { name: '全局启用懒程序员' })

    await waitFor(() => {
      expect(pruningToggle).toBeEnabled()
      expect(cavemanToggle).toBeEnabled()
      expect(ponytailToggle).toBeEnabled()
    })
    expect(pruningToggle).not.toBeChecked()
    expect(cavemanToggle).not.toBeChecked()
    expect(ponytailToggle).not.toBeChecked()
    expect(tokenOptimizationApi.enablePruning).not.toHaveBeenCalled()
    expect(tokenOptimizationApi.enableCaveman).not.toHaveBeenCalled()
    expect(tokenOptimizationApi.enablePonytail).not.toHaveBeenCalled()
  })

  it('shows Lite, RTK, and Code Graph enabled without rewriting loaded defaults', async () => {
    vi.mocked(tokenOptimizationApi.liteStatus).mockResolvedValue({
      enabled: true,
      mode: 'deterministic',
    })
    vi.mocked(tokenOptimizationApi.rtkStatus).mockResolvedValue({
      enabled: true,
      available: true,
      version: '0.43.0',
      stats: null,
      error: null,
    })
    vi.mocked(tokenOptimizationApi.codeGraphGlobalStatus).mockResolvedValue({ enabled: true })
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(status({
      enabled: true,
      state: 'ready',
    }))

    render(<TokenOptimization />)

    const liteToggle = screen.getByRole('switch', { name: '全局启用 Lite 确定性清理' })
    const rtkToggle = screen.getByRole('switch', { name: '启用 RTK 命令输出压缩' })
    const graphToggle = screen.getByRole('switch', { name: '全局启用代码图谱' })
    await waitFor(() => {
      expect(liteToggle).toBeChecked()
      expect(rtkToggle).toBeChecked()
      expect(graphToggle).toBeChecked()
    })

    expect(screen.getByRole('switch', { name: '全局启用智能裁剪' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: '全局启用懒程序员' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: '全局启用 Caveman 响应压缩' })).not.toBeChecked()
    expect(tokenOptimizationApi.enableLite).not.toHaveBeenCalled()
    expect(tokenOptimizationApi.enableRtk).not.toHaveBeenCalled()
    expect(tokenOptimizationApi.enableCodeGraphGlobally).not.toHaveBeenCalled()
  })

  it('enables Ponytail globally without requiring a project', async () => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    vi.mocked(tokenOptimizationApi.enablePonytail).mockResolvedValue({
      enabled: true,
      mode: 'full',
    })

    render(<TokenOptimization />)
    const toggle = await screen.findByRole('switch', { name: '全局启用懒程序员' })
    fireEvent.click(toggle)

    await waitFor(() => expect(tokenOptimizationApi.enablePonytail).toHaveBeenCalledOnce())
    expect(screen.getByTestId('ponytail-toolbar')).toHaveTextContent('懒程序员')
    expect(useUIStore.getState().toasts).toEqual([])
    expect(tokenOptimizationApi.status).not.toHaveBeenCalled()
  })

  it('keeps the Caveman switch disabled until its global status loads', async () => {
    let resolveStatus: ((status: { enabled: boolean; mode: 'full' }) => void) | undefined
    vi.mocked(tokenOptimizationApi.cavemanStatus).mockReturnValue(new Promise((resolve) => {
      resolveStatus = resolve
    }))

    render(<TokenOptimization />)
    const toggle = screen.getByRole('switch', { name: '全局启用 Caveman 响应压缩' })
    expect(toggle).toBeDisabled()
    fireEvent.click(toggle)
    expect(tokenOptimizationApi.enableCaveman).not.toHaveBeenCalled()

    resolveStatus?.({ enabled: false, mode: 'full' })
    await waitFor(() => expect(toggle).toBeEnabled())
  })

  it('enables RTK globally without requiring a project', async () => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    vi.mocked(tokenOptimizationApi.enableRtk).mockResolvedValue({
      enabled: true,
      available: true,
      version: '0.43.0',
      stats: null,
      error: null,
    })

    render(<TokenOptimization />)
    const toggle = await screen.findByRole('switch', { name: '启用 RTK 命令输出压缩' })
    fireEvent.click(toggle)

    await waitFor(() => expect(tokenOptimizationApi.enableRtk).toHaveBeenCalledOnce())
    expect(screen.getByTestId('rtk-toolbar')).toHaveTextContent('RTK 工具输出压缩')
    expect(tokenOptimizationApi.status).not.toHaveBeenCalled()
  })

  it('allows an unavailable RTK runtime to be switched off globally', async () => {
    vi.mocked(tokenOptimizationApi.rtkStatus).mockResolvedValue({
      enabled: true,
      available: false,
      version: null,
      stats: null,
      error: 'Runtime missing',
    })
    vi.mocked(tokenOptimizationApi.disableRtk).mockResolvedValue({
      enabled: false,
      available: false,
      version: null,
      stats: null,
      error: 'Runtime missing',
    })

    render(<TokenOptimization />)
    const toggle = await screen.findByRole('switch', { name: '启用 RTK 命令输出压缩' })
    await waitFor(() => expect(toggle).toBeEnabled())
    fireEvent.click(toggle)

    await waitFor(() => expect(tokenOptimizationApi.disableRtk).toHaveBeenCalledOnce())
  })

  it('converts RTK command-output savings into a full-cycle estimate', async () => {
    vi.mocked(tokenOptimizationApi.rtkStatus).mockResolvedValue({
      enabled: true,
      available: true,
      version: '0.43.0',
      stats: {
        totalCommands: 12,
        totalInput: 10_000,
        totalOutput: 2_000,
        totalSaved: 8_000,
        averageSavingsPercent: 80,
      },
      error: null,
    })

    render(<TokenOptimization />)

    const overview = await screen.findByTestId('savings-overview')
    expect(overview).toHaveTextContent('18–27%')
    expect(overview).not.toHaveTextContent('80%')
    expect(screen.getByTestId('rtk-toolbar')).toHaveTextContent('全周期 预计18–27%')
  })

  it('shows the expected RTK range until local samples exist', async () => {
    vi.mocked(tokenOptimizationApi.rtkStatus).mockResolvedValue({
      enabled: true,
      available: true,
      version: '0.43.0',
      stats: null,
      error: null,
    })

    render(<TokenOptimization />)

    const overview = await screen.findByTestId('savings-overview')
    expect(overview).toHaveTextContent('18–27%')
    expect(screen.getByTestId('rtk-toolbar')).toHaveTextContent('全周期 预计18–27%')
  })

  it('shows a savings estimate for every optimizer', async () => {
    render(<TokenOptimization />)

    expect(await screen.findByTestId('lite-toolbar')).toHaveTextContent('全周期 预计2–8%')
    expect(await screen.findByTestId('pruning-toolbar')).toHaveTextContent('全周期 预计8–24%')
    expect(await screen.findByTestId('ponytail-toolbar')).toHaveTextContent('全周期 预计0–22%')
    expect(await screen.findByTestId('caveman-toolbar')).toHaveTextContent('全周期 预计14–21%')
    expect(screen.getByTestId('rtk-toolbar')).toHaveTextContent('全周期 预计18–27%')
    expect(await screen.findByTestId('codegraph-toolbar')).toHaveTextContent('全周期 预计23–64%')
  })

  it('aggregates enabled full-cycle estimates and renders animated rings', async () => {
    vi.mocked(tokenOptimizationApi.liteStatus).mockResolvedValue({
      enabled: true,
      mode: 'deterministic',
    })
    vi.mocked(tokenOptimizationApi.cavemanStatus).mockResolvedValue({
      enabled: true,
      mode: 'full',
    })
    vi.mocked(tokenOptimizationApi.ponytailStatus).mockResolvedValue({
      enabled: true,
      mode: 'full',
    })
    vi.mocked(tokenOptimizationApi.rtkStatus).mockResolvedValue({
      enabled: true,
      available: true,
      version: '0.43.0',
      stats: {
        totalCommands: 12,
        totalInput: 10_000,
        totalOutput: 2_000,
        totalSaved: 8_000,
        averageSavingsPercent: 80,
      },
      error: null,
    })
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(status({
      enabled: true,
      state: 'ready',
    }))
    vi.mocked(tokenOptimizationApi.pruningStatus).mockResolvedValue({
      enabled: true,
      level: 'balanced',
      mode: 'deterministic',
    })
    vi.mocked(tokenOptimizationApi.codeGraphGlobalStatus).mockResolvedValue({ enabled: true })

    const { container } = render(<TokenOptimization />)

    const overview = await screen.findByTestId('savings-overview')
    expect(overview).toHaveTextContent('65–96%')
    expect(overview).toHaveTextContent('当前已启用方案递减叠加，高区间按重叠折算，上限为 96%')
    expect(overview).toHaveTextContent('6/6')
    expect(screen.getByLabelText('最低预估 65%')).toBeInTheDocument()
    expect(screen.getByLabelText('最高预估 96%')).toBeInTheDocument()
    expect(container.querySelectorAll('.token-savings-ring')).toHaveLength(2)
  })

  it('shows an upper estimate above 92% for Lite, RTK, and Code Graph together', async () => {
    vi.mocked(tokenOptimizationApi.liteStatus).mockResolvedValue({
      enabled: true,
      mode: 'deterministic',
    })
    vi.mocked(tokenOptimizationApi.rtkStatus).mockResolvedValue({
      enabled: true,
      available: true,
      version: '0.43.0',
      stats: null,
      error: null,
    })
    vi.mocked(tokenOptimizationApi.codeGraphGlobalStatus).mockResolvedValue({ enabled: true })

    render(<TokenOptimization />)

    const overview = await screen.findByTestId('savings-overview')
    expect(overview).toHaveTextContent('43–93%')
    expect(overview).toHaveTextContent('3/6')
    expect(screen.getByLabelText('最低预估 43%')).toBeInTheDocument()
    expect(screen.getByLabelText('最高预估 93%')).toBeInTheDocument()
  })

  it('keeps three high-range optimizers at 93% so a fourth one still advances', async () => {
    vi.mocked(tokenOptimizationApi.codeGraphGlobalStatus).mockResolvedValue({ enabled: true })
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(status({
      enabled: true,
      state: 'ready',
    }))
    vi.mocked(tokenOptimizationApi.pruningStatus).mockResolvedValue({
      enabled: true,
      level: 'balanced',
      mode: 'deterministic',
    })
    vi.mocked(tokenOptimizationApi.rtkStatus).mockResolvedValue({
      enabled: true,
      available: true,
      version: '0.43.0',
      stats: null,
      error: null,
    })

    render(<TokenOptimization />)

    const overview = await screen.findByTestId('savings-overview')
    expect(overview).toHaveTextContent('49–93%')
    expect(overview).toHaveTextContent('3/6')
    expect(screen.getByLabelText('最高预估 93%')).toBeInTheDocument()
  })

  it('raises the upper estimate to 94% when a fourth optimizer is enabled', async () => {
    vi.mocked(tokenOptimizationApi.codeGraphGlobalStatus).mockResolvedValue({ enabled: true })
    vi.mocked(tokenOptimizationApi.liteStatus).mockResolvedValue({
      enabled: true,
      mode: 'deterministic',
    })
    vi.mocked(tokenOptimizationApi.cavemanStatus).mockResolvedValue({
      enabled: true,
      mode: 'full',
    })
    vi.mocked(tokenOptimizationApi.rtkStatus).mockResolvedValue({
      enabled: true,
      available: true,
      version: '0.43.0',
      stats: null,
      error: null,
    })
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(status({
      enabled: true,
      state: 'ready',
    }))

    render(<TokenOptimization />)

    const overview = await screen.findByTestId('savings-overview')
    expect(overview).toHaveTextContent('57–94%')
    expect(overview).toHaveTextContent('4/6')
    expect(screen.getByLabelText('最低预估 57%')).toBeInTheDocument()
    expect(screen.getByLabelText('最高预估 94%')).toBeInTheDocument()
  })

  it('raises the upper estimate to 95% when five optimizers are enabled', async () => {
    vi.mocked(tokenOptimizationApi.codeGraphGlobalStatus).mockResolvedValue({ enabled: true })
    vi.mocked(tokenOptimizationApi.liteStatus).mockResolvedValue({
      enabled: true,
      mode: 'deterministic',
    })
    vi.mocked(tokenOptimizationApi.rtkStatus).mockResolvedValue({
      enabled: true,
      available: true,
      version: '0.43.0',
      stats: null,
      error: null,
    })
    vi.mocked(tokenOptimizationApi.ponytailStatus).mockResolvedValue({
      enabled: true,
      mode: 'full',
    })
    vi.mocked(tokenOptimizationApi.cavemanStatus).mockResolvedValue({
      enabled: true,
      mode: 'full',
    })

    render(<TokenOptimization />)

    const overview = await screen.findByTestId('savings-overview')
    expect(overview).toHaveTextContent('57–95%')
    expect(overview).toHaveTextContent('5/6')
    expect(screen.getByLabelText('最低预估 57%')).toBeInTheDocument()
    expect(screen.getByLabelText('最高预估 95%')).toBeInTheDocument()
  })

  it('uses the same Ponytail estimate in its row and the overview when enabled alone', async () => {
    vi.mocked(tokenOptimizationApi.ponytailStatus).mockResolvedValue({
      enabled: true,
      mode: 'full',
    })

    render(<TokenOptimization />)

    const overview = await screen.findByTestId('savings-overview')
    expect(overview).toHaveTextContent('0–22%')
    expect(overview).toHaveTextContent('1/6')
    expect(screen.getByLabelText('最低预估 0%')).toBeInTheDocument()
    expect(screen.getByLabelText('最高预估 22%')).toBeInTheDocument()
    expect(screen.getByTestId('ponytail-toolbar')).toHaveTextContent('全周期 预计0–22%')
  })

  it('aggregates Ponytail and Caveman so both switches affect the estimate', async () => {
    vi.mocked(tokenOptimizationApi.ponytailStatus).mockResolvedValue({
      enabled: true,
      mode: 'full',
    })
    vi.mocked(tokenOptimizationApi.cavemanStatus).mockResolvedValue({
      enabled: true,
      mode: 'full',
    })

    render(<TokenOptimization />)

    const overview = await screen.findByTestId('savings-overview')
    expect(overview).toHaveTextContent('14–43%')
    expect(screen.getByLabelText('最低预估 14%')).toBeInTheDocument()
    expect(screen.getByLabelText('最高预估 43%')).toBeInTheDocument()
    expect(overview).toHaveTextContent('2/6')
  })

  it('keeps the Caveman row and full-cycle rings on the same official range', async () => {
    vi.mocked(tokenOptimizationApi.cavemanStatus).mockResolvedValue({
      enabled: true,
      mode: 'full',
    })

    render(<TokenOptimization />)

    const overview = await screen.findByTestId('savings-overview')
    expect(overview).toHaveTextContent('14–21%')
    expect(screen.getByLabelText('最低预估 14%')).toBeInTheDocument()
    expect(screen.getByLabelText('最高预估 21%')).toBeInTheDocument()
    expect(screen.getByTestId('caveman-toolbar')).toHaveTextContent('全周期 预计14–21%')
  })

  it('enables Code Graph globally without asking for setup', async () => {
    const preparingStatus = status({
      enabled: true,
      state: 'preparing',
      progress: { phase: 'preparing', current: 0, total: 0 },
    })
    vi.mocked(tokenOptimizationApi.enable).mockResolvedValue(preparingStatus)

    render(<TokenOptimization />)
    const toggle = await screen.findByRole('switch', { name: '全局启用代码图谱' })
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(preparingStatus)
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(tokenOptimizationApi.enable).toHaveBeenCalledWith(projectPath)
    })
    expect((await screen.findAllByText('正在准备')).length).toBeGreaterThan(0)
  })

  it('does not overlap slow Code Graph status polls', async () => {
    vi.useFakeTimers()
    const slowPoll = deferred<CodeGraphStatus>()
    let statusCalls = 0
    vi.mocked(tokenOptimizationApi.status).mockImplementation(() => {
      statusCalls += 1
      return statusCalls === 1
        ? Promise.resolve(status({
            enabled: true,
            state: 'indexing',
            progress: { phase: 'indexing', current: 1, total: 10 },
          }))
        : slowPoll.promise
    })

    try {
      render(<TokenOptimization />)
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(screen.getByTestId('codegraph-toolbar')).toHaveTextContent('正在索引')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_400)
      })
      expect(tokenOptimizationApi.status).toHaveBeenCalledTimes(2)

      await act(async () => {
        slowPoll.resolve(status({ enabled: true, state: 'ready' }))
        await slowPoll.promise
      })
      expect(screen.getByTestId('codegraph-toolbar')).toHaveTextContent('已就绪')
    } finally {
      vi.useRealTimers()
    }
  })

  it('enables Code Graph globally even when no project is open', async () => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    vi.mocked(tokenOptimizationApi.enableCodeGraphGlobally).mockResolvedValue({ enabled: true })

    render(<TokenOptimization />)
    const toggle = await screen.findByRole('switch', { name: '全局启用代码图谱' })
    fireEvent.click(toggle)

    await waitFor(() => expect(tokenOptimizationApi.enableCodeGraphGlobally).toHaveBeenCalledOnce())
    expect(toggle).toBeChecked()
    expect(tokenOptimizationApi.status).not.toHaveBeenCalled()
  })

  it('disables Code Graph globally without requiring a current project', async () => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    vi.mocked(tokenOptimizationApi.codeGraphGlobalStatus).mockResolvedValue({ enabled: true })
    vi.mocked(tokenOptimizationApi.disableCodeGraphGlobally).mockResolvedValue({ enabled: false })

    render(<TokenOptimization />)
    const toggle = await screen.findByRole('switch', { name: '全局启用代码图谱' })
    await waitFor(() => expect(toggle).toBeChecked())
    fireEvent.click(toggle)

    await waitFor(() => expect(tokenOptimizationApi.disableCodeGraphGlobally).toHaveBeenCalledOnce())
    expect(toggle).not.toBeChecked()
  })

  it('does not index the home-directory workspace used by temporary sessions', async () => {
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => ({ ...session, isTemporary: true })),
    }))

    render(<TokenOptimization />)

    expect(await screen.findByText('当前没有项目；开启后，之后打开的项目会自动建立图谱。')).toBeInTheDocument()
    expect(tokenOptimizationApi.status).not.toHaveBeenCalled()
  })

  it('shows a project-session hint instead of a backend error for the user home directory', async () => {
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(status({
      projectPath: '/Users/example',
      indexable: false,
      enabled: true,
    }))

    render(<TokenOptimization />)

    expect(await screen.findByText('当前没有项目；开启后，之后打开的项目会自动建立图谱。')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('loads the interactive graph from a ready index', async () => {
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(status({
      enabled: true,
      state: 'ready',
      stats: {
        fileCount: 4,
        nodeCount: 10,
        edgeCount: 12,
        errorFileCount: 0,
        dbSizeBytes: 4096,
        lastUpdated: Date.now(),
        filesByLanguage: { typescript: 4 },
      },
    }))
    vi.mocked(tokenOptimizationApi.graph).mockResolvedValue({
      nodes: [{
        id: 'node-1',
        kind: 'function',
        name: 'run',
        qualifiedName: 'run',
        filePath: 'src/run.ts',
        language: 'typescript',
        startLine: 1,
        endLine: 3,
        degree: 2,
        communityId: 'module:src',
        communityLabel: 'src',
        role: 'hub',
      }],
      edges: [],
      architecture: {
        analyzedNodeCount: 1,
        analyzedEdgeCount: 0,
        availableNodeCount: 1,
        truncated: false,
        communities: [{
          id: 'module:src',
          label: 'src',
          nodeCount: 1,
          edgeCount: 0,
          cohesion: 1,
          hubNodeIds: ['node-1'],
          bridgeNodeIds: [],
        }],
        hubNodeIds: ['node-1'],
        bridgeNodeIds: [],
        confidence: { extracted: 0, inferred: 0, unknown: 0 },
      },
    })

    render(<TokenOptimization />)
    const toolbar = await screen.findByTestId('codegraph-toolbar')
    expect(toolbar).toHaveClass('grid', 'min-w-0')
    expect(toolbar).not.toHaveClass('min-w-max')
    expect(screen.queryByText(/开启后，当前及之后打开的项目/)).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: '可视化' }))

    expect(await screen.findByTestId('code-graph-visualization')).toHaveTextContent('1')
    expect(tokenOptimizationApi.graph).toHaveBeenCalledWith(projectPath)
  })

  it('opens a ready current-project graph directly from the rail entry', async () => {
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(status({
      projectPath: '/private/tmp/cybercode-project',
      enabled: true,
      state: 'ready',
      stats: {
        fileCount: 1,
        nodeCount: 1,
        edgeCount: 0,
        errorFileCount: 0,
        dbSizeBytes: 4096,
        lastUpdated: Date.now(),
        filesByLanguage: { typescript: 1 },
      },
    }))
    vi.mocked(tokenOptimizationApi.graph).mockResolvedValue({
      nodes: [],
      edges: [],
      architecture: {
        analyzedNodeCount: 0,
        analyzedEdgeCount: 0,
        availableNodeCount: 0,
        truncated: false,
        communities: [],
        hubNodeIds: [],
        bridgeNodeIds: [],
        confidence: { extracted: 0, inferred: 0, unknown: 0 },
      },
    })

    render(<TokenOptimization initialView="graph" />)

    expect(await screen.findByTestId('code-graph-visualization')).toHaveTextContent('0')
    expect(tokenOptimizationApi.graph).toHaveBeenCalledTimes(1)
    expect(tokenOptimizationApi.graph).toHaveBeenCalledWith(projectPath)
  })

  it('keeps rail navigation in sync when switching between optimization and graph views', async () => {
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(status({
      enabled: true,
      state: 'ready',
      stats: {
        fileCount: 1,
        nodeCount: 1,
        edgeCount: 0,
        errorFileCount: 0,
        dbSizeBytes: 4096,
        lastUpdated: Date.now(),
        filesByLanguage: { typescript: 1 },
      },
    }))
    vi.mocked(tokenOptimizationApi.graph).mockResolvedValue(graphData('current', 1))

    const view = render(<TokenOptimization initialView="graph" />)
    expect(await screen.findByTestId('code-graph-visualization')).toHaveTextContent('1')

    view.rerender(<TokenOptimization initialView="overview" />)
    expect(await screen.findByTestId('savings-overview')).toBeInTheDocument()

    view.rerender(<TokenOptimization initialView="graph" />)
    expect(await screen.findByTestId('code-graph-visualization')).toHaveTextContent('1')
    expect(tokenOptimizationApi.graph).toHaveBeenCalledTimes(2)
  })

  it('does not reopen an in-flight graph after switching back to the optimization overview', async () => {
    const graphResult = deferred<CodeGraphData>()
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(status({
      enabled: true,
      state: 'ready',
      stats: {
        fileCount: 1,
        nodeCount: 1,
        edgeCount: 0,
        errorFileCount: 0,
        dbSizeBytes: 4096,
        lastUpdated: Date.now(),
        filesByLanguage: { typescript: 1 },
      },
    }))
    vi.mocked(tokenOptimizationApi.graph).mockReturnValue(graphResult.promise)

    const view = render(<TokenOptimization initialView="graph" />)
    await waitFor(() => expect(tokenOptimizationApi.graph).toHaveBeenCalledWith(projectPath))

    view.rerender(<TokenOptimization initialView="overview" />)
    expect(await screen.findByTestId('savings-overview')).toBeInTheDocument()

    await act(async () => {
      graphResult.resolve(graphData('stale', 3))
      await graphResult.promise
    })

    expect(screen.queryByTestId('code-graph-visualization')).not.toBeInTheDocument()
    expect(screen.getByTestId('savings-overview')).toBeInTheDocument()
  })

  it('ignores a stale status response after the current project changes', async () => {
    const oldProjectStatus = deferred<CodeGraphStatus>()
    const nextProjectPath = '/tmp/cybercode-next-project'
    vi.mocked(tokenOptimizationApi.status).mockImplementation((requestedPath) => {
      if (requestedPath === projectPath) return oldProjectStatus.promise
      return Promise.resolve(status({
        projectPath: nextProjectPath,
        enabled: false,
        state: 'disabled',
      }))
    })

    render(<TokenOptimization initialView="graph" />)
    await waitFor(() => expect(tokenOptimizationApi.status).toHaveBeenCalledWith(projectPath))

    act(() => {
      useSessionStore.setState((state) => ({
        sessions: state.sessions.map((session) => ({ ...session, workDir: nextProjectPath })),
      }))
    })

    const graphToolbar = await screen.findByTestId('codegraph-toolbar')
    await waitFor(() => expect(within(graphToolbar).getByText('已关闭')).toBeInTheDocument())
    await act(async () => {
      oldProjectStatus.resolve(status({
        enabled: true,
        state: 'ready',
        stats: {
          fileCount: 99,
          nodeCount: 99,
          edgeCount: 99,
          errorFileCount: 0,
          dbSizeBytes: 4096,
          lastUpdated: Date.now(),
          filesByLanguage: { typescript: 99 },
        },
      }))
      await oldProjectStatus.promise
    })

    expect(within(graphToolbar).getByText('已关闭')).toBeInTheDocument()
    expect(within(graphToolbar).queryByText('99')).not.toBeInTheDocument()
    expect(tokenOptimizationApi.graph).not.toHaveBeenCalled()
  })

  it('ignores stale graph data after the current project changes', async () => {
    const oldProjectGraph = deferred<CodeGraphData>()
    const nextProjectPath = '/tmp/cybercode-next-project'
    vi.mocked(tokenOptimizationApi.status).mockImplementation((requestedPath) => Promise.resolve(status({
      projectPath: requestedPath,
      enabled: true,
      state: 'ready',
      stats: {
        fileCount: 1,
        nodeCount: 1,
        edgeCount: 0,
        errorFileCount: 0,
        dbSizeBytes: 4096,
        lastUpdated: Date.now(),
        filesByLanguage: { typescript: 1 },
      },
    })))
    vi.mocked(tokenOptimizationApi.graph).mockImplementation((requestedPath) => {
      if (requestedPath === projectPath) return oldProjectGraph.promise
      return Promise.resolve(graphData('next', 2))
    })

    render(<TokenOptimization initialView="graph" />)
    await waitFor(() => expect(tokenOptimizationApi.graph).toHaveBeenCalledWith(projectPath))

    act(() => {
      useSessionStore.setState((state) => ({
        sessions: state.sessions.map((session) => ({ ...session, workDir: nextProjectPath })),
      }))
    })

    await waitFor(() => expect(tokenOptimizationApi.graph).toHaveBeenCalledWith(nextProjectPath))
    expect(await screen.findByTestId('code-graph-visualization')).toHaveTextContent('2')

    await act(async () => {
      oldProjectGraph.resolve(graphData('old', 1))
      await oldProjectGraph.promise
    })

    expect(screen.getByTestId('code-graph-visualization')).toHaveTextContent('2')
  })

  it('does not apply an enable response to a project selected while enabling', async () => {
    const enableResult = deferred<CodeGraphStatus>()
    const nextProjectPath = '/tmp/cybercode-next-project'
    vi.mocked(tokenOptimizationApi.status).mockImplementation((requestedPath) => Promise.resolve(status({
      projectPath: requestedPath,
      enabled: false,
      state: 'disabled',
    })))
    vi.mocked(tokenOptimizationApi.enable).mockReturnValue(enableResult.promise)

    render(<TokenOptimization />)
    const toggle = await screen.findByRole('switch', { name: '全局启用代码图谱' })
    fireEvent.click(toggle)
    await waitFor(() => expect(tokenOptimizationApi.enable).toHaveBeenCalledWith(projectPath))

    act(() => {
      useSessionStore.setState((state) => ({
        sessions: state.sessions.map((session) => ({ ...session, workDir: nextProjectPath })),
      }))
    })

    const graphToolbar = await screen.findByTestId('codegraph-toolbar')
    await waitFor(() => expect(within(graphToolbar).getByText('已关闭')).toBeInTheDocument())

    await act(async () => {
      enableResult.resolve(status({
        enabled: true,
        state: 'ready',
        stats: {
          fileCount: 99,
          nodeCount: 99,
          edgeCount: 99,
          errorFileCount: 0,
          dbSizeBytes: 4096,
          lastUpdated: Date.now(),
          filesByLanguage: { typescript: 99 },
        },
      }))
      await enableResult.promise
    })

    expect(within(graphToolbar).getByText('已关闭')).toBeInTheDocument()
    expect(within(graphToolbar).queryByText('99')).not.toBeInTheDocument()
  })

  it('refreshes the selected project after an earlier project enables Code Graph globally', async () => {
    const enableResult = deferred<CodeGraphStatus>()
    const nextProjectPath = '/tmp/cybercode-next-project'
    let globallyEnabled = false
    vi.mocked(tokenOptimizationApi.status).mockImplementation((requestedPath) => Promise.resolve(status({
      projectPath: requestedPath,
      enabled: globallyEnabled,
      state: globallyEnabled ? 'ready' : 'disabled',
      stats: globallyEnabled ? {
        fileCount: 2,
        nodeCount: 2,
        edgeCount: 1,
        errorFileCount: 0,
        dbSizeBytes: 4096,
        lastUpdated: Date.now(),
        filesByLanguage: { typescript: 2 },
      } : null,
    })))
    vi.mocked(tokenOptimizationApi.enable).mockReturnValue(enableResult.promise)

    render(<TokenOptimization />)
    fireEvent.click(await screen.findByRole('switch', { name: '全局启用代码图谱' }))
    await waitFor(() => expect(tokenOptimizationApi.enable).toHaveBeenCalledWith(projectPath))

    act(() => {
      useSessionStore.setState((state) => ({
        sessions: state.sessions.map((session) => ({ ...session, workDir: nextProjectPath })),
      }))
    })

    const graphToolbar = await screen.findByTestId('codegraph-toolbar')
    await waitFor(() => expect(within(graphToolbar).getByText('已关闭')).toBeInTheDocument())

    globallyEnabled = true
    await act(async () => {
      enableResult.resolve(status({ enabled: true, state: 'preparing' }))
      await enableResult.promise
    })

    await waitFor(() => expect(within(graphToolbar).getByText('已就绪')).toBeInTheDocument())
    expect(tokenOptimizationApi.status).toHaveBeenCalledWith(nextProjectPath)
    expect(within(graphToolbar).getAllByText('2').length).toBeGreaterThan(0)
  })

  it('does not apply a rebuild response to a newly selected project', async () => {
    const rebuildResult = deferred<CodeGraphStatus>()
    const nextProjectPath = '/tmp/cybercode-next-project'
    vi.mocked(tokenOptimizationApi.codeGraphGlobalStatus).mockResolvedValue({ enabled: true })
    vi.mocked(tokenOptimizationApi.status).mockImplementation((requestedPath) => Promise.resolve(status({
      projectPath: requestedPath,
      enabled: true,
      state: 'ready',
      stats: {
        fileCount: requestedPath === projectPath ? 1 : 2,
        nodeCount: requestedPath === projectPath ? 1 : 2,
        edgeCount: 0,
        errorFileCount: 0,
        dbSizeBytes: 4096,
        lastUpdated: Date.now(),
        filesByLanguage: { typescript: requestedPath === projectPath ? 1 : 2 },
      },
    })))
    vi.mocked(tokenOptimizationApi.rebuild).mockReturnValue(rebuildResult.promise)

    render(<TokenOptimization />)
    const rebuildButton = await screen.findByRole('button', { name: '重建索引' })
    await waitFor(() => expect(rebuildButton).toBeEnabled())
    fireEvent.click(rebuildButton)
    await waitFor(() => expect(tokenOptimizationApi.rebuild).toHaveBeenCalledWith(projectPath))

    act(() => {
      useSessionStore.setState((state) => ({
        sessions: state.sessions.map((session) => ({ ...session, workDir: nextProjectPath })),
      }))
    })

    const graphToolbar = await screen.findByTestId('codegraph-toolbar')
    await waitFor(() => expect(within(graphToolbar).getByText('已就绪')).toBeInTheDocument())

    await act(async () => {
      rebuildResult.resolve(status({
        enabled: true,
        state: 'indexing',
        progress: { phase: 'indexing', current: 1, total: 99, currentFile: 'old-project.ts' },
      }))
      await rebuildResult.promise
    })

    expect(within(graphToolbar).getByText('已就绪')).toBeInTheDocument()
    expect(within(graphToolbar).queryByText(/old-project\.ts/)).not.toBeInTheDocument()
  })

  it('does not reopen an in-flight graph after Code Graph is disabled', async () => {
    const graphResult = deferred<CodeGraphData>()
    vi.mocked(tokenOptimizationApi.codeGraphGlobalStatus).mockResolvedValue({ enabled: true })
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(status({
      enabled: true,
      state: 'ready',
      stats: {
        fileCount: 1,
        nodeCount: 1,
        edgeCount: 0,
        errorFileCount: 0,
        dbSizeBytes: 4096,
        lastUpdated: Date.now(),
        filesByLanguage: { typescript: 1 },
      },
    }))
    vi.mocked(tokenOptimizationApi.graph).mockReturnValue(graphResult.promise)
    vi.mocked(tokenOptimizationApi.disableCodeGraphGlobally).mockResolvedValue({ enabled: false })

    render(<TokenOptimization />)
    fireEvent.click(await screen.findByRole('button', { name: '可视化' }))
    await waitFor(() => expect(tokenOptimizationApi.graph).toHaveBeenCalledWith(projectPath))

    const toggle = screen.getByRole('switch', { name: '全局启用代码图谱' })
    fireEvent.click(toggle)
    await waitFor(() => expect(tokenOptimizationApi.disableCodeGraphGlobally).toHaveBeenCalledOnce())
    const graphToolbar = screen.getByTestId('codegraph-toolbar')
    await waitFor(() => expect(graphToolbar).toHaveTextContent('已关闭'))

    await act(async () => {
      graphResult.resolve(graphData('stale', 3))
      await graphResult.promise
    })

    expect(screen.queryByTestId('code-graph-visualization')).not.toBeInTheDocument()
    expect(graphToolbar).toHaveTextContent('已关闭')
  })

  it('keeps the graph rail entry on the overview while the project graph is unavailable', async () => {
    render(<TokenOptimization initialView="graph" />)

    expect(await screen.findByTestId('codegraph-toolbar')).toBeInTheDocument()
    expect(tokenOptimizationApi.graph).not.toHaveBeenCalled()
  })

  it('keeps empty-index controls in the compact toolbar', async () => {
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(status({
      enabled: true,
      state: 'empty',
      stats: {
        fileCount: 0,
        nodeCount: 0,
        edgeCount: 0,
        errorFileCount: 0,
        dbSizeBytes: 4096,
        lastUpdated: null,
        filesByLanguage: {},
      },
    }))

    render(<TokenOptimization />)

    expect(await screen.findByText('没有可用代码')).toBeInTheDocument()
    expect(screen.queryByText(/当前项目没有可索引的代码符号/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重建索引' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '可视化' })).toBeDisabled()
  })

  it('does not offer indexing when no project session is active', async () => {
    useTabStore.setState({ tabs: [], activeTabId: null })

    render(<TokenOptimization />)

    expect(await screen.findByText('当前没有项目；开启后，之后打开的项目会自动建立图谱。')).toBeInTheDocument()
    expect(tokenOptimizationApi.status).not.toHaveBeenCalled()
  })
})
