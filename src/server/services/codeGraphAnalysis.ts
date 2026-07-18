import { openCodeGraphDatabaseForRead } from './codeGraphDatabase.js'

const MAX_ANALYSIS_NODES = 1_200
const MAX_ANALYSIS_EDGES_PER_NODE = 24

export type CodeGraphConfidence = 'extracted' | 'inferred' | 'unknown'
export type CodeGraphNodeRole = 'hub' | 'bridge' | 'member'

export type CodeGraphAnalysisNode = {
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

export type CodeGraphAnalysisEdge = {
  source: string
  target: string
  kind: string
  line: number | null
  provenance: string | null
  confidence: CodeGraphConfidence
  crossCommunity: boolean
}

export type CodeGraphCommunity = {
  id: string
  label: string
  nodeCount: number
  edgeCount: number
  cohesion: number
  hubNodeIds: string[]
  bridgeNodeIds: string[]
}

export type CodeGraphArchitecture = {
  analyzedNodeCount: number
  analyzedEdgeCount: number
  availableNodeCount: number
  truncated: boolean
  communities: CodeGraphCommunity[]
  hubNodeIds: string[]
  bridgeNodeIds: string[]
  confidence: Record<CodeGraphConfidence, number>
}

export type CodeGraphVisualization = {
  nodes: CodeGraphAnalysisNode[]
  edges: CodeGraphAnalysisEdge[]
  architecture: CodeGraphArchitecture
}

type SnapshotNode = Omit<
  CodeGraphAnalysisNode,
  'communityId' | 'communityLabel' | 'role'
>

type SnapshotEdge = Omit<CodeGraphAnalysisEdge, 'confidence' | 'crossCommunity'>

type Snapshot = {
  nodes: SnapshotNode[]
  edges: SnapshotEdge[]
  availableNodeCount: number
}

type AnalyzedGraph = {
  nodes: CodeGraphAnalysisNode[]
  edges: CodeGraphAnalysisEdge[]
  architecture: CodeGraphArchitecture
}

export function getCodeGraphVisualization(
  dbPath: string,
  requestedLimit: number,
): CodeGraphVisualization {
  const limit = clamp(Math.round(requestedLimit), 20, 220)
  const candidateLimit = clamp(Math.max(160, limit * 4), limit, 900)
  const analyzed = analyzeSnapshot(readSnapshot(dbPath, candidateLimit))
  if (analyzed.nodes.length <= limit) return analyzed

  const nodeById = new Map(analyzed.nodes.map((node) => [node.id, node]))
  const membersByCommunity = groupBy(analyzed.nodes, (node) => node.communityId)
  const selectedIds = new Set<string>()
  const communityOrder = [...analyzed.architecture.communities].sort((left, right) =>
    right.nodeCount - left.nodeCount || left.label.localeCompare(right.label),
  )

  for (const community of communityOrder) {
    if (selectedIds.size >= limit) break
    const members = rankNodes(membersByCommunity.get(community.id) ?? [])
    const quota = Math.min(members.length, members.length > 8 ? 3 : 2)
    for (const node of members.slice(0, quota)) {
      if (selectedIds.size >= limit) break
      selectedIds.add(node.id)
    }
  }
  for (const node of rankNodes(analyzed.nodes)) {
    if (selectedIds.size >= limit) break
    selectedIds.add(node.id)
  }

  const nodes = [...selectedIds]
    .map((id) => nodeById.get(id))
    .filter((node): node is CodeGraphAnalysisNode => Boolean(node))
  const edges = analyzed.edges.filter((edge) =>
    selectedIds.has(edge.source) && selectedIds.has(edge.target),
  )

  return { nodes, edges, architecture: analyzed.architecture }
}

export function getCodeGraphArchitecture(
  dbPath: string,
  requestedLimit = MAX_ANALYSIS_NODES,
): AnalyzedGraph {
  return analyzeSnapshot(readSnapshot(
    dbPath,
    clamp(Math.round(requestedLimit), 20, MAX_ANALYSIS_NODES),
  ))
}

export function formatCodeGraphArchitecture(graph: AnalyzedGraph): string {
  const { architecture } = graph
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const lines = [
    '# Code Graph Architecture',
    '',
    `Coverage: ${architecture.analyzedNodeCount}/${architecture.availableNodeCount} symbols, ` +
      `${architecture.analyzedEdgeCount} relationships${architecture.truncated ? ' (ranked subset)' : ''}.`,
    `Relationship confidence: ${architecture.confidence.extracted} extracted, ` +
      `${architecture.confidence.inferred} inferred, ${architecture.confidence.unknown} unknown.`,
    '',
    '## Modules',
  ]

  for (const community of architecture.communities.slice(0, 18)) {
    const hubs = community.hubNodeIds
      .map((id) => nodeById.get(id)?.qualifiedName || nodeById.get(id)?.name)
      .filter(Boolean)
      .slice(0, 3)
      .join(', ')
    lines.push(
      `- ${community.label}: ${community.nodeCount} symbols, ${community.edgeCount} internal relations, ` +
      `${Math.round(community.cohesion * 100)}% cohesion${hubs ? `; hubs: ${hubs}` : ''}.`,
    )
  }

  const bridges = architecture.bridgeNodeIds
    .map((id) => nodeById.get(id))
    .filter((node): node is CodeGraphAnalysisNode => Boolean(node))
  if (bridges.length > 0) {
    lines.push('', '## Cross-module bridges')
    for (const node of bridges.slice(0, 12)) {
      lines.push(`- ${node.qualifiedName || node.name} (${node.filePath}:${node.startLine}) — ${node.communityLabel}`)
    }
  }

  const hubs = architecture.hubNodeIds
    .map((id) => nodeById.get(id))
    .filter((node): node is CodeGraphAnalysisNode => Boolean(node))
  if (hubs.length > 0) {
    lines.push('', '## Central symbols')
    for (const node of hubs.slice(0, 12)) {
      lines.push(`- ${node.qualifiedName || node.name} (${node.filePath}:${node.startLine}, degree ${node.degree})`)
    }
  }

  return lines.join('\n')
}

export function confidenceForProvenance(
  provenance: string | null | undefined,
): CodeGraphConfidence {
  if (provenance === 'tree-sitter' || provenance === 'scip') return 'extracted'
  if (provenance === 'heuristic') return 'inferred'
  return 'unknown'
}

function readSnapshot(dbPath: string, requestedLimit: number): Snapshot {
  const db = openCodeGraphDatabaseForRead(dbPath)
  try {
    const limit = clamp(requestedLimit, 20, MAX_ANALYSIS_NODES)
    const availableNodeCount = Number(db.query<{ count: number }, []>(`
      SELECT COUNT(*) AS count
      FROM nodes
      WHERE kind NOT IN ('import', 'property', 'parameter')
    `).get()?.count ?? 0)
    const nodes = readRankedNodes(db, limit, true)
    const selected = nodes.length > 0 ? nodes : readRankedNodes(db, limit, false)
    if (selected.length === 0) return { nodes: [], edges: [], availableNodeCount }

    const columns = new Set(
      db.query<{ name: string }, []>('PRAGMA table_info(edges)').all().map((column) => column.name),
    )
    const ids = selected.map((node) => node.id)
    const placeholders = ids.map(() => '?').join(', ')
    const lineExpression = columns.has('line') ? 'line' : 'NULL'
    const provenanceExpression = columns.has('provenance') ? 'provenance' : 'NULL'
    const edges = db.query<{
      source: string
      target: string
      kind: string
      line: number | null
      provenance: string | null
    }, Array<string | number>>(`
      SELECT source, target, kind,
        ${lineExpression} AS line,
        ${provenanceExpression} AS provenance
      FROM edges
      WHERE source IN (${placeholders}) AND target IN (${placeholders})
      LIMIT ?
    `).all(...ids, ...ids, limit * MAX_ANALYSIS_EDGES_PER_NODE)

    return {
      nodes: selected,
      edges: edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        line: edge.line === null ? null : Number(edge.line),
        provenance: edge.provenance,
      })),
      availableNodeCount,
    }
  } finally {
    db.close()
  }
}

function readRankedNodes(db: Database, limit: number, filterNoise: boolean): SnapshotNode[] {
  const where = filterNoise
    ? "WHERE n.kind NOT IN ('import', 'property', 'parameter')"
    : ''
  return db.query<{
    id: string
    kind: string
    name: string
    qualified_name: string
    file_path: string
    language: string
    start_line: number
    end_line: number
    degree: number
  }, [number]>(`
    WITH endpoint_degrees AS (
      SELECT source AS id, COUNT(*) AS degree FROM edges GROUP BY source
      UNION ALL
      SELECT target AS id, COUNT(*) AS degree FROM edges GROUP BY target
    ), degrees AS (
      SELECT id, SUM(degree) AS degree FROM endpoint_degrees GROUP BY id
    )
    SELECT
      n.id,
      n.kind,
      n.name,
      n.qualified_name,
      n.file_path,
      n.language,
      n.start_line,
      n.end_line,
      COALESCE(d.degree, 0) AS degree
    FROM nodes n
    LEFT JOIN degrees d ON d.id = n.id
    ${where}
    ORDER BY degree DESC, n.name COLLATE NOCASE
    LIMIT ?
  `).all(limit).map((node) => ({
    id: node.id,
    kind: node.kind,
    name: node.name,
    qualifiedName: node.qualified_name,
    filePath: node.file_path,
    language: node.language,
    startLine: Number(node.start_line),
    endLine: Number(node.end_line),
    degree: Number(node.degree),
  }))
}

function analyzeSnapshot(snapshot: Snapshot): AnalyzedGraph {
  if (snapshot.nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      architecture: {
        analyzedNodeCount: 0,
        analyzedEdgeCount: 0,
        availableNodeCount: snapshot.availableNodeCount,
        truncated: false,
        communities: [],
        hubNodeIds: [],
        bridgeNodeIds: [],
        confidence: { extracted: 0, inferred: 0, unknown: 0 },
      },
    }
  }

  const nodeIds = new Set(snapshot.nodes.map((node) => node.id))
  const edges = snapshot.edges.filter((edge) =>
    nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target,
  )
  const adjacency = createAdjacency(snapshot.nodes, edges)
  const rawCommunities = detectCommunities(snapshot.nodes, adjacency)
  const communityData = stabilizeCommunities(snapshot.nodes, edges, rawCommunities, adjacency)
  const communityByNode = new Map<string, { id: string; label: string }>()
  for (const community of communityData.communities) {
    for (const nodeId of community.memberIds) {
      communityByNode.set(nodeId, { id: community.id, label: community.label })
    }
  }

  const bridgeScores = calculateBridgeScores(snapshot.nodes, edges, communityByNode)
  const bridgeNodeIds = [...bridgeScores.entries()]
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, Math.min(12, Math.max(3, Math.ceil(snapshot.nodes.length * 0.04))))
    .map(([id]) => id)
  const bridgeSet = new Set(bridgeNodeIds)
  const hubNodeIds = communityData.communities
    .flatMap((community) => community.hubNodeIds)
    .sort((left, right) => {
      const leftNode = snapshot.nodes.find((node) => node.id === left)
      const rightNode = snapshot.nodes.find((node) => node.id === right)
      return (rightNode?.degree ?? 0) - (leftNode?.degree ?? 0) || left.localeCompare(right)
    })
    .slice(0, 16)
  const hubSet = new Set(hubNodeIds)

  const nodes = snapshot.nodes.map((node): CodeGraphAnalysisNode => {
    const community = communityByNode.get(node.id) ?? {
      id: `community-${hashString(node.id).toString(36)}`,
      label: labelFromNode(node),
    }
    return {
      ...node,
      communityId: community.id,
      communityLabel: community.label,
      role: bridgeSet.has(node.id) ? 'bridge' : hubSet.has(node.id) ? 'hub' : 'member',
    }
  })
  const analyzedEdges = edges.map((edge): CodeGraphAnalysisEdge => ({
    ...edge,
    confidence: confidenceForProvenance(edge.provenance),
    crossCommunity:
      communityByNode.get(edge.source)?.id !== communityByNode.get(edge.target)?.id,
  }))
  const confidence: Record<CodeGraphConfidence, number> = {
    extracted: 0,
    inferred: 0,
    unknown: 0,
  }
  for (const edge of analyzedEdges) confidence[edge.confidence] += 1

  const communities: CodeGraphCommunity[] = communityData.communities.map((community) => ({
    id: community.id,
    label: community.label,
    nodeCount: community.memberIds.length,
    edgeCount: community.internalEdgeCount,
    cohesion: community.cohesion,
    hubNodeIds: community.hubNodeIds,
    bridgeNodeIds: community.memberIds.filter((id) => bridgeSet.has(id)),
  }))

  return {
    nodes,
    edges: analyzedEdges,
    architecture: {
      analyzedNodeCount: nodes.length,
      analyzedEdgeCount: analyzedEdges.length,
      availableNodeCount: snapshot.availableNodeCount,
      truncated: snapshot.availableNodeCount > snapshot.nodes.length,
      communities,
      hubNodeIds,
      bridgeNodeIds,
      confidence,
    },
  }
}

function createAdjacency(nodes: SnapshotNode[], edges: SnapshotEdge[]) {
  const adjacency = new Map<string, Map<string, number>>(
    nodes.map((node) => [node.id, new Map<string, number>()]),
  )
  for (const edge of edges) {
    const weight = edgeWeight(edge.kind)
    const source = adjacency.get(edge.source)
    const target = adjacency.get(edge.target)
    if (!source || !target) continue
    source.set(edge.target, (source.get(edge.target) ?? 0) + weight)
    target.set(edge.source, (target.get(edge.source) ?? 0) + weight)
  }
  return adjacency
}

function detectCommunities(
  nodes: SnapshotNode[],
  adjacency: Map<string, Map<string, number>>,
) {
  if (nodes.length <= 1) return new Map(nodes.map((node) => [node.id, node.id]))
  const labels = new Map(nodes.map((node) => [node.id, node.id]))
  const degree = new Map(nodes.map((node) => [
    node.id,
    sum(adjacency.get(node.id)?.values() ?? []),
  ]))
  const totalByCommunity = new Map(degree)
  const totalDegree = sum(degree.values())
  if (totalDegree <= 0) return fallbackFileCommunities(nodes)

  const order = [...nodes].sort((left, right) =>
    (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0) || left.id.localeCompare(right.id),
  )
  for (let iteration = 0; iteration < 18; iteration += 1) {
    let moved = 0
    for (const node of order) {
      const nodeDegree = degree.get(node.id) ?? 0
      if (nodeDegree <= 0) continue
      const current = labels.get(node.id)!
      totalByCommunity.set(current, (totalByCommunity.get(current) ?? 0) - nodeDegree)
      const weightsByCommunity = new Map<string, number>()
      for (const [neighborId, weight] of adjacency.get(node.id) ?? []) {
        const community = labels.get(neighborId)!
        weightsByCommunity.set(community, (weightsByCommunity.get(community) ?? 0) + weight)
      }

      let best = current
      let bestGain = (weightsByCommunity.get(current) ?? 0) -
        (totalByCommunity.get(current) ?? 0) * nodeDegree / totalDegree
      for (const [community, internalWeight] of weightsByCommunity) {
        const gain = internalWeight -
          (totalByCommunity.get(community) ?? 0) * nodeDegree / totalDegree
        if (gain > bestGain + 1e-9 || (Math.abs(gain - bestGain) <= 1e-9 && community < best)) {
          best = community
          bestGain = gain
        }
      }
      labels.set(node.id, best)
      totalByCommunity.set(best, (totalByCommunity.get(best) ?? 0) + nodeDegree)
      if (best !== current) moved += 1
    }
    if (moved === 0) break
  }

  mergeExcessCommunities(labels, adjacency, nodes.length)
  return labels
}

function fallbackFileCommunities(nodes: SnapshotNode[]) {
  return new Map(nodes.map((node) => [
    node.id,
    `path:${directoryKey(node.filePath)}`,
  ]))
}

function mergeExcessCommunities(
  labels: Map<string, string>,
  adjacency: Map<string, Map<string, number>>,
  nodeCount: number,
) {
  const targetCount = clamp(Math.round(Math.sqrt(nodeCount) * 1.35), 4, 18)
  let groups = groupMap(labels)
  while (groups.size > targetCount) {
    const candidates = [...groups.entries()]
      .filter(([, members]) => members.length <= 3)
      .sort((left, right) => left[1].length - right[1].length || left[0].localeCompare(right[0]))
    const candidate = candidates[0]
    if (!candidate) break
    const [sourceCommunity, members] = candidate
    const neighborWeights = new Map<string, number>()
    for (const member of members) {
      for (const [neighbor, weight] of adjacency.get(member) ?? []) {
        const targetCommunity = labels.get(neighbor)!
        if (targetCommunity === sourceCommunity) continue
        neighborWeights.set(targetCommunity, (neighborWeights.get(targetCommunity) ?? 0) + weight)
      }
    }
    const target = [...neighborWeights.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0]
    if (!target) break
    for (const member of members) labels.set(member, target)
    groups = groupMap(labels)
  }
}

function stabilizeCommunities(
  nodes: SnapshotNode[],
  edges: SnapshotEdge[],
  rawCommunities: Map<string, string>,
  adjacency: Map<string, Map<string, number>>,
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const groups = groupMap(rawCommunities)
  const usedLabels = new Set<string>()
  const communities = [...groups.values()].map((memberIds) => {
    const members = memberIds
      .map((id) => nodeById.get(id))
      .filter((node): node is SnapshotNode => Boolean(node))
    const ranked = rankNodes(members)
    const representative = ranked[0]!
    let label = labelCommunity(members, representative)
    if (usedLabels.has(label)) label = `${label} · ${representative.name}`
    usedLabels.add(label)
    const id = `community-${hashString(representative.filePath + ':' + representative.qualifiedName).toString(36)}`
    const memberSet = new Set(memberIds)
    let internalEdgeCount = 0
    let internalWeight = 0
    let boundaryWeight = 0
    for (const edge of edges) {
      const sourceInside = memberSet.has(edge.source)
      const targetInside = memberSet.has(edge.target)
      if (sourceInside && targetInside) {
        internalEdgeCount += 1
        internalWeight += edgeWeight(edge.kind)
      } else if (sourceInside || targetInside) {
        boundaryWeight += edgeWeight(edge.kind)
      }
    }
    const hubCount = members.length >= 25 ? 2 : 1
    return {
      id,
      label,
      memberIds,
      internalEdgeCount,
      cohesion: internalWeight + boundaryWeight > 0
        ? internalWeight / (internalWeight + boundaryWeight)
        : 1,
      hubNodeIds: ranked
        .filter((node) => (adjacency.get(node.id)?.size ?? 0) > 0 || ranked.length === 1)
        .slice(0, hubCount)
        .map((node) => node.id),
    }
  }).sort((left, right) =>
    right.memberIds.length - left.memberIds.length || left.label.localeCompare(right.label),
  )
  return { communities }
}

function calculateBridgeScores(
  nodes: SnapshotNode[],
  edges: SnapshotEdge[],
  communityByNode: Map<string, { id: string }>,
) {
  const degree = new Map(nodes.map((node) => [node.id, 0]))
  const crossWeight = new Map(nodes.map((node) => [node.id, 0]))
  const reachedCommunities = new Map(nodes.map((node) => [node.id, new Set<string>()]))
  for (const edge of edges) {
    const weight = edgeWeight(edge.kind)
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + weight)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + weight)
    const sourceCommunity = communityByNode.get(edge.source)?.id
    const targetCommunity = communityByNode.get(edge.target)?.id
    if (!sourceCommunity || !targetCommunity || sourceCommunity === targetCommunity) continue
    crossWeight.set(edge.source, (crossWeight.get(edge.source) ?? 0) + weight)
    crossWeight.set(edge.target, (crossWeight.get(edge.target) ?? 0) + weight)
    reachedCommunities.get(edge.source)?.add(targetCommunity)
    reachedCommunities.get(edge.target)?.add(sourceCommunity)
  }
  return new Map(nodes.map((node) => {
    const cross = crossWeight.get(node.id) ?? 0
    const diversity = reachedCommunities.get(node.id)?.size ?? 0
    const score = cross > 0
      ? cross * Math.max(1, diversity) / Math.sqrt(Math.max(1, degree.get(node.id) ?? 0))
      : 0
    return [node.id, score]
  }))
}

function rankNodes<T extends SnapshotNode | CodeGraphAnalysisNode>(nodes: T[]) {
  const roleScore = (node: T) => {
    if (!('role' in node)) return 0
    return node.role === 'bridge' ? 3 : node.role === 'hub' ? 2 : 0
  }
  return [...nodes].sort((left, right) =>
    roleScore(right) - roleScore(left) || right.degree - left.degree || left.id.localeCompare(right.id),
  )
}

function labelCommunity(nodes: SnapshotNode[], representative: SnapshotNode) {
  const scores = new Map<string, { count: number; depth: number }>()
  for (const node of nodes) {
    const segments = node.filePath.split(/[\\/]/).filter(Boolean)
    const directories = segments.slice(0, -1)
    directories.forEach((segment, depth) => {
      const normalized = segment.toLowerCase()
      if (GENERIC_DIRECTORIES.has(normalized) || normalized.startsWith('.')) return
      const current = scores.get(segment) ?? { count: 0, depth }
      current.count += 1
      current.depth = Math.max(current.depth, depth)
      scores.set(segment, current)
    })
  }
  const best = [...scores.entries()].sort((left, right) =>
    right[1].count - left[1].count || right[1].depth - left[1].depth || left[0].localeCompare(right[0]),
  )[0]
  return best?.[0] || labelFromNode(representative)
}

function labelFromNode(node: SnapshotNode) {
  const directory = directoryKey(node.filePath)
  return directory === '(project)' ? node.name : directory.split('/').pop() || node.name
}

function directoryKey(filePath: string) {
  const normalized = filePath.replaceAll('\\', '/')
  const slash = normalized.lastIndexOf('/')
  return slash > 0 ? normalized.slice(0, slash) : '(project)'
}

function groupMap(labels: Map<string, string>) {
  const groups = new Map<string, string[]>()
  for (const [nodeId, community] of labels) {
    const members = groups.get(community) ?? []
    members.push(nodeId)
    groups.set(community, members)
  }
  return groups
}

function groupBy<T>(items: T[], keyFor: (item: T) => string) {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFor(item)
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  return groups
}

function edgeWeight(kind: string) {
  switch (kind) {
    case 'calls':
      return 3
    case 'extends':
    case 'implements':
      return 2.6
    case 'imports':
      return 2.2
    case 'references':
      return 1.35
    case 'contains':
      return 0.18
    default:
      return 1
  }
}

function sum(values: Iterable<number>) {
  let total = 0
  for (const value of values) total += value
  return total
}

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

const GENERIC_DIRECTORIES = new Set([
  'src',
  'source',
  'lib',
  'libs',
  'include',
  'internal',
])
