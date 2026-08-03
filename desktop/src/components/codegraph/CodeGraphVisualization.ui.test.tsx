import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeGraphData } from '../../api/tokenOptimization'
import { useSettingsStore } from '../../stores/settingsStore'
import { CodeGraphVisualization } from './CodeGraphVisualization'
import { CODE_GRAPH_FALLBACK_MAX_NODES, buildSemanticLayout } from './codeGraphLayout'

describe('CodeGraphVisualization fallback state', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'zh' })
    vi.stubGlobal('Worker', undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('labels a bounded preview and retries the full worker layout', async () => {
    const data = largeGraphData(420)
    render(<CodeGraphVisualization data={data} />)

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        `简化预览 ${CODE_GRAPH_FALLBACK_MAX_NODES}/${data.nodes.length}`,
      )
    })
    expect(screen.getByText('简化图谱')).toBeInTheDocument()

    class WorkingLayoutWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null

      postMessage(message: { id: number; data: CodeGraphData; viewMode: 'architecture' | 'files' }) {
        const layout = buildSemanticLayout(message.data, message.viewMode)
        queueMicrotask(() => this.onmessage?.(new MessageEvent('message', {
          data: { id: message.id, layout },
        })))
      }

      terminate() {}
    }
    vi.stubGlobal('Worker', WorkingLayoutWorker)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.getByText('实时语义图谱')).toBeInTheDocument()
  })

  it('shows a busy surface instead of an empty graph while layout is pending', () => {
    class HangingLayoutWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', HangingLayoutWorker)

    render(<CodeGraphVisualization data={largeGraphData(420)} />)

    expect(screen.getByRole('status')).toHaveTextContent('加载中...')
    expect(screen.queryByText('还没有已索引的符号')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '交互式代码关系图' })).not.toBeInTheDocument()
  })

  it('sizes the canvas to a low container without clipping it', () => {
    render(<CodeGraphVisualization data={largeGraphData(2)} />)

    const canvas = screen.getByRole('img', { name: '交互式代码关系图' })
    expect(canvas).toHaveStyle({ height: '100px' })
  })

  it('exposes every node through one lightweight keyboard navigator', () => {
    render(<CodeGraphVisualization data={largeGraphData(3)} />)

    const navigator = screen.getByRole('listbox', { name: '交互式代码关系图' })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option')).toHaveTextContent('app.node0')

    fireEvent.keyDown(navigator, { key: 'ArrowRight' })
    expect(screen.getByRole('option')).toHaveTextContent('app.node1')
    fireEvent.keyDown(navigator, { key: 'Enter' })

    expect(screen.getByRole('heading', { name: 'app.node1' })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })
})

function largeGraphData(count: number): CodeGraphData {
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `node-${index}`,
    kind: 'function',
    name: `node${index}`,
    qualifiedName: `app.node${index}`,
    filePath: `src/node${index}.ts`,
    language: 'typescript',
    startLine: 1,
    endLine: 2,
    degree: 0,
    communityId: 'app',
    communityLabel: 'app',
    role: index === 0 ? 'hub' as const : 'member' as const,
  }))
  return {
    nodes,
    edges: [],
    architecture: {
      analyzedNodeCount: count,
      analyzedEdgeCount: 0,
      availableNodeCount: count,
      truncated: false,
      communities: [{
        id: 'app',
        label: 'app',
        nodeCount: count,
        edgeCount: 0,
        cohesion: 0,
        hubNodeIds: ['node-0'],
        bridgeNodeIds: [],
      }],
      hubNodeIds: ['node-0'],
      bridgeNodeIds: [],
      confidence: { extracted: 0, inferred: 0, unknown: 0 },
    },
  }
}
