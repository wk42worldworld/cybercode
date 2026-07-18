import { createHash } from 'crypto'
import { homedir } from 'os'
import { type Database } from 'bun:sqlite'
import { openSessionSearchDb, sessionKey } from './db.js'
import type { ParsedSessionTranscript, TranscriptSearchMessage } from './transcript.js'

export type ProjectMemoryEntry = {
  id: number
  sessionId: string
  projectPath: string
  workDir: string | null
  title: string
  summary: string
  keywords: string
  source: string
  confidence: number
  createdAt: string
  updatedAt: string
}

type ProjectMemoryCandidate = Omit<ProjectMemoryEntry, 'id' | 'createdAt'>

type ProjectMemoryRow = {
  id: number
  session_key: string
  session_id: string
  project_path: string
  work_dir: string | null
  title: string
  summary: string
  keywords: string
  source: string
  confidence: number
  created_at: string
  updated_at: string
}

const MAX_NOTE_CHARS = 240
const MAX_SUMMARY_CHARS = 2400
const MAX_MEMORY_FILE_SUMMARY_CHARS = 6000
const MAX_CONTEXT_CHARS = 3200
const MAX_KEYWORDS_CHARS = 800
const PROJECT_SIGNAL_RE =
  /(项目|工作区|代码库|客户端|桌面端|应用|仓库|repo|repository|codebase|workspace|project|app|desktop|client|website|site|tool|cli)/i
const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/
const POSIX_PATH_RE = /(?:~|\/)(?:[^\s"'`<>|;&]+\/?)+/g
const WINDOWS_PATH_RE = /\b[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\?)+/g
const RELATIVE_FILE_RE =
  /(?:^|[\s"'`(])((?:\.{1,2}\/)?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.[A-Za-z0-9]{1,10})/g

function shapeRow(row: ProjectMemoryRow): ProjectMemoryEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectPath: row.project_path,
    workDir: row.work_dir,
    title: row.title,
    summary: row.summary,
    keywords: row.keywords,
    source: row.source,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function unique(values: string[], limit: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (result.length >= limit) break
  }
  return result
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized
}

function truncatePreservingLines(value: string, max: number): string {
  const normalized = value
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted-key]')
    .replace(/\bghp_[A-Za-z0-9_]{12,}\b/g, '[redacted-token]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{12,}\b/g, '[redacted-token]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '$1[redacted]')
    .replace(
      /\b(api[_-]?key|auth[_-]?token|password|passwd|token|secret)\b\s*[:=]\s*["']?[^"'\s,;]+/gi,
      '$1=[redacted]',
    )
    .replace(/\b[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}\b/g, '[redacted-password]')
}

function cleanNote(value: string): string {
  return truncate(redactSensitiveText(value), MAX_NOTE_CHARS)
}

function cleanMemoryFileSummary(value: string): string {
  return truncatePreservingLines(
    redactSensitiveText(value),
    MAX_MEMORY_FILE_SUMMARY_CHARS,
  )
}

function contextSummary(value: string): string {
  return truncate(redactSensitiveText(value), 1200)
}

function normalizePathCandidate(value: string): string {
  return redactSensitiveText(value)
    .replace(/[),.;:，。；、]+$/u, '')
    .trim()
}

function extractPaths(text: string): string[] {
  const paths: string[] = []
  for (const match of text.matchAll(WINDOWS_PATH_RE)) {
    paths.push(normalizePathCandidate(match[0]))
  }
  for (const match of text.matchAll(POSIX_PATH_RE)) {
    const value = normalizePathCandidate(match[0])
    if (value.startsWith('//') || value.length < 4) continue
    paths.push(value)
  }
  for (const match of text.matchAll(RELATIVE_FILE_RE)) {
    paths.push(normalizePathCandidate(match[1] ?? ''))
  }
  return unique(paths, 12)
}

function anyPathBasename(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/g, '')
  return normalized.split('/').filter(Boolean).pop() ?? normalized
}

function extractToolNote(message: TranscriptSearchMessage): string | null {
  const match = message.contentText.match(/^tool:([^\s]+)\s*(.*)$/s)
  if (!match) return null

  const toolName = match[1] ?? 'tool'
  const rawInput = match[2]?.trim()
  if (!rawInput) return toolName

  try {
    const parsed = JSON.parse(rawInput) as Record<string, unknown>
    const command = typeof parsed.command === 'string' ? parsed.command : ''
    const filePath =
      typeof parsed.file_path === 'string'
        ? parsed.file_path
        : typeof parsed.path === 'string'
          ? parsed.path
          : ''
    if (command) return `${toolName}: ${cleanNote(command)}`
    if (filePath) return `${toolName}: ${cleanNote(filePath)}`
  } catch {
    // Keep a compact fallback for non-JSON tool inputs.
  }

  return `${toolName}: ${cleanNote(rawInput)}`
}

function hasUsefulWorkDir(workDir: string | null): boolean {
  if (!workDir) return false
  const normalized = workDir.replace(/\/+$/g, '')
  const home = homedir().replace(/\/+$/g, '')
  return normalized.length > 1 && normalized !== home
}

function buildProjectMemoryCandidate(
  parsed: ParsedSessionTranscript,
): ProjectMemoryCandidate | null {
  if (!parsed.isTemporary || parsed.messages.length === 0) return null

  const visibleMessages = parsed.messages.filter(message => message.contentText.trim())
  const userNotes = unique(
    visibleMessages
      .filter(message => message.role === 'user' && message.type === 'user')
      .map(message => cleanNote(message.contentText)),
    5,
  )
  const assistantNotes = unique(
    visibleMessages
      .filter(message => message.role === 'assistant' && message.type === 'assistant')
      .slice(-4)
      .map(message => cleanNote(message.contentText)),
    4,
  )
  const toolNotes = unique(
    visibleMessages
      .filter(message => message.type === 'tool_use')
      .flatMap(message => {
        const note = extractToolNote(message)
        return note ? [note] : []
      }),
    6,
  )

  const combinedText = visibleMessages
    .map(message => message.contentText)
    .join('\n')
  const mentionedPaths = unique(
    [
      ...(parsed.workDir ? [parsed.workDir] : []),
      ...extractPaths(combinedText),
    ],
    12,
  )

  const hasProjectSignal = PROJECT_SIGNAL_RE.test(combinedText)
  const hasWorkDirSignal = hasUsefulWorkDir(parsed.workDir)
  const hasUsefulSignal =
    hasWorkDirSignal ||
    mentionedPaths.length > (parsed.workDir ? 1 : 0) ||
    toolNotes.length > 0 ||
    hasProjectSignal

  if (!hasUsefulSignal) return null

  let confidence = 0.25
  if (hasWorkDirSignal) confidence += 0.25
  if (mentionedPaths.length > (parsed.workDir ? 1 : 0)) confidence += 0.2
  if (toolNotes.length > 0) confidence += 0.2
  if (hasProjectSignal) confidence += 0.15
  if (userNotes.length >= 2) confidence += 0.05
  confidence = Math.min(1, confidence)

  if (confidence < 0.35) return null

  const lines = [
    `Session title: ${cleanNote(parsed.title)}`,
    parsed.workDir ? `Working directory: ${cleanNote(parsed.workDir)}` : '',
    userNotes.length > 0 ? 'User requests:' : '',
    ...userNotes.map(note => `- ${note}`),
    assistantNotes.length > 0 ? 'Assistant/work notes:' : '',
    ...assistantNotes.map(note => `- ${note}`),
    mentionedPaths.length > 0 ? 'Mentioned paths:' : '',
    ...mentionedPaths.map(path => `- ${cleanNote(path)}`),
    toolNotes.length > 0 ? 'Commands/tools:' : '',
    ...toolNotes.map(note => `- ${note}`),
  ].filter(Boolean)

  const pathKeywords = mentionedPaths.map(anyPathBasename)
  const keywords = unique(
    [
      parsed.title,
      ...(parsed.workDir ? [anyPathBasename(parsed.workDir)] : []),
      ...pathKeywords,
      ...toolNotes.map(note => note.split(':')[0] ?? ''),
    ].map(value => truncate(value, 80)),
    20,
  ).join(' ').slice(0, MAX_KEYWORDS_CHARS)

  return {
    sessionId: parsed.sessionId,
    projectPath: parsed.projectPath,
    workDir: parsed.workDir,
    title: cleanNote(parsed.title) || 'Temporary Session',
    summary: lines.join('\n').slice(0, MAX_SUMMARY_CHARS),
    keywords,
    source: 'temporary-session',
    confidence,
    updatedAt: parsed.modifiedAt,
  }
}

export function deleteProjectMemoryBySessionKey(db: Database, key: string): void {
  const rows = db
    .query('SELECT id FROM project_memories WHERE session_key = ?')
    .all(key) as Array<{ id: number }>
  const deleteFts = db.query('DELETE FROM project_memories_fts WHERE rowid = ?')
  const deleteTrigram = db.query('DELETE FROM project_memories_fts_trigram WHERE rowid = ?')
  for (const row of rows) {
    deleteFts.run(row.id)
    deleteTrigram.run(row.id)
  }
  db.query('DELETE FROM project_memories WHERE session_key = ?').run(key)
}

export function upsertProjectMemoryForParsedSession(
  db: Database,
  parsed: ParsedSessionTranscript,
): void {
  const key = sessionKey(parsed.projectPath, parsed.sessionId)
  const candidate = buildProjectMemoryCandidate(parsed)
  if (!candidate) {
    deleteProjectMemoryBySessionKey(db, key)
    return
  }

  const existing = db
    .query('SELECT id, created_at FROM project_memories WHERE session_key = ?')
    .get(key) as { id: number; created_at: string } | null

  if (existing) {
    db.query('DELETE FROM project_memories_fts WHERE rowid = ?').run(existing.id)
    db.query('DELETE FROM project_memories_fts_trigram WHERE rowid = ?').run(existing.id)
  }

  db.query(
    `INSERT INTO project_memories (
      session_key, session_id, project_path, work_dir, title, summary,
      keywords, source, confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET
      project_path = excluded.project_path,
      work_dir = excluded.work_dir,
      title = excluded.title,
      summary = excluded.summary,
      keywords = excluded.keywords,
      source = excluded.source,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at`,
  ).run(
    key,
    candidate.sessionId,
    candidate.projectPath,
    candidate.workDir,
    candidate.title,
    candidate.summary,
    candidate.keywords,
    candidate.source,
    candidate.confidence,
    existing?.created_at ?? parsed.createdAt,
    candidate.updatedAt,
  )

  const row = db
    .query('SELECT id FROM project_memories WHERE session_key = ?')
    .get(key) as { id: number } | null
  if (!row) return

  db.query(
    `INSERT INTO project_memories_fts(rowid, summary, title, keywords, work_dir)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(row.id, candidate.summary, candidate.title, candidate.keywords, candidate.workDir ?? '')
  db.query(
    `INSERT INTO project_memories_fts_trigram(rowid, summary, title, keywords, work_dir)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(row.id, candidate.summary, candidate.title, candidate.keywords, candidate.workDir ?? '')
}

export function projectMemoryFileSessionId(filePath: string): string {
  const hash = createHash('sha256')
    .update(filePath.normalize('NFC'))
    .digest('hex')
    .slice(0, 32)
  return `memory-file-${hash}`
}

export function projectMemoryFileSessionKey(params: {
  projectPath: string
  filePath: string
}): string {
  return sessionKey(params.projectPath, projectMemoryFileSessionId(params.filePath))
}

export function upsertProjectMemoryFile(
  db: Database,
  params: {
    filePath: string
    projectPath: string
    workDir: string | null
    title: string
    content: string
    keywords?: string[]
    source: 'auto-memory-file' | 'prompt-memory'
    createdAt: string
    updatedAt: string
  },
): { sessionKey: string; sessionId: string } | null {
  const summary = cleanMemoryFileSummary(params.content)
  if (!summary) return null

  const sessionId = projectMemoryFileSessionId(params.filePath)
  const key = sessionKey(params.projectPath, sessionId)
  const title = cleanNote(params.title) || 'Memory File'
  const keywords = unique(
    [
      title,
      params.projectPath,
      params.workDir ?? '',
      params.filePath,
      ...(params.keywords ?? []),
    ].map(value => truncate(value, 80)),
    24,
  ).join(' ').slice(0, MAX_KEYWORDS_CHARS)

  const existing = db
    .query('SELECT id, created_at FROM project_memories WHERE session_key = ?')
    .get(key) as { id: number; created_at: string } | null

  if (existing) {
    db.query('DELETE FROM project_memories_fts WHERE rowid = ?').run(existing.id)
    db.query('DELETE FROM project_memories_fts_trigram WHERE rowid = ?').run(existing.id)
  }

  db.query(
    `INSERT INTO project_memories (
      session_key, session_id, project_path, work_dir, title, summary,
      keywords, source, confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET
      project_path = excluded.project_path,
      work_dir = excluded.work_dir,
      title = excluded.title,
      summary = excluded.summary,
      keywords = excluded.keywords,
      source = excluded.source,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at`,
  ).run(
    key,
    sessionId,
    params.projectPath,
    params.workDir,
    title,
    summary,
    keywords,
    params.source,
    1,
    existing?.created_at ?? params.createdAt,
    params.updatedAt,
  )

  const row = db
    .query('SELECT id FROM project_memories WHERE session_key = ?')
    .get(key) as { id: number } | null
  if (!row) return null

  db.query(
    `INSERT INTO project_memories_fts(rowid, summary, title, keywords, work_dir)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(row.id, summary, title, keywords, params.workDir ?? '')
  db.query(
    `INSERT INTO project_memories_fts_trigram(rowid, summary, title, keywords, work_dir)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(row.id, summary, title, keywords, params.workDir ?? '')

  return { sessionKey: key, sessionId }
}

function escapeFtsPhrase(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function buildFtsQuery(query: string): string {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean)
  if (tokens.length === 0) return escapeFtsPhrase(query.trim())
  return tokens.map(escapeFtsPhrase).join(' AND ')
}

function isCjkQuery(query: string): boolean {
  return CJK_RE.test(query)
}

function likePattern(query: string): string {
  return `%${query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
}

function searchProjectMemoriesWithFts(params: {
  db: Database
  query: string
  limit: number
  currentSessionId?: string
  includePromptMemory: boolean
}): ProjectMemoryRow[] {
  const useTrigram = isCjkQuery(params.query) && params.query.trim().length >= 3
  const ftsTable = useTrigram ? 'project_memories_fts_trigram' : 'project_memories_fts'
  const ftsQuery = useTrigram
    ? escapeFtsPhrase(params.query.trim())
    : buildFtsQuery(params.query)
  const where = [`${ftsTable} MATCH ?`]
  const values: unknown[] = [ftsQuery]

  if (params.currentSessionId) {
    where.push('pm.session_id <> ?')
    values.push(params.currentSessionId)
  }
  if (!params.includePromptMemory) {
    where.push('pm.source <> ?')
    values.push('prompt-memory')
  }
  values.push(params.limit)

  return params.db
    .query(
      `SELECT pm.*
       FROM ${ftsTable}
       JOIN project_memories pm ON pm.id = ${ftsTable}.rowid
       WHERE ${where.join(' AND ')}
       ORDER BY bm25(${ftsTable}), pm.updated_at DESC
       LIMIT ?`,
    )
    .all(...values) as ProjectMemoryRow[]
}

function searchProjectMemoriesWithLike(params: {
  db: Database
  query: string
  limit: number
  currentSessionId?: string
  includePromptMemory: boolean
}): ProjectMemoryRow[] {
  const where = [
    `(summary LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR keywords LIKE ? ESCAPE '\\' OR work_dir LIKE ? ESCAPE '\\')`,
  ]
  const pattern = likePattern(params.query)
  const values: unknown[] = [pattern, pattern, pattern, pattern]
  if (params.currentSessionId) {
    where.push('session_id <> ?')
    values.push(params.currentSessionId)
  }
  if (!params.includePromptMemory) {
    where.push('source <> ?')
    values.push('prompt-memory')
  }
  values.push(params.limit)

  return params.db
    .query(
      `SELECT *
       FROM project_memories
       WHERE ${where.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(...values) as ProjectMemoryRow[]
}

function recentProjectMemoryRows(params: {
  db: Database
  limit: number
  currentSessionId?: string
  includePromptMemory: boolean
}): ProjectMemoryRow[] {
  const where: string[] = []
  const values: unknown[] = []
  if (params.currentSessionId) {
    where.push('session_id <> ?')
    values.push(params.currentSessionId)
  }
  if (!params.includePromptMemory) {
    where.push('source <> ?')
    values.push('prompt-memory')
  }
  values.push(params.limit)

  return params.db
    .query(
      `SELECT *
       FROM project_memories
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(...values) as ProjectMemoryRow[]
}

export function searchProjectMemories(params: {
  query?: string
  limit?: number
  currentSessionId?: string
  includeRecentFallback?: boolean
  includePromptMemory?: boolean
  db?: Database
}): ProjectMemoryEntry[] {
  const limit = Math.max(1, Math.min(8, Math.trunc(params.limit ?? 4)))
  const query = params.query?.trim() ?? ''
  const includePromptMemory = params.includePromptMemory !== false
  const ownDb = !params.db
  const db = params.db ?? openSessionSearchDb()
  try {
    const rows: ProjectMemoryRow[] = []
    const seen = new Set<number>()
    const addRows = (items: ProjectMemoryRow[]) => {
      for (const item of items) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        rows.push(item)
        if (rows.length >= limit) break
      }
    }

    if (query) {
      try {
        addRows(searchProjectMemoriesWithFts({
          db,
          query,
          limit,
          currentSessionId: params.currentSessionId,
          includePromptMemory,
        }))
      } catch {
        addRows(searchProjectMemoriesWithLike({
          db,
          query,
          limit,
          currentSessionId: params.currentSessionId,
          includePromptMemory,
        }))
      }
      if (rows.length === 0 && isCjkQuery(query)) {
        addRows(searchProjectMemoriesWithLike({
          db,
          query,
          limit,
          currentSessionId: params.currentSessionId,
          includePromptMemory,
        }))
      }
    }

    if (
      rows.length < limit &&
      (!query || params.includeRecentFallback !== false)
    ) {
      addRows(recentProjectMemoryRows({
        db,
        limit,
        currentSessionId: params.currentSessionId,
        includePromptMemory,
      }))
    }

    return rows.slice(0, limit).map(shapeRow)
  } finally {
    if (ownDb) db.close()
  }
}

export function buildProjectMemoryPromptContext(params: {
  query?: string
  limit?: number
  currentSessionId?: string
  includePromptMemory?: boolean
  db?: Database
}): string | null {
  const memories = searchProjectMemories({
    ...params,
    includeRecentFallback: true,
  })
  if (memories.length === 0) return null

  const chunks: string[] = [
    params.includePromptMemory === false
      ? 'Lightweight memories from CyberCode sessions and project memory files follow. Use them only if they are relevant to the current request; if they conflict with the current request, prefer the current request.'
      : 'Lightweight memories from CyberCode sessions, project memory files, and prompt memory follow. Use them only if they are relevant to the current request; if they conflict with the current request, prefer the current request.',
  ]

  for (const [index, memory] of memories.entries()) {
    const chunk = [
      `Memory ${index + 1}`,
      `Title: ${memory.title}`,
      memory.workDir ? `Work directory: ${memory.workDir}` : '',
      `Source: ${memory.source}`,
      `Updated: ${memory.updatedAt}`,
      `Summary:\n${contextSummary(memory.summary)}`,
    ].filter(Boolean).join('\n')

    const next = [...chunks, chunk].join('\n\n')
    if (next.length > MAX_CONTEXT_CHARS) break
    chunks.push(chunk)
  }

  return chunks.join('\n\n')
}

export const projectMemoryForTesting = {
  buildProjectMemoryCandidate,
  extractPaths,
  projectMemoryFileSessionId,
  redactSensitiveText,
}
