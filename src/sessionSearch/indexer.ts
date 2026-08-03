import type { Dirent } from 'fs'
import { randomUUID } from 'crypto'
import { readFile, readdir, rm, stat } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'path'
import { type Database } from 'bun:sqlite'
import {
  backgroundScheduler,
  type BackgroundScheduler,
} from '../server/background/scheduler.js'
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
import {
  boundSessionSearchContent,
  boundSessionSearchMetadata,
} from './indexText.js'
import { getSessionSearchDbPath } from './paths.js'
import {
  deleteProjectMemoryBySessionKey,
  projectMemoryFileSessionId,
  upsertProjectMemoryForParsedSession,
  upsertProjectMemoryFile,
} from './projectMemory.js'
import {
  parseHistoryLogFileWithStatus,
  parseSessionTranscript,
  type HistoryLogIndexEntryDto,
  type ParsedSessionTranscript,
  type TranscriptWorkerFactory,
} from './transcript.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SessionFileInfo = {
  filePath: string
  projectPath: string
  sessionId: string
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

const SESSION_WRITE_BATCH_SIZE = 16
const SESSION_WRITE_BATCH_CONTENT_CHARS = 8 * 1024
const SESSION_NORMALIZE_BATCH_SIZE = 128
const SESSION_NORMALIZE_SLICE_MS = 4
const SESSION_STAGING_MARKER = '#staging:'
const SESSION_OBSOLETE_MARKER = '#obsolete:'

type SessionIndexWriteOptions = {
  signal?: AbortSignal
  yieldIfNeeded?: () => Promise<void>
  workerFactory?: TranscriptWorkerFactory
  workerTimeoutMs?: number
}

function throwIfIndexAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted()
}

async function yieldBetweenIndexBatches(
  options: SessionIndexWriteOptions,
): Promise<void> {
  throwIfIndexAborted(options.signal)
  if (options.yieldIfNeeded) await options.yieldIfNeeded()
  else await new Promise<void>(resolve => setTimeout(resolve, 0))
  throwIfIndexAborted(options.signal)
}

async function deleteSessionRows(
  db: Database,
  key: string,
  options: SessionIndexWriteOptions = {},
): Promise<void> {
  while (true) {
    throwIfIndexAborted(options.signal)
    const ids = db
      .query('SELECT id FROM messages WHERE session_key = ? LIMIT ?')
      .all(key, SESSION_WRITE_BATCH_SIZE) as Array<{ id: number }>
    if (ids.length === 0) return
    db.transaction(() => {
      const deleteFts = db.query('DELETE FROM messages_fts WHERE rowid = ?')
      const deleteTrigram = db.query('DELETE FROM messages_fts_trigram WHERE rowid = ?')
      const deleteMessage = db.query('DELETE FROM messages WHERE id = ?')
      for (const row of ids) {
        throwIfIndexAborted(options.signal)
        deleteFts.run(row.id)
        throwIfIndexAborted(options.signal)
        deleteTrigram.run(row.id)
        throwIfIndexAborted(options.signal)
        deleteMessage.run(row.id)
      }
    })()
    await yieldBetweenIndexBatches(options)
  }
}

async function renameSessionRows(
  db: Database,
  sourceKey: string,
  targetKey: string,
): Promise<void> {
  if (sourceKey === targetKey) return
  while (true) {
    const ids = db
      .query('SELECT id FROM messages WHERE session_key = ? LIMIT ?')
      .all(sourceKey, SESSION_WRITE_BATCH_SIZE) as Array<{ id: number }>
    if (ids.length === 0) return
    db.transaction(() => {
      const rename = db.query('UPDATE messages SET session_key = ? WHERE id = ?')
      for (const row of ids) rename.run(targetKey, row.id)
    })()
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
}

function getActiveGenerationKey(
  db: Database,
  parsed: Pick<ParsedSessionTranscript, 'sessionId' | 'projectPath' | 'filePath'>,
  stableKey: string,
): string | null {
  const active = db.query<{ session_key: string }, [string, string, string]>(`
    SELECT session_key
    FROM indexed_files
    WHERE session_id = ? AND project_path = ?
    ORDER BY CASE WHEN file_path = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(parsed.sessionId, parsed.projectPath, parsed.filePath)
  if (active) return active.session_key
  const legacy = db.query<{ found: number }, [string]>(`
    SELECT 1 AS found FROM messages WHERE session_key = ? LIMIT 1
  `).get(stableKey)
  return legacy ? stableKey : null
}

async function cleanupInactiveSessionGenerations(
  db: Database,
  params: {
    sessionId: string
    projectPath: string
  },
  options: SessionIndexWriteOptions = {},
): Promise<void> {
  const pointerRows = db.query<{ session_key: string }, [string, string]>(`
    SELECT session_key FROM indexed_files
    WHERE session_id = ? AND project_path = ?
  `).all(params.sessionId, params.projectPath)
  const activeKeys = new Set(pointerRows.map(row => row.session_key))
  if (activeKeys.size === 0) {
    const sessionRows = db.query<{ session_key: string }, [string, string]>(`
      SELECT session_key FROM sessions
      WHERE session_id = ? AND project_path = ?
    `).all(params.sessionId, params.projectPath)
    for (const row of sessionRows) activeKeys.add(row.session_key)
  }
  const generationRows = db.query<{ session_key: string }, [string, string]>(`
    SELECT DISTINCT session_key FROM messages
    WHERE session_id = ? AND project_path = ?
  `).all(params.sessionId, params.projectPath)
  for (const row of generationRows) {
    throwIfIndexAborted(options.signal)
    if (activeKeys.has(row.session_key)) continue
    await deleteSessionRows(db, row.session_key, options)
  }
}

async function writeParsedSession(
  db: Database,
  parsed: ParsedSessionTranscript,
  options: SessionIndexWriteOptions = {},
): Promise<void> {
  if (!parsed.isComplete) return
  const indexableMessages: ParsedSessionTranscript['messages'] = []
  let normalizeSliceStartedAt = performance.now()
  for (let index = 0; index < parsed.messages.length; index += 1) {
    const message = parsed.messages[index]!
    indexableMessages.push({
      ...message,
      messageUuid:
        boundSessionSearchMetadata(message.messageUuid, 512) ??
        `${parsed.sessionId}:${message.lineNo}`,
      role: boundSessionSearchMetadata(message.role, 64) ?? 'unknown',
      type: boundSessionSearchMetadata(message.type, 64) ?? 'system',
      contentText: boundSessionSearchContent(message.contentText),
      timestamp: boundSessionSearchMetadata(message.timestamp, 128),
      model: boundSessionSearchMetadata(message.model, 256),
    })
    const normalizedCount = index + 1
    if (
      normalizedCount < parsed.messages.length &&
      (normalizedCount % SESSION_NORMALIZE_BATCH_SIZE === 0 ||
        performance.now() - normalizeSliceStartedAt >= SESSION_NORMALIZE_SLICE_MS)
    ) {
      await yieldBetweenIndexBatches(options)
      normalizeSliceStartedAt = performance.now()
    }
  }
  const indexable: ParsedSessionTranscript = {
    ...parsed,
    workDir: boundSessionSearchMetadata(parsed.workDir, 4096),
    title: boundSessionSearchMetadata(parsed.title, 160) ?? parsed.sessionId,
    createdAt: boundSessionSearchMetadata(parsed.createdAt, 128) ?? parsed.createdAt,
    modifiedAt: boundSessionSearchMetadata(parsed.modifiedAt, 128) ?? parsed.modifiedAt,
    messages: indexableMessages,
  }
  const stableKey = sessionKey(indexable.projectPath, indexable.sessionId)
  const stagingKey = `${stableKey}${SESSION_STAGING_MARKER}${randomUUID()}`
  const obsoleteKey = `${stableKey}${SESSION_OBSOLETE_MARKER}${randomUUID()}`
  const now = new Date().toISOString()
  throwIfIndexAborted(options.signal)
  await cleanupInactiveSessionGenerations(db, indexable, options)
  const oldActiveKey = getActiveGenerationKey(db, indexable, stableKey)

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
  const insertBatch = db.transaction((batch: ParsedSessionTranscript['messages']) => {
    for (const message of batch) {
      throwIfIndexAborted(options.signal)
      const result = insertMessage.run(
        stagingKey,
        indexable.sessionId,
        indexable.projectPath,
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
      throwIfIndexAborted(options.signal)
      insertFts.run(id, message.contentText)
      throwIfIndexAborted(options.signal)
      insertTrigram.run(id, message.contentText)
    }
  })
  let switched = false
  try {
    for (let start = 0; start < indexable.messages.length;) {
      throwIfIndexAborted(options.signal)
      let end = start
      let contentChars = 0
      while (
        end < indexable.messages.length
        && end - start < SESSION_WRITE_BATCH_SIZE
      ) {
        const nextSize = indexable.messages[end]!.contentText.length
        if (
          end > start
          && contentChars + nextSize > SESSION_WRITE_BATCH_CONTENT_CHARS
        ) {
          break
        }
        contentChars += nextSize
        end += 1
      }
      insertBatch(indexable.messages.slice(start, end))
      start = end
      if (start < indexable.messages.length) {
        await yieldBetweenIndexBatches(options)
      }
    }

    throwIfIndexAborted(options.signal)
    db.transaction(() => {
      throwIfIndexAborted(options.signal)
      db.query(`
        INSERT INTO sessions (
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
          message_count = excluded.message_count
      `).run(
        stableKey,
        indexable.sessionId,
        indexable.projectPath,
        indexable.workDir,
        indexable.title,
        indexable.createdAt,
        indexable.modifiedAt,
        indexable.filePath,
        indexable.fileMtimeMs,
        indexable.fileSize,
        indexable.messages.length,
      )
      throwIfIndexAborted(options.signal)
      db.query(`
        DELETE FROM indexed_files
        WHERE session_id = ? AND project_path = ? AND file_path <> ?
      `).run(indexable.sessionId, indexable.projectPath, indexable.filePath)
      throwIfIndexAborted(options.signal)
      db.query(`
        INSERT INTO indexed_files (
          file_path, session_key, session_id, project_path,
          file_mtime_ms, file_size, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          session_key = excluded.session_key,
          session_id = excluded.session_id,
          project_path = excluded.project_path,
          file_mtime_ms = excluded.file_mtime_ms,
          file_size = excluded.file_size,
          indexed_at = excluded.indexed_at
      `).run(
        indexable.filePath,
        stagingKey,
        indexable.sessionId,
        indexable.projectPath,
        indexable.fileMtimeMs,
        indexable.fileSize,
        now,
      )
    })()
    switched = true
  } catch (error) {
    if (!switched) {
      await deleteSessionRows(db, stagingKey)
    }
    throw error
  }

  upsertProjectMemoryForParsedSession(db, indexable)
  if (oldActiveKey && oldActiveKey !== stagingKey) {
    await renameSessionRows(db, oldActiveKey, obsoleteKey)
    await deleteSessionRows(db, obsoleteKey)
  }
  await cleanupInactiveSessionGenerations(db, indexable)
}

type HistoryLogBatchEntry = {
  entry: HistoryLogIndexEntryDto
  lineNo: number
}

type HistoryStageRow = {
  run_id: string
  stable_key: string
  staging_key: string
  session_id: string
  project_path: string
  work_dir: string | null
  title: string
  created_at: string
  modified_at: string
  file_path: string
  file_mtime_ms: number
  file_size: number
  message_count: number
}

function createHistoryStageWriter(params: {
  db: Database
  historyPath: string
  fileStat: Awaited<ReturnType<typeof stat>>
  projectFilter?: string
  signal?: AbortSignal
}): (runId: string, batch: HistoryLogBatchEntry[]) => void {
  const sanitizedFilter = params.projectFilter
    ? sanitizePortablePath(params.projectFilter)
    : undefined
  const upsertStage = params.db.query(`
    INSERT INTO history_session_staging (
      run_id, stable_key, staging_key, session_id, project_path, work_dir,
      title, created_at, modified_at, file_path, file_mtime_ms, file_size,
      message_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(run_id, stable_key) DO UPDATE SET
      modified_at = excluded.modified_at,
      message_count = history_session_staging.message_count + 1
  `)
  const insertMessage = params.db.query(`
    INSERT INTO messages (
      session_key, session_id, project_path, message_uuid, role, type,
      content_text, timestamp, model, line_no, is_sidechain
    ) VALUES (?, ?, ?, ?, 'user', 'user', ?, ?, NULL, ?, 0)
  `)
  const insertFts = params.db.query(
    'INSERT INTO messages_fts(rowid, content_text) VALUES (?, ?)',
  )
  const insertTrigram = params.db.query(
    'INSERT INTO messages_fts_trigram(rowid, content_text) VALUES (?, ?)',
  )

  return (runId, batch) => {
    params.db.transaction(() => {
      for (const { entry, lineNo } of batch) {
        throwIfIndexAborted(params.signal)
        const display = entry.display?.trim() ?? ''
        const project = entry.project?.trim() ?? ''
        const sessionId = entry.sessionId ?? ''
        if (!display || !project || !UUID_RE.test(sessionId)) continue
        const projectPath = sanitizePortablePath(project)
        if (sanitizedFilter && projectPath !== sanitizedFilter) continue

        const stableKey = sessionKey(projectPath, sessionId)
        const stagingKey = `${stableKey}${SESSION_STAGING_MARKER}history:${runId}`
        const timestamp = parseHistoryTimestamp(entry.timestamp ?? undefined)
        const title = display.length > 80 ? `${display.slice(0, 80)}...` : display
        upsertStage.run(
          runId,
          stableKey,
          stagingKey,
          sessionId,
          projectPath,
          project,
          title,
          timestamp ?? params.fileStat.birthtime.toISOString(),
          timestamp ?? params.fileStat.mtime.toISOString(),
          historySyntheticFilePath(params.historyPath, stableKey),
          params.fileStat.mtimeMs,
          params.fileStat.size,
        )
        const result = insertMessage.run(
          stagingKey,
          sessionId,
          projectPath,
          `history:${sessionId}:${lineNo}`,
          display,
          timestamp,
          lineNo,
        )
        const id = Number(result.lastInsertRowid)
        insertFts.run(id, display)
        insertTrigram.run(id, display)
      }
    })()
  }
}

async function cleanupHistoryStageRun(db: Database, runId: string): Promise<void> {
  let cleaned = 0
  while (true) {
    const row = db.query<{
      stable_key: string
      staging_key: string
    }, [string]>(`
      SELECT stable_key, staging_key
      FROM history_session_staging
      WHERE run_id = ?
      ORDER BY stable_key
      LIMIT 1
    `).get(runId)
    if (!row) return
    const active = db.query<{ found: number }, [string]>(`
      SELECT 1 AS found FROM indexed_files WHERE session_key = ? LIMIT 1
    `).get(row.staging_key)
    if (!active) await deleteSessionRows(db, row.staging_key)
    db.query(`
      DELETE FROM history_session_staging
      WHERE run_id = ? AND stable_key = ?
    `).run(runId, row.stable_key)
    cleaned += 1
    if (cleaned % 32 === 0) await yieldBetweenIndexBatches({})
  }
}

function readHistoryMemorySample(
  db: Database,
  stage: HistoryStageRow,
): ParsedSessionTranscript {
  const rows = db.query<{
    message_uuid: string
    role: string
    type: string
    content_text: string
    timestamp: string | null
    model: string | null
    line_no: number
    is_sidechain: number
  }, [string]>(`
    SELECT message_uuid, role, type, content_text, timestamp, model,
           line_no, is_sidechain
    FROM messages
    WHERE session_key = ?
    ORDER BY line_no DESC, id DESC
    LIMIT 24
  `).all(stage.staging_key)
  const messages = rows.reverse().map(row => ({
    messageUuid: row.message_uuid,
    role: row.role,
    type: row.type,
    contentText: row.content_text,
    timestamp: row.timestamp,
    model: row.model,
    lineNo: row.line_no,
    isSidechain: row.is_sidechain === 1,
  }))
  return {
    sessionId: stage.session_id,
    projectPath: stage.project_path,
    filePath: stage.file_path,
    workDir: stage.work_dir,
    isTemporary: false,
    title: stage.title,
    createdAt: stage.created_at,
    modifiedAt: stage.modified_at,
    fileMtimeMs: stage.file_mtime_ms,
    fileSize: stage.file_size,
    isComplete: true,
    messages,
  }
}

async function activateHistoryStage(
  db: Database,
  stage: HistoryStageRow,
  options: SessionIndexWriteOptions,
): Promise<void> {
  throwIfIndexAborted(options.signal)
  const existing = db.query<{ file_path: string }, [string]>(`
    SELECT file_path FROM sessions WHERE session_key = ?
  `).get(stage.stable_key)
  if (existing && !isHistorySyntheticFilePath(existing.file_path)) {
    await deleteSessionRows(db, stage.staging_key, options)
    db.query(`
      DELETE FROM history_session_staging
      WHERE run_id = ? AND stable_key = ?
    `).run(stage.run_id, stage.stable_key)
    return
  }

  const oldActiveKey = getActiveGenerationKey(db, {
    sessionId: stage.session_id,
    projectPath: stage.project_path,
    filePath: stage.file_path,
  }, stage.stable_key)
  const indexedAt = new Date().toISOString()
  db.transaction(() => {
    throwIfIndexAborted(options.signal)
    db.query(`
      INSERT INTO sessions (
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
        message_count = excluded.message_count
    `).run(
      stage.stable_key,
      stage.session_id,
      stage.project_path,
      stage.work_dir,
      stage.title,
      stage.created_at,
      stage.modified_at,
      stage.file_path,
      stage.file_mtime_ms,
      stage.file_size,
      stage.message_count,
    )
    db.query(`
      DELETE FROM indexed_files
      WHERE session_id = ? AND project_path = ? AND file_path <> ?
    `).run(stage.session_id, stage.project_path, stage.file_path)
    db.query(`
      INSERT INTO indexed_files (
        file_path, session_key, session_id, project_path,
        file_mtime_ms, file_size, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        session_key = excluded.session_key,
        session_id = excluded.session_id,
        project_path = excluded.project_path,
        file_mtime_ms = excluded.file_mtime_ms,
        file_size = excluded.file_size,
        indexed_at = excluded.indexed_at
    `).run(
      stage.file_path,
      stage.staging_key,
      stage.session_id,
      stage.project_path,
      stage.file_mtime_ms,
      stage.file_size,
      indexedAt,
    )
  })()

  upsertProjectMemoryForParsedSession(db, readHistoryMemorySample(db, stage))
  if (oldActiveKey && oldActiveKey !== stage.staging_key) {
    await deleteSessionRows(db, oldActiveKey, options)
  }
  await cleanupInactiveSessionGenerations(db, {
    sessionId: stage.session_id,
    projectPath: stage.project_path,
  }, options)
}

async function deleteStaleHistorySessions(params: {
  db: Database
  historyPath: string
  runId: string | null
  projectFilter?: string
  options: SessionIndexWriteOptions
}): Promise<void> {
  const prefix = `${params.historyPath}#`
  let cursor = ''
  while (true) {
    const row = params.projectFilter
      ? params.db.query<{
          file_path: string
          session_key: string
          session_id: string
          project_path: string
        }, [number, string, string, string]>(`
          SELECT file_path, session_key, session_id, project_path
          FROM indexed_files
          WHERE substr(file_path, 1, ?) = ?
            AND project_path = ?
            AND file_path > ?
          ORDER BY file_path
          LIMIT 1
        `).get(prefix.length, prefix, params.projectFilter, cursor)
      : params.db.query<{
          file_path: string
          session_key: string
          session_id: string
          project_path: string
        }, [number, string, string]>(`
          SELECT file_path, session_key, session_id, project_path
          FROM indexed_files
          WHERE substr(file_path, 1, ?) = ?
            AND file_path > ?
          ORDER BY file_path
          LIMIT 1
        `).get(prefix.length, prefix, cursor)
    if (!row) return
    cursor = row.file_path
    throwIfIndexAborted(params.options.signal)
    const current = params.runId
      ? params.db.query<{ found: number }, [string, string, string]>(`
          SELECT 1 AS found
          FROM history_session_staging
          WHERE run_id = ? AND session_id = ? AND project_path = ?
          LIMIT 1
        `).get(params.runId, row.session_id, row.project_path)
      : null
    if (current) continue
    await deleteSessionSearchIndexByKey(row.session_key, params.db)
    await yieldBetweenIndexBatches(params.options)
  }
}

async function finalizeHistoryStageRun(params: {
  db: Database
  historyPath: string
  runId: string
  projectFilter?: string
  options: SessionIndexWriteOptions
}): Promise<void> {
  let cursor = ''
  while (true) {
    const rows = params.db.query<HistoryStageRow, [string, string]>(`
      SELECT * FROM history_session_staging
      WHERE run_id = ? AND stable_key > ?
      ORDER BY stable_key
      LIMIT 16
    `).all(params.runId, cursor)
    if (rows.length === 0) break
    for (const row of rows) {
      throwIfIndexAborted(params.options.signal)
      await activateHistoryStage(params.db, row, params.options)
    }
    cursor = rows.at(-1)!.stable_key
    await yieldBetweenIndexBatches(params.options)
  }

  await deleteStaleHistorySessions({
    db: params.db,
    historyPath: params.historyPath,
    runId: params.runId,
    projectFilter: params.projectFilter,
    options: params.options,
  })
  await cleanupHistoryStageRun(params.db, params.runId)
}

async function indexHistoryLogSessions(params: {
  db: Database
  projectFilter?: string
} & SessionIndexWriteOptions): Promise<void> {
  const historyPath = getHistoryLogPath()
  let fileStat: Awaited<ReturnType<typeof stat>>
  try {
    fileStat = await stat(historyPath)
  } catch {
    await deleteStaleHistorySessions({
      db: params.db,
      historyPath,
      runId: null,
      projectFilter: params.projectFilter,
      options: params,
    })
    return
  }

  throwIfIndexAborted(params.signal)
  const runIds = [randomUUID()]
  let activeRunId = runIds[0]!
  const writeBatch = createHistoryStageWriter({
    db: params.db,
    historyPath,
    fileStat,
    projectFilter: params.projectFilter,
    signal: params.signal,
  })
  let historyFile
  try {
    historyFile = await parseHistoryLogFileWithStatus({
      filePath: historyPath,
      fileSize: fileStat.size,
      signal: params.signal,
      workerFactory: params.workerFactory,
      workerTimeoutMs: params.workerTimeoutMs,
      collectEntries: false,
      onBatch: batch => writeBatch(activeRunId, batch),
      onReset: () => {
        activeRunId = randomUUID()
        runIds.push(activeRunId)
      },
    })
  } catch (error) {
    for (const runId of runIds) await cleanupHistoryStageRun(params.db, runId)
    throw error
  }

  if (!historyFile.isComplete) {
    for (const runId of runIds) await cleanupHistoryStageRun(params.db, runId)
    return
  }
  for (const runId of runIds) {
    if (runId !== activeRunId) await cleanupHistoryStageRun(params.db, runId)
  }
  try {
    await finalizeHistoryStageRun({
      db: params.db,
      historyPath,
      runId: activeRunId,
      projectFilter: params.projectFilter,
      options: params,
    })
  } catch (error) {
    await cleanupHistoryStageRun(params.db, activeRunId)
    throw error
  }
}

async function indexProjectMemoryFiles(params: {
  db: Database
  projectFilter?: string
  signal?: AbortSignal
  yieldIfNeeded?: () => Promise<void>
}): Promise<Set<string>> {
  const liveFilePaths = new Set<string>()
  const files = [
    ...(await discoverAutoMemoryFiles(params.projectFilter)),
    ...(await discoverPromptMemoryFiles()),
  ]

  for (const file of files) {
    throwIfIndexAborted(params.signal)
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
    throwIfIndexAborted(params.signal)
    const title = memoryFileTitle(file.filePath, raw, file.title)
    const result = params.db.transaction(() => {
      throwIfIndexAborted(params.signal)
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
    await yieldBetweenIndexBatches(params)
  }

  return liveFilePaths
}

export async function indexSessionSearchFile(
  file: SessionFileInfo,
  db?: Database,
  options: SessionIndexWriteOptions = {},
): Promise<void> {
  const ownDb = !db
  const targetDb = db ?? openSessionSearchDb()
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const fileStat = await stat(file.filePath)
      throwIfIndexAborted(options.signal)
      const indexed = getIndexedFile(targetDb, file.filePath)
      if (
        indexed &&
        indexed.file_mtime_ms === fileStat.mtimeMs &&
        indexed.file_size === fileStat.size
      ) {
        return
      }
      const parsed = await parseSessionTranscript({
        ...file,
        signal: options.signal,
        yieldIfNeeded: options.yieldIfNeeded,
        workerFactory: options.workerFactory,
        workerTimeoutMs: options.workerTimeoutMs,
      })
      throwIfIndexAborted(options.signal)
      if (!parsed.isComplete) return
      await writeParsedSession(targetDb, parsed, options)
      const latestStat = await stat(file.filePath)
      throwIfIndexAborted(options.signal)
      if (
        latestStat.mtimeMs === parsed.fileMtimeMs &&
        latestStat.size === parsed.fileSize
      ) {
        return
      }
    }
  } finally {
    if (ownDb) targetDb.close()
  }
}

export async function refreshSessionSearchPathMetadata(
  file: SessionFileInfo,
  workDir: string,
  db?: Database,
): Promise<void> {
  const ownDb = !db
  const targetDb = db ?? openSessionSearchDb()
  try {
    const fileStat = await stat(file.filePath)
    const key = sessionKey(file.projectPath, file.sessionId)
    const indexedAt = new Date().toISOString()

    targetDb.transaction(() => {
      targetDb.query(
        `UPDATE sessions
         SET work_dir = ?, file_mtime_ms = ?, file_size = ?
         WHERE session_key = ?`,
      ).run(workDir, fileStat.mtimeMs, fileStat.size, key)
      targetDb.query(
        `UPDATE indexed_files
         SET file_mtime_ms = ?, file_size = ?, indexed_at = ?
         WHERE file_path = ?`,
      ).run(fileStat.mtimeMs, fileStat.size, indexedAt, file.filePath)

      const memory = targetDb.query(
        `SELECT id, summary, title, keywords
         FROM project_memories
         WHERE session_key = ?`,
      ).get(key) as {
        id: number
        summary: string
        title: string
        keywords: string
      } | null
      if (!memory) return

      targetDb.query(
        'UPDATE project_memories SET work_dir = ? WHERE session_key = ?',
      ).run(workDir, key)
      targetDb.query('DELETE FROM project_memories_fts WHERE rowid = ?').run(memory.id)
      targetDb.query('DELETE FROM project_memories_fts_trigram WHERE rowid = ?').run(memory.id)
      targetDb.query(
        `INSERT INTO project_memories_fts(rowid, summary, title, keywords, work_dir)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(memory.id, memory.summary, memory.title, memory.keywords, workDir)
      targetDb.query(
        `INSERT INTO project_memories_fts_trigram(rowid, summary, title, keywords, work_dir)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(memory.id, memory.summary, memory.title, memory.keywords, workDir)
    })()
  } finally {
    if (ownDb) targetDb.close()
  }
}

export async function indexSessionSearchTranscript(
  filePath: string,
  options: {
    sessionId?: string
    db?: Database
    signal?: AbortSignal
    yieldIfNeeded?: () => Promise<void>
    workerFactory?: TranscriptWorkerFactory
    workerTimeoutMs?: number
  } = {},
): Promise<boolean> {
  const file = sessionSearchFileInfoFromTranscriptPath(
    filePath,
    options.sessionId,
  )
  if (!file) return false
  await indexSessionSearchFile(file, options.db, options)
  return true
}

export async function ensureSessionSearchIndexFresh(options?: {
  project?: string
  db?: Database
  signal?: AbortSignal
  yieldIfNeeded?: () => Promise<void>
}): Promise<void> {
  const ownDb = !options?.db
  const db = options?.db ?? openSessionSearchDb()
  try {
    options?.signal?.throwIfAborted()
    const projectPath = options?.project
      ? sanitizePortablePath(options.project)
      : undefined
    const files = await discoverSessionSearchFiles(projectPath)
    options?.signal?.throwIfAborted()
    const liveFilePaths = new Set(files.map(file => file.filePath))
    for (const file of files) {
      options?.signal?.throwIfAborted()
      await indexSessionSearchFile(file, db, options ?? {})
    }
    options?.signal?.throwIfAborted()
    await indexHistoryLogSessions({
      db,
      projectFilter: projectPath,
      signal: options?.signal,
      yieldIfNeeded: options?.yieldIfNeeded,
    })
    options?.signal?.throwIfAborted()
    const liveMemoryFilePaths = await indexProjectMemoryFiles({
      db,
      projectFilter: projectPath,
      signal: options?.signal,
      yieldIfNeeded: options?.yieldIfNeeded,
    })
    for (const filePath of liveMemoryFilePaths) {
      liveFilePaths.add(filePath)
    }
    const indexedFiles = projectPath
      ? (db
          .query(
            `SELECT file_path, session_key, session_id, project_path
             FROM indexed_files WHERE project_path = ?`,
          )
          .all(projectPath) as Array<{
            file_path: string
            session_key: string
            session_id: string
            project_path: string
          }>)
      : (db
          .query(`
            SELECT file_path, session_key, session_id, project_path
            FROM indexed_files
          `)
          .all() as Array<{
            file_path: string
            session_key: string
            session_id: string
            project_path: string
          }>)
    for (const row of indexedFiles) {
      options?.signal?.throwIfAborted()
      if (liveFilePaths.has(row.file_path)) continue
      if (isHistorySyntheticFilePath(row.file_path)) continue
      const replacementRows = db
        .query(
          `SELECT file_path FROM indexed_files
           WHERE session_id = ? AND project_path = ? AND file_path <> ?`,
        )
        .all(row.session_id, row.project_path, row.file_path) as Array<{ file_path: string }>
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

type ScheduledSessionSearchRefresh = {
  id: string
  scheduler: BackgroundScheduler
  promise: Promise<void>
}

const scheduledSessionSearchRefreshes = new Map<
  string,
  ScheduledSessionSearchRefresh
>()

function trackScheduledSessionSearchRefresh(
  refresh: ScheduledSessionSearchRefresh,
): Promise<void> {
  if (!scheduledSessionSearchRefreshes.has(refresh.id)) {
    scheduledSessionSearchRefreshes.set(refresh.id, refresh)
    void refresh.promise.then(
      () => scheduledSessionSearchRefreshes.delete(refresh.id),
      () => scheduledSessionSearchRefreshes.delete(refresh.id),
    )
  }
  return refresh.promise
}

export async function cancelScheduledSessionSearchIndexRefreshes(): Promise<void> {
  const active = [...scheduledSessionSearchRefreshes.values()]
  for (const refresh of active) {
    refresh.scheduler.cancel(refresh.id, 'Session search index was reset')
  }
  await Promise.allSettled(active.map(refresh => refresh.promise))
}

export type SessionSearchIndexRefreshOptions = {
  project?: string
  priority?: 0 | 1 | 2 | 3
  scheduler?: BackgroundScheduler
}

export const SESSION_SEARCH_REFRESH_BUDGET_MS = 75

export function scheduleSessionSearchIndexRefresh(
  options: SessionSearchIndexRefreshOptions = {},
): Promise<void> | null {
  const projectPath = options.project
    ? sanitizePortablePath(options.project)
    : undefined
  const dbPath = getSessionSearchDbPath()
  try {
    const scheduler = options.scheduler ?? backgroundScheduler
    const handle = scheduler.enqueue({
      type: 'session-search-refresh',
      key: `${dbPath}\0${projectPath ?? 'all'}`,
      priority: options.priority ?? 3,
      lane: 'sqlite-write',
      resourceKey: 'session-search-db',
      dedupe: 'join',
      run: context => ensureSessionSearchIndexFresh({
        project: projectPath,
        signal: context.signal,
        yieldIfNeeded: context.yieldIfNeeded,
      }),
    })
    return trackScheduledSessionSearchRefresh({
      id: handle.id,
      scheduler,
      promise: handle.promise,
    })
  } catch {
    // Shutdown can race with a final read; stale index data remains valid.
    return null
  }
}

export async function refreshSessionSearchIndexWithinBudget(
  options: SessionSearchIndexRefreshOptions = {},
  budgetMs = SESSION_SEARCH_REFRESH_BUDGET_MS,
): Promise<void> {
  const refresh = scheduleSessionSearchIndexRefresh(options)
  if (!refresh) return
  await Promise.race([
    refresh.catch(() => undefined),
    new Promise<void>(resolve => setTimeout(resolve, budgetMs)),
  ])
}

export async function deleteSessionSearchIndexByKey(
  key: string,
  db: Database = openSessionSearchDb(),
): Promise<void> {
  const ownDb = arguments.length < 2
  try {
    const directSession = db.query<{
      session_key: string
      session_id: string
      project_path: string
    }, [string]>(`
      SELECT session_key, session_id, project_path
      FROM sessions WHERE session_key = ?
    `).get(key)
    const messageIdentity = directSession
      ? null
      : db.query<{ session_id: string; project_path: string }, [string]>(`
          SELECT session_id, project_path
          FROM messages WHERE session_key = ? LIMIT 1
        `).get(key)
    const indexedIdentity = directSession || messageIdentity
      ? null
      : db.query<{ session_id: string; project_path: string }, [string]>(`
          SELECT session_id, project_path
          FROM indexed_files WHERE session_key = ? LIMIT 1
        `).get(key)
    const identity = directSession ?? messageIdentity ?? indexedIdentity
    const stableSession = identity
      ? db.query<{ session_key: string }, [string, string]>(`
          SELECT session_key FROM sessions
          WHERE session_id = ? AND project_path = ?
          LIMIT 1
        `).get(identity.session_id, identity.project_path)
      : null
    const stableKey = stableSession?.session_key
      ?? (identity ? sessionKey(identity.project_path, identity.session_id) : key)
    const generationRows = identity
      ? db.query<{ session_key: string }, [string, string]>(`
          SELECT DISTINCT session_key FROM messages
          WHERE session_id = ? AND project_path = ?
        `).all(identity.session_id, identity.project_path)
      : [{ session_key: key }]
    for (const row of generationRows) {
      await deleteSessionRows(db, row.session_key)
    }
    db.transaction(() => {
      deleteProjectMemoryBySessionKey(db, stableKey)
      if (identity) {
        db.query(`
          DELETE FROM sessions WHERE session_id = ? AND project_path = ?
        `).run(identity.session_id, identity.project_path)
        db.query(`
          DELETE FROM indexed_files WHERE session_id = ? AND project_path = ?
        `).run(identity.session_id, identity.project_path)
      } else {
        db.query('DELETE FROM sessions WHERE session_key = ?').run(key)
        db.query('DELETE FROM indexed_files WHERE session_key = ?').run(key)
      }
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
  await cancelScheduledSessionSearchIndexRefreshes()
  await rm(getSessionSearchDbPath(), { force: true }).catch(() => {})
  await rm(`${getSessionSearchDbPath()}-wal`, { force: true }).catch(() => {})
  await rm(`${getSessionSearchDbPath()}-shm`, { force: true }).catch(() => {})
}

export const sessionSearchIndexerForTesting = {
  discoverSessionSearchFiles,
  sessionSearchFileInfoFromTranscriptPath,
}
