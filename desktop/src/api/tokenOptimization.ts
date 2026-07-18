import { api } from './client'

export type CodeGraphState = 'disabled' | 'preparing' | 'indexing' | 'ready' | 'empty' | 'error'

export type CodeGraphStats = {
  fileCount: number
  nodeCount: number
  edgeCount: number
  errorFileCount: number
  dbSizeBytes: number
  lastUpdated: number | null
  filesByLanguage: Record<string, number>
}

export type CodeGraphStatus = {
  projectPath: string
  indexable: boolean
  enabled: boolean
  state: CodeGraphState
  progress: {
    phase: string
    current: number
    total: number
    currentFile?: string
  } | null
  stats: CodeGraphStats | null
  error: string | null
  bundledLanguages: string[]
}

export type CodeGraphGlobalStatus = {
  enabled: boolean
}

export type CodeGraphConfidence = 'extracted' | 'inferred' | 'unknown'
export type CodeGraphNodeRole = 'hub' | 'bridge' | 'member'

export type CodeGraphNode = {
  id: string
  kind: string
  name: string
  qualifiedName: string
  filePath: string
  language: string
  startLine: number
  endLine: number
  degree: number
  communityId: string
  communityLabel: string
  role: CodeGraphNodeRole
}

export type CodeGraphData = {
  nodes: CodeGraphNode[]
  edges: Array<{
    source: string
    target: string
    kind: string
    line: number | null
    provenance: string | null
    confidence: CodeGraphConfidence
    crossCommunity: boolean
  }>
  architecture: {
    analyzedNodeCount: number
    analyzedEdgeCount: number
    availableNodeCount: number
    truncated: boolean
    communities: Array<{
      id: string
      label: string
      nodeCount: number
      edgeCount: number
      cohesion: number
      hubNodeIds: string[]
      bridgeNodeIds: string[]
    }>
    hubNodeIds: string[]
    bridgeNodeIds: string[]
    confidence: Record<CodeGraphConfidence, number>
  }
}

export type RtkStatus = {
  enabled: boolean
  available: boolean
  version: string | null
  stats: {
    totalCommands: number
    totalInput: number
    totalOutput: number
    totalSaved: number
    averageSavingsPercent: number
  } | null
  error: string | null
}

export type CavemanStatus = {
  enabled: boolean
  mode: 'full'
}

export type LiteOptimizationStatus = {
  enabled: boolean
  mode: 'deterministic'
}

export type PonytailStatus = {
  enabled: boolean
  mode: 'full'
}

export type SmartPruningLevel = 'conservative' | 'balanced' | 'aggressive'

export type SmartPruningStatus = {
  enabled: boolean
  level: SmartPruningLevel
  mode: 'deterministic'
}

const projectQuery = (projectPath: string) =>
  `projectPath=${encodeURIComponent(projectPath)}`

export const tokenOptimizationApi = {
  liteStatus: () => api.get<LiteOptimizationStatus>('/api/token-optimization/lite'),

  enableLite: () =>
    api.post<LiteOptimizationStatus>('/api/token-optimization/lite/enable', {}),

  disableLite: () =>
    api.post<LiteOptimizationStatus>('/api/token-optimization/lite/disable', {}),

  pruningStatus: () =>
    api.get<SmartPruningStatus>('/api/token-optimization/pruning'),

  enablePruning: () =>
    api.post<SmartPruningStatus>('/api/token-optimization/pruning/enable', {}),

  disablePruning: () =>
    api.post<SmartPruningStatus>('/api/token-optimization/pruning/disable', {}),

  setPruningLevel: (level: SmartPruningLevel) =>
    api.post<SmartPruningStatus>('/api/token-optimization/pruning/level', { level }),

  codeGraphGlobalStatus: () =>
    api.get<CodeGraphGlobalStatus>('/api/token-optimization/codegraph/global'),

  enableCodeGraphGlobally: () =>
    api.post<CodeGraphGlobalStatus>('/api/token-optimization/codegraph/global/enable', {}),

  disableCodeGraphGlobally: () =>
    api.post<CodeGraphGlobalStatus>('/api/token-optimization/codegraph/global/disable', {}),

  ponytailStatus: () => api.get<PonytailStatus>('/api/token-optimization/ponytail'),

  enablePonytail: () =>
    api.post<PonytailStatus>('/api/token-optimization/ponytail/enable', {}),

  disablePonytail: () =>
    api.post<PonytailStatus>('/api/token-optimization/ponytail/disable', {}),

  cavemanStatus: () => api.get<CavemanStatus>('/api/token-optimization/caveman'),

  enableCaveman: () =>
    api.post<CavemanStatus>('/api/token-optimization/caveman/enable', {}),

  disableCaveman: () =>
    api.post<CavemanStatus>('/api/token-optimization/caveman/disable', {}),

  rtkStatus: () => api.get<RtkStatus>('/api/token-optimization/rtk'),

  enableRtk: () =>
    api.post<RtkStatus>('/api/token-optimization/rtk/enable', {}),

  disableRtk: () =>
    api.post<RtkStatus>('/api/token-optimization/rtk/disable', {}),

  status: (projectPath: string) =>
    api.get<CodeGraphStatus>(
      `/api/token-optimization/codegraph?${projectQuery(projectPath)}`,
    ),

  enable: (projectPath: string) =>
    api.post<CodeGraphStatus>('/api/token-optimization/codegraph/enable', { projectPath }),

  disable: (projectPath: string) =>
    api.post<CodeGraphStatus>('/api/token-optimization/codegraph/disable', { projectPath }),

  rebuild: (projectPath: string) =>
    api.post<CodeGraphStatus>('/api/token-optimization/codegraph/rebuild', { projectPath }),

  graph: (projectPath: string, limit = 120) =>
    api.get<CodeGraphData>(
      `/api/token-optimization/codegraph/graph?${projectQuery(projectPath)}&limit=${limit}`,
      { timeout: 15_000 },
    ),
}
