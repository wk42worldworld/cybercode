import { describe, expect, it } from 'vitest'

import type { RouteGraph } from '../types/routing'
import { deserializeRouteGraph, serializeRouteGraph } from './routingWire'

describe('routing wire distribution outputs', () => {
  it('preserves the manually configured output count across saves', () => {
    const graph: RouteGraph = {
      version: 1,
      nodes: [
        {
          id: 'distribution',
          type: 'routeGraphNode',
          position: { x: 120, y: 80 },
          data: {
            kind: 'distribution',
            config: {
              distributionMode: 'round-robin',
              distributionOutputCount: 4,
            },
          },
        },
      ],
      edges: [],
    }

    const serialized = serializeRouteGraph(graph)
    expect(serialized.nodes[0]?.config).toMatchObject({
      mode: 'round-robin',
      outputCount: 4,
    })
    expect(deserializeRouteGraph(serialized).nodes[0]?.data.config).toMatchObject({
      distributionMode: 'round-robin',
      distributionOutputCount: 4,
    })
  })
})
