import { z } from 'zod'

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

export const RoutingStrategySchema = z.enum(ROUTING_STRATEGIES)
export type RoutingStrategy = z.infer<typeof RoutingStrategySchema>

export const SourceCostClassSchema = z.enum([
  'recurring-free',
  'signup-credit',
  'uncapped',
  'mixed',
  'paid',
  'unknown',
])
export type SourceCostClass = z.infer<typeof SourceCostClassSchema>

export const SourceAuthClassSchema = z.enum([
  'oauth',
  'api-key',
  'local',
  'none',
])
export type SourceAuthClass = z.infer<typeof SourceAuthClassSchema>

export const SourceRiskClassSchema = z.enum([
  'stable',
  'experimental',
  'restricted',
])
export type SourceRiskClass = z.infer<typeof SourceRiskClassSchema>

export const RouteTargetSchema = z.object({
  providerId: z.string().trim().min(1),
  modelId: z.string().trim().min(1).optional(),
  weight: z.number().positive().max(100).optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
})
export type RouteTarget = z.infer<typeof RouteTargetSchema>

export const ROUTE_GRAPH_NODE_TYPES = [
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

export const RouteGraphNodeTypeSchema = z.enum(ROUTE_GRAPH_NODE_TYPES)
export type RouteGraphNodeType = z.infer<typeof RouteGraphNodeTypeSchema>

export const RouteGraphPositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
})
export type RouteGraphPosition = z.infer<typeof RouteGraphPositionSchema>

const RouteGraphNodeBaseSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
  position: RouteGraphPositionSchema,
  label: z.string().trim().min(1).max(80).optional(),
})

export const RouteConditionFieldSchema = z.enum([
  'task',
  'modality',
  'context-tokens',
  'cost',
  'health',
  'quota',
])
export type RouteConditionField = z.infer<typeof RouteConditionFieldSchema>

export const RouteConditionOperatorSchema = z.enum([
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
export type RouteConditionOperator = z.infer<typeof RouteConditionOperatorSchema>

export const RouteDistributionModeSchema = z.enum([
  'round-robin',
  'quota',
  'weighted',
  'cost',
  'latency',
  'reliability',
])
export type RouteDistributionMode = z.infer<typeof RouteDistributionModeSchema>

export const RouteResultModeSchema = z.enum(['fastest', 'collect', 'judge'])
export type RouteResultMode = z.infer<typeof RouteResultModeSchema>

export const RouteRelayModeSchema = z.enum(['sticky', 'summary'])
export type RouteRelayMode = z.infer<typeof RouteRelayModeSchema>

export const RouteAgentBranchSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  label: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(240),
}).strict()
export type RouteAgentBranch = z.infer<typeof RouteAgentBranchSchema>

export const RouteAgentPortSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
  label: z.string().trim().min(1).max(40),
  description: z.string().trim().max(240).default(''),
}).strict()
export type RouteAgentPort = z.infer<typeof RouteAgentPortSchema>

export const RouteAgentDecisionSchema = z.object({
  branch: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().max(160).optional(),
}).strict()
export type RouteAgentDecision = z.infer<typeof RouteAgentDecisionSchema>

export const RouteAgentPortDecisionSchema = z.object({
  outputPortId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().max(160).optional(),
}).strict()
export type RouteAgentPortDecision = z.infer<typeof RouteAgentPortDecisionSchema>

const RouteAgentV2ConfigSchema = z.object({
  providerId: z.string().trim().min(1).optional(),
  modelId: z.string().trim().min(1).optional(),
  branches: z.array(RouteAgentBranchSchema).min(2).max(6),
  fallbackBranchId: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  confidenceThreshold: z.number().min(0).max(1).default(0.6),
  timeoutMs: z.number().int().min(1_000).max(30_000).default(8_000),
  maxInputChars: z.number().int().min(200).max(16_000).default(4_000),
  prompt: z.string().trim().max(4_000).optional(),
}).strict().superRefine((config, context) => {
  const ids = new Set<string>()
  for (const [index, branch] of config.branches.entries()) {
    if (ids.has(branch.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Agent branch id is duplicated: ${branch.id}`,
        path: ['branches', index, 'id'],
      })
    }
    ids.add(branch.id)
  }
  if (!ids.has(config.fallbackBranchId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Agent fallback branch must reference a declared branch',
      path: ['fallbackBranchId'],
    })
  }
})
export type RouteAgentV2Config = z.infer<typeof RouteAgentV2ConfigSchema>

function validateAgentPorts(
  ports: RouteAgentPort[],
  path: 'inputPorts' | 'outputPorts',
  context: z.RefinementCtx,
): void {
  const ids = new Set<string>()
  const labels = new Set<string>()
  for (const [index, port] of ports.entries()) {
    if (ids.has(port.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Agent port id is duplicated: ${port.id}`,
        path: [path, index, 'id'],
      })
    }
    ids.add(port.id)
    const normalizedLabel = port.label.toLocaleLowerCase()
    if (labels.has(normalizedLabel)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Agent port label is duplicated: ${port.label}`,
        path: [path, index, 'label'],
      })
    }
    labels.add(normalizedLabel)
  }
}

const RouteAgentV3ConfigSchema = z.object({
  providerId: z.string().trim().min(1).optional(),
  modelId: z.string().trim().min(1).optional(),
  inputPorts: z.array(RouteAgentPortSchema).min(1).max(6),
  outputPorts: z.array(RouteAgentPortSchema).min(2).max(6),
  instructions: z.string().trim().max(4_000),
  fallbackOutputPortId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
  confidenceThreshold: z.number().min(0).max(1).default(0.6),
  timeoutMs: z.number().int().min(1_000).max(30_000).default(8_000),
  maxInputChars: z.number().int().min(200).max(16_000).default(4_000),
}).strict().superRefine((config, context) => {
  validateAgentPorts(config.inputPorts, 'inputPorts', context)
  validateAgentPorts(config.outputPorts, 'outputPorts', context)
  if (!config.outputPorts.some((port) => port.id === config.fallbackOutputPortId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Agent fallback output must reference a declared output port',
      path: ['fallbackOutputPortId'],
    })
  }
})
export type RouteAgentV3Config = z.infer<typeof RouteAgentV3ConfigSchema>

export const RouteGraphNodeSchema = z.discriminatedUnion('type', [
  RouteGraphNodeBaseSchema.extend({
    type: z.literal('start'),
    config: z.object({}).passthrough().default({}),
  }).passthrough(),
  RouteGraphNodeBaseSchema.extend({
    type: z.literal('model'),
    config: z.object({
      providerId: z.string().trim().min(1).optional(),
      modelId: z.string().trim().min(1).optional(),
      timeoutMs: z.number().int().min(1_000).max(10 * 60_000).default(120_000),
      maxAttempts: z.number().int().min(1).max(8).default(1),
      budgetUsd: z.number().positive().max(10_000).optional(),
    }).passthrough().default({ timeoutMs: 120_000, maxAttempts: 1 }),
  }).passthrough(),
  RouteGraphNodeBaseSchema.extend({
    type: z.literal('agent'),
    config: z.union([RouteAgentV3ConfigSchema, RouteAgentV2ConfigSchema]),
  }).passthrough(),
  RouteGraphNodeBaseSchema.extend({
    type: z.literal('condition'),
    config: z.object({
      field: RouteConditionFieldSchema,
      operator: RouteConditionOperatorSchema,
      value: z.union([z.string(), z.number(), z.boolean()]).optional(),
      onUnknown: z.enum(['true', 'false']).default('false'),
    }).passthrough(),
  }).passthrough(),
  RouteGraphNodeBaseSchema.extend({
    type: z.literal('distribution'),
    config: z.object({
      mode: RouteDistributionModeSchema.default('round-robin'),
      outputCount: z.number().int().min(2).max(128).optional(),
    }).passthrough().default({ mode: 'round-robin' }),
  }).passthrough(),
  RouteGraphNodeBaseSchema.extend({
    type: z.literal('parallel'),
    config: z.object({
      maxConcurrency: z.number().int().min(2).max(4).default(4),
    }).passthrough().default({ maxConcurrency: 4 }),
  }).passthrough(),
  RouteGraphNodeBaseSchema.extend({
    type: z.literal('result'),
    config: z.object({
      mode: RouteResultModeSchema.default('fastest'),
      judgeProviderId: z.string().trim().min(1).optional(),
      judgeModelId: z.string().trim().min(1).optional(),
      judgePrompt: z.string().trim().max(4_000).optional(),
    }).passthrough().default({ mode: 'fastest' }),
  }).passthrough(),
  RouteGraphNodeBaseSchema.extend({
    type: z.literal('relay'),
    config: z.object({
      mode: RouteRelayModeSchema.default('sticky'),
      summaryMaxChars: z.number().int().min(1_000).max(48_000).default(16_000),
    }).passthrough().default({ mode: 'sticky', summaryMaxChars: 16_000 }),
  }).passthrough(),
  RouteGraphNodeBaseSchema.extend({
    type: z.literal('output'),
    config: z.object({}).passthrough().default({}),
  }).passthrough(),
])
export type RouteGraphNode = z.infer<typeof RouteGraphNodeSchema>

export const RouteGraphEdgeKindSchema = z.enum([
  'flow',
  'failure',
  'result',
  'true',
  'false',
  'choice',
])
export type RouteGraphEdgeKind = z.infer<typeof RouteGraphEdgeKindSchema>

export const RouteGraphEdgeSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/),
  source: z.string().min(1).max(64),
  target: z.string().min(1).max(64),
  kind: RouteGraphEdgeKindSchema.default('flow'),
  order: z.number().int().min(0).max(10_000).optional(),
  weight: z.number().positive().max(100).optional(),
  label: z.string().trim().min(1).max(80).optional(),
  branchId: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/).optional(),
  sourcePortId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/).optional(),
  targetPortId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/).optional(),
}).passthrough()
export type RouteGraphEdge = z.infer<typeof RouteGraphEdgeSchema>

export const RouteGraphSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  source: z.enum(['legacy', 'template', 'user']).default('user'),
  nodes: z.array(RouteGraphNodeSchema).max(64),
  edges: z.array(RouteGraphEdgeSchema).max(128),
  viewport: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().positive().min(0.1).max(4),
  }).optional(),
}).passthrough().superRefine((graph, context) => {
  for (const [index, node] of graph.nodes.entries()) {
    if (node.type !== 'agent') continue
    const usesPorts = 'inputPorts' in node.config
    if (graph.version === 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Agent nodes require route graph version 2 or 3',
        path: ['version'],
      })
    } else if (graph.version === 2 && usesPorts) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Version 2 agent nodes must use branches',
        path: ['nodes', index, 'config'],
      })
    } else if (graph.version === 3 && !usesPorts) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Version 3 agent nodes must use input and output ports',
        path: ['nodes', index, 'config'],
      })
    }
  }
})
export type RouteGraph = z.infer<typeof RouteGraphSchema>

export type RouteAgentNode = Extract<RouteGraphNode, { type: 'agent' }>
export type RouteAgentV2Node = RouteAgentNode & { config: RouteAgentV2Config }
export type RouteAgentV3Node = RouteAgentNode & { config: RouteAgentV3Config }

export function isRouteAgentV3Node(
  node: RouteGraphNode | undefined,
): node is RouteAgentV3Node {
  return node?.type === 'agent' && 'inputPorts' in node.config
}

export const RoutePreviewSampleSchema = z.object({
  sessionId: z.string().max(160).optional(),
  task: z.enum(['general', 'coding', 'reasoning', 'vision', 'audio']).optional(),
  modalities: z.array(z.enum(['text', 'image', 'audio'])).max(3).optional(),
  contextTokens: z.number().int().nonnegative().optional(),
  cost: SourceCostClassSchema.optional(),
  health: z.number().min(0).max(1).optional(),
  quotaRemaining: z.number().nonnegative().optional(),
  hasTools: z.boolean().optional(),
}).passthrough()
export type RoutePreviewSample = z.infer<typeof RoutePreviewSampleSchema>

export type RouteGraphValidationIssue = {
  code: string
  message: string
  severity: 'error' | 'warning'
  nodeId?: string
  edgeId?: string
}

export type RouteGraphValidationResult = {
  valid: boolean
  issues: RouteGraphValidationIssue[]
}

export type RouteGraphPreviewStep = {
  order: number
  nodeId: string
  nodeType: RouteGraphNodeType
  status: 'visited' | 'selected' | 'skipped'
  detail: string
  edgeId?: string
}

export type RouteGraphPreviewTrace = {
  valid: boolean
  validation: RouteGraphValidationResult
  path: string[]
  steps: RouteGraphPreviewStep[]
  branches: Array<{
    nodeId: string
    selectedEdgeIds: string[]
    explanation: string
  }>
  estimatedModelAttempts: number
  warnings: string[]
}

export const RouteProfileSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional(),
  enabled: z.boolean().default(true),
  strategy: RoutingStrategySchema.default('auto'),
  strictFree: z.boolean().default(false),
  allowExperimental: z.boolean().default(false),
  maxAttempts: z.number().int().min(1).max(8).default(3),
  targets: z.array(RouteTargetSchema).default([]),
  graph: RouteGraphSchema.optional(),
  draftGraph: RouteGraphSchema.optional(),
  previousGraph: RouteGraphSchema.optional(),
  draftName: z.string().trim().min(1).max(80).optional(),
  draftRevision: z.number().int().nonnegative().optional(),
  publishedAt: z.string().datetime().optional(),
}).passthrough().superRefine((profile, context) => {
  const targetIndexes = new Map<string, number>()
  for (const [index, target] of profile.targets.entries()) {
    const targetKey = `${target.providerId}\u0000${target.modelId ?? ''}`
    const firstIndex = targetIndexes.get(targetKey)
    if (firstIndex !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Route target is duplicated (first used at index ${firstIndex})`,
        path: ['targets', index],
      })
      continue
    }
    targetIndexes.set(targetKey, index)
  }
})
export type RouteProfile = z.infer<typeof RouteProfileSchema>

export const RoutingConfigSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]).default(1),
  enabled: z.boolean().default(true),
  profiles: z.array(RouteProfileSchema),
}).passthrough().superRefine((config, context) => {
  const profileIndexes = new Map<string, number>()
  for (const [index, profile] of config.profiles.entries()) {
    const firstIndex = profileIndexes.get(profile.id)
    if (firstIndex !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Route profile id is duplicated (first used at index ${firstIndex})`,
        path: ['profiles', index, 'id'],
      })
      continue
    }
    profileIndexes.set(profile.id, index)
  }
})
export type RoutingConfig = z.infer<typeof RoutingConfigSchema>

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
