import { readdir, rm, stat } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'path'
import { type Database } from 'bun:sqlite'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { sanitizePath as sanitizePortablePath } from '../utils/sessionStoragePortable.js'
import { openSessionSearchDb, sessionKey } from './db.js'
import { getSessionSearchDbPath } from './paths.js'
import { parseSessionTranscript, type ParsedSessionTranscript } from './transcript.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SessionFileInfo = {
  filePath: string
  projectPath: string
  sessionId: string
}

function getProjectsDir(): string {
  return join(getClaudeConfigHomeDir(), 'projects')
}

function activeSessionFilePath(filePath: string): string {
  return filePath.endsWith('.jsonl.placeholder')
    ? filePath.slice(0, -'.placeholder'.length)
    : filePath
}

function placeholderBackupPath(filePath: string): string {
  return `${activeSessionFilePath(filePath)}.placeholder`
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
