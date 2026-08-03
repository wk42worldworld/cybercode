import { beforeEach, describe, expect, test } from 'bun:test'
import {
  clearRouteAgentDecisionCacheForTests,
  executeRouteGraph,
  type RouteGraphExecutionOptions,
} from '../proxy/routeGraphExecutor.js'
import type {
  ResolvedRouteGraphPlan,
  ResolvedRouteTarget,
} from '../routing/routingService.js'
import {
  RouteGraphSchema,
  type RouteAgentPort,
  type RouteGraph,
  type RouteGraphEdge,
  type RouteGraphNode,
} from '../routing/types.js'
import type {
  AnthropicRequest,
  AnthropicResponse,
} from '../proxy/transform/types.js'

const ORIGINAL_TASK = 'Build the invoice export without changing the existing permissions.'

const ORIGINAL_BODY: AnthropicRequest = {
  model: 'cybercode-route-runtime-test',
  system: 'Keep the implementation compatible with the existing application.',
  messages: [
    { role: 'assistant', content: 'What should I implement?' },
    { role: 'user', content: ORIGINAL_TASK },
  ],
  max_tokens: 512,
  stream: false,
  tools: [{
    name: 'read_file',
    description: 'Read a project file',
    input_schema: { type: 'object', properties: { path: { type: 'string' } } },
  }],
}

type SuccessRecord = Parameters<RouteGraphExecutionOptions['recordSuccess']>[0]
type FailureRecord = Parameters<RouteGraphExecutionOptions['recordFailure']>[0]

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
  return RouteGraphSchema.parse({ version: 3, source: 'user', nodes, edges })
}

function agentConfig(options: {
  inputPorts?: RouteAgentPort[]
  outputPorts?: RouteAgentPort[]
  fallbackOutputPortId?: string
  instructions?: string
  confidenceThreshold?: number
  timeoutMs?: number
} = {}): Extract<RouteGraphNode, { type: 'agent' }>['config'] {
  return {
    inputPorts: options.inputPorts ?? [
      { id: 'task-input', label: 'Task', description: 'Original user task' },
    ],
    outputPorts: options.outputPorts ?? [
      { id: 'selected-output', label: 'Selected', description: 'Continue this route' },
      { id: 'fallback-output', label: 'Fallback', description: 'Safe fallback route' },
    ],
    instructions: options.instructions ?? 'Select the best declared output for the task.',
    fallbackOutputPortId: options.fallbackOutputPortId ?? 'fallback-output',
    confidenceThreshold: options.confidenceThreshold ?? 0.7,
    timeoutMs: options.timeoutMs ?? 1_000,
    maxInputChars: 4_000,
  }
}

function target(id: string, modelId = `${id}-model`): ResolvedRouteTarget {
  return {
    provider: {
      id,
      presetId: 'runtime-test',
      name: id,
      apiKey: `${id}-key`,
      baseUrl: 'https://runtime.test/v1',
      apiFormat: 'anthropic',
      models: {
        main: modelId,
        haiku: modelId,
        sonnet: modelId,
        opus: modelId,
      },
    },
    modelId,
    cost: 'paid',
  }
}

function response(model: string, text: string): Response {
  return Response.json({
    id: `msg-${model}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 4 },
  } satisfies AnthropicResponse)
}

async function assistantText(result: Response): Promise<string> {
  const payload = await result.json() as AnthropicResponse
  return payload.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('\n')
}

function plan(
  routeGraph: RouteGraph,
  overrides: Partial<ResolvedRouteGraphPlan> = {},
): ResolvedRouteGraphPlan {
  return {
    graph: routeGraph,
    graphHash: overrides.graphHash ?? 'runtime-graph-hash',
    maxModelAttempts: overrides.maxModelAttempts ?? 8,
    modelTargets: overrides.modelTargets ?? {},
    agentTargets: overrides.agentTargets ?? {},
    eligibleAgentBranches: overrides.eligibleAgentBranches ?? {},
    eligibleAgentOutputs: overrides.eligibleAgentOutputs ?? {},
    judgeTargets: overrides.judgeTargets ?? {},
    distributionOrders: overrides.distributionOrders ?? {},
    relayOrders: overrides.relayOrders ?? {},
    conditionSample: overrides.conditionSample ?? {},
  }
}

function startExecution(input: {
  graph: RouteGraph
  plan: ResolvedRouteGraphPlan
  forward: RouteGraphExecutionOptions['forward']
  body?: AnthropicRequest
  routeId?: string
  sessionId?: string
  fingerprint?: string
  signal?: AbortSignal
  prime?: RouteGraphExecutionOptions['prime']
}) {
  const successes: SuccessRecord[] = []
  const failures: FailureRecord[] = []
  const result = executeRouteGraph({
    routeId: input.routeId ?? 'runtime-route',
    sessionId: input.sessionId ?? 'runtime-session',
    fingerprint: input.fingerprint ?? 'runtime-fingerprint',
    body: input.body ?? structuredClone(ORIGINAL_BODY),
    plan: input.plan,
    signal: input.signal ?? new AbortController().signal,
    forward: input.forward,
    prime: input.prime ?? (async (upstream) => upstream),
    isRetryableStatus: (status) => [408, 425, 429, 500, 502, 503, 504].includes(status),
    recordSuccess: (record) => successes.push(record),
    recordFailure: (record) => failures.push(record),
  })
  return { result, successes, failures }
}

function chainedAgentGraph(count: number): RouteGraph {
  const agents = Array.from({ length: count }, (_, index) => (
    node(`agent-${index + 1}`, 'agent', agentConfig({
      instructions: `AGENT_${index + 1}: select a route without answering the task.`,
    }))
  ))
  return graph(
    [
      node('start', 'start'),
      ...agents,
      node('selected-model', 'model', { timeoutMs: 1_000, maxAttempts: 1 }),
      node('fallback-model', 'model', { timeoutMs: 1_000, maxAttempts: 1 }),
      node('output', 'output'),
    ],
    [
      edge('start-agent-1', 'start', 'agent-1', { targetPortId: 'task-input' }),
      ...agents.flatMap((agent, index) => {
        const next = agents[index + 1]
        return [
          edge(`${agent.id}-selected`, agent.id, next?.id ?? 'selected-model', {
            kind: 'choice',
            sourcePortId: 'selected-output',
            ...(next && { targetPortId: 'task-input' }),
          }),
          edge(`${agent.id}-fallback`, agent.id, 'fallback-model', {
            kind: 'choice',
            sourcePortId: 'fallback-output',
          }),
        ]
      }),
      edge('selected-output', 'selected-model', 'output'),
      edge('fallback-output', 'fallback-model', 'output'),
    ],
  )
}

function singleAgentGraph(options: {
  inputPorts?: RouteAgentPort[]
  outputPorts?: RouteAgentPort[]
  fallbackOutputPortId?: string
  timeoutMs?: number
  prefixNodes?: RouteGraphNode[]
  prefixEdges?: RouteGraphEdge[]
} = {}): RouteGraph {
  const inputPorts = options.inputPorts ?? [
    { id: 'task-input', label: 'Task', description: 'Original task' },
  ]
  const outputPorts = options.outputPorts ?? [
    { id: 'selected-output', label: 'Selected', description: 'Selected route' },
    { id: 'fallback-output', label: 'Fallback', description: 'Fallback route' },
  ]
  const prefixNodes = options.prefixNodes ?? []
  const prefixEdges = options.prefixEdges ?? [
    edge('start-agent', 'start', 'agent', { targetPortId: inputPorts[0]!.id }),
  ]
  return graph(
    [
      node('start', 'start'),
      ...prefixNodes,
      node('agent', 'agent', agentConfig({
        inputPorts,
        outputPorts,
        fallbackOutputPortId: options.fallbackOutputPortId,
        timeoutMs: options.timeoutMs,
      })),
      ...outputPorts.map((port) => (
        node(`model-${port.id}`, 'model', { timeoutMs: 1_000, maxAttempts: 1 })
      )),
      node('output', 'output'),
    ],
    [
      ...prefixEdges,
      ...outputPorts.flatMap((port) => [
        edge(`agent-${port.id}`, 'agent', `model-${port.id}`, {
          kind: 'choice',
          sourcePortId: port.id,
        }),
        edge(`${port.id}-output`, `model-${port.id}`, 'output'),
      ]),
    ],
  )
}

function singleAgentPlan(
  routeGraph: RouteGraph,
  options: {
    router?: ResolvedRouteTarget
    eligible?: string[]
    distributionOrders?: Record<string, string[]>
    modelTargets?: Record<string, ResolvedRouteTarget[]>
    graphHash?: string
  } = {},
): ResolvedRouteGraphPlan {
  const outputPorts = routeGraph.nodes.find((entry) => entry.id === 'agent')
  if (!outputPorts || outputPorts.type !== 'agent' || !('outputPorts' in outputPorts.config)) {
    throw new Error('Expected a V3 agent node')
  }
  const defaultModelTargets = Object.fromEntries(outputPorts.config.outputPorts.map((port) => [
    `model-${port.id}`,
    [target(port.id)],
  ]))
  return plan(routeGraph, {
    graphHash: options.graphHash,
    modelTargets: options.modelTargets ?? defaultModelTargets,
    agentTargets: { agent: options.router ? [options.router] : [] },
    eligibleAgentOutputs: {
      agent: options.eligible ?? outputPorts.config.outputPorts.map((port) => port.id),
    },
    distributionOrders: options.distributionOrders,
  })
}

describe('route graph multi-agent destructive runtime acceptance', () => {
  beforeEach(() => clearRouteAgentDecisionCacheForTests())

  for (const count of [1, 2, 3, 4]) {
    test(`runs ${count} chained agent${count === 1 ? '' : 's'} and preserves the original task`, async () => {
      const routeGraph = chainedAgentGraph(count)
      const router = target('router')
      const selected = target('selected-generation')
      const fallback = target('fallback-generation')
      const decisions: AnthropicRequest[] = []
      const generations: AnthropicRequest[] = []
      const originalBody = structuredClone(ORIGINAL_BODY)
      const runtimePlan = plan(routeGraph, {
        modelTargets: {
          'selected-model': [selected],
          'fallback-model': [fallback],
        },
        agentTargets: Object.fromEntries(
          Array.from({ length: count }, (_, index) => [`agent-${index + 1}`, [router]]),
        ),
        eligibleAgentOutputs: Object.fromEntries(
          Array.from({ length: count }, (_, index) => [
            `agent-${index + 1}`,
            ['selected-output', 'fallback-output'],
          ]),
        ),
      })
      const execution = startExecution({
        graph: routeGraph,
        plan: runtimePlan,
        body: originalBody,
        forward: async (selectedTarget, body) => {
          if (selectedTarget.provider.id === router.provider.id) {
            decisions.push(structuredClone(body))
            return response(selectedTarget.modelId, JSON.stringify({
              outputPortId: 'selected-output',
              confidence: 0.99,
            }))
          }
          generations.push(structuredClone(body))
          return response(selectedTarget.modelId, `completed-by:${selectedTarget.provider.id}`)
        },
      })

      const result = await execution.result
      expect(result.status).toBe(200)
      expect(await assistantText(result)).toBe('completed-by:selected-generation')
      expect(decisions).toHaveLength(count)
      expect(generations).toHaveLength(1)
      for (const decision of decisions) {
        expect(decision.messages).toEqual([{ role: 'user', content: ORIGINAL_TASK }])
      }
      expect(generations[0]?.messages).toEqual(ORIGINAL_BODY.messages)
      expect(generations[0]?.system).toEqual(ORIGINAL_BODY.system)
      expect(generations[0]?.tools).toEqual(ORIGINAL_BODY.tools)
      expect(originalBody).toEqual(ORIGINAL_BODY)
    })
  }

  test('isolates cached decisions by input port, session, fingerprint, and graph hash', async () => {
    const inputPorts = [
      { id: 'primary-input', label: 'Primary', description: 'Normal entry' },
      { id: 'retry-input', label: 'Retry', description: 'Retry entry' },
    ]
    const routeGraph = singleAgentGraph({
      inputPorts,
      prefixNodes: [node('input-router', 'distribution')],
      prefixEdges: [
        edge('start-router', 'start', 'input-router'),
        edge('router-primary', 'input-router', 'agent', {
          order: 0,
          targetPortId: 'primary-input',
        }),
        edge('router-retry', 'input-router', 'agent', {
          order: 1,
          targetPortId: 'retry-input',
        }),
      ],
    })
    const router = target('cache-router')
    let decisionCalls = 0
    const generationTargets: string[] = []
    const forward: RouteGraphExecutionOptions['forward'] = async (selectedTarget, body) => {
      if (selectedTarget.provider.id === router.provider.id) {
        decisionCalls += 1
        const currentInput = String(body.system).includes('retry-input')
          ? 'fallback-output'
          : 'selected-output'
        return response(selectedTarget.modelId, JSON.stringify({
          outputPortId: currentInput,
          confidence: 1,
        }))
      }
      generationTargets.push(selectedTarget.provider.id)
      return response(selectedTarget.modelId, 'done')
    }
    const run = async (
      firstEdge: 'router-primary' | 'router-retry',
      sessionId: string,
      fingerprint: string,
      graphHash = 'cache-graph',
    ) => {
      const otherEdge = firstEdge === 'router-primary' ? 'router-retry' : 'router-primary'
      const runtimePlan = singleAgentPlan(routeGraph, {
        router,
        graphHash,
        distributionOrders: { 'input-router': [firstEdge, otherEdge] },
      })
      const execution = startExecution({
        graph: routeGraph,
        plan: runtimePlan,
        sessionId,
        fingerprint,
        forward,
      })
      expect((await execution.result).status).toBe(200)
    }

    await run('router-primary', 'session-a', 'turn-a')
    await run('router-retry', 'session-a', 'turn-a')
    await run('router-primary', 'session-a', 'turn-a')
    expect(decisionCalls).toBe(2)
    expect(generationTargets).toEqual([
      'selected-output',
      'fallback-output',
      'selected-output',
    ])

    await run('router-primary', 'session-b', 'turn-a')
    await run('router-primary', 'session-a', 'turn-b')
    await run('router-primary', 'session-a', 'turn-a', 'changed-graph')
    expect(decisionCalls).toBe(5)
  })

  for (const scenario of [
    {
      name: 'low confidence',
      text: JSON.stringify({ outputPortId: 'selected-output', confidence: 0.2 }),
    },
    { name: 'invalid JSON', text: 'selected-output because it looks suitable' },
    {
      name: 'an unknown output port',
      text: JSON.stringify({ outputPortId: 'deleted-output', confidence: 1 }),
    },
  ]) {
    test(`falls back safely on ${scenario.name} and caches only the usable fallback`, async () => {
      const routeGraph = singleAgentGraph()
      const router = target(`router-${scenario.name.replaceAll(' ', '-')}`)
      const runtimePlan = singleAgentPlan(routeGraph, { router })
      let decisionCalls = 0
      const forward: RouteGraphExecutionOptions['forward'] = async (selectedTarget) => {
        if (selectedTarget.provider.id === router.provider.id) {
          decisionCalls += 1
          return response(selectedTarget.modelId, scenario.text)
        }
        return response(selectedTarget.modelId, `used:${selectedTarget.provider.id}`)
      }

      for (const _attempt of [1, 2]) {
        const execution = startExecution({ graph: routeGraph, plan: runtimePlan, forward })
        const result = await execution.result
        expect(result.status).toBe(200)
        expect(await assistantText(result)).toBe('used:fallback-output')
      }
      expect(decisionCalls).toBe(1)
    })
  }

  test('uses the first eligible output when the configured fallback is unavailable', async () => {
    const outputPorts = [
      { id: 'unavailable-fallback', label: 'Unavailable', description: 'Unavailable fallback' },
      { id: 'available-primary', label: 'Primary', description: 'First usable output' },
      { id: 'available-secondary', label: 'Secondary', description: 'Second usable output' },
    ]
    const routeGraph = singleAgentGraph({
      outputPorts,
      fallbackOutputPortId: 'unavailable-fallback',
    })
    const router = target('unavailable-fallback-router')
    const runtimePlan = singleAgentPlan(routeGraph, {
      router,
      eligible: ['available-primary', 'available-secondary'],
      modelTargets: {
        'model-unavailable-fallback': [],
        'model-available-primary': [target('available-primary')],
        'model-available-secondary': [target('available-secondary')],
      },
    })
    const execution = startExecution({
      graph: routeGraph,
      plan: runtimePlan,
      forward: async (selectedTarget) => {
        if (selectedTarget.provider.id === router.provider.id) {
          return response(selectedTarget.modelId, 'invalid decision')
        }
        return response(selectedTarget.modelId, `used:${selectedTarget.provider.id}`)
      },
    })

    const result = await execution.result
    expect(result.status).toBe(200)
    expect(await assistantText(result)).toBe('used:available-primary')
  })

  test('falls back when the configured routing model is unavailable', async () => {
    const routeGraph = singleAgentGraph()
    const runtimePlan = singleAgentPlan(routeGraph)
    let generationCalls = 0
    const execution = startExecution({
      graph: routeGraph,
      plan: runtimePlan,
      forward: async (selectedTarget) => {
        generationCalls += 1
        return response(selectedTarget.modelId, `used:${selectedTarget.provider.id}`)
      },
    })

    const result = await execution.result
    expect(result.status).toBe(200)
    expect(await assistantText(result)).toBe('used:fallback-output')
    expect(generationCalls).toBe(1)
  })

  for (const scenario of [
    {
      name: 'provider failure',
      reply: () => Promise.reject(new Error('routing provider unavailable')),
    },
    {
      name: 'HTTP 429',
      reply: () => Promise.resolve(Response.json({ error: 'rate limited' }, { status: 429 })),
    },
  ]) {
    test(`falls back when the routing model returns ${scenario.name}`, async () => {
      const routeGraph = singleAgentGraph()
      const router = target(`failing-${scenario.name.replaceAll(' ', '-')}`)
      const runtimePlan = singleAgentPlan(routeGraph, { router })
      const execution = startExecution({
        graph: routeGraph,
        plan: runtimePlan,
        forward: async (selectedTarget) => {
          if (selectedTarget.provider.id === router.provider.id) return scenario.reply()
          return response(selectedTarget.modelId, `used:${selectedTarget.provider.id}`)
        },
      })

      const result = await execution.result
      expect(result.status).toBe(200)
      expect(await assistantText(result)).toBe('used:fallback-output')
      expect(execution.failures).toHaveLength(1)
      expect(execution.failures[0]).toMatchObject({
        phase: 'agent-decision',
        nodeId: 'agent',
      })
    })
  }

  test('enforces the agent timeout even when the routing provider ignores AbortSignal', async () => {
    const routeGraph = singleAgentGraph({ timeoutMs: 1_000 })
    const router = target('timeout-router')
    const runtimePlan = singleAgentPlan(routeGraph, { router })
    const startedAt = Date.now()
    const execution = startExecution({
      graph: routeGraph,
      plan: runtimePlan,
      forward: async (selectedTarget) => {
        if (selectedTarget.provider.id === router.provider.id) {
          return new Promise<Response>(() => {})
        }
        return response(selectedTarget.modelId, `used:${selectedTarget.provider.id}`)
      },
    })

    const result = await execution.result
    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(result.status).toBe(200)
    expect(await assistantText(result)).toBe('used:fallback-output')
    expect(execution.failures[0]?.error).toContain('timed out after 1000ms')
  }, 3_000)

  test('cancels promptly without falling back or caching when a provider ignores AbortSignal', async () => {
    const routeGraph = singleAgentGraph()
    const router = target('cancel-router')
    const runtimePlan = singleAgentPlan(routeGraph, { router })
    let decisionCalls = 0
    let generationCalls = 0
    let shouldHang = true
    const forward: RouteGraphExecutionOptions['forward'] = async (selectedTarget) => {
      if (selectedTarget.provider.id === router.provider.id) {
        decisionCalls += 1
        if (shouldHang) return new Promise<Response>(() => {})
        return response(selectedTarget.modelId, JSON.stringify({
          outputPortId: 'selected-output',
          confidence: 1,
        }))
      }
      generationCalls += 1
      return response(selectedTarget.modelId, `used:${selectedTarget.provider.id}`)
    }
    const controller = new AbortController()
    const cancelled = startExecution({
      graph: routeGraph,
      plan: runtimePlan,
      forward,
      signal: controller.signal,
    })
    await Bun.sleep(20)
    controller.abort('user-cancelled')

    const cancelledResponse = await cancelled.result
    expect(cancelledResponse.status).toBe(499)
    expect(generationCalls).toBe(0)
    expect(cancelled.failures).toHaveLength(0)

    shouldHang = false
    const retry = startExecution({ graph: routeGraph, plan: runtimePlan, forward })
    const retryResponse = await retry.result
    expect(retryResponse.status).toBe(200)
    expect(await assistantText(retryResponse)).toBe('used:selected-output')
    expect(decisionCalls).toBe(2)
    expect(generationCalls).toBe(1)
  }, 2_000)

  test('routes through a model into another agent without replacing the original task', async () => {
    const routeGraph = graph(
      [
        node('start', 'start'),
        node('planner', 'agent', agentConfig({
          instructions: 'Choose whether a planning pass is required.',
        })),
        node('planning-model', 'model', { timeoutMs: 1_000, maxAttempts: 1 }),
        node('implementer', 'agent', agentConfig({
          inputPorts: [
            { id: 'plan-input', label: 'Plan', description: 'Task after planning' },
          ],
          instructions: 'Choose the implementation model for the original task.',
        })),
        node('final-model', 'model', { timeoutMs: 1_000, maxAttempts: 1 }),
        node('fallback-model', 'model', { timeoutMs: 1_000, maxAttempts: 1 }),
        node('output', 'output'),
      ],
      [
        edge('start-planner', 'start', 'planner', { targetPortId: 'task-input' }),
        edge('planner-selected', 'planner', 'planning-model', {
          kind: 'choice',
          sourcePortId: 'selected-output',
        }),
        edge('planner-fallback', 'planner', 'fallback-model', {
          kind: 'choice',
          sourcePortId: 'fallback-output',
        }),
        edge('planning-implementer', 'planning-model', 'implementer', {
          targetPortId: 'plan-input',
        }),
        edge('implementer-selected', 'implementer', 'final-model', {
          kind: 'choice',
          sourcePortId: 'selected-output',
        }),
        edge('implementer-fallback', 'implementer', 'fallback-model', {
          kind: 'choice',
          sourcePortId: 'fallback-output',
        }),
        edge('final-output', 'final-model', 'output'),
        edge('fallback-output', 'fallback-model', 'output'),
      ],
    )
    const router = target('reentry-router')
    const planning = target('planning')
    const final = target('final')
    const fallback = target('fallback')
    const decisionBodies: AnthropicRequest[] = []
    const finalBodies: AnthropicRequest[] = []
    const runtimePlan = plan(routeGraph, {
      modelTargets: {
        'planning-model': [planning],
        'final-model': [final],
        'fallback-model': [fallback],
      },
      agentTargets: { planner: [router], implementer: [router] },
      eligibleAgentOutputs: {
        planner: ['selected-output', 'fallback-output'],
        implementer: ['selected-output', 'fallback-output'],
      },
    })
    const execution = startExecution({
      graph: routeGraph,
      plan: runtimePlan,
      forward: async (selectedTarget, body) => {
        if (selectedTarget.provider.id === router.provider.id) {
          decisionBodies.push(structuredClone(body))
          return response(selectedTarget.modelId, JSON.stringify({
            outputPortId: 'selected-output',
            confidence: 1,
          }))
        }
        if (selectedTarget.provider.id === planning.provider.id) {
          return response(selectedTarget.modelId, 'PLAN_OUTPUT_MUST_NOT_REPLACE_THE_TASK')
        }
        if (selectedTarget.provider.id === final.provider.id) {
          finalBodies.push(structuredClone(body))
          return response(selectedTarget.modelId, 'implemented')
        }
        return response(selectedTarget.modelId, 'fallback')
      },
    })

    const result = await execution.result
    expect(result.status).toBe(200)
    expect(await assistantText(result)).toBe('implemented')
    expect(decisionBodies).toHaveLength(2)
    expect(decisionBodies[1]?.messages).toEqual([{ role: 'user', content: ORIGINAL_TASK }])
    expect(String(decisionBodies[1]?.system)).toContain('plan-input')
    expect(JSON.stringify(decisionBodies[1])).not.toContain('PLAN_OUTPUT_MUST_NOT_REPLACE_THE_TASK')
    expect(finalBodies).toHaveLength(1)
    expect(finalBodies[0]?.messages.slice(0, ORIGINAL_BODY.messages.length))
      .toEqual(ORIGINAL_BODY.messages)
    expect(JSON.stringify(finalBodies[0]?.messages)).toContain('PLAN_OUTPUT_MUST_NOT_REPLACE_THE_TASK')
  })
})
