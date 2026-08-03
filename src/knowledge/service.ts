import { createHash, randomUUID } from 'crypto'
import { homedir } from 'os'
import {
  readFile,
  readdir,
  realpath,
  stat,
} from 'fs/promises'
import {
  basename,
  extname,
  parse,
  relative,
  resolve,
} from 'path'
import type { Database } from 'bun:sqlite'
import {
  backgroundScheduler,
  type BackgroundScheduler,
} from '../server/background/scheduler.js'
import type { BackgroundTaskContext } from '../server/background/types.js'
import {
  KNOWLEDGE_FILE_WORKER_THRESHOLD_BYTES,
  chunkKnowledgeText,
  processKnowledgeFile,
  type KnowledgeChunk,
} from './chunker.js'
import { openKnowledgeDb } from './db.js'
import type {
  KnowledgeDocument,
  KnowledgeDocumentIndexMode,
  KnowledgeSearchResult,
  KnowledgeSource,
  KnowledgeSourceKind,
  KnowledgeStats,
} from './types.js'

const MAX_TEXT_FILE_BYTES = 8 * 1024 * 1024
const MAX_SOURCE_FILES = 5_000
const SEARCH_LIMIT_MAX = 100
const CHUNK_WRITE_BATCH_SIZE = 8

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.codegraph',
  '.codebase-memory',
  'node_modules',
  'target',
  'dist',
  'build',
  'coverage',
  '__pycache__',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
])

const KNOWN_BINARY_EXTENSIONS = new Set([
  '.7z', '.a', '.avi', '.bin', '.bmp', '.class', '.dll', '.dmg', '.doc',
  '.docx', '.exe', '.flac', '.gif', '.gz', '.ico', '.jar', '.jpeg', '.jpg',
  '.m4a', '.mov', '.mp3', '.mp4', '.o', '.obj', '.otf', '.pdf', '.png',
  '.ppt', '.pptx', '.rar', '.so', '.tar', '.ttf', '.wav', '.webm', '.webp',
  '.woff', '.woff2', '.xls', '.xlsx', '.zip',
])

type SourceRow = {
  id: string
  path: string
  name: string
  kind: KnowledgeSourceKind
  status: KnowledgeSource['status']
  error: string | null
  document_count: number
  chunk_count: number
  size_bytes: number
  created_at: string
  updated_at: string
  indexed_at: string | null
}

type DocumentRow = {
  id: string
  source_id: string
  path: string
  relative_path: string
  title: string
  extension: string
  index_mode: KnowledgeDocumentIndexMode
  size_bytes: number
  mtime_ms: number
  indexed_at: string
  error: string | null
  is_active: number
}

type IndexedFile = {
  path: string
  relativePath: string
}

type ParsedDocument = {
  mode: KnowledgeDocumentIndexMode
  content: string
  error: string | null
  chunks?: KnowledgeChunk[]
  contentHash?: string
}

type KnowledgeServiceOptions = {
  backgroundScheduler?: BackgroundScheduler
  parseDocument?: (
    filePath: string,
    sizeBytes: number,
    signal?: AbortSignal,
  ) => Promise<ParsedDocument>
}

export class KnowledgeService {
  private readonly db: Database
  private readonly backgroundScheduler: BackgroundScheduler
  private readonly schedulerResourceKey: string
  private readonly parseDocumentImpl: NonNullable<KnowledgeServiceOptions['parseDocument']>
  private readonly jobs = new Map<string, Promise<void>>()
  private readonly jobIds = new Map<string, string>()
  private readonly rerunRequested = new Set<string>()
  private readonly cancelled = new Set<string>()
  private readonly removing = new Set<string>()
  private readonly removalJobs = new Map<string, Promise<void>>()

  constructor(dbPath?: string, options: KnowledgeServiceOptions = {}) {
    this.db = openKnowledgeDb(dbPath)
    this.backgroundScheduler = options.backgroundScheduler ?? backgroundScheduler
    this.schedulerResourceKey = `knowledge-db:${resolve(dbPath ?? 'default')}`
    this.parseDocumentImpl = options.parseDocument ?? parseDocument
    this.db.exec(`
      UPDATE knowledge_sources
      SET status = 'pending', error = NULL
      WHERE status = 'indexing'
    `)
    this.db.exec(`
      UPDATE knowledge_sources
      SET status = 'pending', error = NULL
      WHERE status <> 'removing' AND id IN (
        SELECT DISTINCT source_id FROM knowledge_documents WHERE is_active = 0
      )
    `)
    const interruptedRemovals = this.db.query<{ id: string }, []>(`
      SELECT id FROM knowledge_sources WHERE status = 'removing'
    `).all()
    for (const { id } of interruptedRemovals) {
      this.removing.add(id)
      this.cancelled.add(id)
      void this.scheduleSourceRemoval(id).catch(() => undefined)
    }
  }

  listSources(): KnowledgeSource[] {
    const rows = this.db.query<SourceRow, []>(`
      SELECT * FROM knowledge_sources
      ORDER BY updated_at DESC, name COLLATE NOCASE
    `).all()

    for (const row of rows) {
      if (row.status === 'pending') this.scheduleIndex(row.id)
    }
    return rows.map(mapSource)
  }

  getSource(id: string): KnowledgeSource | null {
    return this.getSourceRaw(id)
  }

  private getSourceRaw(id: string): KnowledgeSource | null {
    const row = this.db.query<SourceRow, [string]>(`
      SELECT * FROM knowledge_sources WHERE id = ?
    `).get(id)
    return row ? mapSource(row) : null
  }

  async addSources(
    paths: string[],
    options: { waitForIndex?: boolean } = {},
  ): Promise<KnowledgeSource[]> {
    const cleanPaths = [...new Set(paths.map((value) => value.trim()).filter(Boolean))]
    if (cleanPaths.length === 0) throw new Error('At least one source path is required')

    const sourceIds: string[] = []
    const indexJobs: Promise<void>[] = []
    for (const inputPath of cleanPaths) {
      const normalizedPath = await validateSourcePath(inputPath)
      const sourceStat = await stat(normalizedPath)
      const kind: KnowledgeSourceKind = sourceStat.isDirectory() ? 'folder' : 'file'
      const id = stableId(normalizedPath)
      const now = new Date().toISOString()

      const removal = this.removalJobs.get(id)
      if (removal) await removal

      this.cancelled.delete(id)
      this.removing.delete(id)
      this.db.query(`
        INSERT INTO knowledge_sources (
          id, path, name, kind, status, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          status = 'pending',
          error = NULL,
          updated_at = excluded.updated_at
      `).run(id, normalizedPath, basename(normalizedPath), kind, now, now)
      sourceIds.push(id)
      const job = this.scheduleIndex(id, true)
      if (job) indexJobs.push(job)
    }

    if (options.waitForIndex) {
      await Promise.all(indexJobs)
    }
    return sourceIds
      .map((id) => this.getSource(id))
      .filter((source): source is KnowledgeSource => source !== null)
  }

  async reindexSource(
    id: string,
    options: { waitForIndex?: boolean } = {},
  ): Promise<KnowledgeSource> {
    if (!this.getSource(id)) throw new Error('Knowledge source not found')
    this.cancelled.delete(id)
    this.db.query(`
      UPDATE knowledge_sources
      SET status = 'pending', error = NULL, updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), id)
    const job = this.scheduleIndex(id, true)
    if (options.waitForIndex) await job
    const source = this.getSource(id)
    if (!source) throw new Error('Knowledge source not found')
    return source
  }

  async removeSource(id: string): Promise<boolean> {
    const activeRemoval = this.removalJobs.get(id)
    if (activeRemoval) {
      await activeRemoval
      return true
    }
    const exists = Boolean(this.getSourceRaw(id))
    if (!exists) return false
    this.removing.add(id)
    this.cancelled.add(id)
    this.db.query(`
      UPDATE knowledge_sources
      SET status = 'removing', error = NULL, updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), id)
    const jobId = this.jobIds.get(id)
    if (jobId) this.backgroundScheduler.cancel(jobId, 'Knowledge source was removed')
    await this.scheduleSourceRemoval(id)
    return true
  }

  private scheduleSourceRemoval(id: string): Promise<void> {
    const existingRemoval = this.removalJobs.get(id)
    if (existingRemoval) return existingRemoval
    const activeJob = this.jobs.get(id)
    const removal = Promise.resolve(activeJob)
      .catch(() => undefined)
      .then(() => this.backgroundScheduler.enqueue({
        type: 'knowledge-remove',
        key: `${this.schedulerResourceKey}:${id}`,
        priority: 1,
        lane: 'sqlite-write',
        resourceKey: this.schedulerResourceKey,
        dedupe: 'join',
        run: context => this.finalizeSourceRemoval(id, context),
      }).promise)
      .catch(error => {
        if (!this.getSourceRaw(id)) return
        if (isAbortError(error)) throw error
        this.removing.delete(id)
        this.cancelled.delete(id)
        this.db.query(`
          UPDATE knowledge_sources
          SET status = 'error', error = ?, updated_at = ?
          WHERE id = ?
        `).run(
          error instanceof Error ? error.message : String(error),
          new Date().toISOString(),
          id,
        )
        throw error
      })
      .finally(() => {
        this.removalJobs.delete(id)
        const source = this.getSourceRaw(id)
        if (source && source.status !== 'removing') {
          this.removing.delete(id)
          this.cancelled.delete(id)
        }
      })
    this.removalJobs.set(id, removal)
    return removal
  }

  listDocuments(options: { sourceId?: string; limit?: number } = {}): KnowledgeDocument[] {
    const limit = clamp(options.limit ?? 500, 1, 2_000)
    const rows = options.sourceId
      ? this.db.query<DocumentRow, [string, number]>(`
          SELECT * FROM knowledge_documents
          WHERE source_id = ? AND is_active = 1
          ORDER BY relative_path COLLATE NOCASE
          LIMIT ?
        `).all(options.sourceId, limit)
      : this.db.query<DocumentRow, [number]>(`
          SELECT * FROM knowledge_documents
          WHERE is_active = 1
          ORDER BY indexed_at DESC, relative_path COLLATE NOCASE
          LIMIT ?
        `).all(limit)
    return rows
      .filter(row => !this.removing.has(row.source_id))
      .map(mapDocument)
  }

  search(query: string, options: { sourceId?: string; limit?: number } = {}): KnowledgeSearchResult[] {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return []
    const limit = clamp(options.limit ?? 30, 1, SEARCH_LIMIT_MAX)
    const resultMap = new Map<number, KnowledgeSearchResult>()

    this.searchFts('knowledge_fts', buildFtsQuery(normalizedQuery), options.sourceId, limit)
      .forEach((result) => resultMap.set(result.chunkId, result))

    if ([...normalizedQuery].length >= 3 && resultMap.size < limit) {
      this.searchFts('knowledge_fts_trigram', quoteFtsPhrase(normalizedQuery), options.sourceId, limit)
        .forEach((result) => {
          if (!resultMap.has(result.chunkId)) resultMap.set(result.chunkId, result)
        })
    }

    if (resultMap.size === 0) {
      this.searchLike(normalizedQuery, options.sourceId, limit)
        .forEach((result) => resultMap.set(result.chunkId, result))
    }

    return [...resultMap.values()]
      .filter(result => !this.removing.has(result.sourceId))
      .sort((a, b) => a.score - b.score)
      .slice(0, limit)
  }

  getStats(): KnowledgeStats {
    const row = this.db.query<{
      source_count: number
      document_count: number
      chunk_count: number
      size_bytes: number
      indexing_count: number
    }, []>(`
      SELECT
        COUNT(*) AS source_count,
        COALESCE(SUM(document_count), 0) AS document_count,
        COALESCE(SUM(chunk_count), 0) AS chunk_count,
        COALESCE(SUM(size_bytes), 0) AS size_bytes,
        COALESCE(SUM(CASE WHEN status IN ('pending', 'indexing') THEN 1 ELSE 0 END), 0) AS indexing_count
      FROM knowledge_sources
    `).get()
    const stats = {
      sourceCount: row?.source_count ?? 0,
      documentCount: row?.document_count ?? 0,
      chunkCount: row?.chunk_count ?? 0,
      sizeBytes: row?.size_bytes ?? 0,
      indexingCount: row?.indexing_count ?? 0,
    }
    return stats
  }

  async waitForIdleForTesting(): Promise<void> {
    while (this.jobs.size > 0 || this.removalJobs.size > 0) {
      await Promise.allSettled([
        ...this.jobs.values(),
        ...this.removalJobs.values(),
      ])
    }
  }

  close(): void {
    this.checkpoint()
    this.db.close()
  }

  private scheduleIndex(
    id: string,
    rerunIfActive = false,
  ): Promise<void> | undefined {
    if (this.removing.has(id)) return undefined
    const active = this.jobs.get(id)
    if (active) {
      if (rerunIfActive) this.rerunRequested.add(id)
      return active
    }

    const job = Promise.resolve().then(() => this.runIndexRounds(id))
    this.jobs.set(id, job)
    return job
  }

  private async runIndexRounds(id: string): Promise<void> {
    try {
      while (!this.removing.has(id) && this.getSourceRaw(id)) {
        this.rerunRequested.delete(id)
        let handle
        try {
          handle = this.backgroundScheduler.enqueue({
            type: 'knowledge-index',
            key: `${this.schedulerResourceKey}:${id}`,
            priority: 2,
            lane: 'sqlite-write',
            resourceKey: this.schedulerResourceKey,
            dedupe: 'join',
            run: context => this.indexSource(id, context),
          })
        } catch (error) {
          this.recordIndexFailure(id, error)
          return
        }

        this.jobIds.set(id, handle.id)
        let interrupted = false
        try {
          await handle.promise
        } catch (error) {
          interrupted = this.recordIndexFailure(id, error)
        } finally {
          if (this.jobIds.get(id) === handle.id) this.jobIds.delete(id)
        }

        if (
          interrupted
          || this.cancelled.has(id)
          || this.removing.has(id)
          || !this.getSourceRaw(id)
        ) {
          return
        }
        if (!this.rerunRequested.has(id)) return
        this.markSourcePending(id)
      }
    } finally {
      this.jobs.delete(id)
      this.jobIds.delete(id)
      this.rerunRequested.delete(id)
      if (!this.removing.has(id)) this.cancelled.delete(id)
    }
  }

  private recordIndexFailure(id: string, error: unknown): boolean {
    if (this.removing.has(id) || !this.getSourceRaw(id)) return true
    if (isRecoverableIndexInterruption(error)) {
      if (!this.cancelled.has(id)) this.markSourcePending(id)
      return true
    }
    if (this.cancelled.has(id)) return true
    const now = new Date().toISOString()
    this.db.query(`
      UPDATE knowledge_sources
      SET status = 'error', error = ?, updated_at = ?
      WHERE id = ?
    `).run(error instanceof Error ? error.message : String(error), now, id)
    return false
  }

  private markSourcePending(id: string): void {
    this.db.query(`
      UPDATE knowledge_sources
      SET status = 'pending', error = NULL, updated_at = ?
      WHERE id = ? AND status <> 'removing'
    `).run(new Date().toISOString(), id)
  }

  private async indexSource(id: string, context: BackgroundTaskContext): Promise<void> {
    const source = this.getSource(id)
    if (!source) return
    this.throwIfIndexCancelled(id, context)
    const startedAt = new Date().toISOString()
    this.throwIfIndexCancelled(id, context)
    this.db.query(`
      UPDATE knowledge_sources
      SET status = 'indexing', error = NULL, updated_at = ?
      WHERE id = ?
    `).run(startedAt, id)

    let files: IndexedFile[]
    try {
      files = source.kind === 'file'
        ? [{ path: source.path, relativePath: basename(source.path) }]
        : await collectFiles(source.path, context.signal)
      this.throwIfIndexCancelled(id, context)
    } catch (error) {
      context.signal.throwIfAborted()
      throw new Error(`Unable to scan source: ${error instanceof Error ? error.message : String(error)}`)
    }

    this.throwIfIndexCancelled(id, context)
    if (!this.getSource(id)) return
    await this.cleanupInactiveDocuments(id, context.yieldIfNeeded, context.signal)
    this.throwIfIndexCancelled(id, context)
    const currentPaths = new Set(files.map((file) => file.path))
    const existingRows = this.db.query<DocumentRow, [string]>(`
      SELECT * FROM knowledge_documents WHERE source_id = ? AND is_active = 1
    `).all(id)
    const existingByPath = new Map(existingRows.map((row) => [row.path, row]))

    for (const existing of existingRows) {
      this.throwIfIndexCancelled(id, context)
      if (!currentPaths.has(existing.path)) {
        this.db.query('UPDATE knowledge_documents SET is_active = 0 WHERE id = ?').run(existing.id)
        await this.deleteDocumentBatched(existing.id, context.yieldIfNeeded, context.signal)
      }
    }

    for (const [index, file] of files.entries()) {
      this.throwIfIndexCancelled(id, context)
      if (!this.getSource(id)) return
      await this.indexFile(source, file, existingByPath.get(file.path), context)
      this.throwIfIndexCancelled(id, context)
      context.report({
        stage: 'indexing',
        completed: index + 1,
        total: files.length,
        message: file.relativePath,
      })
      await context.checkpoint({ sourceId: id, completedFiles: index + 1 })
      this.throwIfIndexCancelled(id, context)
    }

    this.throwIfIndexCancelled(id, context)
    if (!this.getSource(id)) return
    const counts = this.db.query<{
      document_count: number
      chunk_count: number
      size_bytes: number
    }, [string, string, string]>(`
      SELECT
        (SELECT COUNT(*) FROM knowledge_documents WHERE source_id = ? AND is_active = 1) AS document_count,
        (SELECT COUNT(*) FROM knowledge_chunks c
          JOIN knowledge_documents d ON d.id = c.document_id
          WHERE c.source_id = ? AND d.is_active = 1) AS chunk_count,
        (SELECT COALESCE(SUM(size_bytes), 0) FROM knowledge_documents
          WHERE source_id = ? AND is_active = 1) AS size_bytes
    `).get(id, id, id)
    const now = new Date().toISOString()
    const documentCount = counts?.document_count ?? 0
    this.throwIfIndexCancelled(id, context)
    this.db.query(`
      UPDATE knowledge_sources
      SET status = ?, error = NULL, document_count = ?, chunk_count = ?,
          size_bytes = ?, indexed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      documentCount > 0 ? 'ready' : 'empty',
      documentCount,
      counts?.chunk_count ?? 0,
      counts?.size_bytes ?? 0,
      now,
      now,
      id,
    )
    this.throwIfIndexCancelled(id, context)
    this.checkpoint()
  }

  private async indexFile(
    source: KnowledgeSource,
    file: IndexedFile,
    existing: DocumentRow | undefined,
    context: BackgroundTaskContext,
  ): Promise<void> {
    this.throwIfIndexCancelled(source.id, context)
    let fileStat
    try {
      fileStat = await stat(file.path)
      this.throwIfIndexCancelled(source.id, context)
    } catch {
      this.throwIfIndexCancelled(source.id, context)
      if (existing) {
        this.db.query('UPDATE knowledge_documents SET is_active = 0 WHERE id = ?').run(existing.id)
        await this.deleteDocumentBatched(existing.id, context.yieldIfNeeded, context.signal)
      }
      return
    }
    if (!fileStat.isFile()) return
    if (existing && existing.mtime_ms === fileStat.mtimeMs && existing.size_bytes === fileStat.size) return

    const parsed = await this.parseDocumentImpl(file.path, fileStat.size, context.signal)
    this.throwIfIndexCancelled(source.id, context)
    const title = basename(file.path)
    const extension = extname(file.path).toLowerCase()
    const stableDocumentId = stableId(`${source.id}\0${file.path}`)
    const documentId = `${stableDocumentId}:staging:${randomUUID()}`
    const indexedAt = new Date().toISOString()
    const contentHash = parsed.contentHash ?? (parsed.content
      ? createHash('sha256').update(parsed.content).digest('hex')
      : `${fileStat.size}:${fileStat.mtimeMs}`)

    const chunks = parsed.chunks ?? (parsed.content
      ? await chunkKnowledgeText(parsed.content, {
          signal: context.signal,
          yieldIfNeeded: context.yieldIfNeeded,
        })
      : [{ heading: '', content: `${title}\n${file.relativePath}` }])
    this.throwIfIndexCancelled(source.id, context)
    let stagingCreated = false
    let activated = false
    try {
      this.db.query(`
        INSERT INTO knowledge_documents (
          id, source_id, path, relative_path, title, extension, index_mode,
          size_bytes, mtime_ms, content_hash, indexed_at, error, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        documentId,
        source.id,
        file.path,
        file.relativePath,
        title,
        extension,
        parsed.mode,
        fileStat.size,
        fileStat.mtimeMs,
        contentHash,
        indexedAt,
        parsed.error,
      )
      stagingCreated = true

      const insertChunk = this.db.query(`
        INSERT INTO knowledge_chunks (source_id, document_id, ordinal, heading, content)
        VALUES (?, ?, ?, ?, ?)
      `)
      const insertFts = this.db.query(`
        INSERT INTO knowledge_fts (
          rowid, chunk_id, source_id, document_id, title, path, content
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      const insertTrigram = this.db.query(`
        INSERT INTO knowledge_fts_trigram (
          rowid, chunk_id, source_id, document_id, title, path, content
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      const insertBatch = this.db.transaction((batch: Array<[number, typeof chunks[number]]>) => {
        for (const [index, chunk] of batch) {
          this.throwIfIndexCancelled(source.id, context)
          const result = insertChunk.run(source.id, documentId, index, chunk.heading, chunk.content)
          const chunkId = Number(result.lastInsertRowid)
          const searchableContent = chunk.heading
            ? `${chunk.heading}\n${chunk.content}`
            : chunk.content
          insertFts.run(chunkId, chunkId, source.id, documentId, title, file.relativePath, searchableContent)
          insertTrigram.run(chunkId, chunkId, source.id, documentId, title, file.relativePath, searchableContent)
        }
      })

      for (let offset = 0; offset < chunks.length; offset += CHUNK_WRITE_BATCH_SIZE) {
        this.throwIfIndexCancelled(source.id, context)
        const batch = chunks
          .slice(offset, offset + CHUNK_WRITE_BATCH_SIZE)
          .map((chunk, index) => [offset + index, chunk] as [number, typeof chunk])
        insertBatch(batch)
        await context.yieldIfNeeded()
        this.throwIfIndexCancelled(source.id, context)
      }

      this.throwIfIndexCancelled(source.id, context)
      this.db.transaction(() => {
        if (existing) {
          this.db.query(`
            UPDATE knowledge_documents SET is_active = 0
            WHERE id = ? AND is_active = 1
          `).run(existing.id)
        }
        this.db.query(`
          UPDATE knowledge_documents SET is_active = 1 WHERE id = ?
        `).run(documentId)
      })()
      activated = true
    } finally {
      if (stagingCreated && !activated) {
        await this.deleteDocumentBatched(documentId, context.yieldIfNeeded).catch(() => undefined)
      }
    }

    if (existing) {
      await this.deleteDocumentBatched(existing.id, context.yieldIfNeeded).catch(() => undefined)
    }
  }

  private searchFts(
    table: 'knowledge_fts' | 'knowledge_fts_trigram',
    matchQuery: string,
    sourceId: string | undefined,
    limit: number,
  ): KnowledgeSearchResult[] {
    try {
      const sourceClause = sourceId ? `AND f.source_id = ?` : ''
      const sql = `
        SELECT
          CAST(f.chunk_id AS INTEGER) AS chunk_id,
          f.source_id,
          f.document_id,
          s.name AS source_name,
          f.title,
          d.path,
          snippet(${table}, 5, '<mark>', '</mark>', '…', 24) AS excerpt,
          bm25(${table}) AS score
        FROM ${table} f
        JOIN knowledge_sources s ON s.id = f.source_id
        JOIN knowledge_documents d ON d.id = f.document_id
        WHERE ${table} MATCH ? AND d.is_active = 1 ${sourceClause}
        ORDER BY score
        LIMIT ?
      `
      const rows = sourceId
        ? this.db.query<Record<string, unknown>, [string, string, number]>(sql).all(matchQuery, sourceId, limit)
        : this.db.query<Record<string, unknown>, [string, number]>(sql).all(matchQuery, limit)
      return rows.map(mapSearchResult)
    } catch {
      return []
    }
  }

  private searchLike(query: string, sourceId: string | undefined, limit: number): KnowledgeSearchResult[] {
    const pattern = `%${query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    const sourceClause = sourceId ? 'AND c.source_id = ?' : ''
    const sql = `
      SELECT
        c.id AS chunk_id,
        c.source_id,
        c.document_id,
        s.name AS source_name,
        d.title,
        d.path,
        substr(c.content, 1, 360) AS excerpt,
        0 AS score
      FROM knowledge_chunks c
      JOIN knowledge_sources s ON s.id = c.source_id
      JOIN knowledge_documents d ON d.id = c.document_id
      WHERE (c.content LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\' OR d.path LIKE ? ESCAPE '\\')
        AND d.is_active = 1
        ${sourceClause}
      ORDER BY d.indexed_at DESC
      LIMIT ?
    `
    const rows = sourceId
      ? this.db.query<Record<string, unknown>, [string, string, string, string, number]>(sql)
          .all(pattern, pattern, pattern, sourceId, limit)
      : this.db.query<Record<string, unknown>, [string, string, string, number]>(sql)
          .all(pattern, pattern, pattern, limit)
    return rows.map(mapSearchResult)
  }

  private async cleanupInactiveDocuments(
    sourceId: string,
    yieldIfNeeded: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    const documents = this.db.query<{ id: string }, [string]>(`
      SELECT id FROM knowledge_documents
      WHERE source_id = ? AND is_active = 0
    `).all(sourceId)
    for (const document of documents) {
      signal?.throwIfAborted()
      await this.deleteDocumentBatched(document.id, yieldIfNeeded, signal)
    }
  }

  private async deleteSourceIndex(
    sourceId: string,
    context: BackgroundTaskContext,
  ): Promise<void> {
    const documents = this.db.query<{ id: string }, [string]>(`
      SELECT id FROM knowledge_documents WHERE source_id = ?
    `).all(sourceId)
    for (const document of documents) {
      context.signal.throwIfAborted()
      await this.deleteDocumentBatched(
        document.id,
        context.yieldIfNeeded,
        context.signal,
      )
    }
  }

  private async deleteDocumentBatched(
    documentId: string,
    yieldIfNeeded: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted()
    const chunks = this.db.query<{ id: number }, [string]>(`
      SELECT id FROM knowledge_chunks WHERE document_id = ?
    `).all(documentId)
    const deleteFts = this.db.query('DELETE FROM knowledge_fts WHERE rowid = ?')
    const deleteTrigram = this.db.query('DELETE FROM knowledge_fts_trigram WHERE rowid = ?')
    const deleteChunk = this.db.query('DELETE FROM knowledge_chunks WHERE id = ?')
    const deleteBatch = this.db.transaction((batch: Array<{ id: number }>) => {
      for (const chunk of batch) {
        signal?.throwIfAborted()
        deleteFts.run(chunk.id)
        deleteTrigram.run(chunk.id)
        deleteChunk.run(chunk.id)
      }
    })
    for (let offset = 0; offset < chunks.length; offset += 32) {
      signal?.throwIfAborted()
      deleteBatch(chunks.slice(offset, offset + 32))
      await yieldIfNeeded()
    }
    signal?.throwIfAborted()
    this.db.query('DELETE FROM knowledge_documents WHERE id = ?').run(documentId)
  }

  private async finalizeSourceRemoval(
    id: string,
    context: BackgroundTaskContext,
  ): Promise<void> {
    await this.deleteSourceIndex(id, context)
    context.signal.throwIfAborted()
    this.db.query('DELETE FROM knowledge_sources WHERE id = ?').run(id)
    this.checkpoint()
    this.cancelled.delete(id)
    this.removing.delete(id)
  }

  private checkpoint(): void {
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      // The active journal mode may not support checkpoints.
    }
  }

  private throwIfIndexCancelled(id: string, context: BackgroundTaskContext): void {
    context.signal.throwIfAborted()
    if (!this.cancelled.has(id) && !this.removing.has(id)) return
    const error = new Error('Knowledge indexing was cancelled')
    error.name = 'AbortError'
    throw error
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isRecoverableIndexInterruption(error: unknown): boolean {
  return isAbortError(error)
    || (error instanceof Error
      && error.message === 'Background scheduler is shutting down')
}

async function validateSourcePath(inputPath: string): Promise<string> {
  const resolvedPath = resolve(inputPath).normalize('NFC')
  const normalizedPath = (await realpath(resolvedPath)).normalize('NFC')
  const sourceStat = await stat(normalizedPath)
  if (!sourceStat.isFile() && !sourceStat.isDirectory()) {
    throw new Error('Knowledge source must be a file or folder')
  }
  if (sourceStat.isDirectory()) {
    const homePath = (await realpath(homedir())).normalize('NFC')
    if (normalizedPath === parse(normalizedPath).root || normalizedPath === homePath) {
      throw new Error('Choose a project or document folder, not the disk root or entire home folder')
    }
  }
  return normalizedPath
}

async function collectFiles(
  rootPath: string,
  signal?: AbortSignal,
): Promise<IndexedFile[]> {
  const files: IndexedFile[] = []
  const queue = [rootPath]
  while (queue.length > 0 && files.length < MAX_SOURCE_FILES) {
    signal?.throwIfAborted()
    const directory = queue.shift()!
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
      signal?.throwIfAborted()
    } catch {
      signal?.throwIfAborted()
      continue
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      signal?.throwIfAborted()
      if (files.length >= MAX_SOURCE_FILES) break
      if (entry.isSymbolicLink()) continue
      const entryPath = resolve(directory, entry.name).normalize('NFC')
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) queue.push(entryPath)
      } else if (entry.isFile()) {
        files.push({
          path: entryPath,
          relativePath: relative(rootPath, entryPath).normalize('NFC'),
        })
      }
    }
  }
  return files
}

async function parseDocument(
  filePath: string,
  sizeBytes: number,
  signal?: AbortSignal,
): Promise<ParsedDocument> {
  signal?.throwIfAborted()
  const extension = extname(filePath).toLowerCase()
  if (sizeBytes > MAX_TEXT_FILE_BYTES) {
    return {
      mode: 'metadata',
      content: '',
      error: `Content was not indexed because the file is larger than ${MAX_TEXT_FILE_BYTES / 1024 / 1024} MB`,
    }
  }
  if (KNOWN_BINARY_EXTENSIONS.has(extension)) {
    return {
      mode: 'metadata',
      content: '',
      error: 'Binary content is represented by filename and path only',
    }
  }

  if (sizeBytes >= KNOWLEDGE_FILE_WORKER_THRESHOLD_BYTES) {
    const processed = await processKnowledgeFile(filePath, { signal })
    return {
      mode: processed.mode,
      content: '',
      chunks: processed.mode === 'text' ? processed.chunks : undefined,
      contentHash: processed.contentHash ?? undefined,
      error: processed.error,
    }
  }

  const fileBuffer = await readFile(filePath)
  signal?.throwIfAborted()
  const sample = fileBuffer.subarray(0, Math.min(fileBuffer.length, 8_192))
  if (sample.includes(0)) {
    return {
      mode: 'metadata',
      content: '',
      error: 'Binary content is represented by filename and path only',
    }
  }
  return {
    mode: 'text',
    content: fileBuffer.toString('utf8').replace(/\r\n?/g, '\n').trim(),
    error: null,
  }
}

function stableId(value: string): string {
  return createHash('sha256').update(value.normalize('NFC')).digest('hex').slice(0, 24)
}

function buildFtsQuery(value: string): string {
  const tokens = value.split(/\s+/).map((token) => token.trim()).filter(Boolean)
  return tokens.map((token) => `${quoteFtsPhrase(token)}*`).join(' AND ')
}

function quoteFtsPhrase(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function mapSource(row: SourceRow): KnowledgeSource {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    kind: row.kind,
    status: row.status,
    error: row.error,
    documentCount: row.document_count,
    chunkCount: row.chunk_count,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    indexedAt: row.indexed_at,
  }
}

function mapDocument(row: DocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    sourceId: row.source_id,
    path: row.path,
    relativePath: row.relative_path,
    title: row.title,
    extension: row.extension,
    indexMode: row.index_mode,
    sizeBytes: row.size_bytes,
    modifiedAt: new Date(row.mtime_ms).toISOString(),
    indexedAt: row.indexed_at,
    error: row.error,
  }
}

function mapSearchResult(row: Record<string, unknown>): KnowledgeSearchResult {
  return {
    chunkId: Number(row.chunk_id),
    sourceId: String(row.source_id),
    documentId: String(row.document_id),
    sourceName: String(row.source_name),
    title: String(row.title),
    path: String(row.path),
    excerpt: String(row.excerpt ?? ''),
    score: Number(row.score ?? 0),
  }
}

let defaultKnowledgeService: KnowledgeService | null = null

export function getKnowledgeService(): KnowledgeService {
  if (!defaultKnowledgeService) defaultKnowledgeService = new KnowledgeService()
  return defaultKnowledgeService
}
