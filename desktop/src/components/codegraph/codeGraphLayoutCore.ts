import type { CodeGraphData, CodeGraphNode } from '../../api/tokenOptimization'

export type PositionedNode = CodeGraphNode & {
  x: number
  y: number
  radius: number
  clusterKey: string
}

export type GraphViewMode = 'architecture' | 'files'

export type GraphCluster = {
  key: string
  label: string
  kind: GraphViewMode
  x: number
  y: number
  radius: number
  nodeIds: string[]
}

export type GraphLayoutFallbackReason =
  | 'worker-unavailable'
  | 'worker-error'
  | 'worker-timeout'
  | 'worker-post-failed'

export type GraphLayout = {
  nodes: PositionedNode[]
  clusters: GraphCluster[]
  renderEdges?: CodeGraphData['edges']
  fallback?: {
    reason: GraphLayoutFallbackReason
    sourceNodeCount: number
    sourceEdgeCount: number
    processedNodeCount: number
    processedEdgeCount: number
  }
}

export const CODE_GRAPH_LAYOUT_WORKER_THRESHOLD = 400
export const CODE_GRAPH_FALLBACK_MAX_NODES = 128
export const CODE_GRAPH_FALLBACK_MAX_EDGES = 256
export const EMPTY_GRAPH_LAYOUT: GraphLayout = { nodes: [], clusters: [] }

const WORLD_WIDTH = 1180
const WORLD_HEIGHT = 760

export function shouldUseCodeGraphLayoutWorker(data: CodeGraphData) {
  return data.nodes.length + data.edges.length >= CODE_GRAPH_LAYOUT_WORKER_THRESHOLD
}

export function buildSemanticLayout(
  data: CodeGraphData,
  viewMode: GraphViewMode = 'architecture',
): GraphLayout {
  if (data.nodes.length === 0) return EMPTY_GRAPH_LAYOUT
  const groups = new Map<string, CodeGraphNode[]>()
  for (const node of data.nodes) {
    const key = viewMode === 'architecture'
      ? node.communityId || node.filePath || '(project)'
      : node.filePath || '(project)'
    const group = groups.get(key) || []
    group.push(node)
    groups.set(key, group)
  }
  const entries = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
  const columns = Math.max(
    1,
    entries.length <= 4
      ? Math.ceil(Math.sqrt(entries.length))
      : Math.ceil(Math.sqrt(entries.length * 1.3)),
  )
  const rows = Math.ceil(entries.length / columns)
  const cellWidth = (WORLD_WIDTH - 120) / columns
  const cellHeight = (WORLD_HEIGHT - 100) / rows
  const clusterRadius = clamp(Math.min(cellWidth, cellHeight) * 0.4, 72, 148)
  const nodes: PositionedNode[] = []
  const clusters: GraphCluster[] = []

  entries.forEach(([key, group], index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const itemsInRow = Math.min(columns, entries.length - row * columns)
    const rowOffset = (columns - itemsInRow) * cellWidth / 2
    const centerX = 60 + rowOffset + column * cellWidth + cellWidth / 2
    const centerY = 50 + row * cellHeight + cellHeight / 2
    const ordered = [...group].sort((left, right) => {
      const rolePriority = viewMode === 'architecture'
        ? graphRolePriority(right.role) - graphRolePriority(left.role)
        : Number(right.kind === 'file') - Number(left.kind === 'file')
      return rolePriority || right.degree - left.degree || left.name.localeCompare(right.name)
    })
    const hub = viewMode === 'architecture'
      ? ordered.find((node) => node.role === 'hub') || ordered[0]!
      : ordered.find((node) => node.kind === 'file') || ordered[0]!
    const satellites = ordered.filter((node) => node.id !== hub.id)
    const positioned: PositionedNode[] = [{
      ...hub,
      x: centerX,
      y: centerY,
      radius: hub.kind === 'file' ? 15 : hub.role === 'hub' ? 12 : 10,
      clusterKey: key,
    }]
    satellites.forEach((node, satelliteIndex) => {
      const ringIndex = Math.floor(satelliteIndex / 10)
      const indexOnRing = satelliteIndex % 10
      const ringCount = Math.min(10, satellites.length - ringIndex * 10)
      const offset = ((hashString(key) % 360) * Math.PI) / 180
      const angle = offset + indexOnRing / Math.max(1, ringCount) * Math.PI * 2 + ringIndex * 0.35
      const distance = Math.min(clusterRadius - 13, 48 + ringIndex * 34 + (satelliteIndex % 3) * 4)
      positioned.push({
        ...node,
        x: centerX + Math.cos(angle) * distance,
        y: centerY + Math.sin(angle) * distance * 0.82,
        radius: 5.2 + Math.min(4.8, Math.sqrt(Math.max(0, node.degree)) * 0.72),
        clusterKey: key,
      })
    })
    nodes.push(...positioned)
    clusters.push({
      key,
      label: viewMode === 'architecture'
        ? group[0]?.communityLabel || key
        : key.split(/[\\/]/).pop() || key,
      kind: viewMode,
      x: centerX,
      y: centerY,
      radius: clusterRadius,
      nodeIds: positioned.map((node) => node.id),
    })
  })
  return { nodes, clusters }
}

export function buildBoundedSemanticLayout(
  data: CodeGraphData,
  viewMode: GraphViewMode,
  reason: GraphLayoutFallbackReason,
): GraphLayout {
  const nodes = data.nodes.slice(0, CODE_GRAPH_FALLBACK_MAX_NODES)
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = data.edges
    .slice(0, CODE_GRAPH_FALLBACK_MAX_EDGES)
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
  const boundedData: CodeGraphData = {
    ...data,
    nodes,
    edges,
    architecture: {
      ...data.architecture,
      analyzedNodeCount: nodes.length,
      analyzedEdgeCount: edges.length,
      truncated: true,
    },
  }
  const layout = buildSemanticLayout(boundedData, viewMode)
  return {
    ...layout,
    renderEdges: edges,
    fallback: {
      reason,
      sourceNodeCount: data.nodes.length,
      sourceEdgeCount: data.edges.length,
      processedNodeCount: nodes.length,
      processedEdgeCount: edges.length,
    },
  }
}

function graphRolePriority(role: CodeGraphNode['role']) {
  return role === 'hub' ? 3 : role === 'bridge' ? 2 : 1
}

export function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
