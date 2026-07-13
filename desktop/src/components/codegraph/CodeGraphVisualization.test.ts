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
    ...overrides,
  }
}

describe('CodeGraph semantic layout', () => {
  it('builds one stable sector per file with the file node at its center', () => {
    const data: CodeGraphData = {
      nodes: [
        node({ id: 'file:a', kind: 'file', name: 'a.ts', filePath: 'src/a.ts', degree: 4 }),
        node({ id: 'function:a', name: 'runA', filePath: 'src/a.ts' }),
        node({ id: 'file:b', kind: 'file', name: 'b.ts', filePath: 'src/b.ts', degree: 3 }),
        node({ id: 'function:b', name: 'runB', filePath: 'src/b.ts' }),
      ],
      edges: [
        { source: 'file:a', target: 'function:a', kind: 'contains' },
        { source: 'file:b', target: 'function:b', kind: 'contains' },
      ],
    }

    const layout = buildSemanticLayout(data)

    expect(layout.clusters).toHaveLength(2)
    expect(layout.nodes).toHaveLength(4)
    for (const cluster of layout.clusters) {
      const hub = layout.nodes.find((candidate) =>
        candidate.clusterKey === cluster.key && candidate.kind === 'file',
      )
      expect(hub).toMatchObject({ x: cluster.x, y: cluster.y })
      expect(cluster.nodeIds).toContain(hub?.id)
    }
  })

  it('uses a deterministic fallback hub when a file node is unavailable', () => {
    const data: CodeGraphData = {
      nodes: [
        node({ id: 'function:low', name: 'low', filePath: 'index.html', degree: 1 }),
        node({ id: 'function:high', name: 'high', filePath: 'index.html', degree: 6 }),
      ],
      edges: [],
    }

    const first = buildSemanticLayout(data)
    const second = buildSemanticLayout(data)
    const cluster = first.clusters[0]!
    const hub = first.nodes.find((candidate) => candidate.id === 'function:high')

    expect(hub).toMatchObject({ x: cluster.x, y: cluster.y })
    expect(second).toEqual(first)
  })
})
