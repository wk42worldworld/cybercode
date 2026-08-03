import type {
  RouteDistributionMode,
  RouteGraph,
  RouteGraphEdge,
  RouteGraphEdgeKind,
  RouteGraphIssue,
  RouteGraphNode,
  RouteGraphNodeConfig,
  RouteGraphNodeKind,
  RouteGraphValidation,
  RouteProfile,
  RouteResultMode,
  RouteTarget,
  RoutingSource,
  RoutingStrategy,
} from '../types/routing'

export const ROUTE_GRAPH_TEMPLATE_IDS = [
  'stable-fallback',
  'quota-balance',
  'low-cost',
  'fastest-success',
  'parallel-judge',
  'long-relay',
  'agent-difficulty',
] as const

export type RouteGraphTemplateId = (typeof ROUTE_GRAPH_TEMPLATE_IDS)[number]

export const ROUTE_GRAPH_TEMPLATES: Array<{
  id: RouteGraphTemplateId
  icon: 'shield' | 'quota' | 'cost' | 'speed' | 'judge' | 'relay' | 'agent'
}> = ROUTE_GRAPH_TEMPLATE_IDS.map((id) => ({
  id,
  icon: id === 'stable-fallback'
    ? 'shield'
    : id === 'quota-balance'
      ? 'quota'
      : id === 'low-cost'
        ? 'cost'
        : id === 'fastest-success'
          ? 'speed'
          : id === 'parallel-judge'
            ? 'judge'
            : id === 'long-relay'
              ? 'relay'
              : 'agent',
}))

export const DEFAULT_ROUTE_AGENT_INPUT_PORTS = [
  { id: 'input', label: 'Input 1', description: '' },
] as const

export const DEFAULT_ROUTE_AGENT_OUTPUT_PORTS = [
  { id: 'output-1', label: 'Output 1', description: '' },
  { id: 'output-2', label: 'Output 2', description: '' },
] as const

export const DIFFICULTY_ROUTE_AGENT_OUTPUT_PORTS = [
  { id: 'simple', label: 'Simple', description: 'Small, clear tasks suited to a fast low-cost model' },
  { id: 'standard', label: 'Standard', description: 'Normal implementation tasks needing balanced capability' },
  { id: 'complex', label: 'Complex', description: 'Architecture or difficult tasks needing the strongest model' },
] as const

const DEFAULT_DIFFICULTY_AGENT_INSTRUCTIONS =
  'Choose the output connected to the model best suited to the task difficulty.'

// Mirrors RouteAgentPortSchema id regex in src/server/routing/types.ts so the
// client rejects ids the server would refuse at publish time.
const AGENT_PORT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

type ModelRef = { providerId?: string; modelId?: string }

function node(
  id: string,
  kind: RouteGraphNodeKind,
  x: number,
  y: number,
  config: RouteGraphNodeConfig = {},
): RouteGraphNode {
  return {
    id,
    type: 'routeGraphNode',
    position: { x, y },
    data: { kind, config },
  }
}

function edge(
  source: string,
  target: string,
  kind: RouteGraphEdgeKind = 'flow',
  sourceHandle: string = kind,
  targetHandle: string = 'input',
  sourcePortId?: string,
  targetPortId?: string,
): RouteGraphEdge {
  const handleId = sourceHandle.replaceAll(/[^a-zA-Z0-9_-]/g, '-')
  return {
    id: `${source}-${handleId}-${target}${targetPortId ? `-${targetPortId}` : ''}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: 'smoothstep',
    data: {
      kind,
      ...(sourcePortId ? { sourcePortId } : {}),
      ...(targetPortId ? { targetPortId } : {}),
    },
  }
}

function sourceModels(sources: RoutingSource[], limit = 3): ModelRef[] {
  const result: ModelRef[] = []
  for (const source of sources) {
    if (!source.routable || !source.providerId) continue
    for (const model of source.models) {
      result.push({ providerId: source.providerId, modelId: model.id })
      if (result.length >= limit) return result
    }
  }
  return result
}

function modelAt(models: ModelRef[], index: number): ModelRef {
  return models[index] ?? {}
}

export function createEmptyRouteGraph(): RouteGraph {
  return {
    version: 1,
    nodes: [
      node('start', 'start', 80, 180),
      node('output', 'output', 680, 180),
    ],
    edges: [],
  }
}

export function buildRouteGraphTemplate(
  templateId: RouteGraphTemplateId,
  sources: RoutingSource[] = [],
  options: {
    agentInstructions?: string
    agentInputLabel?: string
    agentOutputLabels?: [string, string, string]
    agentOutputDescriptions?: [string, string, string]
  } = {},
): RouteGraph {
  const models = sourceModels(sources)
  const first = modelAt(models, 0)
  const second = modelAt(models, 1)

  if (templateId === 'agent-difficulty') {
    const third = modelAt(models, 2)
    return {
      version: 3,
      source: 'template',
      nodes: [
        node('start', 'start', 30, 220),
        node('agent-router', 'agent', 210, 220, {
          inputPorts: DEFAULT_ROUTE_AGENT_INPUT_PORTS.map((port) => ({
            ...port,
            label: options.agentInputLabel ?? port.label,
          })),
          outputPorts: DIFFICULTY_ROUTE_AGENT_OUTPUT_PORTS.map((port, index) => ({
            ...port,
            label: options.agentOutputLabels?.[index] ?? port.label,
            description: options.agentOutputDescriptions?.[index] ?? port.description,
          })),
          instructions: options.agentInstructions ?? DEFAULT_DIFFICULTY_AGENT_INSTRUCTIONS,
          fallbackOutputPortId: 'standard',
          confidenceThreshold: 0.6,
          timeoutMs: 8_000,
          maxInputChars: 4_000,
        }),
        node('model-simple', 'model', 470, 40, first),
        node('model-standard', 'model', 470, 220, second),
        node('model-complex', 'model', 470, 400, third),
        node('output', 'output', 760, 220),
      ],
      edges: [
        edge('start', 'agent-router', 'flow', 'flow', 'input:input', undefined, 'input'),
        edge('agent-router', 'model-simple', 'choice', 'output:simple', 'input', 'simple'),
        edge('agent-router', 'model-standard', 'choice', 'output:standard', 'input', 'standard'),
        edge('agent-router', 'model-complex', 'choice', 'output:complex', 'input', 'complex'),
        edge('model-simple', 'output', 'success'),
        edge('model-standard', 'output', 'success'),
        edge('model-complex', 'output', 'success'),
      ],
    }
  }

  if (templateId === 'stable-fallback') {
    const hasFallback = Boolean(second.providerId && second.modelId)
    return {
      version: 1,
      nodes: [
        node('start', 'start', 60, 180),
        node('model-primary', 'model', 270, 110, first),
        ...(hasFallback ? [node('model-fallback', 'model', 500, 250, second)] : []),
        node('output', 'output', 750, 110),
      ],
      edges: [
        edge('start', 'model-primary'),
        edge('model-primary', 'output', 'success'),
        ...(hasFallback ? [
          edge('model-primary', 'model-fallback', 'failure'),
          edge('model-fallback', 'output', 'success'),
        ] : []),
      ],
    }
  }

  if (templateId === 'long-relay') {
    const hasFallback = Boolean(second.providerId && second.modelId)
    return {
      version: 1,
      nodes: [
        node('start', 'start', 40, 180),
        node('relay', 'relay', 220, 180, { sessionSticky: true }),
        node('model-primary', 'model', 420, 110, first),
        ...(hasFallback ? [node('model-fallback', 'model', 620, 250, second)] : []),
        node('output', 'output', 850, 110),
      ],
      edges: [
        edge('start', 'relay'),
        edge('relay', 'model-primary'),
        edge('model-primary', 'output', 'success'),
        ...(hasFallback ? [
          edge('model-primary', 'model-fallback', 'failure'),
          edge('model-fallback', 'output', 'success'),
        ] : []),
      ],
    }
  }

  if (templateId === 'quota-balance' || templateId === 'low-cost') {
    const distributionMode: RouteDistributionMode = templateId === 'quota-balance'
      ? 'quota'
      : 'cost'
    return {
      version: 1,
      nodes: [
        node('start', 'start', 40, 180),
        node('distribution', 'distribution', 220, 180, { distributionMode }),
        node('model-a', 'model', 450, 90, first),
        node('model-b', 'model', 450, 270, second),
        node('output', 'output', 720, 180),
      ],
      edges: [
        edge('start', 'distribution'),
        edge('distribution', 'model-a'),
        edge('distribution', 'model-b'),
        edge('model-a', 'output', 'success'),
        edge('model-b', 'output', 'success'),
      ],
    }
  }

  const resultMode: RouteResultMode = templateId === 'parallel-judge'
    ? 'judge'
    : 'first-success'
  return {
    version: 1,
    nodes: [
      node('start', 'start', 30, 180),
      node('parallel', 'parallel', 200, 180, { readOnly: true }),
      node('model-a', 'model', 410, 80, first),
      node('model-b', 'model', 410, 280, second),
      node('result', 'result', 650, 180, {
        resultMode,
        readOnly: true,
        ...(resultMode === 'judge'
          ? { judgeProviderId: first.providerId, judgeModelId: first.modelId }
          : {}),
      }),
      node('output', 'output', 850, 180),
    ],
    edges: [
      edge('start', 'parallel'),
      edge('parallel', 'model-a'),
      edge('parallel', 'model-b'),
      edge('model-a', 'result', 'result'),
      edge('model-b', 'result', 'result'),
      edge('result', 'output'),
    ],
  }
}

export function cloneRouteGraph(graph: RouteGraph): RouteGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((entry) => ({
      ...entry,
      position: { ...entry.position },
      data: {
        ...entry.data,
        config: {
          ...entry.data.config,
          ...(entry.data.config.inputPorts
            ? { inputPorts: entry.data.config.inputPorts.map((port) => ({ ...port })) }
            : {}),
          ...(entry.data.config.outputPorts
            ? { outputPorts: entry.data.config.outputPorts.map((port) => ({ ...port })) }
            : {}),
          ...(entry.data.config.branches
            ? { branches: entry.data.config.branches.map((branch) => ({ ...branch })) }
            : {}),
        },
      },
    })),
    edges: graph.edges.map((entry) => ({
      ...entry,
      data: { ...entry.data },
    })),
    viewport: graph.viewport ? { ...graph.viewport } : undefined,
  }
}

function routeGraphConnectionKey(
  source: string,
  target: string,
  kind: RouteGraphEdgeKind,
  sourcePortId?: string,
  targetPortId?: string,
): string {
  return JSON.stringify([
    source,
    target,
    kind,
    sourcePortId ?? '',
    targetPortId ?? '',
  ])
}

function routeGraphEdgeDetails(
  sourceHandle?: string | null,
  targetHandle?: string | null,
): {
  kind: RouteGraphEdgeKind
  sourcePortId?: string
  targetPortId?: string
} {
  const targetPortId = targetHandle?.startsWith('input:')
    ? targetHandle.slice('input:'.length)
    : undefined
  if (sourceHandle?.startsWith('output:')) {
    return {
      kind: 'choice',
      sourcePortId: sourceHandle.slice('output:'.length),
      ...(targetPortId ? { targetPortId } : {}),
    }
  }
  if (sourceHandle?.startsWith('choice:')) {
    return {
      kind: 'choice',
      sourcePortId: sourceHandle.slice('choice:'.length),
      ...(targetPortId ? { targetPortId } : {}),
    }
  }
  return {
    kind: (sourceHandle && ['success', 'failure', 'result', 'true', 'false'].includes(sourceHandle)
      ? sourceHandle
      : 'flow') as RouteGraphEdgeKind,
    ...(targetPortId ? { targetPortId } : {}),
  }
}

export function hasRouteGraphConnection(
  edges: RouteGraphEdge[],
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): boolean {
  const details = routeGraphEdgeDetails(sourceHandle, targetHandle)
  const connectionKey = routeGraphConnectionKey(
    source,
    target,
    details.kind,
    details.sourcePortId,
    details.targetPortId,
  )
  return edges.some((entry) => routeGraphConnectionKey(
    entry.source,
    entry.target,
    entry.data.kind,
    entry.data.sourcePortId ?? entry.data.branchId,
    entry.data.targetPortId,
  ) === connectionKey)
}

export function dedupeRouteGraphEdges(edges: RouteGraphEdge[]): RouteGraphEdge[] {
  const seen = new Set<string>()
  return edges.filter((entry) => {
    const connectionKey = routeGraphConnectionKey(
      entry.source,
      entry.target,
      entry.data.kind,
      entry.data.sourcePortId ?? entry.data.branchId,
      entry.data.targetPortId,
    )
    if (seen.has(connectionKey)) return false
    seen.add(connectionKey)
    return true
  })
}

const AGENT_MIN_OUTPUT_PORTS = 2

export const DISTRIBUTION_OUTPUT_HANDLE_PREFIX = 'dist:'
export const ROUTE_GRAPH_DISTRIBUTION_MIN_OUTPUTS = 2
export const ROUTE_GRAPH_DISTRIBUTION_DEFAULT_OUTPUTS = 2
export const ROUTE_GRAPH_DISTRIBUTION_MAX_OUTPUTS = 16

/**
 * Keeps distribution output slots and connected edge handles deterministic.
 * Existing graphs without an explicit count migrate from their connected
 * branches, while new empty nodes start with two manually managed outputs.
 */
export function normalizeDistributionOutputHandles(graph: RouteGraph): RouteGraph {
  const distributionIds = new Set(
    graph.nodes
      .filter((entry) => entry.data.kind === 'distribution')
      .map((entry) => entry.id),
  )
  if (distributionIds.size === 0) return graph
  const counters = new Map<string, number>()
  let changed = false
  const edges = graph.edges.map((entry) => {
    if (!distributionIds.has(entry.source)) return entry
    const index = (counters.get(entry.source) ?? 0) + 1
    counters.set(entry.source, index)
    const handle = `${DISTRIBUTION_OUTPUT_HANDLE_PREFIX}${index}`
    if (entry.sourceHandle === handle) return entry
    changed = true
    return { ...entry, sourceHandle: handle }
  })
  const nodes = graph.nodes.map((entry) => {
    if (entry.data.kind !== 'distribution') return entry
    const connected = counters.get(entry.id) ?? 0
    const configured = entry.data.config.distributionOutputCount
    const outputCount = Math.max(
      ROUTE_GRAPH_DISTRIBUTION_MIN_OUTPUTS,
      connected,
      typeof configured === 'number' && Number.isInteger(configured)
        ? configured
        : ROUTE_GRAPH_DISTRIBUTION_DEFAULT_OUTPUTS,
    )
    if (configured === outputCount) return entry
    changed = true
    return {
      ...entry,
      data: {
        ...entry.data,
        config: {
          ...entry.data.config,
          distributionOutputCount: outputCount,
        },
      },
    }
  })
  return changed ? { ...graph, nodes, edges } : graph
}

/**
 * Removes agent output ports that lost their last connection (UE blueprint
 * style: pin count follows the number of connected branches). Keeps at least
 * AGENT_MIN_OUTPUT_PORTS ports so the draft stays close to a publishable
 * shape, and repoints the fallback when its port was pruned.
 */
export function pruneUnconnectedAgentOutputPorts(graph: RouteGraph): RouteGraph {
  const connectedPortsByNode = new Map<string, Set<string>>()
  for (const entry of graph.edges) {
    const sourcePortId = entry.data.sourcePortId ?? entry.data.branchId ?? (
      entry.sourceHandle?.startsWith('output:')
        ? entry.sourceHandle.slice('output:'.length)
        : entry.sourceHandle?.startsWith('choice:')
          ? entry.sourceHandle.slice('choice:'.length)
          : undefined
    )
    if (!sourcePortId) continue
    const connected = connectedPortsByNode.get(entry.source) ?? new Set<string>()
    connectedPortsByNode.set(entry.source, connected.add(sourcePortId))
  }

  let changed = false
  const nodes = graph.nodes.map((entry) => {
    if (entry.data.kind !== 'agent') return entry
    const ports = entry.data.config.outputPorts ?? []
    if (ports.length <= AGENT_MIN_OUTPUT_PORTS) return entry
    const connected = connectedPortsByNode.get(entry.id) ?? new Set<string>()
    const kept = ports.filter((port) => connected.has(port.id))
    if (kept.length === ports.length) return entry
    // Keep connected ports plus the earliest unconnected ones needed to reach
    // the minimum, preserving the original pin order.
    const minimum = Math.max(AGENT_MIN_OUTPUT_PORTS, kept.length)
    let included = 0
    const nextPorts = ports.filter((port) => {
      if (connected.has(port.id)) {
        included += 1
        return true
      }
      if (included < minimum) {
        included += 1
        return true
      }
      return false
    })
    changed = true
    const fallbackOutputPortId = nextPorts.some((port) => (
      port.id === entry.data.config.fallbackOutputPortId
    ))
      ? entry.data.config.fallbackOutputPortId
      : nextPorts[0]?.id
    return {
      ...entry,
      data: {
        ...entry.data,
        config: {
          ...entry.data.config,
          outputPorts: nextPorts,
          fallbackOutputPortId,
        },
      },
    }
  })
  return changed ? { ...graph, nodes } : graph
}

export function replaceRouteGraphNode(
  graph: RouteGraph,
  nextNode: RouteGraphNode,
): RouteGraph {
  if (nextNode.data.kind === 'distribution') {
    const outputCount = Math.max(
      ROUTE_GRAPH_DISTRIBUTION_MIN_OUTPUTS,
      Math.min(
        ROUTE_GRAPH_DISTRIBUTION_MAX_OUTPUTS,
        Math.trunc(
          nextNode.data.config.distributionOutputCount
            ?? ROUTE_GRAPH_DISTRIBUTION_DEFAULT_OUTPUTS,
        ),
      ),
    )
    let retainedOutputs = 0
    return {
      ...graph,
      nodes: graph.nodes.map((entry) => entry.id === nextNode.id
        ? {
            ...nextNode,
            data: {
              ...nextNode.data,
              config: {
                ...nextNode.data.config,
                distributionOutputCount: outputCount,
              },
            },
          }
        : entry),
      edges: graph.edges.filter((entry) => {
        if (entry.source !== nextNode.id) return true
        retainedOutputs += 1
        return retainedOutputs <= outputCount
      }),
    }
  }
  if (nextNode.data.kind !== 'agent') {
    return {
      ...graph,
      nodes: graph.nodes.map((entry) => entry.id === nextNode.id ? nextNode : entry),
    }
  }

  const inputPortIds = new Set(nextNode.data.config.inputPorts?.map((port) => port.id) ?? [])
  const outputPorts = nextNode.data.config.outputPorts ?? []
  const outputPortIds = new Set(outputPorts.map((port) => port.id))
  const fallbackOutputPortId = outputPortIds.has(
    nextNode.data.config.fallbackOutputPortId ?? '',
  )
    ? nextNode.data.config.fallbackOutputPortId
    : outputPorts[0]?.id
  const normalizedNode: RouteGraphNode = {
    ...nextNode,
    data: {
      ...nextNode.data,
      config: {
        ...nextNode.data.config,
        fallbackOutputPortId,
      },
    },
  }

  return {
    ...graph,
    nodes: graph.nodes.map((entry) => entry.id === nextNode.id ? normalizedNode : entry),
    edges: graph.edges.filter((entry) => {
      if (entry.source === nextNode.id) {
        const sourcePortId = entry.data.sourcePortId
          ?? (entry.sourceHandle?.startsWith('output:')
            ? entry.sourceHandle.slice('output:'.length)
            : undefined)
        if (!sourcePortId || !outputPortIds.has(sourcePortId)) return false
      }
      if (entry.target === nextNode.id) {
        const targetPortId = entry.data.targetPortId
          ?? (entry.targetHandle?.startsWith('input:')
            ? entry.targetHandle.slice('input:'.length)
            : undefined)
        if (!targetPortId || !inputPortIds.has(targetPortId)) return false
      }
      return true
    }),
  }
}

function graphForModels(
  refs: ModelRef[],
  mode: 'fallback' | 'distribution' | 'relay',
  distributionMode: RouteDistributionMode = 'reliability',
): RouteGraph {
  if (refs.length === 0) return createEmptyRouteGraph()

  const modelNodes = refs.map((ref, index) => (
    node(`model-${index + 1}`, 'model', 320 + index * 210, 100 + (index % 2) * 180, ref)
  ))
  const outputX = 390 + refs.length * 210
  const nodes = [node('start', 'start', 40, 180), ...modelNodes, node('output', 'output', outputX, 180)]
  const edges: RouteGraphEdge[] = []

  if (mode === 'distribution') {
    const distribution = node('distribution', 'distribution', 200, 180, { distributionMode })
    nodes.splice(1, 0, distribution)
    edges.push(edge('start', 'distribution'))
    for (const modelNode of modelNodes) {
      edges.push(edge('distribution', modelNode.id))
      edges.push(edge(modelNode.id, 'output', 'success'))
    }
    return { version: 1, nodes, edges }
  }

  if (mode === 'relay') {
    const relay = node('relay', 'relay', 190, 180, { sessionSticky: true })
    nodes.splice(1, 0, relay)
    edges.push(edge('start', 'relay'), edge('relay', modelNodes[0]!.id))
  } else {
    edges.push(edge('start', modelNodes[0]!.id))
  }

  modelNodes.forEach((modelNode, index) => {
    edges.push(edge(modelNode.id, 'output', 'success'))
    const next = modelNodes[index + 1]
    if (next) edges.push(edge(modelNode.id, next.id, 'failure'))
  })
  return { version: 1, nodes, edges }
}

function distributionModeFor(strategy: RoutingStrategy): RouteDistributionMode {
  if (strategy === 'round-robin' || strategy === 'least-used') return 'round-robin'
  if (strategy === 'weighted') return 'weighted'
  if (strategy === 'cost-optimized') return 'cost'
  if (strategy === 'p2c' || strategy === 'random' || strategy === 'strict-random') return 'latency'
  return 'reliability'
}

export function legacyRouteToGraph(
  profile: RouteProfile,
  sources: RoutingSource[] = [],
): RouteGraph {
  if (profile.draftGraph) {
    return cloneRouteGraph({
      ...profile.draftGraph,
      edges: dedupeRouteGraphEdges(profile.draftGraph.edges),
    })
  }
  if (profile.graph) {
    return cloneRouteGraph({
      ...profile.graph,
      edges: dedupeRouteGraphEdges(profile.graph.edges),
    })
  }

  const refs = profile.targets.length > 0
    ? profile.targets.map((target) => {
        const source = sources.find((entry) => entry.providerId === target.providerId)
        return {
          providerId: target.providerId,
          modelId: target.modelId ?? source?.models[0]?.id,
        }
      })
    : sourceModels(sources)

  if (profile.strategy === 'context-relay') return graphForModels(refs, 'relay')
  if (profile.strategy === 'priority' || profile.strategy === 'fill-first') {
    return graphForModels(refs, 'fallback')
  }
  return graphForModels(refs, 'distribution', distributionModeFor(profile.strategy))
}

export function routeGraphToLegacyFields(graph: RouteGraph): {
  strategy: RoutingStrategy
  targets: RouteTarget[]
  maxAttempts: number
} {
  const modelNodeIds = new Set(
    graph.nodes.filter((entry) => entry.data.kind === 'model').map((entry) => entry.id),
  )
  const nodeById = new Map(graph.nodes.map((entry) => [entry.id, entry]))
  const outgoing = new Map<string, RouteGraphEdge[]>()
  for (const entry of graph.edges) {
    outgoing.set(entry.source, [...(outgoing.get(entry.source) ?? []), entry])
  }
  const start = graph.nodes.find((entry) => entry.data.kind === 'start')
  const orderedModelIds: string[] = []
  const visited = new Set<string>()
  const pending = start ? [start.id] : []
  while (pending.length > 0) {
    const current = pending.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    if (modelNodeIds.has(current)) orderedModelIds.push(current)
    const nextEdges = [...(outgoing.get(current) ?? [])].sort((left, right) => {
      const priority = { failure: 0, result: 1, success: 2, flow: 3, true: 4, false: 5, choice: 6 }
      return priority[left.data.kind] - priority[right.data.kind]
    })
    pending.push(...nextEdges.map((entry) => entry.target))
  }
  const modelNodes = [
    ...orderedModelIds.flatMap((id) => nodeById.get(id) ?? []),
    ...graph.nodes.filter((entry) => (
      entry.data.kind === 'model' && !visited.has(entry.id)
    )),
  ]
  const distribution = graph.nodes.find((entry) => entry.data.kind === 'distribution')
  const hasRelay = graph.nodes.some((entry) => entry.data.kind === 'relay')
  const hasParallel = graph.nodes.some((entry) => entry.data.kind === 'parallel')
  const mode = distribution?.data.config.distributionMode
  const strategy: RoutingStrategy = hasRelay
    ? 'context-relay'
    : hasParallel
      ? 'p2c'
      : mode === 'round-robin'
        ? 'round-robin'
        : mode === 'weighted' || mode === 'quota'
          ? 'weighted'
          : mode === 'cost'
            ? 'cost-optimized'
            : mode === 'latency'
              ? 'p2c'
              : mode === 'reliability'
                ? 'lkgp'
                : 'priority'

  const targets = modelNodes.flatMap((entry, index) => {
    const providerId = entry.data.config.providerId
    if (!providerId) return []
    return [{
      providerId,
      modelId: entry.data.config.modelId,
      priority: index,
      ...(mode === 'weighted' && entry.data.config.weight
        ? { weight: entry.data.config.weight }
        : {}),
    }]
  })

  return {
    strategy,
    targets,
    maxAttempts: Math.max(1, Math.min(8, targets.length || 1)),
  }
}

function issue(
  code: string,
  severity: RouteGraphIssue['severity'],
  target: Pick<RouteGraphIssue, 'nodeId' | 'edgeId'> = {},
): RouteGraphIssue {
  return {
    code,
    severity,
    messageKey: `settings.routing.graph.validation.${code}`,
    ...target,
  }
}

function reachableFrom(
  startId: string,
  adjacency: Map<string, string[]>,
): Set<string> {
  const seen = new Set<string>()
  const pending = [startId]
  while (pending.length > 0) {
    const current = pending.shift()!
    if (seen.has(current)) continue
    seen.add(current)
    pending.push(...(adjacency.get(current) ?? []))
  }
  return seen
}

function containsCycle(nodeIds: string[], adjacency: Map<string, string[]>): boolean {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const next of adjacency.get(id) ?? []) {
      if (visit(next)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  return nodeIds.some((id) => visit(id))
}

export function validateRouteGraph(
  graph: RouteGraph,
  sources: RoutingSource[] = [],
): RouteGraphValidation {
  const issues: RouteGraphIssue[] = []
  const nodeById = new Map(graph.nodes.map((entry) => [entry.id, entry]))
  const startNodes = graph.nodes.filter((entry) => entry.data.kind === 'start')
  const outputNodes = graph.nodes.filter((entry) => entry.data.kind === 'output')

  if (startNodes.length !== 1) issues.push(issue('singleStart', 'error'))
  if (outputNodes.length !== 1) issues.push(issue('singleOutput', 'error'))

  const validEdges = graph.edges.filter((entry) => {
    const valid = nodeById.has(entry.source) && nodeById.has(entry.target)
    if (!valid) issues.push(issue('brokenEdge', 'error', { edgeId: entry.id }))
    if (entry.source === entry.target) issues.push(issue('selfLoop', 'error', { edgeId: entry.id }))
    return valid && entry.source !== entry.target
  })
  const adjacency = new Map<string, string[]>()
  const reverse = new Map<string, string[]>()
  for (const entry of validEdges) {
    adjacency.set(entry.source, [...(adjacency.get(entry.source) ?? []), entry.target])
    reverse.set(entry.target, [...(reverse.get(entry.target) ?? []), entry.source])
  }

  if (containsCycle(graph.nodes.map((entry) => entry.id), adjacency)) {
    issues.push(issue('cycle', 'error'))
  }

  const start = startNodes[0]
  const output = outputNodes[0]
  if (start && output) {
    const fromStart = reachableFrom(start.id, adjacency)
    const toOutput = reachableFrom(output.id, reverse)
    for (const entry of graph.nodes) {
      if (!fromStart.has(entry.id)) issues.push(issue('unreachable', 'error', { nodeId: entry.id }))
      if (!toOutput.has(entry.id)) issues.push(issue('noOutputPath', 'error', { nodeId: entry.id }))
    }
  }

  const hasModel = graph.nodes.some((entry) => entry.data.kind === 'model')
  if (!hasModel) issues.push(issue('modelRequired', 'error'))

  for (const entry of graph.nodes) {
    const outgoing = validEdges.filter((candidate) => candidate.source === entry.id)
    const incoming = validEdges.filter((candidate) => candidate.target === entry.id)
    if (entry.data.kind === 'model') {
      const { providerId, modelId } = entry.data.config
      if (!providerId || !modelId) {
        issues.push(issue('modelIncomplete', 'error', { nodeId: entry.id }))
      } else {
        const source = sources.find((candidate) => candidate.providerId === providerId)
        if (!source) {
          issues.push(issue('sourceUnknown', 'warning', { nodeId: entry.id }))
        } else if (!source.configured && source.auth !== 'none' && source.auth !== 'local') {
          issues.push(issue('credentialMissing', 'error', { nodeId: entry.id }))
        } else if (!source.models.some((model) => model.id === modelId)) {
          issues.push(issue('modelUnknown', 'warning', { nodeId: entry.id }))
        }
      }
      const modelEdgeKinds = outgoing.map((candidate) => candidate.data.kind)
      if (
        modelEdgeKinds.some((kind) => !['success', 'failure', 'result'].includes(kind)) ||
        new Set(modelEdgeKinds).size !== modelEdgeKinds.length
      ) {
        issues.push(issue('modelEdges', 'error', { nodeId: entry.id }))
      }
    }
    if (entry.data.kind === 'condition') {
      const kinds = new Set(outgoing.map((candidate) => candidate.data.kind))
      if (!kinds.has('true') || !kinds.has('false') || outgoing.length !== 2) {
        issues.push(issue('conditionBranches', 'error', { nodeId: entry.id }))
      }
    }
    if (entry.data.kind === 'agent') {
      const inputPorts = entry.data.config.inputPorts ?? []
      const outputPorts = entry.data.config.outputPorts ?? []
      const choiceEdges = outgoing.filter((candidate) => candidate.data.kind === 'choice')
      const inputPortIds = new Set(inputPorts.map((port) => port.id))
      const outputPortIds = new Set(outputPorts.map((port) => port.id))
      const inputNames = inputPorts.map((port) => port.label.trim().toLowerCase())
      const outputNames = outputPorts.map((port) => port.label.trim().toLowerCase())
      if (graph.version !== 3) issues.push(issue('agentVersion', 'error', { nodeId: entry.id }))
      if (
        inputPorts.length < 1 ||
        inputPorts.length > 6 ||
        inputPortIds.size !== inputPorts.length ||
        inputPorts.some((port) => !port.id.trim())
      ) issues.push(issue('agentInputPorts', 'error', { nodeId: entry.id }))
      if (
        outputPorts.length < 2 ||
        outputPorts.length > 6 ||
        outputPortIds.size !== outputPorts.length ||
        outputPorts.some((port) => !port.id.trim())
      ) issues.push(issue('agentOutputPorts', 'error', { nodeId: entry.id }))
      if (
        [...inputPorts, ...outputPorts].some((port) => !AGENT_PORT_ID_PATTERN.test(port.id))
      ) issues.push(issue('agentPortIds', 'error', { nodeId: entry.id }))
      if (
        inputNames.some((name) => !name) ||
        outputNames.some((name) => !name) ||
        new Set(inputNames).size !== inputNames.length ||
        new Set(outputNames).size !== outputNames.length
      ) issues.push(issue('agentPortNames', 'error', { nodeId: entry.id }))
      if (!entry.data.config.instructions?.trim()) {
        issues.push(issue('agentInstructions', 'error', { nodeId: entry.id }))
      }
      if (
        !entry.data.config.fallbackOutputPortId ||
        !outputPortIds.has(entry.data.config.fallbackOutputPortId)
      ) {
        issues.push(issue('agentFallback', 'error', { nodeId: entry.id }))
      }
      const incomingPortIds = incoming.map((candidate) => (
        candidate.data.targetPortId ?? (candidate.targetHandle?.startsWith('input:')
          ? candidate.targetHandle.slice('input:'.length)
          : undefined)
      ))
      const outgoingPortIds = outgoing.map((candidate) => (
        candidate.data.sourcePortId ?? candidate.data.branchId ?? (
          candidate.sourceHandle?.startsWith('output:')
            ? candidate.sourceHandle.slice('output:'.length)
            : undefined
        )
      ))
      if (
        incomingPortIds.some((portId) => !portId || !inputPortIds.has(portId)) ||
        outgoingPortIds.some((portId) => !portId || !outputPortIds.has(portId))
      ) issues.push(issue('agentUnknownPort', 'error', { nodeId: entry.id }))
      if (
        inputPorts.some((port) => incomingPortIds.filter((portId) => portId === port.id).length !== 1) ||
        outputPorts.some((port) => outgoingPortIds.filter((portId) => portId === port.id).length !== 1)
      ) {
        issues.push(issue('agentPortConnection', 'error', { nodeId: entry.id }))
      }
      if (choiceEdges.length !== outgoing.length) {
        issues.push(issue('agentChoiceEdges', 'error', { nodeId: entry.id }))
      }
      for (const choiceEdge of choiceEdges) {
        const downstream = reachableFrom(choiceEdge.target, adjacency)
        const reachesModel = [...downstream].some((nodeId) => (
          nodeById.get(nodeId)?.data.kind === 'model'
        ))
        if (!reachesModel) {
          issues.push(issue('agentOutputWithoutModel', 'error', { nodeId: entry.id }))
          break
        }
      }
    }
    if (entry.data.kind === 'distribution') {
      const outputCount = entry.data.config.distributionOutputCount
        ?? ROUTE_GRAPH_DISTRIBUTION_DEFAULT_OUTPUTS
      if (outgoing.length < 2 || outgoing.length !== outputCount) {
        issues.push(issue('distributionBranches', 'error', { nodeId: entry.id }))
      }
    }
    if (entry.data.kind === 'parallel') {
      if (outgoing.length < 2 || outgoing.length > 4) {
        issues.push(issue('parallelBranches', 'error', { nodeId: entry.id }))
      }
      const hasReachableResult = outgoing.every((candidate) => {
        const reachable = reachableFrom(candidate.target, adjacency)
        return graph.nodes.some((nodeEntry) => (
          nodeEntry.data.kind === 'result' && reachable.has(nodeEntry.id)
        ))
      })
      if (outgoing.length > 0 && !hasReachableResult) {
        issues.push(issue('parallelResult', 'error', { nodeId: entry.id }))
      }
    }
    if (entry.data.kind === 'result' && incoming.length < 2) {
      issues.push(issue('resultInputs', 'error', { nodeId: entry.id }))
    }
  }

  for (const entry of validEdges) {
    const source = nodeById.get(entry.source)
    if (entry.data.kind === 'choice' && source?.data.kind !== 'agent') {
      issues.push(issue('choiceSource', 'error', { edgeId: entry.id }))
    }
  }

  const startForAgentLimit = startNodes[0]
  if (startForAgentLimit && !containsCycle(graph.nodes.map((entry) => entry.id), adjacency)) {
    const memo = new Map<string, number>()
    const countAgents = (nodeId: string): number => {
      const cached = memo.get(nodeId)
      if (cached !== undefined) return cached
      const current = nodeById.get(nodeId)
      const own = current?.data.kind === 'agent' ? 1 : 0
      const next = adjacency.get(nodeId) ?? []
      const total = own + (next.length === 0
        ? 0
        : Math.max(...next.map((target) => countAgents(target))))
      memo.set(nodeId, total)
      return total
    }
    if (countAgents(startForAgentLimit.id) > 4) issues.push(issue('agentPathLimit', 'error'))
  }

  const deduped = issues.filter((entry, index) => (
    issues.findIndex((candidate) => (
      candidate.code === entry.code &&
      candidate.nodeId === entry.nodeId &&
      candidate.edgeId === entry.edgeId
    )) === index
  ))
  return {
    valid: !deduped.some((entry) => entry.severity === 'error'),
    issues: deduped,
  }
}

export function autoLayoutRouteGraph(graph: RouteGraph): RouteGraph {
  const adjacency = new Map<string, string[]>()
  const incomingCount = new Map(graph.nodes.map((entry) => [entry.id, 0]))
  for (const entry of graph.edges) {
    adjacency.set(entry.source, [...(adjacency.get(entry.source) ?? []), entry.target])
    incomingCount.set(entry.target, (incomingCount.get(entry.target) ?? 0) + 1)
  }

  const start = graph.nodes.find((entry) => entry.data.kind === 'start')
  const queue: Array<{ id: string; layer: number }> = start ? [{ id: start.id, layer: 0 }] : []
  const layers = new Map<string, number>()
  while (queue.length > 0) {
    const current = queue.shift()!
    if (layers.has(current.id)) continue
    layers.set(current.id, current.layer)
    for (const next of adjacency.get(current.id) ?? []) {
      if (!layers.has(next)) queue.push({ id: next, layer: current.layer + 1 })
    }
  }

  graph.nodes.forEach((entry, index) => {
    if (!layers.has(entry.id)) layers.set(entry.id, index + 1)
  })
  const nodesByLayer = new Map<number, RouteGraphNode[]>()
  for (const entry of graph.nodes) {
    const layer = layers.get(entry.id) ?? 0
    nodesByLayer.set(layer, [...(nodesByLayer.get(layer) ?? []), entry])
  }

  return {
    ...cloneRouteGraph(graph),
    nodes: graph.nodes.map((entry) => {
      const layer = layers.get(entry.id) ?? 0
      const peers = nodesByLayer.get(layer) ?? []
      const index = peers.findIndex((candidate) => candidate.id === entry.id)
      return {
        ...entry,
        position: {
          x: 60 + layer * 230,
          y: 80 + index * 170,
        },
      }
    }),
  }
}

export function createRouteGraphNode(
  kind: RouteGraphNodeKind,
  position: { x: number; y: number },
  existingIds: string[],
  agentPortLabels: { input?: string; outputs?: [string, string] } = {},
): RouteGraphNode {
  let suffix = 1
  let id: string = kind
  const used = new Set(existingIds)
  while (used.has(id)) {
    suffix += 1
    id = `${kind}-${suffix}`
  }
  const config: RouteGraphNodeConfig = kind === 'distribution'
    ? {
        distributionMode: 'round-robin',
        distributionOutputCount: ROUTE_GRAPH_DISTRIBUTION_DEFAULT_OUTPUTS,
      }
    : kind === 'parallel'
      ? { readOnly: true }
      : kind === 'result'
        ? { resultMode: 'first-success', readOnly: true }
        : kind === 'relay'
          ? { sessionSticky: true }
          : kind === 'condition'
            ? { condition: 'task', operator: 'is', value: 'coding' }
            : kind === 'agent'
              ? {
                  inputPorts: DEFAULT_ROUTE_AGENT_INPUT_PORTS.map((port) => ({
                    ...port,
                    label: agentPortLabels.input ?? port.label,
                  })),
                  outputPorts: DEFAULT_ROUTE_AGENT_OUTPUT_PORTS.map((port, index) => ({
                    ...port,
                    label: agentPortLabels.outputs?.[index] ?? port.label,
                  })),
                  instructions: '',
                  fallbackOutputPortId: DEFAULT_ROUTE_AGENT_OUTPUT_PORTS[0].id,
                  confidenceThreshold: 0.6,
                  timeoutMs: 8_000,
                  maxInputChars: 4_000,
                }
              : {}
  return node(id, kind, position.x, position.y, config)
}

export function createRouteGraphEdge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
  existingIds: string[] = [],
): RouteGraphEdge {
  const { kind, sourcePortId, targetPortId } = routeGraphEdgeDetails(
    sourceHandle,
    targetHandle,
  )
  const base = [source, sourcePortId ?? kind, target, targetPortId]
    .filter(Boolean)
    .join('-')
  let id = base
  let suffix = 2
  const used = new Set(existingIds)
  while (used.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return {
    ...edge(
      source,
      target,
      kind,
      sourceHandle ?? kind,
      targetHandle ?? 'input',
      sourcePortId,
      targetPortId,
    ),
    id,
  }
}
