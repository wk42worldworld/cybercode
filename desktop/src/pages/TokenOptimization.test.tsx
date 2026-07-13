import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tokenOptimizationApi, type CodeGraphStatus } from '../api/tokenOptimization'
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
  })

  it('enables Lite deterministic cleanup globally without requiring a project', async () => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    vi.mocked(tokenOptimizationApi.enableLite).mockResolvedValue({
      enabled: true,
      mode: 'deterministic',
    })

    render(<TokenOptimization />)
    const toggle = await screen.findByRole('switch', { name: '全局启用 Lite 确定性清理' })
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

  it('starts Caveman and Ponytail disabled by default', async () => {
    render(<TokenOptimization />)

    const cavemanToggle = screen.getByRole('switch', { name: '全局启用 Caveman 响应压缩' })
    const ponytailToggle = screen.getByRole('switch', { name: '全局启用懒程序员' })

    await waitFor(() => {
      expect(cavemanToggle).toBeEnabled()
      expect(ponytailToggle).toBeEnabled()
    })
    expect(cavemanToggle).not.toBeChecked()
    expect(ponytailToggle).not.toBeChecked()
    expect(tokenOptimizationApi.enableCaveman).not.toHaveBeenCalled()
    expect(tokenOptimizationApi.enablePonytail).not.toHaveBeenCalled()
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
    expect(await screen.findByTestId('ponytail-toolbar')).toHaveTextContent('全周期 预计0–22%')
    expect(await screen.findByTestId('caveman-toolbar')).toHaveTextContent('全周期 预计14–21%')
    expect(screen.getByTestId('rtk-toolbar')).toHaveTextContent('全周期 预计18–27%')
    expect(await screen.findByTestId('codegraph-toolbar')).toHaveTextContent('全周期 预计23–64%')
  })

  it('compounds enabled full-cycle estimates and renders animated rings', async () => {
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

    const { container } = render(<TokenOptimization />)

    const overview = await screen.findByTestId('savings-overview')
    expect(overview).toHaveTextContent('47–85%')
    expect(overview).toHaveTextContent('根据当前已启用方案的全周期预估复合计算')
    expect(overview).toHaveTextContent('5/5')
    expect(screen.getByLabelText('最低预估 47%')).toBeInTheDocument()
    expect(screen.getByLabelText('最高预估 85%')).toBeInTheDocument()
    expect(container.querySelectorAll('.token-savings-ring')).toHaveLength(2)
  })

  it('keeps the previous four-optimizer estimate unchanged when Ponytail is off', async () => {
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
    expect(overview).toHaveTextContent('47–81%')
    expect(overview).toHaveTextContent('4/5')
    expect(screen.getByLabelText('最低预估 47%')).toBeInTheDocument()
    expect(screen.getByLabelText('最高预估 81%')).toBeInTheDocument()
  })

  it('uses the same Ponytail estimate in its row and the overview when enabled alone', async () => {
    vi.mocked(tokenOptimizationApi.ponytailStatus).mockResolvedValue({
      enabled: true,
      mode: 'full',
    })

    render(<TokenOptimization />)

    const overview = await screen.findByTestId('savings-overview')
    expect(overview).toHaveTextContent('0–22%')
    expect(overview).toHaveTextContent('1/5')
    expect(screen.getByLabelText('最低预估 0%')).toBeInTheDocument()
    expect(screen.getByLabelText('最高预估 22%')).toBeInTheDocument()
    expect(screen.getByTestId('ponytail-toolbar')).toHaveTextContent('全周期 预计0–22%')
  })

  it('compounds Ponytail and Caveman so both switches affect the estimate', async () => {
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
    expect(overview).toHaveTextContent('14–38%')
    expect(screen.getByLabelText('最低预估 14%')).toBeInTheDocument()
    expect(screen.getByLabelText('最高预估 38%')).toBeInTheDocument()
    expect(overview).toHaveTextContent('2/5')
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
    const toggle = await screen.findByRole('switch', { name: '为项目启用代码图谱' })
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(preparingStatus)
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(tokenOptimizationApi.enable).toHaveBeenCalledWith(projectPath)
    })
    expect((await screen.findAllByText('正在准备')).length).toBeGreaterThan(0)
  })

  it('does not index the home-directory workspace used by temporary sessions', async () => {
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => ({ ...session, isTemporary: true })),
    }))

    render(<TokenOptimization />)

    expect(await screen.findByText('请打开一个项目会话；代码图谱会自动为项目启用。')).toBeInTheDocument()
    expect(tokenOptimizationApi.status).not.toHaveBeenCalled()
  })

  it('shows a project-session hint instead of a backend error for the user home directory', async () => {
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(status({
      projectPath: '/Users/example',
      indexable: false,
      enabled: true,
    }))

    render(<TokenOptimization />)

    expect(await screen.findByText('请打开一个项目会话；代码图谱会自动为项目启用。')).toBeInTheDocument()
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
      }],
      edges: [],
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

    expect(await screen.findByText('请打开一个项目会话；代码图谱会自动为项目启用。')).toBeInTheDocument()
    expect(tokenOptimizationApi.status).not.toHaveBeenCalled()
  })
})
