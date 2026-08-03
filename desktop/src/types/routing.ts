export const ROUTING_STRATEGIES = [
  'priority',
  'weighted',
  'round-robin',
  'context-relay',
  'fill-first',
  'p2c',
  'random',
  'least-used',
  'cost-optimized',
  'reset-aware',
  'reset-window',
  'headroom',
  'strict-random',
  'auto',
  'lkgp',
  'context-optimized',
] as const

export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number]
export type SourceCostClass =
  | 'recurring-free'
  | 'signup-credit'
  | 'uncapped'
  | 'mixed'
  | 'paid'
  | 'unknown'
export type SourceAuthClass = 'oauth' | 'api-key' | 'local' | 'none'
export type SourceRiskClass = 'stable' | 'experimental' | 'restricted'

export type RouteTarget = {
  providerId: string
  modelId?: string
  weight?: number
  priority?: number
}

export const ROUTE_GRAPH_NODE_KINDS = [
  'start',
  'model',
  'agent',
  'condition',
  'distribution',
  'parallel',
  'result',
  'relay',
  'output',
] as const

export type RouteGraphNodeKind = (typeof ROUTE_GRAPH_NODE_KINDS)[number]
export type RouteGraphEdgeKind = 'flow' | 'success' | 'failure' | 'result' | 'true' | 'false' | 'choice'
export type RouteConditionKind = 'task' | 'modality' | 'context' | 'cost' | 'health' | 'quota'
export type RouteConditionOperator =
  | 'is'
  | 'is-not'
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'known'
  | 'unknown'
export type RouteDistributionMode = 'round-robin' | 'quota' | 'weighted' | 'cost' | 'latency' | 'reliability'
export type RouteResultMode = 'first-success' | 'collect' | 'judge'
export type RouteAgentPort = {
  id: string
  label: string
  description: string
}

/** @deprecated V2 routing-agent compatibility only. */
export type RouteAgentBranch = RouteAgentPort

export type RouteGraphNodeConfig = {
  providerId?: string
  modelId?: string
  condition?: RouteConditionKind
  operator?: RouteConditionOperator
  value?: string | number | boolean
  onUnknown?: 'true' | 'false'
  distributionMode?: RouteDistributionMode
  distributionOutputCount?: number
  resultMode?: RouteResultMode
  judgeProviderId?: string
  judgeModelId?: string
  judgePrompt?: string
  sessionSticky?: boolean
  summaryMaxChars?: number
  readOnly?: boolean
  weight?: number
  timeoutMs?: number
  maxAttempts?: number
  maxConcurrency?: number
  budgetUsd?: number
  inputPorts?: RouteAgentPort[]
  outputPorts?: RouteAgentPort[]
  instructions?: string
  fallbackOutputPortId?: string
  /** @deprecated V2 routing-agent compatibility only. */
  branches?: RouteAgentBranch[]
  /** @deprecated V2 routing-agent compatibility only. */
  fallbackBranchId?: string
  confidenceThreshold?: number
  maxInputChars?: number
  /** @deprecated V2 routing-agent compatibility only. */
  prompt?: string
}

export type RouteGraphNodeData = {
  [key: string]: unknown
  kind: RouteGraphNodeKind
  label?: string
  config: RouteGraphNodeConfig
}

export type RouteGraphNode = {
  id: string
  type: 'routeGraphNode'
  position: { x: number; y: number }
  data: RouteGraphNodeData
}

export type RouteGraphEdgeData = {
  kind: RouteGraphEdgeKind
  sourcePortId?: string
  targetPortId?: string
  /** @deprecated V2 routing-agent compatibility only. */
  branchId?: string
}

export type RouteGraphEdge = {
  id: string
  source: string
  target: string
  order?: number
  weight?: number
  label?: string
  sourceHandle?: string | null
  targetHandle?: string | null
  type?: 'smoothstep'
  data: RouteGraphEdgeData
}

export type RouteGraph = {
  version: 1 | 2 | 3
  source?: 'legacy' | 'template' | 'user'
  legacyFingerprint?: string
  nodes: RouteGraphNode[]
  edges: RouteGraphEdge[]
  viewport?: { x: number; y: number; zoom: number }
}

export type RouteGraphIssue = {
  code: string
  severity: 'error' | 'warning'
  nodeId?: string
  edgeId?: string
  message?: string
  messageKey?: string
}

export type RouteGraphValidation = {
  valid: boolean
  issues: RouteGraphIssue[]
}

export type RoutePreviewNodeResult = {
  nodeId: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  detail?: string
}

export type RoutePreviewResult = {
  validation: RouteGraphValidation
  path: string[]
  edgePath?: string[]
  nodes?: RoutePreviewNodeResult[]
  totalLatencyMs?: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

export type RouteProfile = {
  id: string
  name: string
  description?: string
  enabled: boolean
  strategy: RoutingStrategy
  strictFree: boolean
  allowExperimental: boolean
  maxAttempts: number
  targets: RouteTarget[]
  graph?: RouteGraph
  draftGraph?: RouteGraph
  draftName?: string
  previousGraph?: RouteGraph
  draftRevision?: number
  publishedAt?: string
}

export type RoutingConfig = {
  version: 1 | 2
  enabled: boolean
  profiles: RouteProfile[]
}

export type RoutingSource = {
  id: string
  providerId?: string
  presetId: string
  name: string
  configured: boolean
  routable: boolean
  cost: SourceCostClass
  auth: SourceAuthClass
  risk: SourceRiskClass
  costNote?: string
  models: Array<{
    id: string
    contextWindow?: number
    supportsImages?: boolean
  }>
}

export type RouteHealthSnapshot = {
  providerId: string
  providerName: string
  modelId: string
  requests: number
  successes: number
  failures: number
  averageLatencyMs: number | null
  consecutiveFailures: number
  cooldownUntil?: string
  lastUsedAt?: string
  lastError?: string
}

export type RoutingEvent = {
  id: string
  timestamp: string
  routeId: string
  sessionId: string
  providerId: string
  providerName: string
  modelId: string
  status: 'success' | 'failed' | 'skipped'
  latencyMs: number
  attempt: number
  phase?: 'generation' | 'judge' | 'agent-decision'
  nodeId?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  error?: string
}

export type RoutingDashboard = {
  config: RoutingConfig
  sources: RoutingSource[]
  health: RouteHealthSnapshot[]
  events: RoutingEvent[]
  routeAvailability: Record<string, {
    candidateCount: number
    available: boolean
    contextWindow?: number
    reason?: string
  }>
}
