import type {
  RouteAgentPort,
  RouteConditionKind,
  RouteConditionOperator,
  RouteGraph,
  RouteGraphEdge,
  RouteGraphEdgeKind,
  RouteGraphIssue,
  RouteGraphNode,
  RouteGraphNodeConfig,
  RouteGraphNodeKind,
  RoutePreviewResult,
  RouteProfile,
  RoutingConfig,
  RoutingDashboard,
} from '../types/routing'

type WireConditionField =
  | 'task'
  | 'modality'
  | 'context-tokens'
  | 'cost'
  | 'health'
  | 'quota'

type WireConditionOperator =
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'known'
  | 'unknown'

type WireRouteGraphNode = {
  [key: string]: unknown
  id: string
  type: RouteGraphNodeKind
  position: { x: number; y: number }
  label?: string
  config: Record<string, unknown>
}

type WireRouteGraphEdge = {
  [key: string]: unknown
  id: string
  source: string
  target: string
  kind: Exclude<RouteGraphEdgeKind, 'success'>
  order?: number
  weight?: number
  label?: string
  sourcePortId?: string
  targetPortId?: string
  /** @deprecated V2 routing-agent compatibility only. */
  branchId?: string
}

export type WireRouteGraph = {
  [key: string]: unknown
  version: 1 | 2 | 3
  source?: 'legacy' | 'template' | 'user'
  legacyFingerprint?: string
  nodes: WireRouteGraphNode[]
  edges: WireRouteGraphEdge[]
  viewport?: { x: number; y: number; zoom: number }
}

type WireRouteProfile = Omit<RouteProfile, 'graph' | 'draftGraph' | 'previousGraph'> & {
  graph?: WireRouteGraph
  draftGraph?: WireRouteGraph
  previousGraph?: WireRouteGraph
}

export type WireRoutingConfig = Omit<RoutingConfig, 'profiles'> & {
  profiles: WireRouteProfile[]
}

export type WireRoutingDashboard = Omit<RoutingDashboard, 'config'> & {
  config: WireRoutingConfig
}

export type WireRoutePreviewTrace = {
  valid: boolean
  validation: {
    valid: boolean
    issues: RouteGraphIssue[]
  }
  path: string[]
  steps: Array<{
    order: number
    nodeId: string
    nodeType: RouteGraphNodeKind
    status: 'visited' | 'selected' | 'skipped'
    detail: string
    edgeId?: string
  }>
  branches: Array<{
    nodeId: string
    selectedEdgeIds: string[]
    explanation: string
  }>
  estimatedModelAttempts: number
  warnings: string[]
}

const FIELD_TO_WIRE: Record<RouteConditionKind, WireConditionField> = {
  task: 'task',
  modality: 'modality',
  context: 'context-tokens',
  cost: 'cost',
  health: 'health',
  quota: 'quota',
}

const FIELD_FROM_WIRE: Record<WireConditionField, RouteConditionKind> = {
  task: 'task',
  modality: 'modality',
  'context-tokens': 'context',
  cost: 'cost',
  health: 'health',
  quota: 'quota',
}

const WIRE_CONDITION_OPERATORS = new Set<WireConditionOperator>([
  'equals',
  'not-equals',
  'contains',
  'lt',
  'lte',
  'gt',
  'gte',
  'known',
  'unknown',
])

const WIRE_EXTRAS = Symbol('routingWireExtras')
const ORIGINAL_MODEL_WEIGHT = Symbol('routingOriginalModelWeight')

type InternalWireCarrier = {
  [WIRE_EXTRAS]?: Record<string, unknown>
  [ORIGINAL_MODEL_WEIGHT]?: number
}

function recordWithout(
  input: Record<string, unknown>,
  knownKeys: readonly string[],
): Record<string, unknown> {
  const known = new Set(knownKeys)
  return Object.fromEntries(Object.entries(input).filter(([key]) => !known.has(key)))
}

function withWireExtras<T extends object>(
  value: T,
  input: Record<string, unknown>,
  knownKeys: readonly string[],
): T {
  const extras = recordWithout(input, knownKeys)
  if (Object.keys(extras).length === 0) return value
  return Object.assign(value, { [WIRE_EXTRAS]: extras })
}

function passThroughFields(
  value: object,
  knownKeys: readonly string[],
): Record<string, unknown> {
  const carrier = value as InternalWireCarrier
  return {
    ...(carrier[WIRE_EXTRAS] ?? {}),
    ...recordWithout(value as Record<string, unknown>, knownKeys),
  }
}

function serializeConditionOperator(
  condition: RouteConditionKind,
  operator: RouteConditionOperator,
): WireConditionOperator {
  if (operator === 'is') return condition === 'modality' ? 'contains' : 'equals'
  if (operator === 'is-not') return 'not-equals'
  return operator
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  )
}

function deserializeAgentPorts(value: unknown): RouteAgentPort[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const port = entry as Record<string, unknown>
    if (typeof port.id !== 'string' || typeof port.label !== 'string') return []
    return [{
      id: port.id,
      label: port.label,
      description: typeof port.description === 'string' ? port.description : '',
    }]
  })
}

function serializeNodeConfig(
  kind: RouteGraphNodeKind,
  config: RouteGraphNodeConfig,
): Record<string, unknown> {
  if (kind === 'model') {
    return compactRecord({
      ...passThroughFields(config, [
        'providerId',
        'modelId',
        'weight',
        'timeoutMs',
        'maxAttempts',
        'budgetUsd',
      ]),
      providerId: config.providerId,
      modelId: config.modelId,
      timeoutMs: config.timeoutMs,
      maxAttempts: config.maxAttempts,
      budgetUsd: config.budgetUsd,
    })
  }
  if (kind === 'agent') {
    return compactRecord({
      ...passThroughFields(config, [
        'providerId',
        'modelId',
        'inputPorts',
        'outputPorts',
        'instructions',
        'fallbackOutputPortId',
        'branches',
        'fallbackBranchId',
        'confidenceThreshold',
        'timeoutMs',
        'maxInputChars',
        'prompt',
      ]),
      providerId: config.providerId,
      modelId: config.modelId,
      inputPorts: config.inputPorts?.map((port) => ({ ...port })),
      outputPorts: config.outputPorts?.map((port) => ({ ...port })),
      instructions: config.instructions,
      fallbackOutputPortId: config.fallbackOutputPortId,
      branches: config.branches?.map((branch) => ({ ...branch })),
      fallbackBranchId: config.fallbackBranchId,
      confidenceThreshold: config.confidenceThreshold,
      timeoutMs: config.timeoutMs,
      maxInputChars: config.maxInputChars,
      prompt: config.prompt,
    })
  }
  if (kind === 'condition') {
    const condition = config.condition ?? 'task'
    return compactRecord({
      ...passThroughFields(config, ['condition', 'field', 'operator', 'value', 'onUnknown']),
      field: FIELD_TO_WIRE[condition],
      operator: serializeConditionOperator(condition, config.operator ?? 'is'),
      value: config.value,
      onUnknown: config.onUnknown,
    })
  }
  if (kind === 'distribution') {
    return compactRecord({
      ...passThroughFields(config, [
        'distributionMode',
        'distributionOutputCount',
        'mode',
        'outputCount',
      ]),
      mode: config.distributionMode,
      outputCount: config.distributionOutputCount,
    })
  }
  if (kind === 'parallel') {
    return compactRecord({
      ...passThroughFields(config, ['readOnly', 'maxConcurrency']),
      maxConcurrency: config.maxConcurrency,
    })
  }
  if (kind === 'result') {
    return compactRecord({
      ...passThroughFields(config, [
        'resultMode',
        'mode',
        'judgeProviderId',
        'judgeModelId',
        'judgePrompt',
        'readOnly',
      ]),
      mode: config.resultMode === 'first-success'
        ? 'fastest'
        : config.resultMode,
      judgeProviderId: config.judgeProviderId,
      judgeModelId: config.judgeModelId,
      judgePrompt: config.judgePrompt,
    })
  }
  if (kind === 'relay') {
    return compactRecord({
      ...passThroughFields(config, ['sessionSticky', 'mode', 'summaryMaxChars']),
      mode: config.sessionSticky === undefined
        ? undefined
        : config.sessionSticky ? 'sticky' : 'summary',
      summaryMaxChars: config.summaryMaxChars,
    })
  }
  return compactRecord(passThroughFields(config, []))
}

function deserializeNodeConfig(
  kind: RouteGraphNodeKind,
  config: Record<string, unknown>,
): RouteGraphNodeConfig {
  if (kind === 'model') {
    return withWireExtras(compactRecord({
      providerId: typeof config.providerId === 'string' ? config.providerId : undefined,
      modelId: typeof config.modelId === 'string' ? config.modelId : undefined,
      timeoutMs: typeof config.timeoutMs === 'number' ? config.timeoutMs : undefined,
      maxAttempts: typeof config.maxAttempts === 'number' ? config.maxAttempts : undefined,
      budgetUsd: typeof config.budgetUsd === 'number' ? config.budgetUsd : undefined,
    }) as RouteGraphNodeConfig, config, [
      'providerId',
      'modelId',
      'timeoutMs',
      'maxAttempts',
      'budgetUsd',
    ])
  }
  if (kind === 'agent') {
    const inputPorts = deserializeAgentPorts(config.inputPorts)
    const outputPorts = deserializeAgentPorts(config.outputPorts)
    const branches = deserializeAgentPorts(config.branches)
    return withWireExtras(compactRecord({
      providerId: typeof config.providerId === 'string' ? config.providerId : undefined,
      modelId: typeof config.modelId === 'string' ? config.modelId : undefined,
      ...(inputPorts.length > 0 ? { inputPorts } : {}),
      ...(outputPorts.length > 0 ? { outputPorts } : {}),
      instructions: typeof config.instructions === 'string' ? config.instructions : undefined,
      fallbackOutputPortId: typeof config.fallbackOutputPortId === 'string'
        ? config.fallbackOutputPortId
        : undefined,
      ...(branches.length > 0 ? { branches } : {}),
      fallbackBranchId: typeof config.fallbackBranchId === 'string'
        ? config.fallbackBranchId
        : undefined,
      confidenceThreshold: typeof config.confidenceThreshold === 'number'
        ? config.confidenceThreshold
        : 0.6,
      timeoutMs: typeof config.timeoutMs === 'number' ? config.timeoutMs : 8_000,
      maxInputChars: typeof config.maxInputChars === 'number' ? config.maxInputChars : 4_000,
      prompt: typeof config.prompt === 'string' ? config.prompt : undefined,
    }) as RouteGraphNodeConfig, config, [
      'providerId',
      'modelId',
      'inputPorts',
      'outputPorts',
      'instructions',
      'fallbackOutputPortId',
      'branches',
      'fallbackBranchId',
      'confidenceThreshold',
      'timeoutMs',
      'maxInputChars',
      'prompt',
    ])
  }
  if (kind === 'condition') {
    const field = typeof config.field === 'string' && config.field in FIELD_FROM_WIRE
      ? FIELD_FROM_WIRE[config.field as WireConditionField]
      : 'task'
    const operator = typeof config.operator === 'string' && WIRE_CONDITION_OPERATORS.has(
      config.operator as WireConditionOperator,
    )
      ? config.operator as WireConditionOperator
      : 'is'
    return withWireExtras(compactRecord({
      condition: field,
      operator,
      value: config.value,
      onUnknown: config.onUnknown === 'true' || config.onUnknown === 'false'
        ? config.onUnknown
        : undefined,
    }) as RouteGraphNodeConfig, config, ['field', 'operator', 'value', 'onUnknown'])
  }
  if (kind === 'distribution') {
    return withWireExtras({
      distributionMode: typeof config.mode === 'string'
        ? config.mode as RouteGraphNodeConfig['distributionMode']
        : 'round-robin',
      distributionOutputCount: typeof config.outputCount === 'number'
        ? config.outputCount
        : undefined,
    }, config, ['mode', 'outputCount'])
  }
  if (kind === 'parallel') {
    return withWireExtras({
      readOnly: true,
      maxConcurrency: typeof config.maxConcurrency === 'number' ? config.maxConcurrency : 4,
    }, config, ['maxConcurrency'])
  }
  if (kind === 'result') {
    return withWireExtras(compactRecord({
      resultMode: config.mode === 'fastest' ? 'first-success' : config.mode,
      judgeProviderId: config.judgeProviderId,
      judgeModelId: config.judgeModelId,
      judgePrompt: config.judgePrompt,
      readOnly: true,
    }) as RouteGraphNodeConfig, config, [
      'mode',
      'judgeProviderId',
      'judgeModelId',
      'judgePrompt',
    ])
  }
  if (kind === 'relay') {
    return withWireExtras(compactRecord({
      sessionSticky: config.mode !== 'summary',
      summaryMaxChars: typeof config.summaryMaxChars === 'number'
        ? config.summaryMaxChars
        : undefined,
    }) as RouteGraphNodeConfig, config, ['mode', 'summaryMaxChars'])
  }
  return withWireExtras({}, config, [])
}

function portIdFromHandle(handle: string | null | undefined, prefix: 'input:' | 'output:'): string | undefined {
  return handle?.startsWith(prefix) ? handle.slice(prefix.length) : undefined
}

function migrateV2AgentGraph(graph: RouteGraph): RouteGraph {
  const agentNodeIds = new Set(
    graph.nodes.filter((entry) => entry.data.kind === 'agent').map((entry) => entry.id),
  )
  const hasLegacyAgentShape = graph.nodes.some((entry) => (
    entry.data.kind === 'agent' && (
      !entry.data.config.inputPorts ||
      !entry.data.config.outputPorts ||
      Boolean(entry.data.config.branches) ||
      entry.data.config.fallbackBranchId !== undefined ||
      entry.data.config.prompt !== undefined
    )
  ))
  if (graph.version !== 2 && !hasLegacyAgentShape) return graph

  const nodes = graph.nodes.map((entry) => {
    if (entry.data.kind !== 'agent') return entry
    const config = entry.data.config
    const outputPorts = config.outputPorts?.map((port) => ({ ...port }))
      ?? config.branches?.map((branch) => ({ ...branch }))
      ?? []
    const inputPorts = config.inputPorts?.map((port) => ({ ...port }))
      ?? [{ id: 'input', label: 'Input 1', description: '' }]
    const {
      branches: _branches,
      fallbackBranchId: _fallbackBranchId,
      prompt: _prompt,
      ...rest
    } = config
    return {
      ...entry,
      data: {
        ...entry.data,
        config: {
          ...rest,
          inputPorts,
          outputPorts,
          instructions: config.instructions ?? config.prompt ?? '',
          fallbackOutputPortId: config.fallbackOutputPortId
            ?? config.fallbackBranchId
            ?? outputPorts[0]?.id,
        },
      },
    }
  })
  const defaultInputPortByAgentId = new Map(nodes.flatMap((entry) => (
    entry.data.kind === 'agent' && entry.data.config.inputPorts?.[0]?.id
      ? [[entry.id, entry.data.config.inputPorts[0].id] as const]
      : []
  )))
  const edges = graph.edges.map((entry) => {
    const sourceIsAgent = agentNodeIds.has(entry.source)
    const targetIsAgent = agentNodeIds.has(entry.target)
    const sourcePortId = entry.data.sourcePortId
      ?? entry.data.branchId
      ?? portIdFromHandle(entry.sourceHandle, 'output:')
      ?? (entry.sourceHandle?.startsWith('choice:')
        ? entry.sourceHandle.slice('choice:'.length)
        : undefined)
    const targetPortId = entry.data.targetPortId
      ?? portIdFromHandle(entry.targetHandle, 'input:')
      ?? (targetIsAgent ? defaultInputPortByAgentId.get(entry.target) : undefined)
    const { branchId: _branchId, ...edgeData } = entry.data
    return {
      ...entry,
      sourceHandle: sourceIsAgent && sourcePortId
        ? `output:${sourcePortId}`
        : entry.sourceHandle,
      targetHandle: targetIsAgent && targetPortId
        ? `input:${targetPortId}`
        : entry.targetHandle,
      data: {
        ...edgeData,
        ...(sourceIsAgent ? { kind: 'choice' as const } : {}),
        ...(sourcePortId ? { sourcePortId } : {}),
        ...(targetPortId ? { targetPortId } : {}),
      },
    }
  })

  return { ...graph, version: 3, nodes, edges }
}

type AgentPortIndex = {
  inputIds: Set<string>
  outputIds: Set<string>
  defaultInputId?: string
}

function normalizeAgentPortReferences(graph: RouteGraph): RouteGraph {
  const nodes = graph.nodes.map((entry) => {
    if (entry.data.kind !== 'agent') return entry
    const outputPorts = entry.data.config.outputPorts ?? []
    const outputIds = new Set(outputPorts.map((port) => port.id))
    const currentFallback = entry.data.config.fallbackOutputPortId
    const fallbackOutputPortId = currentFallback && outputIds.has(currentFallback)
      ? currentFallback
      : outputPorts[0]?.id
    if (fallbackOutputPortId === currentFallback) return entry
    const { fallbackOutputPortId: _fallbackOutputPortId, ...config } = entry.data.config
    return {
      ...entry,
      data: {
        ...entry.data,
        config: {
          ...config,
          ...(fallbackOutputPortId ? { fallbackOutputPortId } : {}),
        },
      },
    }
  })
  const portsByAgentId = new Map<string, AgentPortIndex>(nodes.flatMap((entry) => {
    if (entry.data.kind !== 'agent') return []
    const inputPorts = entry.data.config.inputPorts ?? []
    const outputPorts = entry.data.config.outputPorts ?? []
    return [[entry.id, {
      inputIds: new Set(inputPorts.map((port) => port.id)),
      outputIds: new Set(outputPorts.map((port) => port.id)),
      defaultInputId: inputPorts[0]?.id,
    }] as const]
  }))
  const edges = graph.edges.flatMap((entry) => {
    const sourcePorts = portsByAgentId.get(entry.source)
    const targetPorts = portsByAgentId.get(entry.target)
    const sourcePortId = sourcePorts
      ? entry.data.sourcePortId
        ?? entry.data.branchId
        ?? portIdFromHandle(entry.sourceHandle, 'output:')
      : undefined
    const targetPortId = targetPorts
      ? entry.data.targetPortId
        ?? portIdFromHandle(entry.targetHandle, 'input:')
        ?? targetPorts.defaultInputId
      : undefined

    if (sourcePorts && (!sourcePortId || !sourcePorts.outputIds.has(sourcePortId))) return []
    if (targetPorts && (!targetPortId || !targetPorts.inputIds.has(targetPortId))) return []
    if (!sourcePorts && !targetPorts) return [entry]

    const { branchId: _branchId, ...edgeData } = entry.data
    return [{
      ...entry,
      ...(sourcePorts ? { sourceHandle: `output:${sourcePortId}` } : {}),
      ...(targetPorts ? { targetHandle: `input:${targetPortId}` } : {}),
      data: {
        ...edgeData,
        ...(sourcePorts ? { kind: 'choice' as const, sourcePortId } : {}),
        ...(targetPorts ? { targetPortId } : {}),
      },
    }]
  })

  return { ...graph, nodes, edges }
}

export function serializeRouteGraph(graph: RouteGraph): WireRouteGraph {
  const normalizedGraph = normalizeAgentPortReferences(migrateV2AgentGraph(graph))
  const nodeById = new Map(normalizedGraph.nodes.map((node) => [node.id, node]))
  return {
    ...passThroughFields(normalizedGraph, [
      'version',
      'source',
      'legacyFingerprint',
      'nodes',
      'edges',
      'viewport',
    ]),
    version: normalizedGraph.version,
    ...(normalizedGraph.source ? { source: normalizedGraph.source } : {}),
    ...(normalizedGraph.legacyFingerprint ? { legacyFingerprint: normalizedGraph.legacyFingerprint } : {}),
    nodes: normalizedGraph.nodes.map((node) => {
      return {
        ...passThroughFields(node, ['id', 'type', 'position', 'data']),
        id: node.id,
        type: node.data.kind,
        position: { ...node.position },
        ...(node.data.label?.trim() ? { label: node.data.label.trim() } : {}),
        config: serializeNodeConfig(node.data.kind, node.data.config),
      }
    }),
    edges: normalizedGraph.edges.map((edge) => {
      const targetNode = nodeById.get(edge.target)
      const wireKind = edge.data.kind === 'success' || (
        edge.data.kind === 'result' && targetNode?.data.kind === 'result'
      )
        ? 'flow'
        : edge.data.kind
      const configuredWeight = targetNode?.data.kind === 'model'
        ? targetNode.data.config.weight
        : undefined
      const originalWeight = targetNode?.data.kind === 'model'
        ? (targetNode.data.config as InternalWireCarrier)[ORIGINAL_MODEL_WEIGHT]
        : undefined
      const weight = edge.weight !== undefined && configuredWeight === originalWeight
        ? edge.weight
        : configuredWeight ?? edge.weight
      const sourcePortId = edge.data.sourcePortId
        ?? portIdFromHandle(edge.sourceHandle, 'output:')
      const targetPortId = edge.data.targetPortId
        ?? portIdFromHandle(edge.targetHandle, 'input:')
      return compactRecord({
        ...passThroughFields(edge, [
          'id',
          'source',
          'target',
          'sourceHandle',
          'targetHandle',
          'type',
          'data',
          'order',
          'weight',
          'label',
          'sourcePortId',
          'targetPortId',
          'branchId',
        ]),
        id: edge.id,
        source: edge.source,
        target: edge.target,
        kind: wireKind,
        order: edge.order,
        weight,
        label: edge.label,
        sourcePortId,
        targetPortId,
        ...(normalizedGraph.version < 3 ? { branchId: edge.data.branchId } : {}),
      }) as WireRouteGraphEdge
    }),
    ...(normalizedGraph.viewport ? { viewport: { ...normalizedGraph.viewport } } : {}),
  }
}

export function deserializeRouteGraph(graph: WireRouteGraph): RouteGraph {
  const nodeKinds = new Map(graph.nodes.map((node) => [node.id, node.type]))
  const weights = new Map(
    graph.edges.flatMap((edge) => edge.weight === undefined ? [] : [[edge.target, edge.weight] as const]),
  )
  const nodes: RouteGraphNode[] = graph.nodes.map((node) => {
    const config = {
      ...deserializeNodeConfig(node.type, node.config ?? {}),
      ...(weights.has(node.id) ? { weight: weights.get(node.id) } : {}),
    }
    if (weights.has(node.id)) {
      Object.assign(config, { [ORIGINAL_MODEL_WEIGHT]: weights.get(node.id) })
    }
    return withWireExtras({
      id: node.id,
      type: 'routeGraphNode' as const,
      position: { ...node.position },
      data: {
        kind: node.type,
        ...(node.label !== undefined ? { label: node.label } : {}),
        config,
      },
    }, node, ['id', 'type', 'position', 'label', 'config'])
  })
  const edges: RouteGraphEdge[] = graph.edges.map((edge) => {
    const sourceKind = nodeKinds.get(edge.source)
    const targetKind = nodeKinds.get(edge.target)
    const kind = edge.kind === 'flow' && sourceKind === 'model'
      ? targetKind === 'result' ? 'result' : 'success'
      : edge.kind
    return withWireExtras({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.order !== undefined ? { order: edge.order } : {}),
      ...(edge.weight !== undefined ? { weight: edge.weight } : {}),
      ...(edge.label !== undefined ? { label: edge.label } : {}),
      sourceHandle: sourceKind === 'agent' && (edge.sourcePortId || edge.branchId)
        ? `output:${edge.sourcePortId ?? edge.branchId}`
        : kind,
      targetHandle: targetKind === 'agent' && edge.targetPortId
        ? `input:${edge.targetPortId}`
        : 'input',
      type: 'smoothstep',
      data: {
        kind,
        ...(edge.sourcePortId ? { sourcePortId: edge.sourcePortId } : {}),
        ...(edge.targetPortId ? { targetPortId: edge.targetPortId } : {}),
        ...(edge.branchId ? { branchId: edge.branchId } : {}),
      },
    }, edge, [
      'id',
      'source',
      'target',
      'kind',
      'order',
      'weight',
      'label',
      'sourcePortId',
      'targetPortId',
      'branchId',
    ])
  })
  const deserialized = withWireExtras({
    version: graph.version,
    ...(graph.source ? { source: graph.source } : {}),
    ...(graph.legacyFingerprint ? { legacyFingerprint: graph.legacyFingerprint } : {}),
    nodes,
    edges,
    ...(graph.viewport ? { viewport: { ...graph.viewport } } : {}),
  }, graph, [
    'version',
    'source',
    'legacyFingerprint',
    'nodes',
    'edges',
    'viewport',
  ])
  return normalizeAgentPortReferences(migrateV2AgentGraph(deserialized))
}

function serializeProfile(profile: RouteProfile): WireRouteProfile {
  const { graph, draftGraph, previousGraph, ...rest } = profile
  return {
    ...rest,
    ...(graph ? { graph: serializeRouteGraph(graph) } : {}),
    ...(draftGraph ? { draftGraph: serializeRouteGraph(draftGraph) } : {}),
    ...(previousGraph ? { previousGraph: serializeRouteGraph(previousGraph) } : {}),
  }
}

function deserializeProfile(profile: WireRouteProfile): RouteProfile {
  const { graph, draftGraph, previousGraph, ...rest } = profile
  return {
    ...rest,
    ...(graph ? { graph: deserializeRouteGraph(graph) } : {}),
    ...(draftGraph ? { draftGraph: deserializeRouteGraph(draftGraph) } : {}),
    ...(previousGraph ? { previousGraph: deserializeRouteGraph(previousGraph) } : {}),
  }
}

export function serializeRoutingConfig(config: RoutingConfig): WireRoutingConfig {
  return { ...config, profiles: config.profiles.map(serializeProfile) }
}

export function deserializeRoutingConfig(config: WireRoutingConfig): RoutingConfig {
  return { ...config, profiles: config.profiles.map(deserializeProfile) }
}

export function deserializeRoutingDashboard(
  dashboard: WireRoutingDashboard,
): RoutingDashboard {
  return { ...dashboard, config: deserializeRoutingConfig(dashboard.config) }
}

export function deserializeRouteProfile(profile: WireRouteProfile): RouteProfile {
  return deserializeProfile(profile)
}

export function normalizePreviewTrace(trace: WireRoutePreviewTrace): RoutePreviewResult {
  return {
    validation: {
      valid: trace.validation.valid,
      issues: trace.validation.issues.map((issue) => ({
        ...issue,
        messageKey: `settings.routing.graph.validation.${issue.code}`,
      })),
    },
    path: trace.path,
    edgePath: trace.steps.flatMap((step) => step.edgeId ? [step.edgeId] : []),
    nodes: trace.steps.map((step) => ({
      nodeId: step.nodeId,
      status: step.status === 'skipped' ? 'skipped' : 'success',
      detail: step.detail,
    })),
  }
}
