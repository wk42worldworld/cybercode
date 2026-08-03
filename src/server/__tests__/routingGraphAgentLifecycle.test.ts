import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  previewRouteGraph,
  validateRouteGraph,
} from '../routing/graphService.js'
import { RoutingService } from '../routing/routingService.js'
import {
  RouteGraphEdgeSchema,
  RouteGraphNodeSchema,
  RouteGraphSchema,
  type RouteGraph,
  type RouteGraphEdge,
  type RouteGraphNode,
  type RouteProfile,
  type RoutingConfig,
} from '../routing/types.js'
import { ProviderService } from '../services/providerService.js'

const ROUTE_ID = 'agent-lifecycle'
const MODEL_ID = 'lifecycle-model'

function node(
  id: string,
  type: RouteGraphNode['type'],
  config: Record<string, unknown> = {},
  label?: string,
): RouteGraphNode {
  return RouteGraphNodeSchema.parse({
    id,
    type,
    position: { x: 0, y: 0 },
    ...(label && { label }),
    config,
  })
}

function edge(
  id: string,
  source: string,
  target: string,
  options: Partial<Pick<
    RouteGraphEdge,
    'kind' | 'order' | 'branchId' | 'sourcePortId' | 'targetPortId'
  >> = {},
): RouteGraphEdge {
  return RouteGraphEdgeSchema.parse({
    id,
    source,
    target,
    kind: options.kind ?? 'flow',
    ...options,
  })
}

function graph(
  version: 1 | 2 | 3,
  nodes: RouteGraphNode[],
  edges: RouteGraphEdge[],
): RouteGraph {
  return RouteGraphSchema.parse({ version, source: 'user', nodes, edges })
}

function emptyV3Graph(): RouteGraph {
  return graph(3, [], [])
}

function routeProfile(providerId: string, draftGraph: RouteGraph): RouteProfile {
  return {
    id: ROUTE_ID,
    name: 'Agent lifecycle',
    enabled: true,
    strategy: 'priority',
    strictFree: false,
    allowExperimental: false,
    maxAttempts: 8,
    targets: [{ providerId, modelId: MODEL_ID }],
    draftGraph,
  }
}

function v3AgentConfig(
  providerId: string,
  inputPorts = [
    { id: 'primary-input', label: 'Primary', description: 'Primary task input' },
    { id: 'retry-input', label: 'Retry', description: 'Retry task input' },
  ],
  outputPorts = [
    { id: 'fast-output', label: 'Fast', description: 'Prefer speed' },
    { id: 'balanced-output', label: 'Balanced', description: 'Balance speed and quality' },
    { id: 'deep-output', label: 'Deep', description: 'Prefer quality' },
  ],
) {
  return {
    providerId,
    modelId: MODEL_ID,
    inputPorts,
    outputPorts,
    instructions: 'Choose the most suitable output for the task.',
    fallbackOutputPortId: 'balanced-output',
    confidenceThreshold: 0.6,
    timeoutMs: 8_000,
    maxInputChars: 4_000,
  }
}

function completeV3Graph(providerId: string, revision: string): RouteGraph {
  return graph(
    3,
    [
      node('start', 'start'),
      node('input-router', 'distribution'),
      node('agent', 'agent', v3AgentConfig(providerId), `Agent ${revision}`),
      node('fast', 'model', { providerId, modelId: MODEL_ID }, `Fast ${revision}`),
      node('balanced', 'model', { providerId, modelId: MODEL_ID }, `Balanced ${revision}`),
      node('deep', 'model', { providerId, modelId: MODEL_ID }, `Deep ${revision}`),
      node('output', 'output'),
    ],
    [
      edge('start-router', 'start', 'input-router'),
      edge('router-primary', 'input-router', 'agent', {
        order: 0,
        targetPortId: 'primary-input',
      }),
      edge('router-retry', 'input-router', 'agent', {
        order: 1,
        targetPortId: 'retry-input',
      }),
      edge('agent-fast', 'agent', 'fast', {
        kind: 'choice',
        sourcePortId: 'fast-output',
      }),
      edge('agent-balanced', 'agent', 'balanced', {
        kind: 'choice',
        sourcePortId: 'balanced-output',
      }),
      edge('agent-deep', 'agent', 'deep', {
        kind: 'choice',
        sourcePortId: 'deep-output',
      }),
      edge('fast-output', 'fast', 'output'),
      edge('balanced-output', 'balanced', 'output'),
      edge('deep-output', 'deep', 'output'),
    ],
  )
}

function directV1Graph(providerId: string): RouteGraph {
  return graph(
    1,
    [
      node('start', 'start'),
      node('model', 'model', { providerId, modelId: MODEL_ID }),
      node('output', 'output'),
    ],
    [
      edge('start-model', 'start', 'model'),
      edge('model-output', 'model', 'output'),
    ],
  )
}

function agentV2Graph(providerId: string): RouteGraph {
  return graph(
    2,
    [
      node('start', 'start'),
      node('agent', 'agent', {
        providerId,
        modelId: MODEL_ID,
        branches: [
          { id: 'fast', label: 'Fast', description: 'Use the fast branch' },
          { id: 'deep', label: 'Deep', description: 'Use the deep branch' },
        ],
        fallbackBranchId: 'fast',
        confidenceThreshold: 0.6,
        timeoutMs: 8_000,
        maxInputChars: 4_000,
      }),
      node('fast', 'model', { providerId, modelId: MODEL_ID }),
      node('deep', 'model', { providerId, modelId: MODEL_ID }),
      node('output', 'output'),
    ],
    [
      edge('start-agent', 'start', 'agent'),
      edge('agent-fast', 'agent', 'fast', {
        kind: 'choice',
        branchId: 'fast',
      }),
      edge('agent-deep', 'agent', 'deep', {
        kind: 'choice',
        branchId: 'deep',
      }),
      edge('fast-output', 'fast', 'output'),
      edge('deep-output', 'deep', 'output'),
    ],
  )
}

function chainedAgentGraph(
  providerId: string,
  agentCount: number,
  finalModelAttempts: number,
): RouteGraph {
  const agents = Array.from({ length: agentCount }, (_, index) => {
    const config = v3AgentConfig(
      providerId,
      [{ id: 'task-input', label: 'Task', description: 'Task input' }],
      [
        { id: 'continue-output', label: 'Continue', description: 'Ask another agent' },
        { id: 'finish-output', label: 'Finish', description: 'Use the final model' },
      ],
    )
    config.fallbackOutputPortId = 'finish-output'
    return node(`agent-${index + 1}`, 'agent', config)
  })
  return graph(
    3,
    [
      node('start', 'start'),
      ...agents,
      node('model', 'model', {
        providerId,
        modelId: MODEL_ID,
        maxAttempts: finalModelAttempts,
      }),
      node('output', 'output'),
    ],
    [
      edge('start-agent', 'start', 'agent-1', { targetPortId: 'task-input' }),
      ...agents.flatMap((agent, index) => {
        const nextAgent = agents[index + 1]
        return [
          edge(`${agent.id}-continue`, agent.id, nextAgent?.id ?? 'model', {
            kind: 'choice',
            sourcePortId: 'continue-output',
            ...(nextAgent && { targetPortId: 'task-input' }),
          }),
          edge(`${agent.id}-finish`, agent.id, 'model', {
            kind: 'choice',
            sourcePortId: 'finish-output',
          }),
        ]
      }),
      edge('model-output', 'model', 'output'),
    ],
  )
}

function modelFreeAgentGraph(providerId: string): RouteGraph {
  const config = v3AgentConfig(
    providerId,
    [{ id: 'task-input', label: 'Task', description: 'Task input' }],
    [
      { id: 'pass-output', label: 'Pass', description: 'Pass through' },
      { id: 'stop-output', label: 'Stop', description: 'Stop here' },
    ],
  )
  config.fallbackOutputPortId = 'pass-output'
  return graph(
    3,
    [
      node('start', 'start'),
      node('agent', 'agent', config),
      node('output', 'output'),
    ],
    [
      edge('start-agent', 'start', 'agent', { targetPortId: 'task-input' }),
      edge('agent-pass', 'agent', 'output', {
        kind: 'choice',
        sourcePortId: 'pass-output',
      }),
      edge('agent-stop', 'agent', 'output', {
        kind: 'choice',
        sourcePortId: 'stop-output',
      }),
    ],
  )
}

describe('route graph agent lifecycle', () => {
  let tempDir: string
  let originalConfigDir: string | undefined
  let service: RoutingService
  let providerId: string

  beforeEach(async () => {
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cybercode-agent-lifecycle-'))
    process.env.CLAUDE_CONFIG_DIR = tempDir
    service = new RoutingService()
    const provider = await new ProviderService().addProvider({
      presetId: 'custom',
      name: 'Lifecycle provider',
      apiKey: 'lifecycle-key',
      baseUrl: 'http://127.0.0.1:9',
      apiFormat: 'openai_chat',
      models: { main: MODEL_ID, haiku: MODEL_ID, sonnet: MODEL_ID, opus: MODEL_ID },
    })
    providerId = provider.id
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  async function saveConfig(profiles: RouteProfile[]): Promise<RoutingConfig> {
    return service.updateConfig({ version: 2, enabled: true, profiles })
  }

  async function saveDraft(draftGraph: RouteGraph): Promise<RoutingConfig> {
    const current = await service.getConfig()
    return service.updateConfig({
      ...current,
      profiles: current.profiles.map((profile) => (
        profile.id === ROUTE_ID ? { ...profile, draftGraph } : profile
      )),
    })
  }

  test('keeps blank and disconnected drafts across restart, then publishes after wiring is complete', async () => {
    const blank = emptyV3Graph()
    await saveConfig([routeProfile(providerId, blank)])

    service = new RoutingService()
    let reloaded = await service.getConfig()
    expect(reloaded.profiles[0]?.graph).toBeUndefined()
    expect(reloaded.profiles[0]?.draftGraph).toEqual(blank)
    await expect(service.publishDraftGraph(ROUTE_ID)).rejects.toThrow('start node')
    expect((await service.getConfig()).profiles[0]?.graph).toBeUndefined()

    const complete = completeV3Graph(providerId, 'one')
    const disconnected = graph(3, complete.nodes, [])
    await saveDraft(disconnected)
    service = new RoutingService()
    reloaded = await service.getConfig()
    expect(reloaded.profiles[0]?.draftGraph?.edges).toHaveLength(0)
    await expect(service.publishDraftGraph(ROUTE_ID)).rejects.toThrow('connected')
    expect((await service.getConfig()).profiles[0]?.graph).toBeUndefined()

    await saveDraft(complete)
    const published = await service.publishDraftGraph(ROUTE_ID)
    expect(published.validation.valid).toBe(true)
    expect(published.profile.graph).toEqual(complete)
    expect(published.profile.draftGraph).toEqual(complete)
    expect(typeof published.profile.publishedAt).toBe('string')

    service = new RoutingService()
    reloaded = await service.getConfig()
    expect(reloaded.profiles[0]?.graph).toEqual(complete)
    expect(reloaded.profiles[0]?.draftGraph).toEqual(complete)
  })

  test('persists publication history and supports restart-safe rollback in both directions', async () => {
    const first = completeV3Graph(providerId, 'one')
    const second = completeV3Graph(providerId, 'two')
    await saveConfig([routeProfile(providerId, first)])
    await service.publishDraftGraph(ROUTE_ID)
    await saveDraft(second)
    await service.publishDraftGraph(ROUTE_ID)

    service = new RoutingService()
    let config = await service.getConfig()
    expect(config.profiles[0]?.graph?.nodes.find((entry) => entry.id === 'agent')?.label)
      .toBe('Agent two')
    expect(config.profiles[0]?.previousGraph?.nodes.find((entry) => entry.id === 'agent')?.label)
      .toBe('Agent one')

    const rolledBack = await service.rollbackGraph(ROUTE_ID)
    expect(rolledBack.profile.graph?.nodes.find((entry) => entry.id === 'agent')?.label)
      .toBe('Agent one')
    expect(rolledBack.profile.draftGraph).toEqual(rolledBack.profile.graph)
    expect(rolledBack.profile.previousGraph?.nodes.find((entry) => entry.id === 'agent')?.label)
      .toBe('Agent two')

    service = new RoutingService()
    await service.rollbackGraph(ROUTE_ID)
    config = await service.getConfig()
    expect(config.profiles[0]?.graph?.nodes.find((entry) => entry.id === 'agent')?.label)
      .toBe('Agent two')
  })

  test('keeps V1 and V2 graphs publishable, reloadable, and rollback compatible', async () => {
    const v1 = directV1Graph(providerId)
    const v2 = agentV2Graph(providerId)
    expect(validateRouteGraph(v1).valid).toBe(true)
    expect(validateRouteGraph(v2).valid).toBe(true)

    await saveConfig([routeProfile(providerId, v1)])
    await service.publishDraftGraph(ROUTE_ID)
    await saveDraft(v2)
    await service.publishDraftGraph(ROUTE_ID)

    service = new RoutingService()
    let profile = (await service.getConfig()).profiles[0]!
    expect(profile.graph?.version).toBe(2)
    expect(profile.previousGraph?.version).toBe(1)
    await service.rollbackGraph(ROUTE_ID)
    profile = (await service.getConfig()).profiles[0]!
    expect(profile.graph?.version).toBe(1)
    expect(profile.previousGraph?.version).toBe(2)
  })

  test('saves stale port edges as a draft but blocks them from replacing the published graph', async () => {
    const publishedGraph = completeV3Graph(providerId, 'published')
    await saveConfig([routeProfile(providerId, publishedGraph)])
    await service.publishDraftGraph(ROUTE_ID)

    const stale = structuredClone(publishedGraph)
    const agent = stale.nodes.find((entry) => entry.id === 'agent')
    if (!agent || agent.type !== 'agent' || !('inputPorts' in agent.config)) {
      throw new Error('Expected a V3 agent')
    }
    agent.config.inputPorts = agent.config.inputPorts.filter((port) => port.id !== 'retry-input')
    agent.config.outputPorts = agent.config.outputPorts.filter((port) => port.id !== 'deep-output')
    expect(RouteGraphSchema.safeParse(stale).success).toBe(true)
    const validation = validateRouteGraph(stale)
    expect(validation.valid).toBe(false)
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'agent.input_unknown',
      edgeId: 'router-retry',
    }))
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'agent.output_unknown',
      edgeId: 'agent-deep',
    }))

    await saveDraft(stale)
    service = new RoutingService()
    expect((await service.getConfig()).profiles[0]?.draftGraph).toEqual(stale)
    await expect(service.publishDraftGraph(ROUTE_ID)).rejects.toThrow('declared')
    const afterFailure = (await service.getConfig()).profiles[0]!
    expect(afterFailure.graph).toEqual(publishedGraph)
    expect(afterFailure.previousGraph).toBeUndefined()
  })

  test('enforces agent-path and call limits while static preview remains model-call free', async () => {
    const exactlyFourAgentsAndEightCalls = chainedAgentGraph(providerId, 4, 4)
    expect(validateRouteGraph(exactlyFourAgentsAndEightCalls).valid).toBe(true)

    const fiveAgents = validateRouteGraph(chainedAgentGraph(providerId, 5, 1))
    expect(fiveAgents.valid).toBe(false)
    expect(fiveAgents.issues).toContainEqual(expect.objectContaining({
      code: 'agent.path_limit',
    }))

    const nineCalls = validateRouteGraph(chainedAgentGraph(providerId, 4, 5))
    expect(nineCalls.valid).toBe(false)
    expect(nineCalls.issues).toContainEqual(expect.objectContaining({
      code: 'graph.attempt_limit',
    }))

    await saveConfig([routeProfile(providerId, exactlyFourAgentsAndEightCalls)])
    const published = await service.publishDraftGraph(ROUTE_ID)
    expect(published.profile.maxAttempts).toBe(8)
    const plan = await service.resolveAttempts(ROUTE_ID, 'lifecycle-plan', {
      messages: [{ role: 'user', content: 'Plan and implement this feature' }],
    })
    expect(plan.graphPlan?.maxModelAttempts).toBe(8)
    expect(Object.keys(plan.graphPlan?.agentTargets ?? {})).toHaveLength(4)

    const originalFetch = globalThis.fetch
    let externalCalls = 0
    globalThis.fetch = (async () => {
      externalCalls += 1
      throw new Error('Static preview must not call a model')
    }) as typeof fetch
    try {
      const trace = await service.previewGraph(ROUTE_ID, exactlyFourAgentsAndEightCalls, {
        task: 'coding',
      })
      expect(trace.valid).toBe(true)
      expect(trace.branches.some((branch) => branch.explanation.includes('Static preview')))
        .toBe(true)
      expect(previewRouteGraph(exactlyFourAgentsAndEightCalls).valid).toBe(true)
      expect(externalCalls).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('rejects V3 agent outputs that can never produce a user response', async () => {
    const unusable = modelFreeAgentGraph(providerId)
    expect(RouteGraphSchema.safeParse(unusable).success).toBe(true)
    const validation = validateRouteGraph(unusable)
    expect(validation.valid).toBe(false)
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'agent.output_without_model',
      edgeId: 'agent-pass',
    }))

    await saveConfig([routeProfile(providerId, unusable)])
    await expect(service.publishDraftGraph(ROUTE_ID)).rejects.toThrow('generation model')
    expect((await service.getConfig()).profiles[0]?.graph).toBeUndefined()
  })
})
