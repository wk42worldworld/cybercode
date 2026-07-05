import type { Dirent } from 'fs'
import { readFile, readdir, rm, stat } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'path'
import { type Database } from 'bun:sqlite'
import { getMemoryBaseDir } from '../memdir/paths.js'
import {
  BRIEF_FILENAME,
  USER_PROMPT_MEMORY_FILENAME,
  getBriefPath,
  getPromptMemoryDir,
  getUserPromptMemoryPath,
} from '../promptMemory/paths.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { sanitizePath as sanitizePortablePath } from '../utils/sessionStoragePortable.js'
import { openSessionSearchDb, sessionKey } from './db.js'
import { getSessionSearchDbPath } from './paths.js'
import {
  deleteProjectMemoryBySessionKey,
  projectMemoryFileSessionId,
  upsertProjectMemoryForParsedSession,
  upsertProjectMemoryFile,
} from './projectMemory.js'
import { parseSessionTranscript, type ParsedSessionTranscript } from './transcript.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SessionFileInfo = {
  filePath: string
  projectPath: string
  sessionId: string
}

type HistoryLogEntry = {
  display?: string
  timestamp?: number | string
  project?: string
  sessionId?: string
}

type MemoryFileInfo = {
  filePath: string
  projectPath: string
  workDir: string | null
  title: string
  keywords: string[]
  source: 'auto-memory-file' | 'prompt-memory'
}

function getProjectsDir(): string {
  return join(getClaudeConfigHomeDir(), 'projects')
}

function getAutoMemoryProjectsDir(): string {
  return join(getMemoryBaseDir(), 'projects')
}

function activeSessionFilePath(filePath: string): string {
  return filePath.endsWith('.jsonl.placeholder')
    ? filePath.slice(0, -'.placeholder'.length)
    : filePath
}

function placeholderBackupPath(filePath: string): string {
  return `${activeSessionFilePath(filePath)}.placeholder`
}

function getHistoryLogPath(): string {
  return join(getClaudeConfigHomeDir(), 'history.jsonl')
}

function historySyntheticFilePath(historyPath: string, key: string): string {
  return `${historyPath}#${key}`
}

function isHistorySyntheticFilePath(filePath: string): boolean {
  return filePath.includes('/history.jsonl#') || filePath.includes('\\history.jsonl#')
}

function parseHistoryTimestamp(value: number | string | undefined): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }
  return null
}

function memoryFileTitle(filePath: string, content: string, fallback: string): string {
  const heading = content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading.length > 80 ? `${heading.slice(0, 80)}...` : heading
  return fallback || basename(filePath)
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const files: string[] = []
  for (const entry of entries) {
    const filePath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(filePath)))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(filePath)
    }
  }
  return files
}

async function discoverAutoMemoryFiles(projectFilter?: string): Promise<MemoryFileInfo[]> {
  const projectsDir = getAutoMemoryProjectsDir()
  const projectNames: string[] = []

  if (projectFilter) {
    projectNames.push(projectFilter)
  } else {
    try {
      const entries = await readdir(projectsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) projectNames.push(entry.name)
      }
    } catch {
      return []
    }
  }

  const files: MemoryFileInfo[] = []
  for (const projectPath of projectNames) {
    const memoryDir = join(projectsDir, projectPath, 'memory')
    const markdownFiles = await collectMarkdownFiles(memoryDir)
    for (const filePath of markdownFiles) {
      const relativePath = relative(memoryDir, filePath)
      files.push({
        filePath,
        projectPath,
        workDir: projectPath.replace(/-/g, '/'),
        title: `Project memory: ${relativePath}`,
        keywords: [projectPath, relativePath, basename(filePath)],
        source: 'auto-memory-file',
      })
    }
  }
  return files
}

async function discoverPromptMemoryFiles(): Promise<MemoryFileInfo[]> {
  const files = [
    { filePath: getBriefPath(), filename: BRIEF_FILENAME },
    { filePath: getUserPromptMemoryPath(), filename: USER_PROMPT_MEMORY_FILENAME },
  ]
  const memoryFiles: MemoryFileInfo[] = []
  for (const file of files) {
    try {
      const fileStat = await stat(file.filePath)
      if (!fileStat.isFile()) continue
    } catch {
      continue
    }
    memoryFiles.push({
      filePath: file.filePath,
      projectPath: '__global_prompt_memory',
      workDir: getPromptMemoryDir(),
      title: `Prompt memory: ${file.filename}`,
      keywords: ['prompt-memory', file.filename],
      source: 'prompt-memory',
    })
  }
  return memoryFiles
}

export function sessionSearchFileInfoFromTranscriptPath(
  filePath: string,
  sessionIdOverride?: string,
): SessionFileInfo | null {
  const normalizedFilePath = activeSessionFilePath(filePath)
  const fileName = basename(normalizedFilePath)
  if (!fileName.endsWith('.jsonl')) return null

  const sessionId =
    sessionIdOverride ?? fileName.slice(0, -'.jsonl'.length)
  if (!UUID_RE.test(sessionId)) return null

  const projectPath = relative(getProjectsDir(), dirname(normalizedFilePath))
  if (
    !projectPath ||
    projectPath === '..' ||
    projectPath.startsWith(`..${sep}`) ||
    projectPath.includes(sep) ||
    isAbsolute(projectPath)
  ) {
    return null
  }

  return {
    filePath,
    projectPath,
    sessionId,
  }
}

export async function discoverSessionSearchFiles(projectFilter?: string): Promise<SessionFileInfo[]> {
  const projectsDir = getProjectsDir()
  let projectDirs: string[]
  try {
    projectDirs = await readdir(projectsDir)
  } catch {
    return []
  }

  if (projectFilter) {
    const sanitized = sanitizePortablePath(projectFilter)
    projectDirs = projectDirs.filter(projectDir => projectDir === sanitized)
  }

  const results = new Map<
    string,
    SessionFileInfo & { isPlaceholderBackup: boolean }
  >()

  for (const projectPath of projectDirs) {
    const dirPath = join(projectsDir, projectPath)
    try {
      const info = await stat(dirPath)
      if (!info.isDirectory()) continue
    } catch {
      continue
    }

    let files: string[]
    try {
      files = await readdir(dirPath)
    } catch {
      continue
    }

    for (const file of files) {
      const isPlaceholderBackup = file.endsWith('.jsonl.placeholder')
      if (!file.endsWith('.jsonl') && !isPlaceholderBackup) continue
      const sessionId = isPlaceholderBackup
        ? file.slice(0, -'.jsonl.placeholder'.length)
        : file.slice(0, -'.jsonl'.length)
      if (!UUID_RE.test(sessionId)) continue
      const key = sessionKey(projectPath, sessionId)
      const existing = results.get(key)
      if (existing && !existing.isPlaceholderBackup) continue
      results.set(key, {
        filePath: join(dirPath, file),
        projectPath,
        sessionId,
        isPlaceholderBackup,
      })
    }
  }

  return [...results.values()].map(({ isPlaceholderBackup: _, ...item }) => item)
}

function getIndexedFile(db: Database, filePath: string): {
  file_mtime_ms: number
  file_size: number
} | null {
  return (
    db
      .query(
        'SELECT file_mtime_ms, file_size FROM indexed_files WHERE file_path = ?',
      )
      .get(filePath) as { file_mtime_ms: number; file_size: number } | null
  )
}

function deleteSessionRows(db: Database, key: string): void {
  const ids = db
    .query('SELECT id FROM messages WHERE session_key = ?')
    .all(key) as Array<{ id: number }>
  const deleteFts = db.query('DELETE FROM messages_fts WHERE rowid = ?')
  const deleteTrigram = db.query('DELETE FROM messages_fts_trigram WHERE rowid = ?')
  for (const row of ids) {
    deleteFts.run(row.id)
    deleteTrigram.run(row.id)
  }
  db.query('DELETE FROM messages WHERE session_key = ?').run(key)
}

function writeParsedSession(db: Database, parsed: ParsedSessionTranscript): void {
  const key = sessionKey(parsed.projectPath, parsed.sessionId)
  const now = new Date().toISOString()
  db.transaction(() => {
    db.query(
      'DELETE FROM indexed_files WHERE session_key = ? AND file_path <> ?',
    ).run(key, parsed.filePath)
    deleteSessionRows(db, key)
    db.query(
      `INSERT INTO sessions (
        session_key, session_id, project_path, work_dir, title,
        created_at, modified_at, file_path, file_mtime_ms, file_size,
        message_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        work_dir = excluded.work_dir,
        title = excluded.title,
        created_at = excluded.created_at,
        modified_at = excluded.modified_at,
        file_path = excluded.file_path,
        file_mtime_ms = excluded.file_mtime_ms,
        file_size = excluded.file_size,
        message_count = excluded.message_count`,
    ).run(
      key,
      parsed.sessionId,
      parsed.projectPath,
      parsed.workDir,
      parsed.title,
      parsed.createdAt,
      parsed.modifiedAt,
      parsed.filePath,
      parsed.fileMtimeMs,
      parsed.fileSize,
      parsed.messages.length,
    )

    const insertMessage = db.query(
      `INSERT INTO messages (
        session_key, session_id, project_path, message_uuid, role, type,
        content_text, timestamp, model, line_no, is_sidechain
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insertFts = db.query(
      'INSERT INTO messages_fts(rowid, content_text) VALUES (?, ?)',
    )
    const insertTrigram = db.query(
      'INSERT INTO messages_fts_trigram(rowid, content_text) VALUES (?, ?)',
    )

    for (const message of parsed.messages) {
      const result = insertMessage.run(
        key,
        parsed.sessionId,
        parsed.projectPath,
        message.messageUuid,
        message.role,
        message.type,
        message.contentText,
        message.timestamp,
        message.model,
        message.lineNo,
        message.isSidechain ? 1 : 0,
      )
      const id = Number(result.lastInsertRowid)
      insertFts.run(id, message.contentText)
      insertTrigram.run(id, message.contentText)
    }

    upsertProjectMemoryForParsedSession(db, parsed)

    db.query(
      `INSERT INTO indexed_files (
        file_path, session_key, session_id, project_path,
        file_mtime_ms, file_size, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        session_key = excluded.session_key,
        session_id = excluded.session_id,
        project_path = excluded.project_path,
        file_mtime_ms = excluded.file_mtime_ms,
        file_size = excluded.file_size,
        indexed_at = excluded.indexed_at`,
    ).run(
      parsed.filePath,
      key,
      parsed.sessionId,
      parsed.projectPath,
      parsed.fileMtimeMs,
      parsed.fileSize,
      now,
    )
  })()
}

function parseHistoryLog(raw: string): Array<{ entry: HistoryLogEntry; lineNo: number }> {
  const parsed: Array<{ entry: HistoryLogEntry; lineNo: number }> = []
  const lines = raw.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim()
    if (!trimmed) continue
    try {
      parsed.push({ entry: JSON.parse(trimmed) as HistoryLogEntry, lineNo: index + 1 })
    } catch {
      // History is append-only JSONL; ignore partial/corrupt tail lines.
    }
  }
  return parsed
}

async function buildHistoryLogSessions(projectFilter?: string): Promise<ParsedSessionTranscript[]> {
  const historyPath = getHistoryLogPath()
  let raw: string
  let fileStat: Awaited<ReturnType<typeof stat>>
  try {
    const result = await Promise.all([
      readFile(historyPath, 'utf-8'),
      stat(historyPath),
    ])
    raw = result[0]
    fileStat = result[1]
  } catch {
    return []
  }

  const sanitizedFilter = projectFilter
    ? sanitizePortablePath(projectFilter)
    : undefined
  const grouped = new Map<
    string,
    {
      sessionId: string
      projectPath: string
      workDir: string | null
      messages: ParsedSessionTranscript['messages']
    }
  >()

  for (const { entry, lineNo } of parseHistoryLog(raw)) {
    const display = typeof entry.display === 'string' ? entry.display.trim() : ''
    const project = typeof entry.project === 'string' ? entry.project.trim() : ''
    const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId : ''
    if (!display || !project || !UUID_RE.test(sessionId)) continue

    const projectPath = sanitizePortablePath(project)
    if (sanitizedFilter && projectPath !== sanitizedFilter) continue

    const key = sessionKey(projectPath, sessionId)
    const group =
      grouped.get(key) ??
      {
        sessionId,
        projectPath,
        workDir: project,
        messages: [],
      }
    group.messages.push({
      messageUuid: `history:${sessionId}:${lineNo}`,
      role: 'user',
      type: 'user',
      contentText: display,
      timestamp: parseHistoryTimestamp(entry.timestamp),
      model: null,
      lineNo,
      isSidechain: false,
    })
    grouped.set(key, group)
  }

  return [...grouped.values()].map(group => {
    const timestamps = group.messages
      .map(message => message.timestamp)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    const createdAt = timestamps[0] ?? fileStat.birthtime.toISOString()
    const modifiedAt = timestamps.at(-1) ?? fileStat.mtime.toISOString()
    const titleText = group.messages[0]?.contentText.trim() || group.sessionId
    const key = sessionKey(group.projectPath, group.sessionId)
    return {
      sessionId: group.sessionId,
      projectPath: group.projectPath,
      filePath: historySyntheticFilePath(historyPath, key),
      workDir: group.workDir,
      isTemporary: false,
      title: titleText.length > 80 ? `${titleText.slice(0, 80)}...` : titleText,
      createdAt,
      modifiedAt,
      fileMtimeMs: fileStat.mtimeMs,
      fileSize: fileStat.size,
      messages: group.messages,
    }
  })
}

async function indexHistoryLogSessions(params: {
  db: Database
  projectFilter?: string
}): Promise<Set<string>> {
  const liveFilePaths = new Set<string>()
  const sessions = await buildHistoryLogSessions(params.projectFilter)

  for (const session of sessions) {
    const key = sessionKey(session.projectPath, session.sessionId)
    const existing = params.db
      .query('SELECT file_path FROM sessions WHERE session_key = ?')
      .get(key) as { file_path: string } | null
    if (existing && !isHistorySyntheticFilePath(existing.file_path)) {
      continue
    }
    writeParsedSession(params.db, session)
    liveFilePaths.add(session.filePath)
  }

  return liveFilePaths
}

async function indexProjectMemoryFiles(params: {
  db: Database
  projectFilter?: string
}): Promise<Set<string>> {
  const liveFilePaths = new Set<string>()
  const files = [
    ...(await discoverAutoMemoryFiles(params.projectFilter)),
    ...(await discoverPromptMemoryFiles()),
  ]

  for (const file of files) {
    let fileStat: Awaited<ReturnType<typeof stat>>
    try {
      fileStat = await stat(file.filePath)
      if (!fileStat.isFile()) continue
    } catch {
      continue
    }

    const sessionId = projectMemoryFileSessionId(file.filePath)
    const key = sessionKey(file.projectPath, sessionId)
    liveFilePaths.add(file.filePath)

    const indexed = getIndexedFile(params.db, file.filePath)
    const existingMemory = params.db
      .query('SELECT id FROM project_memories WHERE session_key = ?')
      .get(key) as { id: number } | null
    if (
      indexed &&
      existingMemory &&
      indexed.file_mtime_ms === fileStat.mtimeMs &&
      indexed.file_size === fileStat.size
    ) {
      continue
    }

    const raw = await readFile(file.filePath, 'utf-8')
    const title = memoryFileTitle(file.filePath, raw, file.title)
    const result = params.db.transaction(() => {
      const upsert = upsertProjectMemoryFile(params.db, {
        filePath: file.filePath,
        projectPath: file.projectPath,
        workDir: file.workDir,
        title,
        content: raw,
        keywords: file.keywords,
        source: file.source,
        createdAt: fileStat.birthtime.toISOString(),
        updatedAt: fileStat.mtime.toISOString(),
      })

      if (!upsert) {
        deleteProjectMemoryBySessionKey(params.db, key)
        params.db.query('DELETE FROM indexed_files WHERE file_path = ?').run(file.filePath)
        return null
      }

      params.db.query(
        `INSERT INTO indexed_files (
          file_path, session_key, session_id, project_path,
          file_mtime_ms, file_size, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          session_key = excluded.session_key,
          session_id = excluded.session_id,
          project_path = excluded.project_path,
          file_mtime_ms = excluded.file_mtime_ms,
          file_size = excluded.file_size,
          indexed_at = excluded.indexed_at`,
      ).run(
        file.filePath,
        upsert.sessionKey,
        upsert.sessionId,
        file.projectPath,
        fileStat.mtimeMs,
        fileStat.size,
        new Date().toISOString(),
      )
      return upsert
    })()

    if (!result) {
      liveFilePaths.delete(file.filePath)
    }
  }

  return liveFilePaths
}

export async function indexSessionSearchFile(
  file: SessionFileInfo,
  db?: Database,
): Promise<void> {
  const ownDb = !db
  const targetDb = db ?? openSessionSearchDb()
  try {
    const fileStat = await stat(file.filePath)
    const indexed = getIndexedFile(targetDb, file.filePath)
    if (
      indexed &&
      indexed.file_mtime_ms === fileStat.mtimeMs &&
      indexed.file_size === fileStat.size
    ) {
      return
    }
    const parsed = await parseSessionTranscript(file)
    writeParsedSession(targetDb, parsed)
  } finally {
    if (ownDb) targetDb.close()
  }
}

export async function indexSessionSearchTranscript(
  filePath: string,
  options: {
    sessionId?: string
    db?: Database
  } = {},
): Promise<boolean> {
  const file = sessionSearchFileInfoFromTranscriptPath(
    filePath,
    options.sessionId,
  )
  if (!file) return false
  await indexSessionSearchFile(file, options.db)
  return true
}

export async function ensureSessionSearchIndexFresh(options?: {
  project?: string
  db?: Database
}): Promise<void> {
  const ownDb = !options?.db
  const db = options?.db ?? openSessionSearchDb()
  try {
    const projectPath = options?.project
      ? sanitizePortablePath(options.project)
      : undefined
    const files = await discoverSessionSearchFiles(projectPath)
    const liveFilePaths = new Set(files.map(file => file.filePath))
    for (const file of files) {
      await indexSessionSearchFile(file, db)
    }
    const liveHistoryFilePaths = await indexHistoryLogSessions({
      db,
      projectFilter: projectPath,
    })
    for (const filePath of liveHistoryFilePaths) {
      liveFilePaths.add(filePath)
    }
    const liveMemoryFilePaths = await indexProjectMemoryFiles({
      db,
      projectFilter: projectPath,
    })
    for (const filePath of liveMemoryFilePaths) {
      liveFilePaths.add(filePath)
    }
    const indexedFiles = projectPath
      ? (db
          .query(
            'SELECT file_path, session_key FROM indexed_files WHERE project_path = ?',
          )
          .all(projectPath) as Array<{ file_path: string; session_key: string }>)
      : (db
          .query('SELECT file_path, session_key FROM indexed_files')
          .all() as Array<{ file_path: string; session_key: string }>)
    for (const row of indexedFiles) {
      if (liveFilePaths.has(row.file_path)) continue
      const replacementRows = db
        .query(
          'SELECT file_path FROM indexed_files WHERE session_key = ? AND file_path <> ?',
        )
        .all(row.session_key, row.file_path) as Array<{ file_path: string }>
      if (replacementRows.some(replacement => liveFilePaths.has(replacement.file_path))) {
        db.query('DELETE FROM indexed_files WHERE file_path = ?').run(row.file_path)
        continue
      }
      await deleteSessionSearchIndexByKey(row.session_key, db)
    }
  } finally {
    if (ownDb) db.close()
  }
}

export async function deleteSessionSearchIndexByKey(
  key: string,
  db: Database = openSessionSearchDb(),
): Promise<void> {
  const ownDb = arguments.length < 2
  try {
    db.transaction(() => {
      deleteSessionRows(db, key)
      deleteProjectMemoryBySessionKey(db, key)
      db.query('DELETE FROM sessions WHERE session_key = ?').run(key)
      db.query('DELETE FROM indexed_files WHERE session_key = ?').run(key)
    })()
  } finally {
    if (ownDb) db.close()
  }
}

export async function deleteSessionFromSearchIndex(params: {
  sessionId: string
  projectPath?: string
}): Promise<void> {
  const db = openSessionSearchDb()
  try {
    const rows = params.projectPath
      ? (db
          .query(
            'SELECT session_key FROM sessions WHERE session_id = ? AND project_path = ?',
          )
          .all(params.sessionId, params.projectPath) as Array<{ session_key: string }>)
      : (db
          .query('SELECT session_key FROM sessions WHERE session_id = ?')
          .all(params.sessionId) as Array<{ session_key: string }>)
    for (const row of rows) {
      await deleteSessionSearchIndexByKey(row.session_key, db)
    }
  } finally {
    db.close()
  }
}

export async function resetSessionSearchIndex(): Promise<void> {
  await rm(getSessionSearchDbPath(), { force: true }).catch(() => {})
  await rm(`${getSessionSearchDbPath()}-wal`, { force: true }).catch(() => {})
  await rm(`${getSessionSearchDbPath()}-shm`, { force: true }).catch(() => {})
}

export const sessionSearchIndexerForTesting = {
  discoverSessionSearchFiles,
  sessionSearchFileInfoFromTranscriptPath,
}
