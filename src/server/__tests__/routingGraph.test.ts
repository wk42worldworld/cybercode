import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleRoutingApi } from '../api/routing.js'
import { handleProxyRequest } from '../proxy/handler.js'
import { clearRouteAgentDecisionCacheForTests } from '../proxy/routeGraphExecutor.js'
import {
  previewRouteGraph,
  validateRouteGraph,
} from '../routing/graphService.js'
import { routingService } from '../routing/routingService.js'
import {
  RouteGraphSchema,
  type RouteGraph,
  type RouteGraphEdge,
  type RouteGraphNode,
} from '../routing/types.js'
import { ProviderService } from '../services/providerService.js'

const PROFILE = {
  id: 'blueprint',
  name: 'Blueprint',
  enabled: true,
  strategy: 'priority' as const,
  strictFree: false,
  allowExperimental: false,
  maxAttempts: 8,
  targets: [],
}

function node(
  id: string,
  type: RouteGraphNode['type'],
  config: Record<string, unknown> = {},
): RouteGraphNode {
  return RouteGraphSchema.shape.nodes.element.parse({
    id,
    type,
    position: { x: 0, y: 0 },
    config,
  })
}

function edge(
  id: string,
  source: string,
  target: string,
  kind: RouteGraphEdge['kind'] = 'flow',
  order?: number,
  branchId?: string,
): RouteGraphEdge {
  return {
    id,
    source,
    target,
    kind,
    ...(order !== undefined && { order }),
    ...(branchId && { branchId }),
  }
}

function portEdge(
  id: string,
  source: string,
  target: string,
  options: {
    kind?: RouteGraphEdge['kind']
    order?: number
    sourcePortId?: string
    targetPortId?: string
  } = {},
): RouteGraphEdge {
  return {
    id,
    source,
    target,
    kind: options.kind ?? 'flow',
    ...(options.order !== undefined && { order: options.order }),
    ...(options.sourcePortId && { sourcePortId: options.sourcePortId }),
    ...(options.targetPortId && { targetPortId: options.targetPortId }),
  }
}

function graph(nodes: RouteGraphNode[], edges: RouteGraphEdge[]): RouteGraph {
  return RouteGraphSchema.parse({
    version: nodes.some((entry) => entry.type === 'agent') ? 2 : 1,
    source: 'user',
    nodes,
    edges,
  })
}

function agentConfig(providerId?: string, modelId?: string) {
  return {
    ...(providerId && { providerId }),
    ...(modelId && { modelId }),
    branches: [
      { id: 'simple', label: 'Simple', description: 'Small and direct task' },
      { id: 'standard', label: 'Standard', description: 'Normal implementation task' },
      { id: 'complex', label: 'Complex', description: 'Architecture or difficult task' },
    ],
    fallbackBranchId: 'standard',
    confidenceThreshold: 0.6,
    timeoutMs: 8_000,
    maxInputChars: 400,
  }
}

function portAgentConfig(
  providerId?: string,
  modelId?: string,
  inputPorts = [
    { id: 'task-input', label: 'Task', description: 'A new task to route' },
  ],
) {
  return {
    ...(providerId && { providerId }),
    ...(modelId && { modelId }),
    inputPorts,
    outputPorts: [
      { id: 'fast-output', label: 'Fast', description: 'Use the faster model' },
      { id: 'quality-output', label: 'Quality', description: 'Use the stronger model' },
    ],
    instructions: 'Choose an output according to the task and the input port.',
    fallbackOutputPortId: 'quality-output',
    confidenceThreshold: 0.6,
    timeoutMs: 8_000,
    maxInputChars: 400,
  }
}

function portGraph(nodes: RouteGraphNode[], edges: RouteGraphEdge[]): RouteGraph {
  return RouteGraphSchema.parse({
    version: 3,
    source: 'user',
    nodes,
    edges,
  })
}

function directGraph(providerId: string, modelId: string, label = 'Published model'): RouteGraph {
  return graph(
    [
      node('start', 'start'),
      { ...node('model', 'model', { providerId, modelId }), label },
      node('output', 'output'),
    ],
    [edge('start-model', 'start', 'model'), edge('model-output', 'model', 'output')],
  )
}

function openAIResponse(model: string, content: string): Response {
  return Response.json({
    id: `chatcmpl-${model}`,
    object: 'chat.completion',
    created: 1,
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
  })
}

describe('agent routing blueprint', () => {
  let tempDir: string
  let originalConfigDir: string | undefined
  let upstream: ReturnType<typeof Bun.serve> | null

  beforeEach(async () => {
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cybercode-route-graph-'))
    process.env.CLAUDE_CONFIG_DIR = tempDir
    routingService.resetHealth()
    clearRouteAgentDecisionCacheForTests()
    await routingService.updateConfig({ version: 1, enabled: true, profiles: [PROFILE] })
    upstream = null
  })

  afterEach(async () => {
    upstream?.stop(true)
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    routingService.resetHealth()
    clearRouteAgentDecisionCacheForTests()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  test('migrates a legacy profile to an equivalent published graph without dropping legacy fields', async () => {
    const config = await routingService.getConfig()
    const profile = config.profiles[0]!

    expect(profile.graph?.source).toBe('legacy')
    expect(profile.draftGraph).toEqual(profile.graph)
    expect(profile.strategy).toBe('priority')
    expect(profile.targets).toEqual([])
    expect(profile.graph?.nodes.map((entry) => entry.type)).toEqual([
      'start',
      'distribution',
      'model',
      'output',
    ])

    const previousFingerprint = profile.graph?.legacyFingerprint
    const updated = await routingService.updateConfig({
      ...config,
      profiles: [{ ...profile, targets: [{ providerId: 'new-provider', modelId: 'new-model' }] }],
    })
    expect(updated.profiles[0]?.graph?.source).toBe('legacy')
    expect(updated.profiles[0]?.graph?.legacyFingerprint).not.toBe(previousFingerprint)
    expect(updated.profiles[0]?.graph?.nodes.some((entry) => (
      entry.type === 'model' && entry.config.providerId === 'new-provider'
    ))).toBe(true)
  })

  test('keeps a draft-only route unpublished across save and reload', async () => {
    const draft = directGraph('draft-provider', 'draft-model', 'Unpublished draft')
    const saved = await routingService.updateConfig({
      version: 2,
      enabled: true,
      profiles: [{
        ...PROFILE,
        graph: undefined,
        draftGraph: draft,
      }],
    })

    expect(saved.profiles[0]?.graph).toBeUndefined()
    expect(saved.profiles[0]?.draftGraph).toEqual(draft)
    const reloaded = await routingService.getConfig()
    expect(reloaded.profiles[0]?.graph).toBeUndefined()
    expect(reloaded.profiles[0]?.draftGraph?.nodes.find((entry) => entry.id === 'model')?.label)
      .toBe('Unpublished draft')
    const dashboard = await routingService.getDashboard()
    expect(dashboard.routeAvailability[PROFILE.id]).toMatchObject({
      available: false,
      reason: 'unpublished',
    })
    await expect(routingService.getRuntimeEnv(PROFILE.id, 'unpublished-runtime'))
      .rejects.toThrow('Route has not been published')
    await expect(routingService.resolveAttempts(PROFILE.id, 'unpublished-request', {
      messages: [{ role: 'user', content: 'draft must not run' }],
    })).rejects.toThrow('Route has not been published')
  })

  test('reports cycles, disconnected nodes, and branch decisions with stable references', () => {
    const invalid = graph(
      [
        node('start', 'start'),
        node('condition', 'condition', {
          field: 'task',
          operator: 'equals',
          value: 'coding',
        }),
        node('model-a', 'model'),
        node('model-b', 'model'),
        node('detached', 'model'),
        node('output', 'output'),
      ],
      [
        edge('start-condition', 'start', 'condition'),
        edge('condition-true', 'condition', 'model-a', 'true'),
        edge('condition-false', 'condition', 'model-b', 'false'),
        edge('model-a-output', 'model-a', 'output'),
        edge('model-b-output', 'model-b', 'output'),
        edge('detached-output', 'detached', 'output'),
        edge('model-a-cycle', 'model-a', 'condition', 'failure'),
      ],
    )
    const validation = validateRouteGraph(invalid)
    expect(validation.valid).toBe(false)
    expect(validation.issues.some((issue) => issue.code === 'graph.cycle')).toBe(true)
    expect(validation.issues.some((issue) => (
      issue.code === 'node.unreachable' && issue.nodeId === 'detached'
    ))).toBe(true)

    const valid = graph(
      [
        node('start', 'start'),
        node('condition', 'condition', {
          field: 'task',
          operator: 'equals',
          value: 'coding',
        }),
        node('model-a', 'model'),
        node('model-b', 'model'),
        node('output', 'output'),
      ],
      [
        edge('start-condition', 'start', 'condition'),
        edge('condition-true', 'condition', 'model-a', 'true'),
        edge('condition-false', 'condition', 'model-b', 'false'),
        edge('model-a-output', 'model-a', 'output'),
        edge('model-b-output', 'model-b', 'output'),
      ],
    )
    const preview = previewRouteGraph(valid, { task: 'coding' })
    expect(preview.valid).toBe(true)
    expect(preview.path).toEqual(['start', 'condition', 'model-a', 'output'])
    expect(preview.branches[0]?.selectedEdgeIds).toEqual(['condition-true'])
  })

  test('rejects duplicate semantic connections even when their edge ids differ', () => {
    const duplicate = directGraph('provider-a', 'model-a')
    duplicate.edges.push(edge('model-output-2', 'model', 'output'))

    const validation = validateRouteGraph(duplicate)

    expect(validation.valid).toBe(false)
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'edge.connection_duplicate',
      edgeId: 'model-output-2',
    }))
  })

  test('keeps draft edits isolated, publishes atomically, and rolls back one version', async () => {
    const provider = await addProvider('Publisher', 'publish-key', 'publish-model')
    const config = await routingService.getConfig()
    const first = directGraph(provider.id, 'publish-model', 'Version one')
    await routingService.updateConfig({
      ...config,
      profiles: config.profiles.map((profile) => (
        profile.id === PROFILE.id ? { ...profile, draftGraph: first } : profile
      )),
    })

    const beforePublish = await routingService.resolveAttempts(PROFILE.id, 'draft-isolation', {
      messages: [{ role: 'user', content: 'draft must not run' }],
    })
    expect(beforePublish.graphPlan?.graph.source).toBe('legacy')

    await routingService.publishDraftGraph(PROFILE.id)
    const second = directGraph(provider.id, 'publish-model', 'Version two')
    const published = await routingService.getConfig()
    await routingService.updateConfig({
      ...published,
      profiles: published.profiles.map((profile) => (
        profile.id === PROFILE.id ? { ...profile, draftGraph: second } : profile
      )),
    })
    const stillFirst = await routingService.resolveAttempts(PROFILE.id, 'published-only', {
      messages: [{ role: 'user', content: 'published graph only' }],
    })
    expect(stillFirst.graphPlan?.graph.nodes.find((entry) => entry.id === 'model')?.label)
      .toBe('Version one')

    await routingService.publishDraftGraph(PROFILE.id)
    expect((await routingService.getConfig()).profiles[0]?.graph?.nodes
      .find((entry) => entry.id === 'model')?.label).toBe('Version two')
    await routingService.rollbackGraph(PROFILE.id)
    expect((await routingService.getConfig()).profiles[0]?.graph?.nodes
      .find((entry) => entry.id === 'model')?.label).toBe('Version one')
  })

  test('exposes preview, publish, and rollback through the routing API', async () => {
    const provider = await addProvider('API provider', 'api-key', 'api-model')
    const first = directGraph(provider.id, 'api-model', 'API version one')

    const preview = await routingApi('preview', {
      profileId: PROFILE.id,
      graph: first,
      sample: { task: 'coding' },
    })
    expect(preview.status).toBe(200)
    expect((await preview.json() as { trace: { valid: boolean } }).trace.valid).toBe(true)

    const firstPublish = await routingApi('publish', {
      profileId: PROFILE.id,
      graph: first,
      name: 'API route one',
    })
    expect(firstPublish.status).toBe(200)
    const published = await routingService.getConfig()
    expect(published.profiles[0]?.name).toBe('API route one')
    expect(typeof published.profiles[0]?.publishedAt).toBe('string')
    const second = directGraph(provider.id, 'api-model', 'API version two')
    expect((await routingApi('publish', {
      profileId: PROFILE.id,
      graph: second,
      name: 'API route two',
    })).status).toBe(200)
    expect((await routingApi('rollback', { profileId: PROFILE.id })).status).toBe(200)
    expect((await routingService.getConfig()).profiles[0]?.graph?.nodes
      .find((entry) => entry.id === 'model')?.label).toBe('API version one')

    expect((await routingApi('preview', {})).status).toBe(400)
  })

  test('selects a condition branch and rotates an explicit distribution', async () => {
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
        const body = await request.json() as { model: string }
        return openAIResponse(body.model, key)
      },
    })
    const first = await addProvider('First', 'first-key', 'first-model')
    const second = await addProvider('Second', 'second-key', 'second-model')
    const conditional = graph(
      [
        node('start', 'start'),
        node('condition', 'condition', {
          field: 'task',
          operator: 'equals',
          value: 'coding',
        }),
        node('first', 'model', { providerId: first.id, modelId: 'first-model' }),
        node('second', 'model', { providerId: second.id, modelId: 'second-model' }),
        node('output', 'output'),
      ],
      [
        edge('start-condition', 'start', 'condition'),
        edge('coding', 'condition', 'first', 'true'),
        edge('general', 'condition', 'second', 'false'),
        edge('first-output', 'first', 'output'),
        edge('second-output', 'second', 'output'),
      ],
    )
    await setPublishedGraph(conditional)
    const coding = await routeRequest({
      model: 'cybercode-route-blueprint',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'Write a TypeScript function and test it.' }],
    }, 'condition')
    expect(await coding.text()).toContain('first-key')

    const distributed = graph(
      [
        node('start', 'start'),
        node('distribution', 'distribution', { mode: 'round-robin' }),
        node('first', 'model', { providerId: first.id, modelId: 'first-model' }),
        node('second', 'model', { providerId: second.id, modelId: 'second-model' }),
        node('output', 'output'),
      ],
      [
        edge('start-distribution', 'start', 'distribution'),
        edge('distribution-first', 'distribution', 'first', 'flow', 0),
        edge('distribution-second', 'distribution', 'second', 'flow', 1),
        edge('first-output', 'first', 'output'),
        edge('second-output', 'second', 'output'),
      ],
    )
    await setPublishedGraph(distributed)
    routingService.resetHealth()
    const replies = []
    for (const session of ['round-robin-a', 'round-robin-b']) {
      const response = await routeRequest({
        model: 'cybercode-route-blueprint',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }],
      }, session)
      replies.push(await response.text())
    }
    expect(replies[0]).toContain('first-key')
    expect(replies[1]).toContain('second-key')
  })

  test('keeps V1 graphs compatible and previews a V2 agent through its fallback without calling a model', () => {
    const legacy = directGraph('provider-a', 'model-a')
    expect(RouteGraphSchema.parse(legacy).version).toBe(1)

    const routed = graph(
      [
        node('start', 'start'),
        node('agent', 'agent', agentConfig()),
        node('simple', 'model'),
        node('standard', 'model'),
        node('complex', 'model'),
        node('output', 'output'),
      ],
      [
        edge('start-agent', 'start', 'agent'),
        edge('agent-simple', 'agent', 'simple', 'choice', 0, 'simple'),
        edge('agent-standard', 'agent', 'standard', 'choice', 1, 'standard'),
        edge('agent-complex', 'agent', 'complex', 'choice', 2, 'complex'),
        edge('simple-output', 'simple', 'output'),
        edge('standard-output', 'standard', 'output'),
        edge('complex-output', 'complex', 'output'),
      ],
    )
    const preview = previewRouteGraph(routed, { task: 'coding' })

    expect(routed.version).toBe(2)
    expect(preview.valid).toBe(true)
    expect(preview.path).toEqual(['start', 'agent', 'standard', 'output'])
    expect(preview.branches[0]).toMatchObject({
      nodeId: 'agent',
      selectedEdgeIds: ['agent-standard'],
    })
    expect(preview.branches[0]?.explanation).toContain('Static preview')
  })

  test('validates and previews V3 agents with multiple stable input and output ports', () => {
    const routed = portGraph(
      [
        node('start', 'start'),
        node('input-router', 'distribution'),
        node('agent', 'agent', portAgentConfig(undefined, undefined, [
          { id: 'primary-input', label: 'Primary', description: 'Normal task entry' },
          { id: 'retry-input', label: 'Retry', description: 'Task returning from a retry path' },
        ])),
        node('fast', 'model'),
        node('quality', 'model'),
        node('output', 'output'),
      ],
      [
        portEdge('start-router', 'start', 'input-router'),
        portEdge('router-primary', 'input-router', 'agent', {
          order: 0,
          targetPortId: 'primary-input',
        }),
        portEdge('router-retry', 'input-router', 'agent', {
          order: 1,
          targetPortId: 'retry-input',
        }),
        portEdge('agent-fast', 'agent', 'fast', {
          kind: 'choice',
          sourcePortId: 'fast-output',
        }),
        portEdge('agent-quality', 'agent', 'quality', {
          kind: 'choice',
          sourcePortId: 'quality-output',
        }),
        portEdge('fast-output', 'fast', 'output'),
        portEdge('quality-output', 'quality', 'output'),
      ],
    )

    expect(validateRouteGraph(routed).valid).toBe(true)
    const preview = previewRouteGraph(routed, { task: 'coding' })
    expect(preview.valid).toBe(true)
    expect(preview.path).toEqual(['start', 'input-router', 'agent', 'quality', 'output'])
    expect(preview.branches.find((branch) => branch.nodeId === 'agent')).toMatchObject({
      selectedEdgeIds: ['agent-quality'],
    })

    const missingInputPort = structuredClone(routed)
    delete missingInputPort.edges.find((item) => item.id === 'router-retry')!.targetPortId
    const invalid = validateRouteGraph(missingInputPort)
    expect(invalid.valid).toBe(false)
    expect(invalid.issues.some((issue) => issue.code === 'agent.input_connection')).toBe(true)
    expect(invalid.issues.some((issue) => issue.code === 'agent.input_port_required')).toBe(true)
  })

  test('allows blank V3 agent instructions in drafts but rejects publishing them', () => {
    const draft = portGraph(
      [
        node('start', 'start'),
        node('agent', 'agent', {
          ...portAgentConfig(),
          instructions: '',
        }),
        node('fast', 'model'),
        node('quality', 'model'),
        node('output', 'output'),
      ],
      [
        portEdge('start-agent', 'start', 'agent', { targetPortId: 'task-input' }),
        portEdge('agent-fast', 'agent', 'fast', {
          kind: 'choice',
          sourcePortId: 'fast-output',
        }),
        portEdge('agent-quality', 'agent', 'quality', {
          kind: 'choice',
          sourcePortId: 'quality-output',
        }),
        portEdge('fast-output', 'fast', 'output'),
        portEdge('quality-output', 'quality', 'output'),
      ],
    )

    expect(RouteGraphSchema.safeParse(draft).success).toBe(true)
    const validation = validateRouteGraph(draft)
    expect(validation.valid).toBe(false)
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'agent.instructions_required',
      nodeId: 'agent',
    }))
  })

  test('allows four chained V3 agents but rejects a fifth agent on the same path', () => {
    const chainedAgents = (count: number, finalModelAttempts = 1): RouteGraph => {
      const agents = Array.from({ length: count }, (_, index) => (
        node(`agent-${index + 1}`, 'agent', portAgentConfig())
      ))
      return portGraph(
        [
          node('start', 'start'),
          ...agents,
          node('model', 'model', { maxAttempts: finalModelAttempts }),
          node('output', 'output'),
        ],
        [
          portEdge('start-agent', 'start', 'agent-1', { targetPortId: 'task-input' }),
          ...agents.flatMap((agent, index) => {
            const nextAgent = agents[index + 1]
            return [
              portEdge(`${agent.id}-fast`, agent.id, nextAgent?.id ?? 'model', {
                kind: 'choice',
                sourcePortId: 'fast-output',
                ...(nextAgent && { targetPortId: 'task-input' }),
              }),
              portEdge(`${agent.id}-quality`, agent.id, 'model', {
                kind: 'choice',
                sourcePortId: 'quality-output',
              }),
            ]
          }),
          portEdge('model-output', 'model', 'output'),
        ],
      )
    }

    expect(validateRouteGraph(chainedAgents(4)).valid).toBe(true)
    const tooDeep = validateRouteGraph(chainedAgents(5))
    expect(tooDeep.valid).toBe(false)
    expect(tooDeep.issues).toContainEqual(expect.objectContaining({ code: 'agent.path_limit' }))
    const tooManyCalls = validateRouteGraph(chainedAgents(4, 5))
    expect(tooManyCalls.valid).toBe(false)
    expect(tooManyCalls.issues).toContainEqual(expect.objectContaining({
      code: 'graph.attempt_limit',
    }))
  })

  test('executes chained V3 agents and forwards the selected input port metadata', async () => {
    const decisionPrompts: string[] = []
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
        const body = await request.json() as Record<string, unknown>
        if (key === 'chain-router') {
          const prompt = JSON.stringify(body)
          decisionPrompts.push(prompt)
          return openAIResponse('router-model', JSON.stringify({
            outputPortId: prompt.includes('FIRST_AGENT') ? 'fast-output' : 'quality-output',
            confidence: 1,
          }))
        }
        return openAIResponse(String(body.model), `selected:${key}`)
      },
    })
    const router = await addProvider('Chain router', 'chain-router', 'router-model')
    const fast = await addProvider('Chain fast', 'chain-fast', 'fast-model')
    const quality = await addProvider('Chain quality', 'chain-quality', 'quality-model')
    await setPublishedGraph(portGraph(
      [
        node('start', 'start'),
        node('planner', 'agent', {
          ...portAgentConfig(router.id, 'router-model'),
          instructions: 'FIRST_AGENT: decide whether the task needs another specialist.',
        }),
        node('implementer', 'agent', {
          ...portAgentConfig(router.id, 'router-model', [
            { id: 'from-planner', label: 'Plan', description: 'Selected by the planning agent' },
          ]),
          instructions: 'SECOND_AGENT: choose the implementation model.',
        }),
        node('fast', 'model', { providerId: fast.id, modelId: 'fast-model' }),
        node('quality', 'model', { providerId: quality.id, modelId: 'quality-model' }),
        node('output', 'output'),
      ],
      [
        portEdge('start-planner', 'start', 'planner', { targetPortId: 'task-input' }),
        portEdge('planner-specialist', 'planner', 'implementer', {
          kind: 'choice',
          sourcePortId: 'fast-output',
          targetPortId: 'from-planner',
        }),
        portEdge('planner-direct', 'planner', 'fast', {
          kind: 'choice',
          sourcePortId: 'quality-output',
        }),
        portEdge('implementer-fast', 'implementer', 'fast', {
          kind: 'choice',
          sourcePortId: 'fast-output',
        }),
        portEdge('implementer-quality', 'implementer', 'quality', {
          kind: 'choice',
          sourcePortId: 'quality-output',
        }),
        portEdge('fast-output', 'fast', 'output'),
        portEdge('quality-output', 'quality', 'output'),
      ],
    ))

    const response = await routeRequest({
      model: 'cybercode-route-blueprint',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'implement this planned feature' }],
    }, 'agent-chain-session')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('selected:chain-quality')
    expect(decisionPrompts).toHaveLength(2)
    expect(decisionPrompts[1]).toContain('from-planner')
  })

  test('keys V3 agent decisions by the actual input port', async () => {
    let decisionCalls = 0
    const generationKeys: string[] = []
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
        const body = await request.json() as Record<string, unknown>
        if (key === 'port-router') {
          decisionCalls += 1
          const outputPortId = JSON.stringify(body).includes('primary-input')
            ? 'fast-output'
            : 'quality-output'
          return openAIResponse('router-model', JSON.stringify({
            outputPortId,
            confidence: 0.95,
          }))
        }
        generationKeys.push(key)
        return openAIResponse(String(body.model), `selected:${key}`)
      },
    })
    const router = await addProvider('Port router', 'port-router', 'router-model')
    const fast = await addProvider('Fast model', 'fast-key', 'fast-model')
    const quality = await addProvider('Quality model', 'quality-key', 'quality-model')
    await setPublishedGraph(portGraph(
      [
        node('start', 'start'),
        node('input-router', 'distribution'),
        node('agent', 'agent', portAgentConfig(router.id, 'router-model', [
          { id: 'primary-input', label: 'Primary', description: 'Normal task entry' },
          { id: 'retry-input', label: 'Retry', description: 'Retry task entry' },
        ])),
        node('fast', 'model', { providerId: fast.id, modelId: 'fast-model' }),
        node('quality', 'model', { providerId: quality.id, modelId: 'quality-model' }),
        node('output', 'output'),
      ],
      [
        portEdge('start-router', 'start', 'input-router'),
        portEdge('router-primary', 'input-router', 'agent', {
          order: 0,
          targetPortId: 'primary-input',
        }),
        portEdge('router-retry', 'input-router', 'agent', {
          order: 1,
          targetPortId: 'retry-input',
        }),
        portEdge('agent-fast', 'agent', 'fast', {
          kind: 'choice',
          sourcePortId: 'fast-output',
        }),
        portEdge('agent-quality', 'agent', 'quality', {
          kind: 'choice',
          sourcePortId: 'quality-output',
        }),
        portEdge('fast-output', 'fast', 'output'),
        portEdge('quality-output', 'quality', 'output'),
      ],
    ))
    const requestBody = {
      model: 'cybercode-route-blueprint',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'same task and same turn fingerprint' }],
    }

    for (const expected of ['fast-key', 'quality-key', 'fast-key']) {
      const response = await routeRequest(requestBody, 'same-port-session')
      expect(response.status).toBe(200)
      expect(await response.text()).toContain(`selected:${expected}`)
    }
    expect(decisionCalls).toBe(2)
    expect(generationKeys).toEqual(['fast-key', 'quality-key', 'fast-key'])
  })

  test('falls back from an invalid V3 output and caches the usable fallback', async () => {
    let decisionCalls = 0
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
        if (key === 'invalid-port-router') {
          decisionCalls += 1
          return openAIResponse('router-model', JSON.stringify({
            outputPortId: 'missing-output',
            confidence: 1,
          }))
        }
        const body = await request.json() as { model: string }
        return openAIResponse(body.model, `selected:${key}`)
      },
    })
    const router = await addProvider('Invalid port router', 'invalid-port-router', 'router-model')
    const fast = await addProvider('Fallback fast', 'fallback-fast', 'fast-model')
    const quality = await addProvider('Fallback quality', 'fallback-quality', 'quality-model')
    await setPublishedGraph(portGraph(
      [
        node('start', 'start'),
        node('agent', 'agent', portAgentConfig(router.id, 'router-model')),
        node('fast', 'model', { providerId: fast.id, modelId: 'fast-model' }),
        node('quality', 'model', { providerId: quality.id, modelId: 'quality-model' }),
        node('output', 'output'),
      ],
      [
        portEdge('start-agent', 'start', 'agent', { targetPortId: 'task-input' }),
        portEdge('agent-fast', 'agent', 'fast', {
          kind: 'choice',
          sourcePortId: 'fast-output',
        }),
        portEdge('agent-quality', 'agent', 'quality', {
          kind: 'choice',
          sourcePortId: 'quality-output',
        }),
        portEdge('fast-output', 'fast', 'output'),
        portEdge('quality-output', 'quality', 'output'),
      ],
    ))
    const requestBody = {
      model: 'cybercode-route-blueprint',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'use a safe fallback' }],
    }

    for (const _attempt of [1, 2]) {
      const response = await routeRequest(requestBody, 'invalid-output-session')
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('selected:fallback-quality')
    }
    expect(decisionCalls).toBe(1)

    await new ProviderService().deleteProvider(quality.id)
    const withoutConfiguredFallback = await routeRequest(
      requestBody,
      'invalid-output-session',
    )
    expect(withoutConfiguredFallback.status).toBe(200)
    expect(await withoutConfiguredFallback.text()).toContain('selected:fallback-fast')
    expect(decisionCalls).toBe(1)
  })

  test('never falls back or caches when a V3 agent decision is cancelled', async () => {
    let decisionCalls = 0
    let generationCalls = 0
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
        if (key === 'cancel-port-router') {
          decisionCalls += 1
          if (decisionCalls === 1) await Bun.sleep(250)
          return openAIResponse('router-model', JSON.stringify({
            outputPortId: 'fast-output',
            confidence: 1,
          }))
        }
        generationCalls += 1
        return openAIResponse('generation', `selected:${key}`)
      },
    })
    const router = await addProvider('Cancel port router', 'cancel-port-router', 'router-model')
    const fast = await addProvider('Cancel fast', 'cancel-fast', 'fast-model')
    const quality = await addProvider('Cancel quality', 'cancel-quality', 'quality-model')
    await setPublishedGraph(portGraph(
      [
        node('start', 'start'),
        node('agent', 'agent', portAgentConfig(router.id, 'router-model')),
        node('fast', 'model', { providerId: fast.id, modelId: 'fast-model' }),
        node('quality', 'model', { providerId: quality.id, modelId: 'quality-model' }),
        node('output', 'output'),
      ],
      [
        portEdge('start-agent', 'start', 'agent', { targetPortId: 'task-input' }),
        portEdge('agent-fast', 'agent', 'fast', {
          kind: 'choice',
          sourcePortId: 'fast-output',
        }),
        portEdge('agent-quality', 'agent', 'quality', {
          kind: 'choice',
          sourcePortId: 'quality-output',
        }),
        portEdge('fast-output', 'fast', 'output'),
        portEdge('quality-output', 'quality', 'output'),
      ],
    ))
    const requestBody = {
      model: 'cybercode-route-blueprint',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'cancel this exact turn' }],
    }
    const controller = new AbortController()
    const pending = routeRequest(requestBody, 'cancel-port-session', controller.signal)
    await Bun.sleep(30)
    controller.abort()
    expect((await pending).status).toBe(499)
    expect(generationCalls).toBe(0)

    const retry = await routeRequest(requestBody, 'cancel-port-session')
    expect(retry.status).toBe(200)
    expect(await retry.text()).toContain('selected:cancel-fast')
    expect(decisionCalls).toBe(2)
    expect(generationCalls).toBe(1)
  })

  test('routes simple, standard, and complex tasks with one constrained cached agent decision', async () => {
    const decisionRequests: Array<Record<string, unknown>> = []
    const generationKeys: string[] = []
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
        const body = await request.json() as Record<string, unknown>
        if (key === 'router-key') {
          decisionRequests.push(body)
          const raw = JSON.stringify(body)
          const branch = raw.includes('very-hard')
            ? 'complex'
            : raw.includes('ordinary') ? 'standard' : 'simple'
          return openAIResponse('router-model', JSON.stringify({
            branch,
            confidence: 0.94,
            reason: 'matched task difficulty',
          }))
        }
        generationKeys.push(key)
        return openAIResponse(String(body.model), `selected:${key}`)
      },
    })
    const router = await addProvider('Router', 'router-key', 'router-model')
    const simple = await addProvider('Simple', 'simple-key', 'simple-model')
    const standard = await addProvider('Standard', 'standard-key', 'standard-model')
    const complex = await addProvider('Complex', 'complex-key', 'complex-model')
    await setPublishedGraph(graph(
      [
        node('start', 'start'),
        node('agent', 'agent', agentConfig(router.id, 'router-model')),
        node('simple', 'model', { providerId: simple.id, modelId: 'simple-model' }),
        node('standard', 'model', { providerId: standard.id, modelId: 'standard-model' }),
        node('complex', 'model', { providerId: complex.id, modelId: 'complex-model' }),
        node('output', 'output'),
      ],
      [
        edge('start-agent', 'start', 'agent'),
        edge('agent-simple', 'agent', 'simple', 'choice', 0, 'simple'),
        edge('agent-standard', 'agent', 'standard', 'choice', 1, 'standard'),
        edge('agent-complex', 'agent', 'complex', 'choice', 2, 'complex'),
        edge('simple-output', 'simple', 'output'),
        edge('standard-output', 'standard', 'output'),
        edge('complex-output', 'complex', 'output'),
      ],
    ))

    for (const [session, task, expected] of [
      ['agent-simple', 'tiny change', 'simple-key'],
      ['agent-standard', 'ordinary feature', 'standard-key'],
      ['agent-complex', 'very-hard architecture', 'complex-key'],
    ] as const) {
      const requestBody = {
        model: 'cybercode-route-blueprint',
        system: 'ORIGINAL-SYSTEM-MUST-NOT-BE-FORWARDED',
        tools: [{ name: 'danger', description: 'must be removed', input_schema: {} }],
        max_tokens: 64,
        messages: [
          { role: 'user', content: 'old context '.repeat(200) },
          { role: 'assistant', content: 'old answer' },
          { role: 'user', content: task },
        ],
      }
      const first = await routeRequest(requestBody, session)
      const second = await routeRequest(requestBody, session)
      expect(await first.text()).toContain(`selected:${expected}`)
      expect(await second.text()).toContain(`selected:${expected}`)
    }

    expect(decisionRequests).toHaveLength(3)
    for (const request of decisionRequests) {
      expect(request.max_tokens).toBe(96)
      expect(request.stream).toBe(false)
      expect(request.temperature).toBe(0)
      expect(request).not.toHaveProperty('tools')
      expect(JSON.stringify(request)).not.toContain('ORIGINAL-SYSTEM-MUST-NOT-BE-FORWARDED')
      expect(JSON.stringify(request)).not.toContain('old context')
    }
    expect(generationKeys).toEqual([
      'simple-key', 'simple-key',
      'standard-key', 'standard-key',
      'complex-key', 'complex-key',
    ])
    const dashboard = await routingService.getDashboard()
    expect(dashboard.events.filter((event) => event.phase === 'agent-decision')).toHaveLength(3)
    expect(dashboard.events.filter((event) => event.phase === 'agent-decision').every((event) => (
      event.inputTokens === 10 && event.outputTokens === 4
    ))).toBe(true)
    const pins = (routingService as unknown as {
      pins: Map<string, { candidateKey: string }>
    }).pins
    expect([...pins.values()].every((pin) => !pin.candidateKey.startsWith(`${router.id}:`))).toBe(true)
  })

  test('falls back silently on malformed output, 429 responses, and low confidence', async () => {
    let decisionCalls = 0
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
        if (key === 'fallback-router') {
          decisionCalls += 1
          if (decisionCalls === 1) return openAIResponse('router', 'not-json')
          if (decisionCalls === 2) {
            return Response.json({ error: { message: 'rate limited' } }, { status: 429 })
          }
          return openAIResponse('router', JSON.stringify({
            branch: 'complex',
            confidence: 0.2,
          }))
        }
        const body = await request.json() as { model: string }
        return openAIResponse(body.model, key)
      },
    })
    const router = await addProvider('Fallback router', 'fallback-router', 'router-model')
    const simple = await addProvider('Fallback simple', 'fallback-simple', 'simple-model')
    const standard = await addProvider('Fallback standard', 'fallback-standard', 'standard-model')
    const complex = await addProvider('Fallback complex', 'fallback-complex', 'complex-model')
    await setPublishedGraph(graph(
      [
        node('start', 'start'),
        node('agent', 'agent', agentConfig(router.id, 'router-model')),
        node('simple', 'model', { providerId: simple.id, modelId: 'simple-model' }),
        node('standard', 'model', { providerId: standard.id, modelId: 'standard-model' }),
        node('complex', 'model', { providerId: complex.id, modelId: 'complex-model' }),
        node('output', 'output'),
      ],
      [
        edge('start-agent', 'start', 'agent'),
        edge('agent-simple', 'agent', 'simple', 'choice', 0, 'simple'),
        edge('agent-standard', 'agent', 'standard', 'choice', 1, 'standard'),
        edge('agent-complex', 'agent', 'complex', 'choice', 2, 'complex'),
        edge('simple-output', 'simple', 'output'),
        edge('standard-output', 'standard', 'output'),
        edge('complex-output', 'complex', 'output'),
      ],
    ))

    for (const session of [
      'malformed-decision',
      'rate-limited-decision',
      'low-confidence-decision',
    ]) {
      const requestBody = {
        model: 'cybercode-route-blueprint',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'route me' }],
      }
      const response = await routeRequest(requestBody, session)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('fallback-standard')
      const repeated = await routeRequest(requestBody, session)
      expect(repeated.status).toBe(200)
      expect(await repeated.text()).toContain('fallback-standard')
    }
    expect(decisionCalls).toBe(3)

    await new ProviderService().deleteProvider(standard.id)
    const missingFallbackBody = {
      model: 'cybercode-route-blueprint',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'route without the default provider' }],
    }
    const missingFallback = await routeRequest(missingFallbackBody, 'missing-fallback-provider')
    expect(missingFallback.status).toBe(200)
    expect(await missingFallback.text()).toContain('fallback-simple')
    const repeatedMissingFallback = await routeRequest(
      missingFallbackBody,
      'missing-fallback-provider',
    )
    expect(repeatedMissingFallback.status).toBe(200)
    expect(await repeatedMissingFallback.text()).toContain('fallback-simple')
    expect(decisionCalls).toBe(4)
  })

  test('does not enter the fallback branch when the user cancels an agent decision', async () => {
    let generationCalls = 0
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
        if (key === 'cancel-router') {
          await Bun.sleep(250)
          return openAIResponse('router-model', '{"branch":"simple","confidence":1}')
        }
        generationCalls += 1
        return openAIResponse('generation', 'must not run')
      },
    })
    const router = await addProvider('Cancel router', 'cancel-router', 'router-model')
    const simple = await addProvider('Cancel simple', 'cancel-simple', 'simple-model')
    const standard = await addProvider('Cancel standard', 'cancel-standard', 'standard-model')
    const complex = await addProvider('Cancel complex', 'cancel-complex', 'complex-model')
    await setPublishedGraph(graph(
      [
        node('start', 'start'),
        node('agent', 'agent', agentConfig(router.id, 'router-model')),
        node('simple', 'model', { providerId: simple.id, modelId: 'simple-model' }),
        node('standard', 'model', { providerId: standard.id, modelId: 'standard-model' }),
        node('complex', 'model', { providerId: complex.id, modelId: 'complex-model' }),
        node('output', 'output'),
      ],
      [
        edge('start-agent', 'start', 'agent'),
        edge('agent-simple', 'agent', 'simple', 'choice', 0, 'simple'),
        edge('agent-standard', 'agent', 'standard', 'choice', 1, 'standard'),
        edge('agent-complex', 'agent', 'complex', 'choice', 2, 'complex'),
        edge('simple-output', 'simple', 'output'),
        edge('standard-output', 'standard', 'output'),
        edge('complex-output', 'complex', 'output'),
      ],
    ))
    const controller = new AbortController()
    const pending = routeRequest({
      model: 'cybercode-route-blueprint',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'cancel this request' }],
    }, 'cancel-agent', controller.signal)
    await Bun.sleep(30)
    controller.abort()
    const response = await pending

    expect(response.status).toBe(499)
    expect(generationCalls).toBe(0)
  })

  test('uses an explicit failure edge only after a retryable model failure', async () => {
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const key = request.headers.get('authorization') ?? ''
        if (key === 'Bearer limited') {
          return Response.json({ error: { message: 'rate limited' } }, { status: 429 })
        }
        const body = await request.json() as { model: string }
        return openAIResponse(body.model, 'fallback-success')
      },
    })
    const limited = await addProvider('Limited', 'limited', 'limited-model')
    const fallback = await addProvider('Fallback', 'fallback', 'fallback-model')
    await setPublishedGraph(graph(
      [
        node('start', 'start'),
        node('limited', 'model', { providerId: limited.id, modelId: 'limited-model' }),
        node('fallback', 'model', { providerId: fallback.id, modelId: 'fallback-model' }),
        node('output', 'output'),
      ],
      [
        edge('start-limited', 'start', 'limited'),
        edge('limited-output', 'limited', 'output'),
        edge('limited-failure', 'limited', 'fallback', 'failure'),
        edge('fallback-output', 'fallback', 'output'),
      ],
    ))

    const response = await routeRequest({
      model: 'cybercode-route-blueprint',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'fall back safely' }],
    }, 'failure-edge')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('fallback-success')
    expect((await routingService.getDashboard()).events.map((event) => event.status))
      .toEqual(['success', 'failed'])
  })

  test('passes a bounded non-streaming model result into the next pipeline model', async () => {
    const requests: Array<{ key: string; stream?: boolean; text: string }> = []
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
        const body = await request.json() as { model: string; stream?: boolean; messages?: unknown }
        const text = JSON.stringify(body.messages)
        requests.push({ key, stream: body.stream, text })
        return openAIResponse(
          body.model,
          key === 'pipeline-first' ? 'upstream draft' : 'pipeline final',
        )
      },
    })
    const first = await addProvider('Pipeline first', 'pipeline-first', 'pipeline-first-model')
    const second = await addProvider('Pipeline second', 'pipeline-second', 'pipeline-second-model')
    await setPublishedGraph(graph(
      [
        node('start', 'start'),
        node('first', 'model', { providerId: first.id, modelId: 'pipeline-first-model' }),
        node('second', 'model', { providerId: second.id, modelId: 'pipeline-second-model' }),
        node('output', 'output'),
      ],
      [
        edge('start-first', 'start', 'first'),
        edge('first-result-second', 'first', 'second', 'result'),
        edge('second-output', 'second', 'output'),
      ],
    ))

    const response = await routeRequest({
      model: 'cybercode-route-blueprint',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'build a pipeline' }],
    }, 'pipeline')
    expect(await response.text()).toContain('pipeline final')
    expect(requests[0]).toMatchObject({ key: 'pipeline-first', stream: false })
    expect(requests[1]?.text).toContain('upstream draft')
  })

  test('materializes model successors and applies a non-parallel collect result', async () => {
    const requests: Array<{ key: string; stream?: boolean; body: string }> = []
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
        const body = await request.json() as { model: string; stream?: boolean }
        requests.push({ key, stream: body.stream, body: JSON.stringify(body) })
        return openAIResponse(
          body.model,
          key === 'relay-first' ? 'relay draft' : 'relay final',
        )
      },
    })
    const first = await addProvider('Relay first', 'relay-first', 'relay-first-model')
    const second = await addProvider('Relay second', 'relay-second', 'relay-second-model')
    await setPublishedGraph(graph(
      [
        node('start', 'start'),
        node('first', 'model', { providerId: first.id, modelId: 'relay-first-model' }),
        node('relay', 'relay', { mode: 'summary', summaryMaxChars: 4_000 }),
        node('second', 'model', { providerId: second.id, modelId: 'relay-second-model' }),
        node('result', 'result', { mode: 'collect' }),
        node('output', 'output'),
      ],
      [
        edge('start-first', 'start', 'first'),
        edge('first-relay', 'first', 'relay'),
        edge('relay-second', 'relay', 'second'),
        edge('second-result', 'second', 'result'),
        edge('result-output', 'result', 'output'),
      ],
    ))

    const response = await routeRequest({
      model: 'cybercode-route-blueprint',
      stream: true,
      max_tokens: 64,
      messages: [{ role: 'user', content: 'relay this result' }],
    }, 'relay-materialized')
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(text).toContain('## Candidate 1')
    expect(text).toContain('relay final')
    expect(requests.map((request) => request.stream)).toEqual([false, false])
    expect(requests[1]?.body).toContain('relay draft')

    await setPublishedGraph(graph(
      [
        node('start', 'start'),
        node('first', 'model', { providerId: first.id, modelId: 'relay-first-model' }),
        node('condition', 'condition', {
          field: 'task',
          operator: 'equals',
          value: 'coding',
        }),
        node('output', 'output'),
      ],
      [
        edge('start-first', 'start', 'first'),
        edge('first-condition', 'first', 'condition'),
        edge('condition-true', 'condition', 'output', 'true'),
        edge('condition-false', 'condition', 'output', 'false'),
      ],
    ))
    const conditioned = await routeRequest({
      model: 'cybercode-route-blueprint',
      stream: true,
      max_tokens: 64,
      messages: [{ role: 'user', content: 'Write code after materialization.' }],
    }, 'condition-after-model')
    expect(conditioned.headers.get('content-type')).toContain('text/event-stream')
    expect(await conditioned.text()).toContain('relay draft')
    expect(requests[2]?.stream).toBe(false)
  })

  test('runs parallel fastest and collect modes with protocol-correct final responses', async () => {
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
        const body = await request.json() as { model: string }
        if (key === 'slow-panel') await Bun.sleep(50)
        else await Bun.sleep(5)
        return openAIResponse(body.model, `${key}-answer`)
      },
    })
    const slow = await addProvider('Slow panel', 'slow-panel', 'slow-model')
    const fast = await addProvider('Fast panel', 'fast-panel', 'fast-model')
    const makeParallel = (mode: 'fastest' | 'collect') => graph(
      [
        node('start', 'start'),
        node('parallel', 'parallel', { maxConcurrency: 2 }),
        node('slow', 'model', { providerId: slow.id, modelId: 'slow-model' }),
        node('fast', 'model', { providerId: fast.id, modelId: 'fast-model' }),
        node('result', 'result', { mode }),
        node('output', 'output'),
      ],
      [
        edge('start-parallel', 'start', 'parallel'),
        edge('parallel-slow', 'parallel', 'slow'),
        edge('parallel-fast', 'parallel', 'fast'),
        edge('slow-result', 'slow', 'result'),
        edge('fast-result', 'fast', 'result'),
        edge('result-output', 'result', 'output'),
      ],
    )

    await setPublishedGraph(makeParallel('fastest'))
    const fastest = await routeRequest({
      model: 'cybercode-route-blueprint',
      stream: true,
      max_tokens: 64,
      messages: [{ role: 'user', content: 'pick the fastest' }],
    }, 'fastest')
    expect(fastest.headers.get('content-type')).toContain('text/event-stream')
    expect(await fastest.text()).toContain('fast-panel-answer')

    await setPublishedGraph(makeParallel('collect'))
    const collected = await routeRequest({
      model: 'cybercode-route-blueprint',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'collect both' }],
    }, 'collect')
    const collectedText = await collected.text()
    expect(collectedText).toContain('slow-panel-answer')
    expect(collectedText).toContain('fast-panel-answer')
  })

  test('strips tools from parallel panels and restores them only for the judge', async () => {
    const calls: Array<{ key: string; hasTools: boolean; body: string }> = []
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
        const body = await request.json() as { model: string; tools?: unknown[] }
        calls.push({ key, hasTools: Boolean(body.tools?.length), body: JSON.stringify(body) })
        return openAIResponse(body.model, key === 'judge' ? 'judged answer' : `${key} candidate`)
      },
    })
    const first = await addProvider('Panel one', 'panel-one', 'panel-one-model')
    const second = await addProvider('Panel two', 'panel-two', 'panel-two-model')
    const judge = await addProvider('Judge', 'judge', 'judge-model')
    await setPublishedGraph(graph(
      [
        node('start', 'start'),
        node('parallel', 'parallel', { maxConcurrency: 2 }),
        node('first', 'model', { providerId: first.id, modelId: 'panel-one-model' }),
        node('second', 'model', { providerId: second.id, modelId: 'panel-two-model' }),
        node('result', 'result', {
          mode: 'judge',
          judgeProviderId: judge.id,
          judgeModelId: 'judge-model',
        }),
        node('output', 'output'),
      ],
      [
        edge('start-parallel', 'start', 'parallel'),
        edge('parallel-first', 'parallel', 'first'),
        edge('parallel-second', 'parallel', 'second'),
        edge('first-result', 'first', 'result'),
        edge('second-result', 'second', 'result'),
        edge('result-output', 'result', 'output'),
      ],
    ))

    const response = await routeRequest({
      model: 'cybercode-route-blueprint',
      max_tokens: 64,
      tools: [{
        name: 'write_file',
        description: 'Write a file',
        input_schema: { type: 'object', properties: {} },
      }],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: 'compare plans before using tools' }],
    }, 'parallel-tools')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('judged answer')
    expect(calls.filter((call) => call.key.startsWith('panel-')).every((call) => !call.hasTools))
      .toBe(true)
    expect(calls.find((call) => call.key === 'judge')?.hasTools).toBe(true)
    expect(calls.find((call) => call.key === 'judge')?.body).toContain('panel-one candidate')
    expect(calls.find((call) => call.key === 'judge')?.body).toContain('panel-two candidate')
  })

  test('budgets the implicit judge added by parallel tool requests', async () => {
    const calls: Array<{ key: string; hasTools: boolean }> = []
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
        const body = await request.json() as { model: string; tools?: unknown[] }
        calls.push({ key, hasTools: Boolean(body.tools?.length) })
        return openAIResponse(
          body.model,
          calls.length === 3 ? 'implicit judge answer' : `${key} candidate`,
        )
      },
    })
    const first = await addProvider('Implicit one', 'implicit-one', 'implicit-one-model')
    const second = await addProvider('Implicit two', 'implicit-two', 'implicit-two-model')
    const parallel = graph(
      [
        node('start', 'start'),
        node('parallel', 'parallel', { maxConcurrency: 2 }),
        node('first', 'model', { providerId: first.id, modelId: 'implicit-one-model' }),
        node('second', 'model', { providerId: second.id, modelId: 'implicit-two-model' }),
        node('result', 'result', { mode: 'fastest' }),
        node('output', 'output'),
      ],
      [
        edge('start-parallel', 'start', 'parallel'),
        edge('parallel-first', 'parallel', 'first'),
        edge('parallel-second', 'parallel', 'second'),
        edge('first-result', 'first', 'result'),
        edge('second-result', 'second', 'result'),
        edge('result-output', 'result', 'output'),
      ],
    )
    const published = await routingService.publishDraftGraph(PROFILE.id, parallel)
    expect(published.profile.maxAttempts).toBe(2)

    const response = await routeRequest({
      model: 'cybercode-route-blueprint',
      max_tokens: 64,
      tools: [{
        name: 'write_file',
        description: 'Write a file',
        input_schema: { type: 'object', properties: {} },
      }],
      messages: [{ role: 'user', content: 'compare before using tools' }],
    }, 'implicit-judge-budget')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('implicit judge answer')
    expect(calls).toHaveLength(3)
    expect(calls.slice(0, 2).every((call) => !call.hasTools)).toBe(true)
    expect(calls[2]?.hasTools).toBe(true)
    const plan = await routingService.resolveAttempts(PROFILE.id, 'implicit-budget-plan', {
      tools: [{}],
      messages: [{ role: 'user', content: 'inspect budget' }],
    })
    expect(plan.graphPlan?.maxModelAttempts).toBe(3)
    expect(previewRouteGraph(parallel, { hasTools: true }).estimatedModelAttempts).toBe(3)
  })

  test('cancels every in-flight parallel branch without recording false failures', async () => {
    let startedCount = 0
    let markStarted!: () => void
    let release!: () => void
    const allStarted = new Promise<void>((resolve) => { markStarted = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        startedCount += 1
        if (startedCount === 2) markStarted()
        await gate
        const body = await request.json() as { model: string }
        return openAIResponse(body.model, 'too late')
      },
    })
    const first = await addProvider('Cancel one', 'cancel-one', 'cancel-one-model')
    const second = await addProvider('Cancel two', 'cancel-two', 'cancel-two-model')
    await setPublishedGraph(graph(
      [
        node('start', 'start'),
        node('parallel', 'parallel', { maxConcurrency: 2 }),
        node('first', 'model', { providerId: first.id, modelId: 'cancel-one-model' }),
        node('second', 'model', { providerId: second.id, modelId: 'cancel-two-model' }),
        node('result', 'result', { mode: 'collect' }),
        node('output', 'output'),
      ],
      [
        edge('start-parallel', 'start', 'parallel'),
        edge('parallel-first', 'parallel', 'first'),
        edge('parallel-second', 'parallel', 'second'),
        edge('first-result', 'first', 'result'),
        edge('second-result', 'second', 'result'),
        edge('result-output', 'result', 'output'),
      ],
    ))
    const controller = new AbortController()
    const responsePromise = routeRequest({
      model: 'cybercode-route-blueprint',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'cancel all branches' }],
    }, 'parallel-cancel', controller.signal)
    await allStarted
    controller.abort()
    release()
    const response = await responsePromise
    expect(response.status).toBe(499)
    expect((await routingService.getDashboard()).events).toEqual([])
  })

  test('rejects a graph whose configured model attempts exceed the hard runtime cap', () => {
    const modelNodes = Array.from({ length: 9 }, (_, index) => node(`model-${index}`, 'model'))
    const tooMany = graph(
      [node('start', 'start'), node('distribution', 'distribution'), ...modelNodes, node('output', 'output')],
      [
        edge('start-distribution', 'start', 'distribution'),
        ...modelNodes.flatMap((model, index) => [
          edge(`distribution-${index}`, 'distribution', model.id, 'flow', index),
          edge(`model-${index}-output`, model.id, 'output'),
        ]),
      ],
    )
    const validation = validateRouteGraph(tooMany)
    expect(validation.valid).toBe(false)
    expect(validation.issues.some((issue) => issue.code === 'graph.attempt_limit')).toBe(true)
  })

  test('never exceeds the route attempt cap at runtime', async () => {
    let calls = 0
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        calls += 1
        return Response.json({ error: { message: 'temporarily unavailable' } }, { status: 429 })
      },
    })
    const providers = []
    for (const index of [1, 2, 3]) {
      providers.push(await addProvider(`Attempt ${index}`, `attempt-${index}`, `model-${index}`))
    }
    const cappedGraph = graph(
      [
        node('start', 'start'),
        node('distribution', 'distribution'),
        ...providers.map((provider, index) => node(`model-${index}`, 'model', {
          providerId: provider.id,
          modelId: `model-${index + 1}`,
        })),
        node('output', 'output'),
      ],
      [
        edge('start-distribution', 'start', 'distribution'),
        ...providers.flatMap((_provider, index) => [
          edge(`distribution-${index}`, 'distribution', `model-${index}`, 'flow', index),
          edge(`model-${index}-output`, `model-${index}`, 'output'),
        ]),
      ],
    )
    const config = await routingService.getConfig()
    await routingService.updateConfig({
      ...config,
      version: 2,
      profiles: config.profiles.map((profile) => profile.id === PROFILE.id
        ? {
            ...profile,
            maxAttempts: 2,
            graph: cappedGraph,
            draftGraph: structuredClone(cappedGraph),
          }
        : profile),
    })

    const response = await routeRequest({
      model: 'cybercode-route-blueprint',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'respect the cap' }],
    }, 'attempt-cap')
    expect(response.status).toBe(502)
    expect(calls).toBe(2)
    expect(await response.text()).toContain('exceeded 2 model attempts')
  })

  test('persists and enforces a model node estimated USD budget before dispatch', async () => {
    let calls = 0
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        calls += 1
        return openAIResponse('budget-model', 'should not run')
      },
    })
    const provider = await addProvider('Budget provider', 'budget-key', 'budget-model')
    const budgetGraph = graph(
      [
        node('start', 'start'),
        node('budgeted', 'model', {
          providerId: provider.id,
          modelId: 'budget-model',
          budgetUsd: 0.0001,
        }),
        node('output', 'output'),
      ],
      [
        edge('start-budgeted', 'start', 'budgeted'),
        edge('budgeted-output', 'budgeted', 'output'),
      ],
    )
    await setPublishedGraph(budgetGraph)
    const persisted = (await routingService.getConfig()).profiles[0]?.graph?.nodes
      .find((entry) => entry.id === 'budgeted')
    expect(persisted?.type === 'model' ? persisted.config.budgetUsd : undefined).toBe(0.0001)

    const response = await routeRequest({
      model: 'cybercode-route-blueprint',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'stay inside the budget' }],
    }, 'budget-cap')
    expect(response.status).toBe(502)
    expect(calls).toBe(0)
    expect(await response.text()).toContain('exceeded its estimated')
  })

  async function addProvider(name: string, apiKey: string, modelId: string) {
    if (!upstream) {
      upstream = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: () => openAIResponse(modelId, 'ok'),
      })
    }
    return new ProviderService().addProvider({
      presetId: 'custom',
      name,
      apiKey,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiFormat: 'openai_chat',
      models: { main: modelId, haiku: modelId, sonnet: modelId, opus: modelId },
    })
  }

  async function setPublishedGraph(publishedGraph: RouteGraph): Promise<void> {
    const config = await routingService.getConfig()
    await routingService.updateConfig({
      ...config,
      version: 2,
      profiles: config.profiles.map((profile) => (
        profile.id === PROFILE.id
          ? {
              ...profile,
              graph: publishedGraph,
              draftGraph: structuredClone(publishedGraph),
            }
          : profile
      )),
    })
  }

  function routeRequest(
    body: Record<string, unknown>,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = new URL(
      `http://127.0.0.1/proxy/routes/${PROFILE.id}/sessions/${sessionId}/v1/messages`,
    )
    const request = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    return handleProxyRequest(request, url)
  }

  function routingApi(action: string, body: Record<string, unknown>): Promise<Response> {
    const url = new URL(`http://127.0.0.1/api/routing/${action}`)
    const request = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return handleRoutingApi(request, url, url.pathname.split('/').filter(Boolean))
  }
})

describe('routing graph validation hardening', () => {
  test('rejects graphs without a model node', () => {
    const noModel = graph(
      [node('start', 'start'), node('output', 'output')],
      [edge('e1', 'start', 'output')],
    )

    const validation = validateRouteGraph(noModel)
    expect(validation.valid).toBe(false)
    expect(validation.issues.some((issue) => issue.code === 'graph.model_required')).toBe(true)
  })

  test('sticky relay preview follows the same session hash as live execution', () => {
    const relayGraph = graph(
      [
        node('start', 'start'),
        node('relay', 'relay', { mode: 'sticky' }),
        node('model-a', 'model', { providerId: 'p1', modelId: 'm1' }),
        node('model-b', 'model', { providerId: 'p2', modelId: 'm2' }),
        node('output', 'output'),
      ],
      [
        edge('e-start', 'start', 'relay'),
        edge('e-a', 'relay', 'model-a', 'flow', 0),
        edge('e-b', 'relay', 'model-b', 'flow', 1),
        edge('e-a-out', 'model-a', 'output'),
        edge('e-b-out', 'model-b', 'output'),
      ],
    )
    const fnv = (value: string): number => {
      let hash = 2166136261
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
      }
      return hash >>> 0
    }

    const trace = previewRouteGraph(relayGraph, { sessionId: 'session-42' }, 'blueprint')
    expect(trace.valid).toBe(true)
    const relayBranch = trace.branches.find((entry) => entry.nodeId === 'relay')
    const expectedIndex = fnv('blueprint:session-42:relay') % 2
    expect(relayBranch?.selectedEdgeIds).toEqual([['e-a', 'e-b'][expectedIndex]])
    expect(trace.path).toContain(['model-a', 'model-b'][expectedIndex])
  })
})

describe('routing updateConfig graph guard', () => {
  let tempDir = ''
  let originalConfigDir: string | undefined

  beforeEach(async () => {
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cybercode-route-guard-'))
    process.env.CLAUDE_CONFIG_DIR = tempDir
    routingService.resetHealth()
    await routingService.updateConfig({ version: 1, enabled: true, profiles: [PROFILE] })
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    routingService.resetHealth()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  test('rejects a newly introduced invalid graph but allows carried-over graphs', async () => {
    const badGraph = graph(
      [node('start', 'start'), node('output', 'output')],
      [edge('e1', 'start', 'output')],
    )

    await expect(routingService.updateConfig({
      version: 2,
      enabled: true,
      profiles: [{ ...PROFILE, graph: badGraph }],
    })).rejects.toThrow(/model/i)

    // Re-saving the untouched config (graphs carried over) stays allowed.
    const config = await routingService.getConfig()
    await expect(routingService.updateConfig(config)).resolves.toBeTruthy()
  })
})
