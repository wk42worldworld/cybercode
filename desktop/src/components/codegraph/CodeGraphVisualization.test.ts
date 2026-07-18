import { describe, expect, it } from 'vitest'
import type { CodeGraphData, CodeGraphNode } from '../../api/tokenOptimization'
import { buildSemanticLayout } from './CodeGraphVisualization'

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
})
