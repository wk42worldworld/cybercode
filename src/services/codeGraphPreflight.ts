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

const PREFLIGHT_TOKEN_BUDGET = 640
const ARCHITECTURE_TOKEN_BUDGET = 320
const SEARCH_RESULT_TOKEN_BUDGET = 320
const MAX_CONTEXT_NODES = 18
const MAX_CONTEXT_EDGES = 96
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

export type CodeGraphFileMatch = {
  filePath: string
  line?: number
}

export function isBroadTextSearchCommand(command: string) {
  return /(?:^|[\s;&|()])(?:grep|rg)(?=\s|$)/i.test(command)
}

export function extractCodeGraphFileMatches(
  searchRoot: string,
  output: string,
): CodeGraphFileMatch[] {
  const matches = new Map<string, CodeGraphFileMatch>()
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.replace(/\x1B\[[0-9;]*m/g, '').trim()
    if (!line) continue
    const numbered = /^((?:[A-Za-z]:[\\/])?.+?):(\d+)(?::|$)/.exec(line)
    const candidates: CodeGraphFileMatch[] = numbered
      ? [{ filePath: numbered[1]!, line: Number(numbered[2]) }]
      : [{ filePath: line }]
    for (const candidate of candidates) {
      const absolutePath = path.isAbsolute(candidate.filePath)
        ? candidate.filePath
        : path.resolve(searchRoot, candidate.filePath)
      try {
        if (!fs.statSync(absolutePath).isFile()) continue
      } catch {
        continue
      }
      const key = `${path.resolve(absolutePath)}\0${candidate.line ?? ''}`
      matches.set(key, { ...candidate, filePath: absolutePath })
      if (matches.size >= 24) return [...matches.values()]
    }
  }
  return [...matches.values()]
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
  return CODE_ACTION.test(normalized) && (
    CODE_SHAPED_TOKEN.test(normalized) || SOFTWARE_SCOPE.test(normalized)
  )
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
  let body = terms.length > 0
    ? buildSymbolContext(dbPath, projectPath, prompt, terms, signal)
    : getArchitectureContext(dbPath)
  if (
    !body &&
    !CODE_SHAPED_TOKEN.test(prompt) &&
    SOFTWARE_SCOPE.test(prompt)
  ) {
    body = getArchitectureContext(dbPath)
  }
  if (!body || signal.aborted) return null

  return limitTextToTokenBudget([
    '<codegraph_context note="Graph-ranked context; treat it as already read. Use graph tools before broad file scans.">',
    body,
    '</codegraph_context>',
  ].join('\n'), PREFLIGHT_TOKEN_BUDGET)
}

export function buildCodeGraphFileContext(
  searchRoot: string,
  matches: ReadonlyArray<CodeGraphFileMatch>,
  signal: AbortSignal = new AbortController().signal,
): string | null {
  if (signal.aborted || !isCodeGraphEnabled()) return null
  const projectPath = resolveIndexedProject(searchRoot)
  if (!projectPath) return null
  const dbPath = path.join(projectPath, '.codegraph', 'codegraph.db')
  if (!fs.existsSync(dbPath)) return null

  const normalizedMatches = normalizeFileMatches(projectPath, searchRoot, matches)
  if (normalizedMatches.length === 0) return null

  const db = openCodeGraphDatabaseForRead(dbPath)
  try {
    const seedById = new Map<string, PreflightNode>()
    for (const match of normalizedMatches.slice(0, 16)) {
      const rows = findNodesForFileMatch(db, match)
      for (const row of rows) {
        const node = normalizeNode(row)
        seedById.set(node.id, node)
        if (seedById.size >= 12) break
      }
      if (seedById.size >= 12 || signal.aborted) break
    }
    if (seedById.size === 0 || signal.aborted) return null

    const seeds = [...seedById.values()]
    const edges = readEdgesForNodeIds(db, seeds.map((node) => node.id), 40)
    const relatedIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]))
    const nodes = readNodesById(db, [...relatedIds])
    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    for (const seed of seeds) nodeById.set(seed.id, seed)

    const lines = [
      '<codegraph_context note="Exact-text search hits mapped to owning symbols and graph impact.">',
      '# Code Graph mapping for search results',
      '',
      '## Owning symbols',
    ]
    for (const node of seeds.slice(0, 10)) {
      lines.push(
        `- ${node.qualifiedName || node.name} (${node.kind}, ${node.filePath}:${node.startLine})`,
      )
    }

    const visibleEdges = edges.filter((edge) =>
      nodeById.has(edge.source) && nodeById.has(edge.target),
    )
    if (visibleEdges.length > 0) {
      lines.push('', '## Impact relationships')
      for (const edge of visibleEdges.slice(0, 12)) {
        const source = nodeById.get(edge.source)
        const target = nodeById.get(edge.target)
        if (!source || !target) continue
        lines.push(
          `- ${source.name} --${edge.kind}/${confidenceForProvenance(edge.provenance)}--> ${target.name}`,
        )
      }
    }
    lines.push(
      '',
      'Use the exact search hits for literals, then inspect these owning or dependent symbols before broader reads.',
      '</codegraph_context>',
    )
    return limitTextToTokenBudget(lines.join('\n'), SEARCH_RESULT_TOKEN_BUDGET)
  } catch (error) {
    if (process.env.NODE_ENV === 'test') throw error
    return null
  } finally {
    db.close()
  }
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
    if (seeds.length === 0) return null
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

function normalizeFileMatches(
  projectPath: string,
  searchRoot: string,
  matches: ReadonlyArray<CodeGraphFileMatch>,
) {
  let basePath = searchRoot
  try {
    if (fs.statSync(basePath).isFile()) basePath = path.dirname(basePath)
  } catch {
    return []
  }

  const normalized = new Map<string, { filePath: string; line?: number }>()
  for (const match of matches) {
    const unresolvedPath = path.isAbsolute(match.filePath)
      ? path.resolve(match.filePath)
      : path.resolve(basePath, match.filePath)
    let absolutePath: string
    try {
      absolutePath = fs.realpathSync.native(unresolvedPath)
    } catch {
      continue
    }
    const relativePath = path.relative(projectPath, absolutePath)
    if (
      !relativePath ||
      relativePath.startsWith('..') ||
      path.isAbsolute(relativePath)
    ) {
      continue
    }
    const filePath = relativePath.split(path.sep).join('/')
    const line = Number.isInteger(match.line) && Number(match.line) > 0
      ? Number(match.line)
      : undefined
    normalized.set(`${filePath}\0${line ?? ''}`, { filePath, line })
    if (normalized.size >= 24) break
  }
  return [...normalized.values()]
}

function findNodesForFileMatch(
  db: Database,
  match: { filePath: string; line?: number },
) {
  const fileExpression = "replace(file_path, '\\', '/')"
  const baseSelect = `
    SELECT id, kind, name, qualified_name, file_path, language,
      start_line, end_line, ${nodeColumn(db, 'signature', 'NULL')} AS signature
    FROM nodes
    WHERE ${fileExpression} IN (?, ?)
  `
  if (match.line !== undefined) {
    const exact = db.query<NodeRow, [string, string, number, number]>(`
      ${baseSelect}
        AND start_line <= ? AND end_line >= ?
      ORDER BY (end_line - start_line) ASC,
        CASE WHEN kind IN ('class', 'function', 'method', 'interface') THEN 0 ELSE 1 END
      LIMIT 2
    `).all(match.filePath, `./${match.filePath}`, match.line, match.line)
    if (exact.length > 0) return exact
  }
  return db.query<NodeRow, [string, string]>(`
    ${baseSelect}
      AND kind NOT IN ('file', 'module')
    ORDER BY CASE WHEN kind IN ('class', 'function', 'method', 'interface') THEN 0 ELSE 1 END,
      (end_line - start_line) DESC
    LIMIT 2
  `).all(match.filePath, `./${match.filePath}`)
}

function readEdgesForNodeIds(db: Database, ids: string[], limit: number) {
  if (ids.length === 0) return []
  const columns = new Set(
    db.query<{ name: string }, []>('PRAGMA table_info(edges)').all().map((column) => column.name),
  )
  const lineExpression = columns.has('line') ? 'line' : 'NULL'
  const provenanceExpression = columns.has('provenance') ? 'provenance' : 'NULL'
  const placeholders = ids.map(() => '?').join(', ')
  return db.query<{
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
  `).all(...ids, ...ids, limit).map((edge): PreflightEdge => ({
    source: edge.source,
    target: edge.target,
    kind: edge.kind,
    line: edge.line === null ? null : Number(edge.line),
    provenance: edge.provenance,
  }))
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
    `Query: ${prompt.slice(0, 180)}`,
    '',
    '## Relevant symbols',
  ]
  for (const node of nodes.slice(0, 10)) {
    lines.push(
      `- ${node.qualifiedName || node.name} (${node.kind}, ${node.filePath}:${node.startLine})` +
      `${node.signature ? ` — ${node.signature}` : ''}`,
    )
  }

  if (edges.length > 0) {
    lines.push('', '## Relationships')
    for (const edge of edges.slice(0, 16)) {
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
    .slice(0, 2)
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
  return limitTextToTokenBudget(lines.join('\n'), PREFLIGHT_TOKEN_BUDGET - 80)
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
    const end = Math.min(lines.length, Math.max(start + 1, Math.min(node.endLine, node.startLine + 35)))
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
      ARCHITECTURE_TOKEN_BUDGET,
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
  for (const [pattern, aliases] of QUERY_TERM_ALIASES) {
    if (!pattern.test(prompt)) continue
    for (const alias of aliases) {
      terms.add(alias)
      if (terms.size >= 8) return [...terms]
    }
  }
  for (const candidate of candidates) {
    const normalized = candidate.replace(/^[./\\-]+|[.,;:!?]+$/g, '')
    if (normalized.length < 2 || QUERY_STOP_WORDS.has(normalized.toLowerCase())) continue
    terms.add(normalized)
    if (terms.size >= 8) break
  }
  return [...terms]
}

export function resolveIndexedProject(cwd: string) {
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

export function isCodeGraphEnabled() {
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
const CODE_ACTION = /\b(?:add|build|create|debug|explain|find|fix|implement|modify|refactor|remove|rename|review|trace|update)\b|修复|修改|重构|查找|解释|分析|调试|实现|更新|删除|重命名|新增|添加|开发|创建|建立|写一个|看看|怎么|如何/i
const SOFTWARE_SCOPE = /\b(?:api|app|application|attachment|button|cache|chat|code|codebase|component|config|database|dialog|feature|file|form|index|login|memory|menu|message|modal|model|page|permission|preferences?|project|provider|release|server|session|setting|sidebar|test|theme|tool|upload|window)\b|代码|项目|功能|设置|設定|偏好|页面|頁面|组件|元件|按钮|按鈕|弹窗|彈窗|对话框|對話框|窗口|窗口|主题|主題|模式|会话|會話|聊天|消息|模型|厂商|廠商|工具|权限|權限|上传|上傳|附件|文件|目录|目錄|接口|介面|服务|服務|数据库|資料庫|索引|缓存|快取|内存|記憶體|测试|測試|构建|構建|发布|發布|登录|登錄|用户|使用者|侧边栏|側邊欄|菜单|選單|表单|表單|图谱|圖譜|记忆|記憶/i
const QUERY_TERM_ALIASES: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/深色|暗色|黑暗/i, ['dark', 'theme']],
  [/主题|主題/i, ['theme']],
  [/偏好|设置|設定/i, ['settings', 'preferences']],
  [/模式/i, ['mode']],
  [/会话|會話/i, ['session']],
  [/聊天|消息/i, ['chat', 'message']],
  [/模型/i, ['model']],
  [/厂商|廠商/i, ['provider']],
  [/上传|上傳|附件/i, ['upload', 'attachment']],
  [/权限|權限|授权|授權/i, ['permission']],
  [/代码图谱|代碼圖譜|图谱|圖譜/i, ['codegraph', 'graph']],
  [/索引/i, ['index']],
  [/记忆|記憶/i, ['memory']],
  [/登录|登錄/i, ['login', 'auth']],
  [/侧边栏|側邊欄/i, ['sidebar']],
  [/弹窗|彈窗|对话框|對話框/i, ['dialog', 'modal']],
]
const QUERY_STOP_WORDS = new Set([
  'a', 'an', 'analyze', 'analyse', 'and', 'architecture', 'architectural', 'blast', 'call', 'caller', 'callers',
  'chain', 'change', 'code', 'control', 'data', 'dependency', 'dependencies', 'dependent',
  'dependents', 'does', 'entry', 'explain', 'find', 'fix', 'flow', 'from', 'how', 'impact',
  'implementation', 'in', 'is', 'main', 'major', 'module', 'modules', 'of', 'overview', 'please',
  'point', 'project', 'radius', 'relationship', 'review', 'structure', 'subsystem', 'system', 'the',
  'this', 'to', 'trace', 'update', 'where', 'with', 'work', 'working', 'works',
])
