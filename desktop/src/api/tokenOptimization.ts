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
}

export type CodeGraphData = {
  nodes: CodeGraphNode[]
  edges: Array<{ source: string; target: string; kind: string }>
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

const projectQuery = (projectPath: string) =>
  `projectPath=${encodeURIComponent(projectPath)}`

export const tokenOptimizationApi = {
  liteStatus: () => api.get<LiteOptimizationStatus>('/api/token-optimization/lite'),

  enableLite: () =>
    api.post<LiteOptimizationStatus>('/api/token-optimization/lite/enable', {}),

  disableLite: () =>
    api.post<LiteOptimizationStatus>('/api/token-optimization/lite/disable', {}),

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
