import { describe, expect, it } from 'vitest'

import type { RouteGraphEdge, RouteProfile, RoutingSource } from '../types/routing'
import {
  ROUTE_GRAPH_TEMPLATE_IDS,
  autoLayoutRouteGraph,
  buildRouteGraphTemplate,
  createEmptyRouteGraph,
  createRouteGraphEdge,
  createRouteGraphNode,
  dedupeRouteGraphEdges,
  hasRouteGraphConnection,
  legacyRouteToGraph,
  normalizeDistributionOutputHandles,
  pruneUnconnectedAgentOutputPorts,
  replaceRouteGraphNode,
  routeGraphToLegacyFields,
  validateRouteGraph,
} from './routeGraph'

const source: RoutingSource = {
  id: 'provider-1',
  providerId: 'provider-1',
  presetId: 'custom',
  name: 'Acme AI',
  configured: true,
  routable: true,
  cost: 'paid',
  auth: 'api-key',
  risk: 'stable',
  models: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-c' }],
}

function legacyProfile(overrides: Partial<RouteProfile> = {}): RouteProfile {
  return {
    id: 'route-1',
    name: 'Route 1',
    enabled: true,
    strategy: 'priority',
    strictFree: false,
    allowExperimental: false,
    maxAttempts: 2,
    targets: [
      { providerId: 'provider-1', modelId: 'model-b', priority: 0 },
      { providerId: 'provider-1', modelId: 'model-a', priority: 1 },
    ],
    ...overrides,
  }
}

describe('route graph templates', () => {
  it('builds every product template with one start and one output', () => {
    for (const templateId of ROUTE_GRAPH_TEMPLATE_IDS) {
      const graph = buildRouteGraphTemplate(templateId, [source])
      expect(graph.nodes.filter((node) => node.data.kind === 'start')).toHaveLength(1)
      expect(graph.nodes.filter((node) => node.data.kind === 'output')).toHaveLength(1)
      expect(graph.nodes.some((node) => node.data.kind === 'model')).toBe(true)
      expect(validateRouteGraph(graph, [source]).valid).toBe(true)
    }
  })

  it('builds an editable V3 agent difficulty template with stable named ports', () => {
    const graph = buildRouteGraphTemplate('agent-difficulty', [source])
    const agent = graph.nodes.find((node) => node.data.kind === 'agent')!

    expect(graph.version).toBe(3)
    expect(agent.data.config.inputPorts?.map((port) => port.id)).toEqual(['input'])
    expect(agent.data.config.fallbackOutputPortId).toBe('standard')
    expect(agent.data.config.outputPorts?.map((port) => port.id)).toEqual([
      'simple',
      'standard',
      'complex',
    ])
    expect(graph.edges.filter((entry) => entry.source === agent.id).map((entry) => (
      entry.data.sourcePortId
    ))).toEqual(['simple', 'standard', 'complex'])
    expect(graph.edges.find((entry) => entry.target === agent.id)).toMatchObject({
      targetHandle: 'input:input',
      data: expect.objectContaining({ targetPortId: 'input' }),
    })
    expect(agent.data.config.instructions).toBeTruthy()
    expect(graph.nodes.filter((node) => node.data.kind === 'model').map((node) => (
      node.data.config.modelId
    ))).toEqual(['model-a', 'model-b', 'model-c'])
    expect(validateRouteGraph(graph, [source]).valid).toBe(true)
  })

  it('creates a generic agent with one input, two outputs and no fixed difficulty branches', () => {
    const agent = createRouteGraphNode('agent', { x: 10, y: 20 }, [])

    expect(agent.data.config).toMatchObject({
      inputPorts: [{ id: 'input', label: 'Input 1' }],
      outputPorts: [
        { id: 'output-1', label: 'Output 1' },
        { id: 'output-2', label: 'Output 2' },
      ],
      instructions: '',
      fallbackOutputPortId: 'output-1',
    })
    expect(agent.data.config).not.toHaveProperty('branches')
  })

  it('leaves missing agent template models unconfigured instead of duplicating one model', () => {
    const oneModelSource = { ...source, models: [{ id: 'model-a' }] }
    const graph = buildRouteGraphTemplate('agent-difficulty', [oneModelSource])
    const models = graph.nodes.filter((node) => node.data.kind === 'model')

    expect(models.map((node) => node.data.config.modelId)).toEqual([
      'model-a',
      undefined,
      undefined,
    ])
    expect(validateRouteGraph(graph, [oneModelSource]).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'modelIncomplete', severity: 'error' }),
    ]))
  })

  it('uses failure edges for fallback and success edges for terminal output', () => {
    const graph = buildRouteGraphTemplate('stable-fallback', [source])

    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'model-primary',
        target: 'model-fallback',
        data: { kind: 'failure' },
      }),
      expect.objectContaining({
        source: 'model-primary',
        target: 'output',
        data: { kind: 'success' },
      }),
    ]))
  })

  it('does not fake a fallback by duplicating the only available model', () => {
    const graph = buildRouteGraphTemplate('stable-fallback', [{
      ...source,
      models: [{ id: 'model-a' }],
    }])

    expect(graph.nodes.filter((node) => node.data.kind === 'model')).toHaveLength(1)
    expect(validateRouteGraph(graph, [{ ...source, models: [{ id: 'model-a' }] }]).valid).toBe(true)
  })

  it('forces parallel branches through a result node', () => {
    const graph = buildRouteGraphTemplate('fastest-success', [source])
    const result = graph.nodes.find((node) => node.data.kind === 'result')!

    expect(result.data.config.resultMode).toBe('first-success')
    expect(graph.edges.filter((edge) => edge.target === result.id)).toHaveLength(2)
    expect(validateRouteGraph(graph, [source])).toEqual({ valid: true, issues: [] })
  })
})

describe('route graph migration and validation', () => {
  it('recognizes and removes only exact duplicate connections', () => {
    const edges: RouteGraphEdge[] = [
      {
        id: 'model-success-output',
        source: 'model',
        target: 'output',
        sourceHandle: 'success',
        targetHandle: 'input',
        type: 'smoothstep',
        data: { kind: 'success' },
      },
      {
        id: 'model-success-output-2',
        source: 'model',
        target: 'output',
        sourceHandle: 'success',
        targetHandle: 'input',
        type: 'smoothstep',
        data: { kind: 'success' },
      },
      {
        id: 'model-failure-output',
        source: 'model',
        target: 'output',
        sourceHandle: 'failure',
        targetHandle: 'input',
        type: 'smoothstep',
        data: { kind: 'failure' },
      },
    ]

    expect(hasRouteGraphConnection(edges, 'model', 'output', 'success')).toBe(true)
    expect(hasRouteGraphConnection(edges, 'model', 'output', 'result')).toBe(false)
    expect(dedupeRouteGraphEdges(edges).map((entry) => entry.id)).toEqual([
      'model-success-output',
      'model-failure-output',
    ])
  })

  it('normalizes duplicate connections from a saved draft before editing', () => {
    const draftGraph = buildRouteGraphTemplate('stable-fallback', [source])
    draftGraph.edges.push({ ...draftGraph.edges[0]!, id: `${draftGraph.edges[0]!.id}-2` })

    const normalized = legacyRouteToGraph(legacyProfile({ draftGraph }), [source])

    expect(normalized.edges).toHaveLength(draftGraph.edges.length - 1)
  })

  it('keeps stable port ids on rename and prunes edges when a port is deleted', () => {
    const graph = buildRouteGraphTemplate('agent-difficulty', [source])
    const agent = graph.nodes.find((node) => node.data.kind === 'agent')!
    const renamedAgent = {
      ...agent,
      data: {
        ...agent.data,
        config: {
          ...agent.data.config,
          outputPorts: agent.data.config.outputPorts?.map((port) => (
            port.id === 'simple' ? { ...port, label: 'Quick lane' } : port
          )),
        },
      },
    }
    const renamedGraph = replaceRouteGraphNode(graph, renamedAgent)

    expect(renamedGraph.edges.find((edge) => edge.data.sourcePortId === 'simple'))
      .toBeDefined()
    expect(renamedGraph.nodes.find((node) => node.id === agent.id)?.data.config.outputPorts)
      .toContainEqual(expect.objectContaining({ id: 'simple', label: 'Quick lane' }))

    const withoutFallback = {
      ...renamedAgent,
      data: {
        ...renamedAgent.data,
        config: {
          ...renamedAgent.data.config,
          outputPorts: renamedAgent.data.config.outputPorts?.filter((port) => (
            port.id !== 'standard'
          )),
        },
      },
    }
    const prunedGraph = replaceRouteGraphNode(renamedGraph, withoutFallback)
    const updatedAgent = prunedGraph.nodes.find((node) => node.id === agent.id)!

    expect(prunedGraph.edges.some((edge) => edge.data.sourcePortId === 'standard')).toBe(false)
    expect(updatedAgent.data.config.fallbackOutputPortId).toBe('simple')
  })

  it('reports empty rules, duplicate names, unknown ports and disconnected ports', () => {
    const graph = buildRouteGraphTemplate('agent-difficulty', [source])
    const agent = graph.nodes.find((node) => node.data.kind === 'agent')!
    agent.data.config.instructions = '   '
    agent.data.config.outputPorts = agent.data.config.outputPorts?.map((port) => ({
      ...port,
      label: 'Same output',
    }))
    const simpleEdge = graph.edges.find((edge) => edge.data.sourcePortId === 'simple')!
    simpleEdge.sourceHandle = 'output:missing'
    simpleEdge.data.sourcePortId = 'missing'
    graph.edges = graph.edges.filter((edge) => edge.data.sourcePortId !== 'complex')

    expect(validateRouteGraph(graph, [source]).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'agentInstructions', nodeId: agent.id }),
      expect.objectContaining({ code: 'agentPortNames', nodeId: agent.id }),
      expect.objectContaining({ code: 'agentUnknownPort', nodeId: agent.id }),
      expect.objectContaining({ code: 'agentPortConnection', nodeId: agent.id }),
    ]))
  })

  it('blocks an agent output that cannot reach a generation model', () => {
    const graph = buildRouteGraphTemplate('agent-difficulty', [source])
    const agent = graph.nodes.find((node) => node.data.kind === 'agent')!
    const simpleEdge = graph.edges.find((edge) => edge.data.sourcePortId === 'simple')!
    simpleEdge.target = 'output'

    expect(validateRouteGraph(graph, [source]).issues).toContainEqual(
      expect.objectContaining({ code: 'agentOutputWithoutModel', nodeId: agent.id }),
    )
  })

  it('allows four agents on a path and blocks the fifth', () => {
    const buildAgentChain = (count: number) => {
      const nodes = [createRouteGraphNode('start', { x: 0, y: 0 }, [])]
      for (let index = 0; index < count; index += 1) {
        const agent = createRouteGraphNode(
          'agent',
          { x: 160 + index * 180, y: 0 },
          nodes.map((node) => node.id),
        )
        agent.data.config.instructions = 'Choose the next output.'
        nodes.push(agent)
      }
      const model = createRouteGraphNode(
        'model',
        { x: 160 + count * 180, y: 0 },
        nodes.map((node) => node.id),
      )
      model.data.config = { providerId: 'provider-1', modelId: 'model-a' }
      nodes.push(model)
      const output = createRouteGraphNode(
        'output',
        { x: 340 + count * 180, y: 0 },
        nodes.map((node) => node.id),
      )
      nodes.push(output)

      const agents = nodes.filter((node) => node.data.kind === 'agent')
      const edges: RouteGraphEdge[] = []
      edges.push(createRouteGraphEdge(
        nodes[0]!.id,
        agents[0]!.id,
        'flow',
        'input:input',
        edges.map((edge) => edge.id),
      ))
      agents.forEach((agent, index) => {
        const next = agents[index + 1] ?? model
        edges.push(createRouteGraphEdge(
          agent.id,
          next.id,
          'output:output-1',
          next.data.kind === 'agent' ? 'input:input' : 'input',
          edges.map((edge) => edge.id),
        ))
        edges.push(createRouteGraphEdge(
          agent.id,
          model.id,
          'output:output-2',
          'input',
          edges.map((edge) => edge.id),
        ))
      })
      edges.push(createRouteGraphEdge(
        model.id,
        output.id,
        'success',
        'input',
        edges.map((edge) => edge.id),
      ))
      return { version: 3 as const, nodes, edges }
    }

    expect(validateRouteGraph(buildAgentChain(4), [source]).issues).not.toContainEqual(
      expect.objectContaining({ code: 'agentPathLimit' }),
    )
    expect(validateRouteGraph(buildAgentChain(5), [source]).issues).toContainEqual(
      expect.objectContaining({ code: 'agentPathLimit' }),
    )
  })

  it('migrates an ordered legacy route without changing model order', () => {
    const graph = legacyRouteToGraph(legacyProfile(), [source])
    const models = graph.nodes.filter((node) => node.data.kind === 'model')

    expect(models.map((node) => node.data.config.modelId)).toEqual(['model-b', 'model-a'])
    expect(graph.edges).toContainEqual(expect.objectContaining({
      source: models[0]!.id,
      target: models[1]!.id,
      data: { kind: 'failure' },
    }))
    expect(routeGraphToLegacyFields(graph)).toMatchObject({
      strategy: 'priority',
      maxAttempts: 2,
      targets: [
        { providerId: 'provider-1', modelId: 'model-b', priority: 0 },
        { providerId: 'provider-1', modelId: 'model-a', priority: 1 },
      ],
    })

    graph.nodes.reverse()
    expect(routeGraphToLegacyFields(graph).targets.map((target) => target.modelId))
      .toEqual(['model-b', 'model-a'])
  })

  it('blocks an empty graph from publishing', () => {
    const validation = validateRouteGraph(createEmptyRouteGraph(), [source])

    expect(validation.valid).toBe(false)
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'modelRequired', severity: 'error' }),
      expect.objectContaining({ code: 'noOutputPath', nodeId: 'start' }),
    ]))
  })

  it('detects parallel branches that bypass a result node', () => {
    const graph = buildRouteGraphTemplate('fastest-success', [source])
    graph.nodes = graph.nodes.filter((node) => node.data.kind !== 'result')
    graph.edges = graph.edges
      .filter((edge) => edge.source !== 'result' && edge.target !== 'result')
      .concat([
        {
          id: 'model-a-output',
          source: 'model-a',
          target: 'output',
          sourceHandle: 'result',
          targetHandle: 'input',
          type: 'smoothstep',
          data: { kind: 'result' },
        },
        {
          id: 'model-b-output',
          source: 'model-b',
          target: 'output',
          sourceHandle: 'result',
          targetHandle: 'input',
          type: 'smoothstep',
          data: { kind: 'result' },
        },
      ])

    expect(validateRouteGraph(graph, [source]).issues).toContainEqual(expect.objectContaining({
      code: 'parallelResult',
      nodeId: 'parallel',
    }))
  })

  it('lays a legacy graph into stable left-to-right columns', () => {
    const graph = legacyRouteToGraph(legacyProfile(), [source])
    const laidOut = autoLayoutRouteGraph(graph)
    const start = laidOut.nodes.find((node) => node.data.kind === 'start')!
    const output = laidOut.nodes.find((node) => node.data.kind === 'output')!

    expect(output.position.x).toBeGreaterThan(start.position.x)
    expect(new Set(laidOut.nodes.map((node) => `${node.position.x}:${node.position.y}`)).size)
      .toBe(laidOut.nodes.length)
  })
})

describe('pruneUnconnectedAgentOutputPorts', () => {
  it('drops output ports that lost their last connection, keeping the fallback valid', () => {
    const graph = buildRouteGraphTemplate('agent-difficulty', [source])
    const withoutComplex = {
      ...graph,
      edges: graph.edges.filter((entry) => entry.data.sourcePortId !== 'complex'),
    }

    const pruned = pruneUnconnectedAgentOutputPorts(withoutComplex)
    const agent = pruned.nodes.find((node) => node.data.kind === 'agent')!

    expect(agent.data.config.outputPorts?.map((port) => port.id)).toEqual(['simple', 'standard'])
    expect(agent.data.config.fallbackOutputPortId).toBe('standard')
  })

  it('repoints the fallback when its port is pruned and keeps at least two ports', () => {
    const graph = buildRouteGraphTemplate('agent-difficulty', [source])
    const onlySimpleConnected = {
      ...graph,
      edges: graph.edges.filter((entry) => (
        entry.source !== 'agent-router' || entry.data.sourcePortId === 'simple'
      )),
    }

    const pruned = pruneUnconnectedAgentOutputPorts(onlySimpleConnected)
    const agent = pruned.nodes.find((node) => node.data.kind === 'agent')!
    const portIds = agent.data.config.outputPorts?.map((port) => port.id)

    expect(portIds).toHaveLength(2)
    expect(portIds?.[0]).toBe('simple')
    expect(portIds).toContain(agent.data.config.fallbackOutputPortId)
  })

  it('leaves fully connected agent nodes untouched', () => {
    const graph = buildRouteGraphTemplate('agent-difficulty', [source])
    expect(pruneUnconnectedAgentOutputPorts(graph)).toBe(graph)
  })
})

describe('route graph edge-case regressions', () => {
  it('auto layout terminates on graphs containing a cycle', () => {
    const graph = buildRouteGraphTemplate('stable-fallback', [source])
    const cyclic = {
      ...graph,
      edges: [
        ...graph.edges,
        createRouteGraphEdge('model-fallback', 'model-primary', 'flow', 'input', graph.edges.map((entry) => entry.id)),
      ],
    }

    const laidOut = autoLayoutRouteGraph(cyclic)
    expect(laidOut.nodes).toHaveLength(cyclic.nodes.length)
    expect(validateRouteGraph(cyclic, [source]).issues).toContainEqual(expect.objectContaining({
      code: 'cycle',
    }))
  })

  it('validates deep diamond agent graphs without exponential blowup', () => {
    const graph = buildRouteGraphTemplate('agent-difficulty', [source])
    // Fan the three agent outputs into a shared diamond: simple/standard/complex
    // all reconverge through the same two models, producing many overlapping paths.
    const diamond = {
      ...graph,
      edges: [
        ...graph.edges,
        createRouteGraphEdge('model-simple', 'model-standard', 'failure', 'input', graph.edges.map((entry) => entry.id)),
        createRouteGraphEdge('model-standard', 'model-complex', 'failure', 'input', graph.edges.map((entry) => entry.id)),
      ],
    }

    const started = Date.now()
    validateRouteGraph(diamond, [source])
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('keeps agent ports referenced through branchId edges when pruning', () => {
    const graph = buildRouteGraphTemplate('agent-difficulty', [source])
    const branchIdEdges = graph.edges.map((entry) => (
      entry.source === 'agent-router'
        ? {
            ...entry,
            data: {
              kind: entry.data.kind,
              branchId: entry.data.sourcePortId,
            },
          }
        : entry
    ))

    const pruned = pruneUnconnectedAgentOutputPorts({ ...graph, edges: branchIdEdges })
    const agent = pruned.nodes.find((node) => node.data.kind === 'agent')!
    expect(agent.data.config.outputPorts?.map((port) => port.id))
      .toEqual(['simple', 'standard', 'complex'])
  })

  it('flags agent port ids the server schema would reject', () => {
    const graph = buildRouteGraphTemplate('agent-difficulty', [source])
    const unicodePorts = {
      ...graph,
      nodes: graph.nodes.map((entry) => entry.data.kind === 'agent'
        ? {
            ...entry,
            data: {
              ...entry.data,
              config: {
                ...entry.data.config,
                outputPorts: entry.data.config.outputPorts?.map((port, index) => (
                  index === 0 ? { ...port, id: '简单' } : port
                )),
              },
            },
          }
        : entry),
    }

    expect(validateRouteGraph(unicodePorts, [source]).issues)
      .toContainEqual(expect.objectContaining({ code: 'agentPortIds', nodeId: 'agent-router' }))
  })

  it('flags duplicate edge kinds and third connections on model and condition nodes', () => {
    const graph = buildRouteGraphTemplate('stable-fallback', [source])
    const duplicateSuccess = {
      ...graph,
      edges: [
        ...graph.edges,
        createRouteGraphEdge('model-primary', 'model-fallback', 'success', 'input', graph.edges.map((entry) => entry.id)),
      ],
    }

    expect(validateRouteGraph(duplicateSuccess, [source]).issues)
      .toContainEqual(expect.objectContaining({ code: 'modelEdges', nodeId: 'model-primary' }))
  })
})

describe('normalizeDistributionOutputHandles', () => {
  it('assigns sequential dist pins in edge insertion order and stays idempotent', () => {
    const graph = buildRouteGraphTemplate('quota-balance', [source])

    const normalized = normalizeDistributionOutputHandles(graph)
    const handles = normalized.edges
      .filter((entry) => entry.source === 'distribution')
      .map((entry) => entry.sourceHandle)
    expect(handles).toEqual(['dist:1', 'dist:2'])
    expect(normalizeDistributionOutputHandles(normalized)).toBe(normalized)
  })

  it('recompacts pins after a branch edge is removed', () => {
    const graph = buildRouteGraphTemplate('quota-balance', [source])
    const withThird = {
      ...graph,
      edges: [
        ...graph.edges,
        createRouteGraphEdge('distribution', 'output', 'flow', 'input', graph.edges.map((entry) => entry.id)),
      ],
    }

    const normalized = normalizeDistributionOutputHandles(withThird)
    expect(normalized.edges.filter((entry) => entry.source === 'distribution')
      .map((entry) => entry.sourceHandle)).toEqual(['dist:1', 'dist:2', 'dist:3'])

    const withoutMiddle = {
      ...normalized,
      edges: normalized.edges.filter((entry) => entry.sourceHandle !== 'dist:2'),
    }
    const recompacted = normalizeDistributionOutputHandles(withoutMiddle)
    expect(recompacted.edges.filter((entry) => entry.source === 'distribution')
      .map((entry) => entry.sourceHandle)).toEqual(['dist:1', 'dist:2'])
  })

  it('leaves non-distribution edges untouched', () => {
    const graph = buildRouteGraphTemplate('stable-fallback', [source])
    expect(normalizeDistributionOutputHandles(graph)).toBe(graph)
  })
})
