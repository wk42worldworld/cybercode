import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { knowledgeApi, type KnowledgeSource } from '../api/knowledge'
import { tokenOptimizationApi, type CodeGraphData, type CodeGraphStatus } from '../api/tokenOptimization'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'
import { KnowledgeSpace } from './KnowledgeSpace'

vi.mock('../api/knowledge', () => ({
  knowledgeApi: {
    sources: vi.fn(),
    addSources: vi.fn(),
    removeSource: vi.fn(),
    reindexSource: vi.fn(),
    documents: vi.fn(),
    search: vi.fn(),
    stats: vi.fn(),
  },
}))

vi.mock('../api/tokenOptimization', () => ({
  tokenOptimizationApi: {
    status: vi.fn(),
    enable: vi.fn(),
    rebuild: vi.fn(),
    graph: vi.fn(),
  },
}))

vi.mock('../components/codegraph/CodeGraphVisualization', () => ({
  CodeGraphVisualization: ({ data }: { data: { nodes: unknown[] } }) => (
    <div data-testid="code-graph-visualization">{data.nodes.length}</div>
  ),
}))

vi.mock('../lib/desktopRuntime', () => ({
  isTauriRuntime: () => false,
}))

const projectPath = '/tmp/cybercode-project'

const source: KnowledgeSource = {
  id: 'source-1',
  path: '/tmp/notes',
  name: 'notes',
  kind: 'folder',
  status: 'ready',
  error: null,
  documentCount: 2,
  chunkCount: 4,
  sizeBytes: 1024,
  createdAt: '2026-07-19T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
  indexedAt: '2026-07-19T00:00:00.000Z',
}

function graphStatus(overrides: Partial<CodeGraphStatus> = {}): CodeGraphStatus {
  return {
    projectPath,
    indexable: true,
    enabled: true,
    state: 'ready',
    progress: null,
    stats: null,
    error: null,
    bundledLanguages: ['TypeScript'],
    ...overrides,
  }
}

function graphData(): CodeGraphData {
  return {
    nodes: [{
      id: 'node-1',
      kind: 'function',
      name: 'start',
      qualifiedName: 'app.start',
      filePath: 'src/app.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 3,
      degree: 0,
      communityId: 'app',
      communityLabel: 'app',
      role: 'member',
    }],
    edges: [],
    architecture: {
      analyzedNodeCount: 1,
      analyzedEdgeCount: 0,
      availableNodeCount: 1,
      truncated: false,
      communities: [],
      hubNodeIds: [],
      bridgeNodeIds: [],
      confidence: { extracted: 1, inferred: 0, unknown: 0 },
    },
  }
}

describe('KnowledgeSpace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'zh' })
    useUIStore.setState({ toasts: [] })
    useSessionStore.setState({
      sessions: [{
        id: 'session-1',
        title: 'Project',
        createdAt: '2026-07-19T00:00:00.000Z',
        modifiedAt: '2026-07-19T00:00:00.000Z',
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
    vi.mocked(knowledgeApi.sources).mockResolvedValue([source])
    vi.mocked(knowledgeApi.stats).mockResolvedValue({
      sourceCount: 1,
      documentCount: 2,
      chunkCount: 4,
      sizeBytes: 1024,
      indexingCount: 0,
    })
    vi.mocked(knowledgeApi.documents).mockResolvedValue([])
    vi.mocked(knowledgeApi.search).mockResolvedValue([])
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(graphStatus())
    vi.mocked(tokenOptimizationApi.graph).mockResolvedValue(graphData())
  })

  it('opens the ready project graph directly', async () => {
    render(<KnowledgeSpace />)

    expect(await screen.findByTestId('code-graph-visualization')).toHaveTextContent('1')
    expect(tokenOptimizationApi.status).toHaveBeenCalledWith(projectPath)
    expect(tokenOptimizationApi.graph).toHaveBeenCalledWith(projectPath, 180)
  })

  it('enables Code Graph from the workspace without visiting token optimization', async () => {
    vi.mocked(tokenOptimizationApi.status).mockResolvedValue(graphStatus({ enabled: false, state: 'disabled' }))
    vi.mocked(tokenOptimizationApi.enable).mockResolvedValue(graphStatus({ state: 'indexing' }))

    render(<KnowledgeSpace />)
    fireEvent.click(await screen.findByRole('button', { name: '启用代码图谱' }))

    await waitFor(() => expect(tokenOptimizationApi.enable).toHaveBeenCalledWith(projectPath))
  })

  it('filters full-text search to the selected source', async () => {
    vi.mocked(knowledgeApi.search).mockResolvedValue([{
      chunkId: 1,
      sourceId: source.id,
      documentId: 'document-1',
      sourceName: source.name,
      title: 'README.md',
      path: '/tmp/notes/README.md',
      excerpt: '项目使用 <mark>事件总线</mark>。',
      score: -1,
    }])

    render(<KnowledgeSpace />)
    fireEvent.click(await screen.findByRole('button', { name: /notes/ }))
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索文件和索引内容' }), {
      target: { value: '事件总线' },
    })

    expect(await screen.findByText('README.md')).toBeInTheDocument()
    expect(knowledgeApi.search).toHaveBeenCalledWith('事件总线', source.id)
  })
})
