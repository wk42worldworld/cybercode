import { describe, expect, it } from 'vitest'
import type { CodeGraphData, CodeGraphNode } from '../../api/tokenOptimization'
import { buildSemanticLayout } from './CodeGraphVisualization'
import {
  CODE_GRAPH_FALLBACK_MAX_EDGES,
  CODE_GRAPH_FALLBACK_MAX_NODES,
  CODE_GRAPH_LAYOUT_WORKER_THRESHOLD,
  requestCodeGraphLayout,
  shouldUseCodeGraphLayoutWorker,
  type LayoutWorkerLike,
} from './codeGraphLayout'

function node(overrides: Partial<CodeGraphNode> & Pick<CodeGraphNode, 'id' | 'name' | 'filePath'>): CodeGraphNode {
  return {
    kind: 'function',
    qualifiedName: overrides.name,
    language: 'typescript',
    startLine: 1,
    endLine: 3,
    degree: 1,
    communityId: 'community-core',
    communityLabel: 'core',
    role: 'member',
    ...overrides,
  }
}

function graphData(nodes: CodeGraphNode[], edges: CodeGraphData['edges'] = []): CodeGraphData {
  const communities = [...new Map(nodes.map((item) => [item.communityId, item.communityLabel])).entries()]
    .map(([id, label]) => {
      const members = nodes.filter((item) => item.communityId === id)
      return {
        id,
        label,
        nodeCount: members.length,
        edgeCount: edges.filter((edge) =>
          members.some((item) => item.id === edge.source)
          && members.some((item) => item.id === edge.target),
        ).length,
        cohesion: 1,
        hubNodeIds: members.filter((item) => item.role === 'hub').map((item) => item.id),
        bridgeNodeIds: members.filter((item) => item.role === 'bridge').map((item) => item.id),
      }
    })
  return {
    nodes,
    edges,
    architecture: {
      analyzedNodeCount: nodes.length,
      analyzedEdgeCount: edges.length,
      availableNodeCount: nodes.length,
      truncated: false,
      communities,
      hubNodeIds: nodes.filter((item) => item.role === 'hub').map((item) => item.id),
      bridgeNodeIds: nodes.filter((item) => item.role === 'bridge').map((item) => item.id),
      confidence: { extracted: edges.length, inferred: 0, unknown: 0 },
    },
  }
}

describe('CodeGraph semantic layout', () => {
  it('builds one stable sector per architecture community with its hub at the center', () => {
    const data = graphData([
      node({ id: 'hub:a', name: 'runA', filePath: 'src/a.ts', degree: 4, role: 'hub' }),
      node({ id: 'function:a', name: 'helperA', filePath: 'src/a.ts' }),
      node({
        id: 'hub:b',
        name: 'runB',
        filePath: 'desktop/b.ts',
        degree: 3,
        role: 'hub',
        communityId: 'community-desktop',
        communityLabel: 'desktop',
      }),
      node({
        id: 'function:b',
        name: 'helperB',
        filePath: 'desktop/b.ts',
        communityId: 'community-desktop',
        communityLabel: 'desktop',
      }),
    ])

    const layout = buildSemanticLayout(data, 'architecture')

    expect(layout.clusters).toHaveLength(2)
    expect(layout.nodes).toHaveLength(4)
    for (const cluster of layout.clusters) {
      const hub = layout.nodes.find((candidate) =>
        candidate.clusterKey === cluster.key && candidate.role === 'hub',
      )
      expect(hub).toMatchObject({ x: cluster.x, y: cluster.y })
      expect(cluster.nodeIds).toContain(hub?.id)
      expect(cluster.kind).toBe('architecture')
    }
  })

  it('retains the file-sector view and centers its file node', () => {
    const data = graphData([
      node({ id: 'file:a', kind: 'file', name: 'a.ts', filePath: 'src/a.ts', degree: 4 }),
      node({ id: 'function:a', name: 'runA', filePath: 'src/a.ts', degree: 6 }),
    ])

    const layout = buildSemanticLayout(data, 'files')
    const cluster = layout.clusters[0]!
    const fileNode = layout.nodes.find((candidate) => candidate.id === 'file:a')

    expect(fileNode).toMatchObject({ x: cluster.x, y: cluster.y })
    expect(cluster.kind).toBe('files')
  })

  it('uses a deterministic fallback hub when an architecture hub is unavailable', () => {
    const data = graphData([
      node({ id: 'function:low', name: 'low', filePath: 'index.html', degree: 1 }),
      node({ id: 'function:high', name: 'high', filePath: 'index.html', degree: 6 }),
    ])

    const first = buildSemanticLayout(data, 'architecture')
    const second = buildSemanticLayout(data, 'architecture')
    const cluster = first.clusters[0]!
    const hub = first.nodes.find((candidate) => candidate.id === 'function:high')

    expect(hub).toMatchObject({ x: cluster.x, y: cluster.y })
    expect(second).toEqual(first)
  })

  it('keeps small graphs synchronous and routes large graphs through a worker', async () => {
    const small = graphData([
      node({ id: 'small', name: 'small', filePath: 'src/small.ts' }),
    ])
    const large = graphData(Array.from({ length: CODE_GRAPH_LAYOUT_WORKER_THRESHOLD }, (_, index) =>
      node({ id: `node:${index}`, name: `node${index}`, filePath: `src/${index}.ts` })))
    let workerCreated = false

    expect(shouldUseCodeGraphLayoutWorker(small)).toBe(false)
    expect(shouldUseCodeGraphLayoutWorker(large)).toBe(true)
    await expect(requestCodeGraphLayout(small, 'architecture', {
      workerFactory: () => {
        workerCreated = true
        throw new Error('not expected')
      },
    })).resolves.toEqual(buildSemanticLayout(small, 'architecture'))
    expect(workerCreated).toBe(false)
  })

  it('ignores stale worker replies and accepts the matching deterministic layout', async () => {
    const data = graphData(Array.from({ length: CODE_GRAPH_LAYOUT_WORKER_THRESHOLD }, (_, index) =>
      node({ id: `node:${index}`, name: `node${index}`, filePath: 'src/index.ts' })))
    const expected = buildSemanticLayout(data, 'architecture')
    let terminated = false
    const worker = fakeLayoutWorker((message, instance) => {
      instance.onmessage?.({ data: { id: message.id + 1, layout: { nodes: [], clusters: [] } } } as MessageEvent)
      instance.onmessage?.({ data: { id: message.id, layout: expected } } as MessageEvent)
    }, () => { terminated = true })

    await expect(requestCodeGraphLayout(data, 'architecture', {
      workerFactory: () => worker,
    })).resolves.toEqual(expected)
    expect(terminated).toBe(true)
  })

  it('cancels worker layout and uses a bounded subgraph on worker errors', async () => {
    const base = graphData(Array.from({ length: CODE_GRAPH_LAYOUT_WORKER_THRESHOLD }, (_, index) =>
      node({ id: `node:${index}`, name: `node${index}`, filePath: 'src/index.ts' })))
    const data: CodeGraphData = {
      ...base,
      edges: Array.from({ length: 1000 }, (_, index) => ({
        source: `node:${index % CODE_GRAPH_LAYOUT_WORKER_THRESHOLD}`,
        target: `node:${(index + 1) % CODE_GRAPH_LAYOUT_WORKER_THRESHOLD}`,
        kind: 'calls',
        confidence: 'extracted',
        provenance: null,
        line: null,
        crossCommunity: false,
      })),
    }
    const controller = new AbortController()
    let cancelledWorkerTerminated = false
    const pendingWorker = fakeLayoutWorker(() => undefined, () => { cancelledWorkerTerminated = true })
    const pending = requestCodeGraphLayout(data, 'files', {
      signal: controller.signal,
      workerFactory: () => pendingWorker,
    })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelledWorkerTerminated).toBe(true)

    const failedWorker = fakeLayoutWorker((_message, instance) => {
      instance.onerror?.(new ErrorEvent('error'))
    })
    const fallback = await requestCodeGraphLayout(data, 'files', {
      workerFactory: () => failedWorker,
    })
    const boundedNodeIds = new Set(
      data.nodes.slice(0, CODE_GRAPH_FALLBACK_MAX_NODES).map(item => item.id),
    )
    const renderedEdgeCount = data.edges
      .slice(0, CODE_GRAPH_FALLBACK_MAX_EDGES)
      .filter(edge => boundedNodeIds.has(edge.source) && boundedNodeIds.has(edge.target))
      .length
    expect(fallback.nodes.length).toBeLessThanOrEqual(CODE_GRAPH_FALLBACK_MAX_NODES)
    expect(fallback.renderEdges).toHaveLength(renderedEdgeCount)
    expect(fallback.renderEdges!.length).toBeLessThanOrEqual(CODE_GRAPH_FALLBACK_MAX_EDGES)
    expect(fallback.renderEdges!.every((edge) =>
      boundedNodeIds.has(edge.source) && boundedNodeIds.has(edge.target),
    )).toBe(true)
    expect(fallback.fallback).toEqual({
      reason: 'worker-error',
      sourceNodeCount: data.nodes.length,
      sourceEdgeCount: data.edges.length,
      processedNodeCount: CODE_GRAPH_FALLBACK_MAX_NODES,
      processedEdgeCount: renderedEdgeCount,
    })
  })

  it('bounds worker creation, postMessage, and timeout fallbacks', async () => {
    const data = graphData(Array.from({ length: CODE_GRAPH_LAYOUT_WORKER_THRESHOLD * 3 }, (_, index) =>
      node({ id: `node:${index}`, name: `node${index}`, filePath: 'src/index.ts' })))
    const unavailable = await requestCodeGraphLayout(data, 'architecture', {
      workerFactory: () => { throw new Error('unavailable') },
    })
    expect(unavailable.fallback?.reason).toBe('worker-unavailable')
    expect(unavailable.fallback?.processedNodeCount).toBe(CODE_GRAPH_FALLBACK_MAX_NODES)

    const postFailed = await requestCodeGraphLayout(data, 'architecture', {
      workerFactory: () => fakeLayoutWorker(() => { throw new Error('clone failed') }),
    })
    expect(postFailed.fallback?.reason).toBe('worker-post-failed')
    expect(postFailed.nodes).toHaveLength(CODE_GRAPH_FALLBACK_MAX_NODES)

    let terminated = false
    const timedOut = await requestCodeGraphLayout(data, 'architecture', {
      workerFactory: () => fakeLayoutWorker(() => undefined, () => { terminated = true }),
      timeoutMs: 2,
    })
    expect(terminated).toBe(true)
    expect(timedOut.fallback?.reason).toBe('worker-timeout')
    expect(timedOut.nodes).toHaveLength(CODE_GRAPH_FALLBACK_MAX_NODES)
  })
})

function fakeLayoutWorker(
  respond: (message: { id: number }, worker: LayoutWorkerLike) => void,
  terminate = () => undefined,
): LayoutWorkerLike {
  const worker: LayoutWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      respond(message, worker)
    },
    terminate,
  }
  return worker
}
