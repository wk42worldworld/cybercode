import { describe, expect, test } from 'bun:test'

import { validateRouteGraph } from '../routing/graphService.js'

function distributionGraph(outputCount?: number) {
  return {
    version: 1,
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: {} },
      {
        id: 'distribution',
        type: 'distribution',
        position: { x: 100, y: 0 },
        config: { mode: 'round-robin', ...(outputCount ? { outputCount } : {}) },
      },
      {
        id: 'model-a',
        type: 'model',
        position: { x: 200, y: 0 },
        config: { providerId: 'provider', modelId: 'model-a' },
      },
      {
        id: 'model-b',
        type: 'model',
        position: { x: 200, y: 100 },
        config: { providerId: 'provider', modelId: 'model-b' },
      },
      { id: 'output', type: 'output', position: { x: 300, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'start-distribution', source: 'start', target: 'distribution', kind: 'flow' },
      { id: 'distribution-a', source: 'distribution', target: 'model-a', kind: 'flow' },
      { id: 'distribution-b', source: 'distribution', target: 'model-b', kind: 'flow' },
      { id: 'model-a-output', source: 'model-a', target: 'output', kind: 'flow' },
      { id: 'model-b-output', source: 'model-b', target: 'output', kind: 'flow' },
    ],
  }
}

describe('distribution output counts', () => {
  test('requires every manually added output to be connected', () => {
    const validation = validateRouteGraph(distributionGraph(3))

    expect(validation.valid).toBe(false)
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'distribution.branches',
      nodeId: 'distribution',
    }))
  })

  test('accepts a configured count matching the connected branches', () => {
    expect(validateRouteGraph(distributionGraph(2)).valid).toBe(true)
  })

  test('keeps legacy graphs without an output count compatible', () => {
    const graph = distributionGraph()
    graph.nodes = graph.nodes.filter((node) => node.id !== 'model-b')
    graph.edges = graph.edges.filter((edge) => (
      edge.id !== 'distribution-b' && edge.id !== 'model-b-output'
    ))

    expect(validateRouteGraph(graph).valid).toBe(true)
  })
})
