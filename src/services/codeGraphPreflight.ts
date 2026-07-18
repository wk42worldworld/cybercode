import type { Database } from 'bun:sqlite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { QuerySource } from '../constants/querySource.js'
import type { Message } from '../types/message.js'
import { getCwd } from '../utils/cwd.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { getUserMessageText } from '../utils/messages.js'
import {
  confidenceForProvenance,
  formatCodeGraphArchitecture,
  getCodeGraphArchitecture,
} from '../server/services/codeGraphAnalysis.js'
import { openCodeGraphDatabaseForRead } from '../server/services/codeGraphDatabase.js'
import { limitTextToTokenBudget } from './codeGraphTextBudget.js'

const PREFLIGHT_TOKEN_BUDGET = 1_800
const MAX_CONTEXT_NODES = 36
const MAX_CONTEXT_EDGES = 260
const architectureCache = new Map<string, { fingerprint: string; text: string }>()

type PreflightNode = {
  id: string
  kind: string
  name: string
  qualifiedName: string
  filePath: string
  language: string
  startLine: number
  endLine: number
  signature: string | null
}

type PreflightEdge = {
  source: string
  target: string
  kind: string
  line: number | null
  provenance: string | null
}

export function startCodeGraphPreflight(
  messages: ReadonlyArray<Message>,
  querySource: QuerySource,
  signal: AbortSignal,
): Promise<string | null> | null {
  if (!isUserFacingQuery(querySource) || signal.aborted) return null
  const message = messages.findLast((candidate) =>
    candidate.type === 'user' && !candidate.isMeta,
  )
  const prompt = message ? getUserMessageText(message)?.trim() : null
  if (!prompt || !shouldRunCodeGraphPreflight(prompt)) return null

  const projectPath = resolveIndexedProject(getCwd())
  if (!projectPath || !isCodeGraphEnabled()) return null
  return Promise.resolve()
    .then(() => buildCodeGraphPreflight(projectPath, prompt, signal))
    .catch(() => null)
}

export function shouldRunCodeGraphPreflight(prompt: string) {
  const normalized = prompt.trim()
  if (normalized.length < 8 || normalized.length > 80_000) return false
  if (normalized.startsWith('/') && !normalized.includes(' ')) return false
  if (STRUCTURAL_INTENT.test(normalized)) return true
  return CODE_SHAPED_TOKEN.test(normalized) && CODE_ACTION.test(normalized)
}

export function buildCodeGraphPreflight(
  projectPath: string,
  prompt: string,
  signal: AbortSignal,
): string | null {
  if (signal.aborted) return null
  const dbPath = path.join(projectPath, '.codegraph', 'codegraph.db')
  if (!fs.existsSync(dbPath)) return null
  const terms = extractQueryTerms(prompt)
  const body = terms.length > 0
    ? buildSymbolContext(dbPath, projectPath, prompt, terms, signal)
    : getArchitectureContext(dbPath)
  if (!body || signal.aborted) return null

  return limitTextToTokenBudget([
    '<codegraph_context note="Automatic graph-ranked context for this prompt. Treat included source as already read; use Code Graph tools for deeper details before broad file scans.">',
    body,
    '</codegraph_context>',
  ].join('\n'), PREFLIGHT_TOKEN_BUDGET)
}

function buildSymbolContext(
  dbPath: string,
  projectPath: string,
  prompt: string,
  terms: string[],
  signal: AbortSignal,
) {
  const db = openCodeGraphDatabaseForRead(dbPath)
  try {
    const seeds = searchNodes(db, terms)
    if (seeds.length === 0) return getArchitectureContext(dbPath)
    if (signal.aborted) return null

    const columns = new Set(
      db.query<{ name: string }, []>('PRAGMA table_info(edges)').all().map((column) => column.name),
    )
    const lineExpression = columns.has('line') ? 'line' : 'NULL'
    const provenanceExpression = columns.has('provenance') ? 'provenance' : 'NULL'
    const selectedIds = new Set(seeds.map((node) => node.id))
    let frontier = new Set(selectedIds)
    const edgeByKey = new Map<string, PreflightEdge>()

    for (let depth = 0; depth < 2 && frontier.size > 0; depth += 1) {
      const ids = [...frontier]
      const placeholders = ids.map(() => '?').join(', ')
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
        WHERE source IN (${placeholders}) OR target IN (${placeholders})
        LIMIT ?
      `).all(...ids, ...ids, MAX_CONTEXT_EDGES)
      const next = new Set<string>()
      for (const edge of edges) {
        const normalized: PreflightEdge = {
          source: edge.source,
          target: edge.target,
          kind: edge.kind,
          line: edge.line === null ? null : Number(edge.line),
          provenance: edge.provenance,
        }
        edgeByKey.set(
          `${normalized.source}\0${normalized.target}\0${normalized.kind}\0${normalized.line ?? ''}`,
          normalized,
        )
        for (const nodeId of [edge.source, edge.target]) {
          if (selectedIds.size >= MAX_CONTEXT_NODES) break
          if (!selectedIds.has(nodeId)) {
            selectedIds.add(nodeId)
            next.add(nodeId)
          }
        }
      }
      frontier = next
      if (signal.aborted) return null
    }

    const nodes = readNodesById(db, [...selectedIds])
    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    const degree = new Map(nodes.map((node) => [node.id, 0]))
    const edges = [...edgeByKey.values()].filter((edge) =>
      nodeById.has(edge.source) && nodeById.has(edge.target),
    )
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
    }
    const seedIds = new Set(seeds.map((node) => node.id))
    const rankedNodes = [...nodes].sort((left, right) =>
      Number(seedIds.has(right.id)) - Number(seedIds.has(left.id)) ||
      (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0) ||
      left.qualifiedName.localeCompare(right.qualifiedName),
    )
    return formatSymbolContext(prompt, rankedNodes, edges, nodeById, projectPath)
  } finally {
    db.close()
  }
}

function searchNodes(db: Database, terms: string[]): PreflightNode[] {
  const cleanTerms = terms
    .flatMap((term) => term.split(/[.:/\\#-]+/))
    .map((term) => term.replace(/[^A-Za-z0-9_$]/g, ''))
    .filter((term) => term.length >= 2)
    .slice(0, 10)
  if (cleanTerms.length === 0) return []

  const hasFts = Boolean(db.query<{ name: string }, [string]>(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get('nodes_fts'))
  if (hasFts) {
    try {
      const ftsQuery = cleanTerms.map((term) => `"${term}"*`).join(' OR ')
      const rows = db.query<NodeRow, [string, number]>(`
        SELECT n.id, n.kind, n.name, n.qualified_name, n.file_path, n.language,
          n.start_line, n.end_line, n.signature
        FROM nodes_fts
        JOIN nodes n ON nodes_fts.id = n.id
        WHERE nodes_fts MATCH ?
        ORDER BY bm25(nodes_fts, 0, 20, 5, 1, 2)
        LIMIT ?
      `).all(ftsQuery, 12)
      if (rows.length > 0) return rows.map(normalizeNode)
    } catch {
      // Old or partially migrated indexes fall through to indexed LIKE lookup.
    }
  }

  const clauses = cleanTerms.map(() =>
    '(lower(name) LIKE ? OR lower(qualified_name) LIKE ? OR lower(file_path) LIKE ?)',
  )
  const params = cleanTerms.flatMap((term) => {
    const pattern = `%${term.toLowerCase()}%`
    return [pattern, pattern, pattern]
  })
  const rows = db.query<NodeRow, Array<string | number>>(`
    SELECT id, kind, name, qualified_name, file_path, language,
      start_line, end_line, ${nodeColumn(db, 'signature', 'NULL')} AS signature
    FROM nodes
    WHERE ${clauses.join(' OR ')}
    ORDER BY CASE WHEN kind IN ('class', 'function', 'method', 'interface') THEN 0 ELSE 1 END,
      name COLLATE NOCASE
    LIMIT ?
  `).all(...params, 12)
  return rows.map(normalizeNode)
}

function readNodesById(db: Database, ids: string[]) {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(', ')
  return db.query<NodeRow, string[]>(`
    SELECT id, kind, name, qualified_name, file_path, language,
      start_line, end_line, ${nodeColumn(db, 'signature', 'NULL')} AS signature
    FROM nodes
    WHERE id IN (${placeholders})
  `).all(...ids).map(normalizeNode)
}

function formatSymbolContext(
  prompt: string,
  nodes: PreflightNode[],
  edges: PreflightEdge[],
  nodeById: Map<string, PreflightNode>,
  projectPath: string,
) {
  const lines = [
    '# Automatic Code Graph Context',
    '',
    `Query: ${prompt.slice(0, 400)}`,
    '',
    '## Relevant symbols',
  ]
  for (const node of nodes.slice(0, 18)) {
    lines.push(
      `- ${node.qualifiedName || node.name} (${node.kind}, ${node.filePath}:${node.startLine})` +
      `${node.signature ? ` — ${node.signature}` : ''}`,
    )
  }

  if (edges.length > 0) {
    lines.push('', '## Relationships')
    for (const edge of edges.slice(0, 36)) {
      const source = nodeById.get(edge.source)
      const target = nodeById.get(edge.target)
      if (!source || !target) continue
      const confidence = confidenceForProvenance(edge.provenance)
      lines.push(
        `- ${source.name} --${edge.kind}/${confidence}--> ${target.name}` +
        `${edge.line ? ` (line ${edge.line})` : ''}`,
      )
    }
  }

  const sourceBlocks = nodes
    .filter((node) => node.kind !== 'file' && node.kind !== 'module')
    .map((node) => ({ node, source: readNodeSource(projectPath, node) }))
    .filter((entry): entry is { node: PreflightNode; source: string } => Boolean(entry.source))
    .slice(0, 5)
  if (sourceBlocks.length > 0) {
    lines.push('', '## Targeted source')
    for (const { node, source } of sourceBlocks) {
      lines.push(
        '',
        `### ${node.qualifiedName || node.name} — ${node.filePath}:${node.startLine}`,
        `\`\`\`${codeFenceLanguage(node.language)}`,
        source,
        '\`\`\`',
      )
    }
  }
  return limitTextToTokenBudget(lines.join('\n'), PREFLIGHT_TOKEN_BUDGET - 120)
}

function readNodeSource(projectPath: string, node: PreflightNode) {
  const filePath = path.resolve(projectPath, node.filePath)
  const relative = path.relative(projectPath, filePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return null
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
    const start = Math.max(0, node.startLine - 1)
    const end = Math.min(lines.length, Math.max(start + 1, Math.min(node.endLine, node.startLine + 70)))
    return lines.slice(start, end).join('\n').trim() || null
  } catch {
    return null
  }
}

function getArchitectureContext(dbPath: string) {
  try {
    const fingerprint = databaseFingerprint(dbPath)
    const cached = architectureCache.get(dbPath)
    if (cached?.fingerprint === fingerprint) return cached.text
    const text = limitTextToTokenBudget(
      formatCodeGraphArchitecture(getCodeGraphArchitecture(dbPath, 600)),
      PREFLIGHT_TOKEN_BUDGET - 120,
    )
    architectureCache.set(dbPath, { fingerprint, text })
    return text
  } catch {
    return null
  }
}

function databaseFingerprint(dbPath: string) {
  const files = [dbPath, `${dbPath}-wal`]
  return files.map((filePath) => {
    try {
      const stat = fs.statSync(filePath)
      return `${stat.size}:${stat.mtimeMs}`
    } catch {
      return '0:0'
    }
  }).join('|')
}

function extractQueryTerms(prompt: string) {
  const candidates = prompt.match(/[A-Za-z_$][A-Za-z0-9_$.:/\\-]{1,}/g) ?? []
  const terms = new Set<string>()
  for (const candidate of candidates) {
    const normalized = candidate.replace(/^[./\\-]+|[.,;:!?]+$/g, '')
    if (normalized.length < 2 || QUERY_STOP_WORDS.has(normalized.toLowerCase())) continue
    terms.add(normalized)
    if (terms.size >= 8) break
  }
  return [...terms]
}

function resolveIndexedProject(cwd: string) {
  let current: string
  try {
    current = fs.realpathSync.native(cwd)
  } catch {
    return null
  }
  const root = path.parse(current).root
  while (current !== root) {
    if (fs.existsSync(path.join(current, '.codegraph', 'codegraph.db'))) return current
    current = path.dirname(current)
  }
  return null
}

function isCodeGraphEnabled() {
  try {
    const config = JSON.parse(fs.readFileSync(
      path.join(getClaudeConfigHomeDir(), 'cybercode', 'codegraph.json'),
      'utf8',
    )) as {
      enabled?: boolean
      projects?: Record<string, { enabled?: boolean }>
    }
    if (typeof config.enabled === 'boolean') return config.enabled
    return Object.values(config.projects ?? {}).some((project) => project.enabled === true)
  } catch {
    return true
  }
}

function isUserFacingQuery(querySource: QuerySource) {
  return String(querySource).startsWith('repl_main_thread') || querySource === 'sdk'
}

function nodeColumn(db: Database, name: string, fallback: string) {
  const columns = new Set(
    db.query<{ name: string }, []>('PRAGMA table_info(nodes)').all().map((column) => column.name),
  )
  return columns.has(name) ? name : fallback
}

function normalizeNode(row: NodeRow): PreflightNode {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    qualifiedName: row.qualified_name,
    filePath: row.file_path,
    language: row.language,
    startLine: Number(row.start_line),
    endLine: Number(row.end_line),
    signature: row.signature,
  }
}

function codeFenceLanguage(language: string) {
  const normalized = language.toLowerCase()
  if (normalized === 'typescript') return 'ts'
  if (normalized === 'javascript') return 'js'
  if (normalized === 'python') return 'py'
  return normalized.replace(/[^a-z0-9_+-]/g, '')
}

type NodeRow = {
  id: string
  kind: string
  name: string
  qualified_name: string
  file_path: string
  language: string
  start_line: number
  end_line: number
  signature: string | null
}

const STRUCTURAL_INTENT = /\b(?:architecture|architectural|callers?|callees?|call\s+graph|call\s+chain|dependency|dependencies|dependents?|data\s*flow|control\s*flow|impact|blast\s+radius|module|subsystem|entry\s*point|trace|relationship|implementation|how\s+does|where\s+is)\b|架构|架構|调用|調用|调用链|調用鏈|依赖|依賴|影响|影響|数据流|資料流|入口|模块|模組|关系|關係|实现|實現|原理|机制|機制|流程|路径|路徑|追踪|追蹤|谁调用|誰調用/i
const CODE_SHAPED_TOKEN = /(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|[a-z][A-Za-z0-9$]*[A-Z][A-Za-z0-9$]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9$]*|[\w./\\-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|php|lua|sol|html))\b/
const CODE_ACTION = /\b(?:fix|change|modify|refactor|find|explain|trace|review|debug|implement|update|remove|rename)\b|修复|修改|重构|查找|解释|分析|调试|实现|更新|删除|重命名|看看|怎么|如何/i
const QUERY_STOP_WORDS = new Set([
  'a', 'an', 'analyze', 'analyse', 'and', 'architecture', 'architectural', 'blast', 'call', 'caller', 'callers',
  'chain', 'change', 'code', 'control', 'data', 'dependency', 'dependencies', 'dependent',
  'dependents', 'does', 'entry', 'explain', 'find', 'fix', 'flow', 'from', 'how', 'impact',
  'implementation', 'in', 'is', 'main', 'major', 'module', 'modules', 'of', 'overview', 'please',
  'point', 'project', 'radius', 'relationship', 'review', 'structure', 'subsystem', 'system', 'the',
  'this', 'to', 'trace', 'update', 'where', 'with', 'work', 'working', 'works',
])
