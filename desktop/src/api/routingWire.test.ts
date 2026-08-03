import { describe, expect, it } from 'vitest'
import type { RouteGraph } from '../types/routing'
import { cloneRouteGraph } from '../utils/routeGraph'
import {
  deserializeRouteGraph,
  deserializeRoutingConfig,
  normalizePreviewTrace,
  serializeRouteGraph,
  serializeRoutingConfig,
  type WireRouteGraph,
  type WireRoutingConfig,
} from './routingWire'

const graph: RouteGraph = {
  version: 1,
  source: 'legacy',
  legacyFingerprint: 'legacy-v1',
  nodes: [
    {
      id: 'start',
      type: 'routeGraphNode',
      position: { x: 0, y: 0 },
      data: { kind: 'start', config: {} },
    },
    {
      id: 'condition',
      type: 'routeGraphNode',
      position: { x: 160, y: 0 },
      data: {
        kind: 'condition',
        config: { condition: 'context', operator: 'gte', value: 100_000 },
      },
    },
    {
      id: 'model',
      type: 'routeGraphNode',
      position: { x: 320, y: 0 },
      data: {
        kind: 'model',
        label: 'Primary',
        config: {
          providerId: 'provider-a',
          modelId: 'model-a',
          weight: 3,
          timeoutMs: 45_000,
          maxAttempts: 2,
          budgetUsd: 0.25,
        },
      },
    },
    {
      id: 'output',
      type: 'routeGraphNode',
      position: { x: 480, y: 0 },
      data: { kind: 'output', config: {} },
    },
  ],
  edges: [
    {
      id: 'start-condition',
      source: 'start',
      target: 'condition',
      sourceHandle: 'flow',
      targetHandle: 'input',
      type: 'smoothstep',
      data: { kind: 'flow' },
    },
    {
      id: 'condition-model',
      source: 'condition',
      target: 'model',
      sourceHandle: 'true',
      targetHandle: 'input',
      type: 'smoothstep',
      data: { kind: 'true' },
    },
    {
      id: 'model-output',
      source: 'model',
      target: 'output',
      sourceHandle: 'success',
      targetHandle: 'input',
      type: 'smoothstep',
      data: { kind: 'success' },
    },
  ],
}

describe('routing wire adapter', () => {
  it('migrates a V2 routing agent to V3 exactly once', () => {
    const agentGraph: WireRouteGraph = {
      version: 2,
      source: 'user',
      nodes: [
        {
          id: 'start',
          type: 'start',
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: 'agent',
          type: 'agent',
          position: { x: 160, y: 0 },
          config: {
            providerId: 'router-provider',
            modelId: 'router-model',
            branches: [
              { id: 'simple', label: 'Simple', description: 'Fast tasks' },
              { id: 'complex', label: 'Complex', description: 'Hard tasks' },
            ],
            fallbackBranchId: 'simple',
            confidenceThreshold: 0.7,
            timeoutMs: 7_000,
            maxInputChars: 3_000,
            prompt: 'Prefer complex for architecture.',
          },
        },
        {
          id: 'output',
          type: 'output',
          position: { x: 320, y: 0 },
          config: {},
        },
      ],
      edges: [
        { id: 'start-agent', source: 'start', target: 'agent', kind: 'flow' },
        {
          id: 'agent-simple-output',
          source: 'agent',
          target: 'output',
          kind: 'choice',
          branchId: 'simple',
        },
      ],
    }

    const migrated = deserializeRouteGraph(agentGraph)
    const wire = serializeRouteGraph(migrated)
    const secondPass = deserializeRouteGraph(wire)

    expect(migrated.version).toBe(3)
    expect(migrated.nodes[1]?.data.config).toMatchObject({
      inputPorts: [{ id: 'input', label: 'Input 1' }],
      outputPorts: [{ id: 'simple' }, { id: 'complex' }],
      instructions: 'Prefer complex for architecture.',
      fallbackOutputPortId: 'simple',
      confidenceThreshold: 0.7,
    })
    expect(migrated.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'start-agent',
        targetHandle: 'input:input',
        data: expect.objectContaining({ targetPortId: 'input' }),
      }),
      expect.objectContaining({
        id: 'agent-simple-output',
        sourceHandle: 'output:simple',
        data: expect.objectContaining({ kind: 'choice', sourcePortId: 'simple' }),
      }),
    ]))
    expect(wire.version).toBe(3)
    expect(wire.nodes[1]?.config).toMatchObject({ fallbackOutputPortId: 'simple' })
    expect(wire.nodes[1]?.config).not.toHaveProperty('branches')
    expect(wire.edges[1]).toMatchObject({ kind: 'choice', sourcePortId: 'simple' })
    expect(serializeRouteGraph(secondPass)).toEqual(wire)
  })

  it('round-trips V3 source and target port ids independently of React Flow handles', () => {
    const agentGraph: RouteGraph = {
      version: 3,
      nodes: [
        {
          id: 'agent-a',
          type: 'routeGraphNode',
          position: { x: 0, y: 0 },
          data: {
            kind: 'agent',
            config: {
              inputPorts: [{ id: 'request', label: 'Request', description: '' }],
              outputPorts: [
                { id: 'ready', label: 'Ready', description: '' },
                { id: 'retry', label: 'Retry', description: '' },
              ],
              instructions: 'Choose an output.',
              fallbackOutputPortId: 'retry',
            },
          },
        },
        {
          id: 'agent-b',
          type: 'routeGraphNode',
          position: { x: 240, y: 0 },
          data: {
            kind: 'agent',
            config: {
              inputPorts: [{ id: 'work', label: 'Work', description: '' }],
              outputPorts: [
                { id: 'done', label: 'Done', description: '' },
                { id: 'blocked', label: 'Blocked', description: '' },
              ],
              instructions: 'Continue the work.',
              fallbackOutputPortId: 'blocked',
            },
          },
        },
      ],
      edges: [{
        id: 'agent-a-ready-agent-b-work',
        source: 'agent-a',
        target: 'agent-b',
        sourceHandle: 'output:ready',
        targetHandle: 'input:work',
        type: 'smoothstep',
        data: { kind: 'choice', sourcePortId: 'ready', targetPortId: 'work' },
      }],
    }

    const wire = serializeRouteGraph(agentGraph)
    const roundTrip = deserializeRouteGraph(wire)

    expect(wire.edges[0]).toMatchObject({ sourcePortId: 'ready', targetPortId: 'work' })
    expect(roundTrip.edges[0]).toMatchObject({
      sourceHandle: 'output:ready',
      targetHandle: 'input:work',
      data: { kind: 'choice', sourcePortId: 'ready', targetPortId: 'work' },
    })
  })

  it('keeps a legacy simple, standard, and complex route usable across repeated saves', () => {
    const legacyGraph: WireRouteGraph = {
      version: 2,
      source: 'user',
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 180 }, config: {} },
        {
          id: 'agent',
          type: 'agent',
          position: { x: 180, y: 180 },
          config: {
            providerId: 'router-provider',
            modelId: 'router-model',
            branches: [
              { id: 'simple', label: 'Simple', description: 'Small tasks' },
              { id: 'standard', label: 'Standard', description: 'Normal tasks' },
              { id: 'complex', label: 'Complex', description: 'Hard tasks' },
            ],
            fallbackBranchId: 'standard',
            prompt: 'Choose the model that matches the task difficulty.',
            confidenceThreshold: 0.65,
            timeoutMs: 8_000,
            maxInputChars: 4_000,
          },
        },
        {
          id: 'model-simple',
          type: 'model',
          position: { x: 440, y: 0 },
          config: { providerId: 'fast', modelId: 'fast-model' },
        },
        {
          id: 'model-standard',
          type: 'model',
          position: { x: 440, y: 180 },
          config: { providerId: 'balanced', modelId: 'balanced-model' },
        },
        {
          id: 'model-complex',
          type: 'model',
          position: { x: 440, y: 360 },
          config: { providerId: 'strong', modelId: 'strong-model' },
        },
        { id: 'output', type: 'output', position: { x: 700, y: 180 }, config: {} },
      ],
      edges: [
        { id: 'start-agent', source: 'start', target: 'agent', kind: 'flow' },
        {
          id: 'agent-simple',
          source: 'agent',
          target: 'model-simple',
          kind: 'choice',
          branchId: 'simple',
        },
        {
          id: 'agent-standard',
          source: 'agent',
          target: 'model-standard',
          kind: 'choice',
          branchId: 'standard',
        },
        {
          id: 'agent-complex',
          source: 'agent',
          target: 'model-complex',
          kind: 'choice',
          branchId: 'complex',
        },
        { id: 'simple-output', source: 'model-simple', target: 'output', kind: 'flow' },
        { id: 'standard-output', source: 'model-standard', target: 'output', kind: 'flow' },
        { id: 'complex-output', source: 'model-complex', target: 'output', kind: 'flow' },
      ],
    }

    const firstSave = serializeRouteGraph(deserializeRouteGraph(legacyGraph))
    const secondSave = serializeRouteGraph(deserializeRouteGraph(firstSave))
    const thirdSave = serializeRouteGraph(deserializeRouteGraph(secondSave))
    const agent = firstSave.nodes.find((node) => node.id === 'agent')

    expect(firstSave.version).toBe(3)
    expect(agent?.config).toMatchObject({
      inputPorts: [{ id: 'input', label: 'Input 1', description: '' }],
      outputPorts: [
        { id: 'simple', label: 'Simple', description: 'Small tasks' },
        { id: 'standard', label: 'Standard', description: 'Normal tasks' },
        { id: 'complex', label: 'Complex', description: 'Hard tasks' },
      ],
      instructions: 'Choose the model that matches the task difficulty.',
      fallbackOutputPortId: 'standard',
    })
    expect(agent?.config).not.toHaveProperty('branches')
    expect(agent?.config).not.toHaveProperty('fallbackBranchId')
    expect(agent?.config).not.toHaveProperty('prompt')
    expect(firstSave.edges.filter((edge) => edge.source === 'agent')).toEqual([
      expect.objectContaining({ id: 'agent-simple', kind: 'choice', sourcePortId: 'simple' }),
      expect.objectContaining({ id: 'agent-standard', kind: 'choice', sourcePortId: 'standard' }),
      expect.objectContaining({ id: 'agent-complex', kind: 'choice', sourcePortId: 'complex' }),
    ])
    expect(firstSave.edges.find((edge) => edge.id === 'start-agent'))
      .toMatchObject({ targetPortId: 'input' })
    expect(secondSave).toEqual(firstSave)
    expect(thirdSave).toEqual(firstSave)
  })

  it('round-trips dynamic ports, instructions, fallback, and agent-to-agent wiring', () => {
    const wireGraph: WireRouteGraph = {
      version: 3,
      source: 'user',
      viewport: { x: 24, y: -16, zoom: 0.9 },
      nodes: [
        {
          id: 'planner',
          type: 'agent',
          position: { x: 0, y: 0 },
          label: 'Planner',
          config: {
            providerId: 'planner-provider',
            modelId: 'planner-model',
            inputPorts: [
              { id: 'feature', label: 'Feature request', description: 'A new feature' },
              { id: 'bugfix', label: 'Bug report', description: 'A reported defect' },
            ],
            outputPorts: [
              { id: 'implement', label: 'Implement', description: 'Ready for coding' },
              { id: 'clarify', label: 'Clarify', description: 'Needs more information' },
            ],
            instructions: 'Read the arriving task and choose the correct next step.',
            fallbackOutputPortId: 'clarify',
            confidenceThreshold: 0.72,
            timeoutMs: 9_500,
            maxInputChars: 6_000,
          },
        },
        {
          id: 'implementer',
          type: 'agent',
          position: { x: 320, y: 0 },
          label: 'Implementer',
          config: {
            providerId: 'coding-provider',
            modelId: 'coding-model',
            inputPorts: [
              { id: 'planned', label: 'Planned work', description: 'Implementation plan' },
              { id: 'urgent', label: 'Urgent work', description: 'Urgent implementation' },
            ],
            outputPorts: [
              { id: 'done', label: 'Done', description: 'Implementation completed' },
              { id: 'blocked', label: 'Blocked', description: 'Cannot continue' },
            ],
            instructions: 'Implement the task, then report whether it completed.',
            fallbackOutputPortId: 'blocked',
            confidenceThreshold: 0.8,
            timeoutMs: 12_000,
            maxInputChars: 8_000,
          },
        },
      ],
      edges: [{
        id: 'planner-implement-implementer-planned',
        source: 'planner',
        target: 'implementer',
        kind: 'choice',
        sourcePortId: 'implement',
        targetPortId: 'planned',
        label: 'Approved plan',
      }],
    }

    const roundTrip = serializeRouteGraph(deserializeRouteGraph(wireGraph))

    expect(roundTrip).toEqual(wireGraph)
  })

  it('keeps stable port ids and wiring when users rename port labels', () => {
    const wireGraph: WireRouteGraph = {
      version: 3,
      nodes: [
        {
          id: 'agent',
          type: 'agent',
          position: { x: 0, y: 0 },
          config: {
            inputPorts: [{ id: 'request', label: 'Request', description: '' }],
            outputPorts: [
              { id: 'fast', label: 'Fast', description: '' },
              { id: 'deep', label: 'Deep', description: '' },
            ],
            instructions: 'Choose a route.',
            fallbackOutputPortId: 'fast',
            confidenceThreshold: 0.6,
            timeoutMs: 8_000,
            maxInputChars: 4_000,
          },
        },
        { id: 'output', type: 'output', position: { x: 300, y: 0 }, config: {} },
      ],
      edges: [{
        id: 'agent-fast-output',
        source: 'agent',
        target: 'output',
        kind: 'choice',
        sourcePortId: 'fast',
      }],
    }
    const editable = deserializeRouteGraph(wireGraph)
    const agent = editable.nodes.find((node) => node.id === 'agent')!
    agent.data.config.inputPorts![0]!.label = 'User request'
    agent.data.config.outputPorts![0]!.label = 'Quick model'

    const saved = serializeRouteGraph(editable)

    expect(saved.nodes[0]?.config).toMatchObject({
      inputPorts: [{ id: 'request', label: 'User request' }],
      outputPorts: [
        { id: 'fast', label: 'Quick model' },
        { id: 'deep', label: 'Deep' },
      ],
      fallbackOutputPortId: 'fast',
    })
    expect(saved.edges[0]).toMatchObject({
      sourcePortId: 'fast',
      source: 'agent',
      target: 'output',
    })
  })

  it('removes dangling edges and repairs fallback after agent ports are deleted', () => {
    const editable: RouteGraph = {
      version: 3,
      nodes: [
        {
          id: 'source-agent',
          type: 'routeGraphNode',
          position: { x: 0, y: 0 },
          data: {
            kind: 'agent',
            config: {
              inputPorts: [{ id: 'input', label: 'Input', description: '' }],
              outputPorts: [
                { id: 'keep', label: 'Keep', description: '' },
                { id: 'other', label: 'Other', description: '' },
              ],
              instructions: 'Choose an output.',
              fallbackOutputPortId: 'deleted-output',
            },
          },
        },
        {
          id: 'target-agent',
          type: 'routeGraphNode',
          position: { x: 300, y: 0 },
          data: {
            kind: 'agent',
            config: {
              inputPorts: [{ id: 'kept-input', label: 'Kept input', description: '' }],
              outputPorts: [
                { id: 'done', label: 'Done', description: '' },
                { id: 'blocked', label: 'Blocked', description: '' },
              ],
              instructions: 'Choose an output.',
              fallbackOutputPortId: 'blocked',
            },
          },
        },
        {
          id: 'output',
          type: 'routeGraphNode',
          position: { x: 600, y: 0 },
          data: { kind: 'output', config: {} },
        },
      ],
      edges: [
        {
          id: 'valid-edge',
          source: 'source-agent',
          target: 'output',
          sourceHandle: 'output:keep',
          targetHandle: 'input',
          type: 'smoothstep',
          data: { kind: 'choice', sourcePortId: 'keep' },
        },
        {
          id: 'deleted-output-edge',
          source: 'source-agent',
          target: 'output',
          sourceHandle: 'output:deleted-output',
          targetHandle: 'input',
          type: 'smoothstep',
          data: { kind: 'choice', sourcePortId: 'deleted-output' },
        },
        {
          id: 'deleted-input-edge',
          source: 'source-agent',
          target: 'target-agent',
          sourceHandle: 'output:other',
          targetHandle: 'input:deleted-input',
          type: 'smoothstep',
          data: {
            kind: 'choice',
            sourcePortId: 'other',
            targetPortId: 'deleted-input',
          },
        },
      ],
    }

    const saved = serializeRouteGraph(editable)
    const sourceAgent = saved.nodes.find((node) => node.id === 'source-agent')

    expect(saved.edges.map((edge) => edge.id)).toEqual(['valid-edge'])
    expect(sourceAgent?.config.fallbackOutputPortId).toBe('keep')
  })

  it('preserves empty agent instructions while a draft is still being edited', () => {
    const wireConfig: WireRoutingConfig = {
      version: 2,
      enabled: true,
      profiles: [{
        id: 'draft-route',
        name: 'Draft route',
        enabled: false,
        strategy: 'priority',
        strictFree: false,
        allowExperimental: false,
        maxAttempts: 2,
        targets: [],
        draftGraph: {
          version: 3,
          source: 'user',
          nodes: [{
            id: 'agent',
            type: 'agent',
            position: { x: 0, y: 0 },
            config: {
              inputPorts: [{ id: 'input', label: 'Input', description: '' }],
              outputPorts: [
                { id: 'route-a', label: 'Route A', description: '' },
                { id: 'route-b', label: 'Route B', description: '' },
              ],
              instructions: '',
              fallbackOutputPortId: 'route-a',
              confidenceThreshold: 0.6,
              timeoutMs: 8_000,
              maxInputChars: 4_000,
            },
          }],
          edges: [],
        },
      }],
    }

    const saved = serializeRoutingConfig(deserializeRoutingConfig(wireConfig))

    expect(saved.profiles[0]?.draftGraph?.nodes[0]?.config.instructions).toBe('')
    expect(saved.profiles[0]?.draftGraph).toEqual(wireConfig.profiles[0]?.draftGraph)
  })

  it('serializes React Flow nodes into the server graph contract', () => {
    const wire = serializeRouteGraph(graph)

    expect(wire).toMatchObject({
      source: 'legacy',
      legacyFingerprint: 'legacy-v1',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        {
          id: 'condition',
          type: 'condition',
          config: {
            field: 'context-tokens',
            operator: 'gte',
            value: 100_000,
          },
        },
        {
          id: 'model',
          type: 'model',
          label: 'Primary',
          config: {
            providerId: 'provider-a',
            modelId: 'model-a',
            timeoutMs: 45_000,
            maxAttempts: 2,
            budgetUsd: 0.25,
          },
        },
        { id: 'output', type: 'output', config: {} },
      ],
    })
    expect(wire.edges[1]).toMatchObject({
      id: 'condition-model',
      kind: 'true',
      source: 'condition',
      target: 'model',
      weight: 3,
    })
    expect(wire.edges[2]).toMatchObject({
      id: 'model-output',
      kind: 'flow',
      source: 'model',
      target: 'output',
    })
  })

  it('round-trips graph semantics and migration metadata', () => {
    const roundTrip = deserializeRouteGraph(serializeRouteGraph(graph))

    expect(roundTrip.source).toBe('legacy')
    expect(roundTrip.legacyFingerprint).toBe('legacy-v1')
    expect(roundTrip.nodes.find((node) => node.id === 'condition')?.data.config)
      .toMatchObject({ condition: 'context', operator: 'gte', value: 100_000 })
    expect(roundTrip.nodes.find((node) => node.id === 'model')?.data.config)
      .toMatchObject({
        providerId: 'provider-a',
        modelId: 'model-a',
        weight: 3,
        maxAttempts: 2,
        budgetUsd: 0.25,
      })
    expect(roundTrip.edges.find((edge) => edge.id === 'model-output'))
      .toMatchObject({ sourceHandle: 'success', data: { kind: 'success' } })
  })

  it('preserves supported and future wire fields through graph clones', () => {
    const wireGraph: WireRouteGraph = {
      version: 1,
      source: 'user',
      legacyFingerprint: 'future-compatible-v1',
      futureGraphPolicy: { mode: 'careful' },
      viewport: { x: 12, y: -8, zoom: 0.85 },
      nodes: [
        {
          id: 'start',
          type: 'start',
          position: { x: 0, y: 0 },
          config: { futureStartOption: 'keep-me' },
          futureNodeOption: 7,
        },
        {
          id: 'modality',
          type: 'condition',
          position: { x: 180, y: 0 },
          config: {
            field: 'modality',
            operator: 'contains',
            value: 'image',
            onUnknown: 'true',
            futureConditionOption: ['image', 'video'],
          },
        },
        {
          id: 'task',
          type: 'condition',
          position: { x: 360, y: 0 },
          config: {
            field: 'task',
            operator: 'equals',
            value: 'coding',
            onUnknown: 'false',
          },
        },
        {
          id: 'relay',
          type: 'relay',
          position: { x: 540, y: 0 },
          config: {
            mode: 'summary',
            summaryMaxChars: 23_456,
            futureRelayOption: true,
          },
        },
        {
          id: 'result',
          type: 'result',
          position: { x: 720, y: 0 },
          config: {
            mode: 'judge',
            judgeProviderId: 'judge-provider',
            judgeModelId: 'judge-model',
            judgePrompt: 'Prefer the most complete answer.',
            futureJudgeOption: { retries: 2 },
          },
        },
        {
          id: 'output',
          type: 'output',
          position: { x: 900, y: 0 },
          config: {},
        },
      ],
      edges: [
        {
          id: 'start-modality',
          source: 'start',
          target: 'modality',
          kind: 'flow',
          order: 9,
          label: 'Inspect input',
          futureEdgeOption: { color: 'cyan' },
        },
        {
          id: 'modality-task',
          source: 'modality',
          target: 'task',
          kind: 'true',
          order: 3,
          label: 'Has image',
        },
        {
          id: 'task-relay',
          source: 'task',
          target: 'relay',
          kind: 'true',
          order: 4,
        },
        {
          id: 'relay-result',
          source: 'relay',
          target: 'result',
          kind: 'flow',
          order: 1,
        },
        {
          id: 'result-output',
          source: 'result',
          target: 'output',
          kind: 'result',
          order: 8,
          label: 'Judged result',
        },
      ],
    }

    const cloned = cloneRouteGraph(deserializeRouteGraph(wireGraph))

    expect(serializeRouteGraph(cloned)).toEqual(wireGraph)
  })

  it('does not rewrite graphs when an unrelated routing switch is saved', () => {
    const wireGraph: WireRouteGraph = {
      version: 1,
      source: 'user',
      nodes: [
        {
          id: 'condition',
          type: 'condition',
          position: { x: 10, y: 20 },
          config: {
            field: 'modality',
            operator: 'contains',
            value: 'image',
            onUnknown: 'true',
            futureOption: 'preserved',
          },
        },
      ],
      edges: [{
        id: 'future-edge',
        source: 'condition',
        target: 'condition',
        kind: 'false',
        order: 42,
        label: 'Fallback',
        futurePriority: 'late',
      }],
      futureGraphVersion: 2,
    }
    const wireConfig: WireRoutingConfig = {
      version: 2,
      enabled: true,
      profiles: [{
        id: 'preserved-route',
        name: 'Preserved route',
        enabled: true,
        strategy: 'priority',
        strictFree: false,
        allowExperimental: false,
        maxAttempts: 2,
        targets: [],
        graph: wireGraph,
      }],
    }
    const config = deserializeRoutingConfig(wireConfig)

    const saved = serializeRoutingConfig({ ...config, enabled: false })

    expect(saved.enabled).toBe(false)
    expect(saved.profiles[0]?.graph).toEqual(wireGraph)
  })

  it('serializes the UI modality "is image" condition with array containment', () => {
    const modalityGraph: RouteGraph = {
      version: 1,
      nodes: [{
        id: 'modality',
        type: 'routeGraphNode',
        position: { x: 0, y: 0 },
        data: {
          kind: 'condition',
          config: { condition: 'modality', operator: 'is', value: 'image' },
        },
      }],
      edges: [],
    }
    const taskGraph: RouteGraph = {
      ...modalityGraph,
      nodes: [{
        ...modalityGraph.nodes[0]!,
        data: {
          kind: 'condition',
          config: { condition: 'task', operator: 'is', value: 'coding' },
        },
      }],
    }

    expect(serializeRouteGraph(modalityGraph).nodes[0]?.config.operator).toBe('contains')
    expect(serializeRouteGraph(taskGraph).nodes[0]?.config.operator).toBe('equals')
  })

  it('normalizes backend preview traces for path highlighting', () => {
    const preview = normalizePreviewTrace({
      valid: true,
      validation: {
        valid: true,
        issues: [{ code: 'distribution.quota_observed', severity: 'warning', message: 'fallback' }],
      },
      path: ['start', 'model', 'output'],
      steps: [
        { order: 0, nodeId: 'start', nodeType: 'start', status: 'visited', detail: 'start' },
        {
          order: 1,
          nodeId: 'model',
          nodeType: 'model',
          status: 'selected',
          detail: 'selected',
          edgeId: 'start-model',
        },
      ],
      branches: [],
      estimatedModelAttempts: 1,
      warnings: [],
    })

    expect(preview.path).toEqual(['start', 'model', 'output'])
    expect(preview.edgePath).toEqual(['start-model'])
    expect(preview.validation.issues[0]).toMatchObject({
      messageKey: 'settings.routing.graph.validation.distribution.quota_observed',
    })
  })
})
