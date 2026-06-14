import { type Database } from 'bun:sqlite'
import { sanitizePath as sanitizePortablePath } from '../utils/sessionStoragePortable.js'
import { openSessionSearchDb } from './db.js'
import { ensureSessionSearchIndexFresh } from './indexer.js'

export type SessionSearchMessage = {
  id: number
  role: string
  type: string
  content: string
  timestamp: string | null
  model: string | null
  line: number
  anchor?: boolean
}

export type SessionSearchHit = {
  sessionId: string
  projectPath: string
  workDir: string | null
  title: string
  matchedRole?: string
  matchMessageId?: number
  snippet?: string
  messages: SessionSearchMessage[]
  bookendStart?: SessionSearchMessage[]
  bookendEnd?: SessionSearchMessage[]
  messagesBefore?: number
  messagesAfter?: number
  matchCount: number
  matches: Array<{ line: number; text: string }>
}

export type SessionSearchResult =
  | {
      success: true
      mode: 'browse'
      results: SessionSearchHit[]
      count: number
    }
  | {
      success: true
      mode: 'discover'
      query: string
      results: SessionSearchHit[]
      count: number
    }
  | {
      success: true
      mode: 'read' | 'scroll'
      sessionId: string
      projectPath: string
      title: string
      messages: SessionSearchMessage[]
      messagesBefore: number
      messagesAfter: number
      count: number
    }

type SessionRow = {
  session_key: string
  session_id: string
  project_path: string
  work_dir: string | null
  title: string
  created_at: string
  modified_at: string
  message_count: number
}

type MessageRow = {
  id: number
  role: string
  type: string
  content_text: string
  timestamp: string | null
  model: string | null
  line_no: number
}

type MatchRow = MessageRow & {
  session_key: string
  session_id: string
  project_path: string
  snippet: string
}

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/

function isCjkQuery(query: string): boolean {
  return CJK_RE.test(query)
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

function normalizeLimit(limit: number | undefined, fallback: number, max: number): number {
  const value = Number.isFinite(limit) ? Math.trunc(limit!) : fallback
  return Math.max(1, Math.min(max, value))
}

function normalizeProjectPath(project: string | undefined): string | undefined {
  return project ? sanitizePortablePath(project) : undefined
}

function shapeMessage(row: MessageRow, anchorId?: number): SessionSearchMessage {
  return {
    id: row.id,
    role: row.role,
    type: row.type,
    content: row.content_text,
    timestamp: row.timestamp,
    model: row.model,
    line: row.line_no,
    ...(anchorId === row.id ? { anchor: true } : {}),
  }
}

function getSessionRow(db: Database, params: {
  sessionId: string
  projectPath?: string
}): SessionRow | null {
  if (params.projectPath) {
    return db
      .query(
        `SELECT * FROM sessions
         WHERE session_id = ? AND project_path = ?
         ORDER BY modified_at DESC
         LIMIT 1`,
      )
      .get(params.sessionId, params.projectPath) as SessionRow | null
  }
  return db
    .query(
      `SELECT * FROM sessions
       WHERE session_id = ?
       ORDER BY modified_at DESC
       LIMIT 1`,
    )
    .get(params.sessionId) as SessionRow | null
}

function getMessagesForSession(db: Database, sessionKey: string): MessageRow[] {
  return db
    .query(
      `SELECT id, role, type, content_text, timestamp, model, line_no
       FROM messages
       WHERE session_key = ?
       ORDER BY line_no ASC, id ASC`,
    )
    .all(sessionKey) as MessageRow[]
}

function windowAround(params: {
  messages: MessageRow[]
  anchorId: number
  window: number
}): {
  rows: MessageRow[]
  before: number
  after: number
} {
  const anchorIndex = params.messages.findIndex(row => row.id === params.anchorId)
  if (anchorIndex < 0) return { rows: [], before: 0, after: 0 }
  const start = Math.max(0, anchorIndex - params.window)
  const end = Math.min(params.messages.length, anchorIndex + params.window + 1)
  return {
    rows: params.messages.slice(start, end),
    before: start,
    after: Math.max(0, params.messages.length - end),
  }
}

function getAnchoredHit(db: Database, match: MatchRow): SessionSearchHit | null {
  const session = db
    .query('SELECT * FROM sessions WHERE session_key = ?')
    .get(match.session_key) as SessionRow | null
  if (!session) return null
  const messages = getMessagesForSession(db, match.session_key)
  const window = windowAround({ messages, anchorId: match.id, window: 5 })
  if (window.rows.length === 0) return null
  return {
    sessionId: session.session_id,
    projectPath: session.project_path,
    workDir: session.work_dir,
    title: session.title,
    matchedRole: match.role,
    matchMessageId: match.id,
    snippet: match.snippet,
    messages: window.rows.map(row => shapeMessage(row, match.id)),
    bookendStart: messages.slice(0, 3).map(row => shapeMessage(row)),
    bookendEnd: messages.slice(-3).map(row => shapeMessage(row)),
    messagesBefore: window.before,
    messagesAfter: window.after,
    matchCount: 1,
    matches: [{ line: match.line_no, text: match.snippet || match.content_text }],
  }
}

function searchWithFts(params: {
  db: Database
  query: string
  limit: number
  project?: string
  currentSessionId?: string
  roleFilter?: string[]
}): MatchRow[] {
  const useTrigram = isCjkQuery(params.query) && params.query.trim().length >= 3
  const ftsTable = useTrigram ? 'messages_fts_trigram' : 'messages_fts'
  const ftsQuery = useTrigram
    ? escapeFtsPhrase(params.query.trim())
    : buildFtsQuery(params.query)
  const where = [`${ftsTable} MATCH ?`]
  const values: unknown[] = [ftsQuery]

  if (params.project) {
    where.push('m.project_path = ?')
    values.push(params.project)
  }
  if (params.currentSessionId) {
    where.push('m.session_id <> ?')
    values.push(params.currentSessionId)
  }
  if (params.roleFilter && params.roleFilter.length > 0) {
    where.push(`m.role IN (${params.roleFilter.map(() => '?').join(', ')})`)
    values.push(...params.roleFilter)
  }

  values.push(Math.max(params.limit * 8, params.limit))

  return params.db
    .query(
      `SELECT
        m.id, m.session_key, m.session_id, m.project_path, m.role, m.type,
        m.content_text, m.timestamp, m.model, m.line_no,
        snippet(${ftsTable}, 0, '>>>', '<<<', '...', 32) AS snippet
       FROM ${ftsTable}
       JOIN messages m ON m.id = ${ftsTable}.rowid
       WHERE ${where.join(' AND ')}
       ORDER BY bm25(${ftsTable})
       LIMIT ?`,
    )
    .all(...values) as MatchRow[]
}

function searchWithLike(params: {
  db: Database
  query: string
  limit: number
  project?: string
  currentSessionId?: string
  roleFilter?: string[]
}): MatchRow[] {
  const where = ['m.content_text LIKE ? ESCAPE \'\\\'']
  const values: unknown[] = [
    `%${params.query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`,
  ]
  if (params.project) {
    where.push('m.project_path = ?')
    values.push(params.project)
  }
  if (params.currentSessionId) {
    where.push('m.session_id <> ?')
    values.push(params.currentSessionId)
  }
  if (params.roleFilter && params.roleFilter.length > 0) {
    where.push(`m.role IN (${params.roleFilter.map(() => '?').join(', ')})`)
    values.push(...params.roleFilter)
  }
  values.push(Math.max(params.limit * 8, params.limit))
  return params.db
    .query(
      `SELECT
        m.id, m.session_key, m.session_id, m.project_path, m.role, m.type,
        m.content_text, m.timestamp, m.model, m.line_no,
        substr(m.content_text, 1, 240) AS snippet
       FROM messages m
       WHERE ${where.join(' AND ')}
       ORDER BY m.timestamp DESC, m.id DESC
       LIMIT ?`,
    )
    .all(...values) as MatchRow[]
}

export async function discoverSessionSearch(params: {
  query: string
  limit?: number
  project?: string
  currentSessionId?: string
  roleFilter?: string[]
  db?: Database
}): Promise<SessionSearchResult> {
  const query = params.query.trim()
  const limit = normalizeLimit(params.limit, 3, 10)
  const project = normalizeProjectPath(params.project)
  const ownDb = !params.db
  const db = params.db ?? openSessionSearchDb()
  try {
    await ensureSessionSearchIndexFresh({ project, db })
    let rows: MatchRow[] = []
    try {
      rows = searchWithFts({ ...params, project, query, limit, db })
    } catch {
      rows = searchWithLike({ ...params, project, query, limit, db })
    }
    if (rows.length === 0 && isCjkQuery(query)) {
      rows = searchWithLike({ ...params, project, query, limit, db })
    }

    const seen = new Set<string>()
    const results: SessionSearchHit[] = []
    for (const row of rows) {
      if (seen.has(row.session_key)) continue
      seen.add(row.session_key)
      const hit = getAnchoredHit(db, row)
      if (hit) results.push(hit)
      if (results.length >= limit) break
    }
    return {
      success: true,
      mode: 'discover',
      query,
      results,
      count: results.length,
    }
  } finally {
    if (ownDb) db.close()
  }
}

export async function browseSessionSearch(params: {
  limit?: number
  project?: string
  currentSessionId?: string
  db?: Database
} = {}): Promise<SessionSearchResult> {
  const limit = normalizeLimit(params.limit, 10, 50)
  const project = normalizeProjectPath(params.project)
  const ownDb = !params.db
  const db = params.db ?? openSessionSearchDb()
  try {
    await ensureSessionSearchIndexFresh({ project, db })
    const where: string[] = []
    const values: unknown[] = []
    if (project) {
      where.push('project_path = ?')
      values.push(project)
    }
    if (params.currentSessionId) {
      where.push('session_id <> ?')
      values.push(params.currentSessionId)
    }
    values.push(limit)
    const sessions = db
      .query(
        `SELECT * FROM sessions
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY modified_at DESC
         LIMIT ?`,
      )
      .all(...values) as SessionRow[]
    return {
      success: true,
      mode: 'browse',
      results: sessions.map(session => ({
        sessionId: session.session_id,
        projectPath: session.project_path,
        workDir: session.work_dir,
        title: session.title,
        messages: [],
        matchCount: 0,
        matches: [],
      })),
      count: sessions.length,
    }
  } finally {
    if (ownDb) db.close()
  }
}

export async function readSessionSearch(params: {
  sessionId: string
  projectPath?: string
  head?: number
  tail?: number
  db?: Database
}): Promise<SessionSearchResult | null> {
  const ownDb = !params.db
  const db = params.db ?? openSessionSearchDb()
  try {
    await ensureSessionSearchIndexFresh({ db })
    const session = getSessionRow(db, params)
    if (!session) return null
    const head = normalizeLimit(params.head, 20, 100)
    const tail = normalizeLimit(params.tail, 10, 100)
    const messages = getMessagesForSession(db, session.session_key)
    const truncated = messages.length > head + tail
    const rows = truncated ? [...messages.slice(0, head), ...messages.slice(-tail)] : messages
    return {
      success: true,
      mode: 'read',
      sessionId: session.session_id,
      projectPath: session.project_path,
      title: session.title,
      messages: rows.map(row => shapeMessage(row)),
      messagesBefore: 0,
      messagesAfter: Math.max(0, messages.length - rows.length),
      count: rows.length,
    }
  } finally {
    if (ownDb) db.close()
  }
}

export async function scrollSessionSearch(params: {
  sessionId: string
  aroundMessageId: number
  projectPath?: string
  window?: number
  db?: Database
}): Promise<SessionSearchResult | null> {
  const ownDb = !params.db
  const db = params.db ?? openSessionSearchDb()
  try {
    await ensureSessionSearchIndexFresh({ db })
    const session = getSessionRow(db, params)
    if (!session) return null
    const messages = getMessagesForSession(db, session.session_key)
    const view = windowAround({
      messages,
      anchorId: params.aroundMessageId,
      window: normalizeLimit(params.window, 5, 20),
    })
    if (view.rows.length === 0) return null
    return {
      success: true,
      mode: 'scroll',
      sessionId: session.session_id,
      projectPath: session.project_path,
      title: session.title,
      messages: view.rows.map(row => shapeMessage(row, params.aroundMessageId)),
      messagesBefore: view.before,
      messagesAfter: view.after,
      count: view.rows.length,
    }
  } finally {
    if (ownDb) db.close()
  }
}

export async function sessionSearch(params: {
  query?: string
  limit?: number
  project?: string
  currentSessionId?: string
  sessionId?: string
  aroundMessageId?: number
  window?: number
  projectPath?: string
  db?: Database
}): Promise<SessionSearchResult | null> {
  if (params.sessionId && params.aroundMessageId !== undefined) {
    return scrollSessionSearch({
      sessionId: params.sessionId,
      aroundMessageId: params.aroundMessageId,
      projectPath: params.projectPath,
      window: params.window,
      db: params.db,
    })
  }
  if (params.sessionId) {
    return readSessionSearch({
      sessionId: params.sessionId,
      projectPath: params.projectPath,
      db: params.db,
    })
  }
  if (params.query?.trim()) {
    return discoverSessionSearch({
      query: params.query,
      limit: params.limit,
      project: params.project,
      currentSessionId: params.currentSessionId,
      db: params.db,
    })
  }
  return browseSessionSearch({
    limit: params.limit,
    project: params.project,
    currentSessionId: params.currentSessionId,
    db: params.db,
  })
}
