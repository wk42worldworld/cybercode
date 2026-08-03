import type {
  RouteConditionOperator,
  RouteGraph,
  RouteGraphEdge,
  RouteGraphNode,
  RouteGraphPreviewStep,
  RouteGraphPreviewTrace,
  RouteGraphValidationIssue,
  RouteGraphValidationResult,
  RoutePreviewSample,
  RouteProfile,
  RoutingStrategy,
} from './types.js'
import { RouteGraphSchema } from './types.js'
import { isRouteAgentV3Node } from './types.js'

export const ROUTE_GRAPH_LIMITS = {
  nodes: 64,
  edges: 128,
  depth: 24,
  modelAttempts: 8,
  agentsPerPath: 4,
  parallelConcurrency: 4,
} as const

export function routeGraphModelAttemptLimit(graph: RouteGraph): number {
  const configured = routeGraphConfiguredModelAttempts(graph)
  return Math.max(1, Math.min(configured, ROUTE_GRAPH_LIMITS.modelAttempts))
}

export type CompiledRouteGraph = {
  graph: RouteGraph
  startNodeId: string
  outputNodeId: string
  nodeById: Map<string, RouteGraphNode>
  outgoing: Map<string, RouteGraphEdge[]>
  incoming: Map<string, RouteGraphEdge[]>
}

function cloneGraph(graph: RouteGraph): RouteGraph {
  return structuredClone(graph)
}

function edgeOrder(left: RouteGraphEdge, right: RouteGraphEdge): number {
  return (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)
}

function legacyDistributionMode(
  strategy: RoutingStrategy,
): 'round-robin' | 'quota' | 'weighted' | 'cost' | 'latency' | 'reliability' {
  if (strategy === 'round-robin' || strategy === 'context-relay') return 'round-robin'
  if (strategy === 'weighted' || strategy === 'random' || strategy === 'strict-random') {
    return 'weighted'
  }
  if (strategy === 'cost-optimized') return 'cost'
  if (strategy === 'p2c') return 'latency'
  if (strategy === 'least-used' || strategy === 'reset-aware' || strategy === 'reset-window') {
    return 'quota'
  }
  return 'reliability'
}

export function legacyRouteFingerprint(profile: RouteProfile): string {
  return JSON.stringify({
    strategy: profile.strategy,
    strictFree: profile.strictFree,
    allowExperimental: profile.allowExperimental,
    maxAttempts: profile.maxAttempts,
    targets: profile.targets,
  })
}

export function legacyRouteToGraph(profile: RouteProfile): RouteGraph {
  const targets = profile.targets.length > 0 ? profile.targets : [undefined]
  const startId = 'start'
  const distributionId = 'distribution'
  const outputId = 'output'
  const modelNodes: RouteGraphNode[] = targets.map((target, index) => ({
    id: `model-${index + 1}`,
    type: 'model',
    position: { x: 460, y: 100 + index * 180 },
    label: target?.modelId || `Model ${index + 1}`,
    config: {
      ...(target?.providerId && { providerId: target.providerId }),
      ...(target?.modelId && { modelId: target.modelId }),
      timeoutMs: 120_000,
      maxAttempts: target ? 1 : profile.maxAttempts,
    },
  }))
  const nodes: RouteGraphNode[] = [
    {
      id: startId,
      type: 'start',
      position: { x: 40, y: 160 },
      label: 'Start',
      config: {},
    },
    {
      id: distributionId,
      type: 'distribution',
      position: { x: 240, y: 160 },
      label: 'Route strategy',
      config: {
        mode: legacyDistributionMode(profile.strategy),
        legacyStrategy: profile.strategy,
      },
    },
    ...modelNodes,
    {
      id: outputId,
      type: 'output',
      position: { x: 720, y: 160 },
      label: 'Output',
      config: {},
    },
  ]
  const edges: RouteGraphEdge[] = [
    {
      id: 'start-to-distribution',
      source: startId,
      target: distributionId,
      kind: 'flow',
      order: 0,
    },
    ...modelNodes.flatMap((node, index) => {
      const target = profile.targets[index]
      return [
        {
          id: `distribution-to-${node.id}`,
          source: distributionId,
          target: node.id,
          kind: 'flow' as const,
          order: target?.priority ?? index,
          weight: target?.weight ?? 1,
        },
        {
          id: `${node.id}-to-output`,
          source: node.id,
          target: outputId,
          kind: 'flow' as const,
          order: 0,
        },
      ]
    }),
  ]
  return RouteGraphSchema.parse({
    version: 1,
    source: 'legacy',
    legacyFingerprint: legacyRouteFingerprint(profile),
    nodes,
    edges,
  })
}

function issueFromSchema(
  issue: { path: PropertyKey[]; message: string },
  input: unknown,
): RouteGraphValidationIssue {
  const path = issue.path.map(String)
  const nodeIndex = path[0] === 'nodes' ? Number(path[1]) : Number.NaN
  const edgeIndex = path[0] === 'edges' ? Number(path[1]) : Number.NaN
  const graph = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const edges = Array.isArray(graph.edges) ? graph.edges : []
  const node = Number.isInteger(nodeIndex) ? nodes[nodeIndex] : undefined
  const edge = Number.isInteger(edgeIndex) ? edges[edgeIndex] : undefined
  return {
    code: 'schema.invalid',
    message: `${path.join('.') || 'graph'}: ${issue.message}`,
    severity: 'error',
    ...(node && typeof node === 'object' && typeof (node as { id?: unknown }).id === 'string'
      ? { nodeId: (node as { id: string }).id }
      : {}),
    ...(edge && typeof edge === 'object' && typeof (edge as { id?: unknown }).id === 'string'
      ? { edgeId: (edge as { id: string }).id }
      : {}),
  }
}

function pushIssue(
  issues: RouteGraphValidationIssue[],
  code: string,
  message: string,
  reference: { nodeId?: string; edgeId?: string } = {},
  severity: RouteGraphValidationIssue['severity'] = 'error',
): void {
  issues.push({ code, message, severity, ...reference })
}

function collectFirstResults(
  startId: string,
  nodeById: Map<string, RouteGraphNode>,
  outgoing: Map<string, RouteGraphEdge[]>,
): Set<string> {
  const results = new Set<string>()
  const seen = new Set<string>()
  const queue = [startId]
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    if (seen.has(nodeId)) continue
    seen.add(nodeId)
    const node = nodeById.get(nodeId)
    if (node?.type === 'result') {
      results.add(nodeId)
      continue
    }
    for (const edge of outgoing.get(nodeId) ?? []) queue.push(edge.target)
  }
  return results
}

function branchReachesGenerationModel(
  startId: string,
  nodeById: Map<string, RouteGraphNode>,
  outgoing: Map<string, RouteGraphEdge[]>,
): boolean {
  const seen = new Set<string>()
  const queue = [startId]
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    if (seen.has(nodeId)) continue
    seen.add(nodeId)
    if (nodeById.get(nodeId)?.type === 'model') return true
    for (const edge of outgoing.get(nodeId) ?? []) queue.push(edge.target)
  }
  return false
}

function graphIndexes(graph: RouteGraph): {
  nodeById: Map<string, RouteGraphNode>
  outgoing: Map<string, RouteGraphEdge[]>
} {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const outgoing = new Map<string, RouteGraphEdge[]>()
  for (const edge of graph.edges) {
    const edges = outgoing.get(edge.source) ?? []
    edges.push(edge)
    outgoing.set(edge.source, edges)
  }
  return { nodeById, outgoing }
}

function parallelResultIds(
  graph: RouteGraph,
  nodeById: Map<string, RouteGraphNode>,
  outgoing: Map<string, RouteGraphEdge[]>,
): Set<string> {
  const resultIds = new Set<string>()
  for (const node of graph.nodes) {
    if (node.type !== 'parallel') continue
    const branches = outgoing.get(node.id) ?? []
    if (branches.length === 0) continue
    const resultSets = branches.map((edge) => (
      collectFirstResults(edge.target, nodeById, outgoing)
    ))
    for (const resultId of resultSets[0] ?? []) {
      if (resultSets.every((set) => set.has(resultId))) resultIds.add(resultId)
    }
  }
  return resultIds
}

function resultHasDownstreamModel(
  nodeId: string,
  nodeById: Map<string, RouteGraphNode>,
  outgoing: Map<string, RouteGraphEdge[]>,
): boolean {
  const nextId = outgoing.get(nodeId)?.[0]?.target
  return nextId !== undefined && nodeById.get(nextId)?.type === 'model'
}

function routeGraphConfiguredModelAttempts(graph: RouteGraph): number {
  const { nodeById, outgoing } = graphIndexes(graph)
  return graph.nodes.reduce((total, node) => {
    if (node.type === 'model') return total + node.config.maxAttempts
    if (node.type === 'agent') return total + 1
    if (
      node.type === 'result' &&
      node.config.mode === 'judge' &&
      node.config.judgeProviderId &&
      !resultHasDownstreamModel(node.id, nodeById, outgoing)
    ) {
      return total + 1
    }
    return total
  }, 0)
}

export function routeGraphImplicitJudgeAttempts(
  graph: RouteGraph,
  hasTools: boolean,
): number {
  if (!hasTools) return 0
  const { nodeById, outgoing } = graphIndexes(graph)
  const joins = parallelResultIds(graph, nodeById, outgoing)
  return [...joins].filter((resultId) => {
    const node = nodeById.get(resultId)
    return node?.type === 'result' &&
      node.config.mode !== 'judge' &&
      !resultHasDownstreamModel(node.id, nodeById, outgoing)
  }).length
}

function maxGraphDepth(startId: string, outgoing: Map<string, RouteGraphEdge[]>): number {
  const memo = new Map<string, number>()
  const visit = (nodeId: string): number => {
    const known = memo.get(nodeId)
    if (known !== undefined) return known
    const next = outgoing.get(nodeId) ?? []
    const depth = next.length === 0
      ? 1
      : 1 + Math.max(...next.map((edge) => visit(edge.target)))
    memo.set(nodeId, depth)
    return depth
  }
  return visit(startId)
}

export function validateRouteGraph(input: unknown): RouteGraphValidationResult {
  const parsed = RouteGraphSchema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issueFromSchema(issue, input))
    return { valid: false, issues }
  }

  const graph = parsed.data
  const issues: RouteGraphValidationIssue[] = []
  const nodeById = new Map<string, RouteGraphNode>()
  const edgeIds = new Set<string>()
  const edgeConnections = new Set<string>()
  for (const node of graph.nodes) {
    if (nodeById.has(node.id)) {
      pushIssue(issues, 'node.duplicate', `Node id is duplicated: ${node.id}`, { nodeId: node.id })
    } else {
      nodeById.set(node.id, node)
    }
  }

  const outgoing = new Map<string, RouteGraphEdge[]>()
  const incoming = new Map<string, RouteGraphEdge[]>()
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      pushIssue(issues, 'edge.duplicate', `Edge id is duplicated: ${edge.id}`, { edgeId: edge.id })
    }
    edgeIds.add(edge.id)
    const connectionKey = JSON.stringify([
      edge.source,
      edge.target,
      edge.kind,
      edge.kind === 'choice' ? edge.branchId ?? '' : '',
      edge.sourcePortId ?? '',
      edge.targetPortId ?? '',
    ])
    if (edgeConnections.has(connectionKey)) {
      pushIssue(
        issues,
        'edge.connection_duplicate',
        `Connection is duplicated: ${edge.source} -> ${edge.target} (${edge.kind})`,
        { edgeId: edge.id },
      )
    }
    edgeConnections.add(connectionKey)
    if (!nodeById.has(edge.source)) {
      pushIssue(issues, 'edge.source_missing', `Edge source does not exist: ${edge.source}`, {
        edgeId: edge.id,
      })
      continue
    }
    if (!nodeById.has(edge.target)) {
      pushIssue(issues, 'edge.target_missing', `Edge target does not exist: ${edge.target}`, {
        edgeId: edge.id,
      })
      continue
    }
    if (edge.source === edge.target) {
      pushIssue(issues, 'edge.self_loop', 'A node cannot connect to itself', { edgeId: edge.id })
    }
    const sourceEdges = outgoing.get(edge.source) ?? []
    sourceEdges.push(edge)
    outgoing.set(edge.source, sourceEdges)
    const targetEdges = incoming.get(edge.target) ?? []
    targetEdges.push(edge)
    incoming.set(edge.target, targetEdges)
  }
  for (const edges of outgoing.values()) edges.sort(edgeOrder)

  const starts = graph.nodes.filter((node) => node.type === 'start')
  const outputs = graph.nodes.filter((node) => node.type === 'output')
  if (starts.length !== 1) {
    pushIssue(issues, 'graph.start_count', `Graph must contain exactly one start node; found ${starts.length}`)
  }
  if (outputs.length !== 1) {
    pushIssue(issues, 'graph.output_count', `Graph must contain exactly one output node; found ${outputs.length}`)
  }
  if (!graph.nodes.some((node) => node.type === 'model')) {
    pushIssue(issues, 'graph.model_required', 'Graph must contain at least one model node')
  }

  for (const node of graph.nodes) {
    const nodeOutgoing = outgoing.get(node.id) ?? []
    const nodeIncoming = incoming.get(node.id) ?? []
    if (node.type === 'start') {
      if (nodeIncoming.length > 0) {
        pushIssue(issues, 'start.has_input', 'Start cannot have incoming edges', { nodeId: node.id })
      }
      if (nodeOutgoing.length !== 1 || nodeOutgoing[0]?.kind !== 'flow') {
        pushIssue(issues, 'start.invalid_output', 'Start requires exactly one flow edge', {
          nodeId: node.id,
        })
      }
      continue
    }
    if (node.type === 'output') {
      if (nodeIncoming.length === 0) {
        pushIssue(issues, 'output.no_input', 'Output requires at least one incoming edge', {
          nodeId: node.id,
        })
      }
      if (nodeOutgoing.length > 0) {
        pushIssue(issues, 'output.has_output', 'Output cannot have outgoing edges', {
          nodeId: node.id,
        })
      }
      continue
    }
    if (nodeIncoming.length === 0) {
      pushIssue(issues, 'node.no_input', 'Node is not connected from an upstream node', {
        nodeId: node.id,
      })
    }
    if (nodeOutgoing.length === 0) {
      pushIssue(issues, 'node.no_output', 'Node has no outgoing path', { nodeId: node.id })
    }

    if (node.type === 'condition') {
      const trueEdges = nodeOutgoing.filter((edge) => edge.kind === 'true')
      const falseEdges = nodeOutgoing.filter((edge) => edge.kind === 'false')
      if (trueEdges.length !== 1 || falseEdges.length !== 1 || nodeOutgoing.length !== 2) {
        pushIssue(
          issues,
          'condition.branches',
          'Condition requires exactly one true edge and one false edge',
          { nodeId: node.id },
        )
      }
    } else if (node.type === 'agent' && 'inputPorts' in node.config) {
      const inputIds = new Set(node.config.inputPorts.map((port) => port.id))
      const outputIds = new Set(node.config.outputPorts.map((port) => port.id))
      const choiceEdges = nodeOutgoing.filter((edge) => edge.kind === 'choice')
      if (!node.config.instructions.trim()) {
        pushIssue(
          issues,
          'agent.instructions_required',
          'Agent instructions are required before publishing',
          { nodeId: node.id },
        )
      }
      for (const edge of nodeIncoming) {
        if (!edge.targetPortId || !inputIds.has(edge.targetPortId)) {
          pushIssue(
            issues,
            'agent.input_unknown',
            'Agent incoming edge must reference a declared input port',
            { edgeId: edge.id },
          )
        }
      }
      for (const inputPort of node.config.inputPorts) {
        const matches = nodeIncoming.filter((edge) => edge.targetPortId === inputPort.id)
        if (matches.length !== 1) {
          pushIssue(
            issues,
            'agent.input_connection',
            `Agent input ${inputPort.label} requires exactly one incoming edge`,
            { nodeId: node.id },
          )
        }
      }
      for (const edge of choiceEdges) {
        if (!edge.sourcePortId || !outputIds.has(edge.sourcePortId)) {
          pushIssue(
            issues,
            'agent.output_unknown',
            'Agent choice edge must reference a declared output port',
            { edgeId: edge.id },
          )
        }
      }
      for (const outputPort of node.config.outputPorts) {
        const matches = choiceEdges.filter((edge) => edge.sourcePortId === outputPort.id)
        if (matches.length !== 1) {
          pushIssue(
            issues,
            'agent.output_connection',
            `Agent output ${outputPort.label} requires exactly one choice edge`,
            { nodeId: node.id },
          )
        }
        for (const edge of matches) {
          if (branchReachesGenerationModel(edge.target, nodeById, outgoing)) continue
          pushIssue(
            issues,
            'agent.output_without_model',
            `Agent output ${outputPort.label} must reach a generation model`,
            { nodeId: node.id, edgeId: edge.id },
          )
        }
      }
      if (choiceEdges.length !== nodeOutgoing.length) {
        pushIssue(issues, 'agent.edges', 'Agent accepts only choice edges', { nodeId: node.id })
      }
      const fallbackOutputPortId = node.config.fallbackOutputPortId
      if (!choiceEdges.some((edge) => (
        edge.sourcePortId === fallbackOutputPortId
      ))) {
        pushIssue(
          issues,
          'agent.fallback_connection',
          'Agent fallback output must be connected',
          { nodeId: node.id },
        )
      }
    } else if (node.type === 'agent' && 'branches' in node.config) {
      const declared = new Set(node.config.branches.map((branch) => branch.id))
      const choiceEdges = nodeOutgoing.filter((edge) => edge.kind === 'choice')
      for (const edge of choiceEdges) {
        if (!edge.branchId || !declared.has(edge.branchId)) {
          pushIssue(
            issues,
            'agent.branch_unknown',
            'Agent choice edge must reference a declared branch',
            { edgeId: edge.id },
          )
        }
      }
      for (const branch of node.config.branches) {
        const matches = choiceEdges.filter((edge) => edge.branchId === branch.id)
        if (matches.length !== 1) {
          pushIssue(
            issues,
            'agent.branch_connection',
            `Agent branch ${branch.label} requires exactly one choice edge`,
            { nodeId: node.id },
          )
        }
      }
      if (choiceEdges.length !== nodeOutgoing.length) {
        pushIssue(issues, 'agent.edges', 'Agent accepts only choice edges', { nodeId: node.id })
      }
      const fallbackBranchId = node.config.fallbackBranchId
      const fallbackConnected = choiceEdges.some((edge) => (
        edge.branchId === fallbackBranchId
      ))
      if (!fallbackConnected) {
        pushIssue(
          issues,
          'agent.fallback_connection',
          'Agent fallback branch must be connected',
          { nodeId: node.id },
        )
      }
    } else if (node.type === 'distribution') {
      if (
        nodeOutgoing.length === 0
        || nodeOutgoing.some((edge) => edge.kind !== 'flow')
        || (node.config.outputCount !== undefined && nodeOutgoing.length !== node.config.outputCount)
      ) {
        pushIssue(issues, 'distribution.branches', 'Distribution accepts only flow branches', {
          nodeId: node.id,
        })
      }
    } else if (node.type === 'parallel') {
      if (
        nodeOutgoing.length < 2 ||
        nodeOutgoing.length > ROUTE_GRAPH_LIMITS.parallelConcurrency ||
        nodeOutgoing.some((edge) => edge.kind !== 'flow')
      ) {
        pushIssue(issues, 'parallel.branches', 'Parallel requires 2 to 4 flow branches', {
          nodeId: node.id,
        })
      } else {
        const resultSets = nodeOutgoing.map((edge) => (
          collectFirstResults(edge.target, nodeById, outgoing)
        ))
        const shared = [...resultSets[0]!].filter((resultId) => (
          resultSets.every((set) => set.has(resultId))
        ))
        if (shared.length !== 1 || resultSets.some((set) => set.size !== 1)) {
          pushIssue(
            issues,
            'parallel.result_join',
            'Every parallel branch must converge on the same result node',
            { nodeId: node.id },
          )
        }
      }
    } else if (node.type === 'model') {
      const flowEdges = nodeOutgoing.filter((edge) => edge.kind === 'flow')
      const failureEdges = nodeOutgoing.filter((edge) => edge.kind === 'failure')
      const resultEdges = nodeOutgoing.filter((edge) => edge.kind === 'result')
      if (
        flowEdges.length > 1 || failureEdges.length > 1 || resultEdges.length > 1 ||
        nodeOutgoing.some((edge) => !['flow', 'failure', 'result'].includes(edge.kind))
      ) {
        pushIssue(
          issues,
          'model.edges',
          'Model supports at most one flow, failure, and result edge',
          { nodeId: node.id },
        )
      }
      if (flowEdges.length === 0 && resultEdges.length === 0) {
        pushIssue(issues, 'model.no_success_path', 'Model needs a success flow or result edge', {
          nodeId: node.id,
        })
      }
      for (const edge of flowEdges) {
        if (nodeById.get(edge.target)?.type === 'model') {
          pushIssue(
            issues,
            'model.pipeline_edge_required',
            'Model-to-model pipelines must use a result edge',
            { edgeId: edge.id },
          )
        }
      }
      for (const edge of resultEdges) {
        if (nodeById.get(edge.target)?.type !== 'model') {
          pushIssue(
            issues,
            'model.pipeline_target',
            'A model result edge must connect to another model node',
            { edgeId: edge.id },
          )
        }
      }
    } else if (node.type === 'result') {
      if (nodeOutgoing.length !== 1 || nodeOutgoing[0]?.kind !== 'flow') {
        pushIssue(issues, 'result.output', 'Result requires exactly one flow edge', {
          nodeId: node.id,
        })
      }
      if (
        node.config.mode === 'judge' &&
        !node.config.judgeProviderId &&
        nodeById.get(nodeOutgoing[0]?.target ?? '')?.type !== 'model'
      ) {
        pushIssue(
          issues,
          'result.judge_missing',
          'Judge result requires a judge provider or a downstream model node',
          { nodeId: node.id },
        )
      }
    } else if (node.type === 'relay') {
      if (nodeOutgoing.length === 0 || nodeOutgoing.some((edge) => edge.kind !== 'flow')) {
        pushIssue(issues, 'relay.branches', 'Relay accepts only flow branches', {
          nodeId: node.id,
        })
      }
    }
  }

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (edge.kind === 'choice' && source?.type !== 'agent') {
      pushIssue(
        issues,
        'choice.source',
        'Choice edges may only originate from an agent node',
        { edgeId: edge.id },
      )
    }
    if (edge.kind !== 'choice' && edge.branchId !== undefined) {
      pushIssue(
        issues,
        'choice.branch_id',
        'Only choice edges may declare a branch id',
        { edgeId: edge.id },
      )
    }
    if (graph.version < 3 && (edge.sourcePortId !== undefined || edge.targetPortId !== undefined)) {
      pushIssue(
        issues,
        'port.version',
        'Named edge ports require route graph version 3',
        { edgeId: edge.id },
      )
    }
    if (isRouteAgentV3Node(source)) {
      if (edge.kind !== 'choice' || edge.sourcePortId === undefined) {
        pushIssue(
          issues,
          'agent.output_port_required',
          'Version 3 agent edges require a choice output port',
          { edgeId: edge.id },
        )
      }
      if (edge.branchId !== undefined) {
        pushIssue(
          issues,
          'agent.legacy_branch_id',
          'Version 3 agent edges cannot use a legacy branch id',
          { edgeId: edge.id },
        )
      }
    } else if (edge.sourcePortId !== undefined) {
      pushIssue(
        issues,
        'port.source',
        'Only a version 3 agent may declare a source port',
        { edgeId: edge.id },
      )
    }
    if (isRouteAgentV3Node(target)) {
      if (edge.targetPortId === undefined) {
        pushIssue(
          issues,
          'agent.input_port_required',
          'Version 3 agent incoming edges require an input port',
          { edgeId: edge.id },
        )
      }
    } else if (edge.targetPortId !== undefined) {
      pushIssue(
        issues,
        'port.target',
        'Only a version 3 agent may declare a target port',
        { edgeId: edge.id },
      )
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  let hasCycle = false
  const visitForCycle = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      hasCycle = true
      return
    }
    if (visited.has(nodeId)) return
    visiting.add(nodeId)
    for (const edge of outgoing.get(nodeId) ?? []) visitForCycle(edge.target)
    visiting.delete(nodeId)
    visited.add(nodeId)
  }
  for (const node of graph.nodes) visitForCycle(node.id)
  if (hasCycle) pushIssue(issues, 'graph.cycle', 'Graph cannot contain a cycle')

  if (starts.length === 1 && outputs.length === 1) {
    const reachable = new Set<string>()
    const queue = [starts[0]!.id]
    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (reachable.has(nodeId)) continue
      reachable.add(nodeId)
      for (const edge of outgoing.get(nodeId) ?? []) queue.push(edge.target)
    }
    const reachesOutput = new Set<string>()
    const reverseQueue = [outputs[0]!.id]
    while (reverseQueue.length > 0) {
      const nodeId = reverseQueue.shift()!
      if (reachesOutput.has(nodeId)) continue
      reachesOutput.add(nodeId)
      for (const edge of incoming.get(nodeId) ?? []) reverseQueue.push(edge.source)
    }
    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) {
        pushIssue(issues, 'node.unreachable', 'Node is unreachable from start', { nodeId: node.id })
      } else if (!reachesOutput.has(node.id)) {
        pushIssue(issues, 'node.dead_end', 'Node cannot reach output', { nodeId: node.id })
      }
    }
    if (!hasCycle) {
      const depth = maxGraphDepth(starts[0]!.id, outgoing)
      if (depth > ROUTE_GRAPH_LIMITS.depth) {
        pushIssue(
          issues,
          'graph.depth_limit',
          `Graph depth ${depth} exceeds the limit of ${ROUTE_GRAPH_LIMITS.depth}`,
        )
      }
      const countAgents = (nodeId: string, count: number): number => {
        const node = nodeById.get(nodeId)
        const nextCount = count + (node?.type === 'agent' ? 1 : 0)
        const next = outgoing.get(nodeId) ?? []
        return next.length === 0
          ? nextCount
          : Math.max(...next.map((edge) => countAgents(edge.target, nextCount)))
      }
      if (countAgents(starts[0]!.id, 0) > ROUTE_GRAPH_LIMITS.agentsPerPath) {
        pushIssue(
          issues,
          'agent.path_limit',
          `A route path may contain at most ${ROUTE_GRAPH_LIMITS.agentsPerPath} agent nodes`,
        )
      }
    }
  }

  const configuredAttempts = routeGraphConfiguredModelAttempts(graph) +
    routeGraphImplicitJudgeAttempts(graph, true)
  if (configuredAttempts > ROUTE_GRAPH_LIMITS.modelAttempts) {
    pushIssue(
      issues,
      'graph.attempt_limit',
      `Graph can make ${configuredAttempts} model attempts; the limit is ${ROUTE_GRAPH_LIMITS.modelAttempts}`,
      {},
      graph.source === 'legacy' ? 'warning' : 'error',
    )
  }

  return { valid: !issues.some((issue) => issue.severity === 'error'), issues }
}

export function compileRouteGraph(input: unknown): CompiledRouteGraph {
  const validation = validateRouteGraph(input)
  if (!validation.valid) {
    throw new Error(validation.issues.map((issue) => issue.message).join('; '))
  }
  const graph = RouteGraphSchema.parse(input)
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const outgoing = new Map<string, RouteGraphEdge[]>()
  const incoming = new Map<string, RouteGraphEdge[]>()
  for (const edge of graph.edges) {
    const from = outgoing.get(edge.source) ?? []
    from.push(edge)
    outgoing.set(edge.source, from)
    const to = incoming.get(edge.target) ?? []
    to.push(edge)
    incoming.set(edge.target, to)
  }
  for (const edges of outgoing.values()) edges.sort(edgeOrder)
  return {
    graph,
    startNodeId: graph.nodes.find((node) => node.type === 'start')!.id,
    outputNodeId: graph.nodes.find((node) => node.type === 'output')!.id,
    nodeById,
    outgoing,
    incoming,
  }
}

function compareValue(
  actual: unknown,
  operator: RouteConditionOperator,
  expected: unknown,
): boolean {
  if (operator === 'known') return actual !== undefined && actual !== null
  if (operator === 'unknown') return actual === undefined || actual === null
  if (operator === 'contains') {
    if (Array.isArray(actual)) return actual.map(String).includes(String(expected))
    return String(actual ?? '').toLocaleLowerCase().includes(String(expected ?? '').toLocaleLowerCase())
  }
  if (operator === 'equals') return String(actual) === String(expected)
  if (operator === 'not-equals') return String(actual) !== String(expected)
  const left = Number(actual)
  const right = Number(expected)
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false
  if (operator === 'lt') return left < right
  if (operator === 'lte') return left <= right
  if (operator === 'gt') return left > right
  return left >= right
}

export function evaluateRouteCondition(
  node: Extract<RouteGraphNode, { type: 'condition' }>,
  sample: RoutePreviewSample,
): { value: boolean; known: boolean; explanation: string } {
  const actual = node.config.field === 'task'
    ? sample.task
    : node.config.field === 'modality'
      ? sample.modalities
      : node.config.field === 'context-tokens'
        ? sample.contextTokens
        : node.config.field === 'cost'
          ? sample.cost
          : node.config.field === 'health'
            ? sample.health
            : sample.quotaRemaining
  const known = actual !== undefined && actual !== null
  const value = !known && !['known', 'unknown'].includes(node.config.operator)
    ? node.config.onUnknown === 'true'
    : compareValue(actual, node.config.operator, node.config.value)
  const actualLabel = known ? JSON.stringify(actual) : 'unknown'
  return {
    value,
    known,
    explanation: `${node.config.field} is ${actualLabel}; ${value ? 'true' : 'false'} branch selected`,
  }
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function findParallelResultNode(
  compiled: CompiledRouteGraph,
  parallelNodeId: string,
): string | undefined {
  const branches = compiled.outgoing.get(parallelNodeId) ?? []
  if (branches.length === 0) return undefined
  const resultSets = branches.map((edge) => (
    collectFirstResults(edge.target, compiled.nodeById, compiled.outgoing)
  ))
  return [...resultSets[0]!].find((resultId) => resultSets.every((set) => set.has(resultId)))
}

export function previewRouteGraph(
  input: unknown,
  sampleInput: RoutePreviewSample = {},
  profileId?: string,
): RouteGraphPreviewTrace {
  const validation = validateRouteGraph(input)
  if (!validation.valid) {
    return {
      valid: false,
      validation,
      path: [],
      steps: [],
      branches: [],
      estimatedModelAttempts: 0,
      warnings: validation.issues
        .filter((issue) => issue.severity === 'warning')
        .map((issue) => issue.message),
    }
  }
  const compiled = compileRouteGraph(input)
  const sample = sampleInput
  const path: string[] = []
  const steps: RouteGraphPreviewStep[] = []
  const branches: RouteGraphPreviewTrace['branches'] = []
  const visited = new Set<string>()
  const parallelResults = parallelResultIds(
    compiled.graph,
    compiled.nodeById,
    compiled.outgoing,
  )
  let estimatedModelAttempts = 0
  const addStep = (node: RouteGraphNode, detail: string, edgeId?: string): void => {
    if (!visited.has(node.id)) path.push(node.id)
    visited.add(node.id)
    steps.push({
      order: steps.length + 1,
      nodeId: node.id,
      nodeType: node.type,
      status: 'visited',
      detail,
      ...(edgeId && { edgeId }),
    })
    if (node.type === 'model') estimatedModelAttempts += node.config.maxAttempts
    if (
      node.type === 'result' &&
      !resultHasDownstreamModel(node.id, compiled.nodeById, compiled.outgoing) &&
      (
        (node.config.mode === 'judge' && Boolean(node.config.judgeProviderId)) ||
        (node.config.mode !== 'judge' && sample.hasTools === true && parallelResults.has(node.id))
      )
    ) {
      estimatedModelAttempts += 1
    }
  }

  const walk = (nodeId: string, stopAt?: string): void => {
    if (nodeId === stopAt) return
    const node = compiled.nodeById.get(nodeId)
    if (!node) return
    addStep(node, node.label ?? node.type)
    const outgoing = compiled.outgoing.get(nodeId) ?? []
    if (node.type === 'condition') {
      const result = evaluateRouteCondition(node, sample)
      const edge = outgoing.find((candidate) => candidate.kind === String(result.value))
      branches.push({
        nodeId: node.id,
        selectedEdgeIds: edge ? [edge.id] : [],
        explanation: result.explanation,
      })
      if (edge) walk(edge.target, stopAt)
      return
    }
    if (node.type === 'agent') {
      const fallbackId = 'inputPorts' in node.config
        ? node.config.fallbackOutputPortId
        : node.config.fallbackBranchId
      const portAgent = 'inputPorts' in node.config
      const fallback = outgoing.find((edge) => (
        edge.kind === 'choice' && (
          portAgent
            ? edge.sourcePortId === fallbackId
            : edge.branchId === fallbackId
        )
      ))
      branches.push({
        nodeId: node.id,
        selectedEdgeIds: fallback ? [fallback.id] : [],
        explanation: `Static preview follows fallback ${fallbackId}; live execution asks the routing agent`,
      })
      estimatedModelAttempts += 1
      if (fallback) walk(fallback.target, stopAt)
      return
    }
    if (node.type === 'distribution') {
      branches.push({
        nodeId: node.id,
        selectedEdgeIds: outgoing.map((edge) => edge.id),
        explanation: `${node.config.mode} orders ${outgoing.length} fallback branches`,
      })
      if (outgoing[0]) walk(outgoing[0].target, stopAt)
      return
    }
    if (node.type === 'parallel') {
      const resultNodeId = findParallelResultNode(compiled, node.id)
      branches.push({
        nodeId: node.id,
        selectedEdgeIds: outgoing.map((edge) => edge.id),
        explanation: `${outgoing.length} branches run concurrently and join at ${resultNodeId ?? 'an invalid result'}`,
      })
      for (const edge of outgoing) walk(edge.target, resultNodeId)
      if (resultNodeId) walk(resultNodeId, stopAt)
      return
    }
    if (node.type === 'relay') {
      // Mirror the live cursor in routingService so a sticky preview shows the
      // same branch the session would actually take.
      const selectedIndex = node.config.mode === 'sticky' && outgoing.length > 0
        ? stableHash(`${profileId ?? 'preview'}:${sample.sessionId ?? 'preview'}:${node.id}`) % outgoing.length
        : 0
      const edge = outgoing[selectedIndex]
      branches.push({
        nodeId: node.id,
        selectedEdgeIds: edge ? [edge.id] : [],
        explanation: node.config.mode === 'sticky'
          ? `Session-sticky branch ${selectedIndex + 1} selected`
          : 'Summary relay selects the first compatible branch',
      })
      if (edge) walk(edge.target, stopAt)
      return
    }
    if (node.type === 'model') {
      const success = outgoing.find((edge) => edge.kind === 'result') ??
        outgoing.find((edge) => edge.kind === 'flow')
      const failure = outgoing.find((edge) => edge.kind === 'failure')
      if (failure) {
        branches.push({
          nodeId: node.id,
          selectedEdgeIds: [success?.id, failure.id].filter((id): id is string => Boolean(id)),
          explanation: `Success continues on ${success?.kind ?? 'no'} edge; retryable failure uses ${failure.id}`,
        })
      }
      if (success) walk(success.target, stopAt)
      return
    }
    if (outgoing[0]) walk(outgoing[0].target, stopAt)
  }

  walk(compiled.startNodeId)
  const warnings = validation.issues
    .filter((issue) => issue.severity === 'warning')
    .map((issue) => issue.message)
  if (sample.quotaRemaining === undefined && compiled.graph.nodes.some((node) => (
    (node.type === 'condition' && node.config.field === 'quota') ||
    (node.type === 'distribution' && node.config.mode === 'quota')
  ))) {
    warnings.push(
      'Exact provider quota is unknown; conditions use their unknown fallback and distribution uses observed request fairness',
    )
  }
  return {
    valid: true,
    validation,
    path,
    steps,
    branches,
    estimatedModelAttempts: Math.min(estimatedModelAttempts, ROUTE_GRAPH_LIMITS.modelAttempts),
    warnings,
  }
}

export function withLegacyGraph(profile: RouteProfile): RouteProfile {
  if (profile.graph) {
    const legacyFingerprint = (profile.graph as RouteGraph & { legacyFingerprint?: unknown })
      .legacyFingerprint
    if (
      profile.graph.source === 'legacy' &&
      legacyFingerprint !== legacyRouteFingerprint(profile)
    ) {
      const graph = legacyRouteToGraph(profile)
      return { ...profile, graph, draftGraph: cloneGraph(graph), previousGraph: undefined }
    }
    return profile.draftGraph ? profile : { ...profile, draftGraph: cloneGraph(profile.graph) }
  }
  if (profile.draftGraph) return profile
  const graph = legacyRouteToGraph(profile)
  return {
    ...profile,
    graph,
    draftGraph: cloneGraph(graph),
  }
}
