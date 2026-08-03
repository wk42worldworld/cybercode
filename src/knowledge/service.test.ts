import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { KnowledgeService } from './service.js'
import { BackgroundScheduler } from '../server/background/scheduler.js'
import { openKnowledgeDb } from './db.js'

const cleanupPaths: string[] = []
const services: KnowledgeService[] = []
const schedulers: BackgroundScheduler[] = []

afterEach(async () => {
  await Promise.all(schedulers.splice(0).map((scheduler) => scheduler.shutdown({ timeoutMs: 100 })))
  for (const service of services.splice(0)) service.close()
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('KnowledgeService', () => {
  test('indexes text incrementally and searches Chinese content', async () => {
    const fixture = await createFixture()
    const project = join(fixture, 'project')
    await mkdir(project)
    await writeFile(join(project, 'README.md'), '# 架构设计\n\n订单服务通过事件总线处理付款。')
    await writeFile(join(project, 'worker.ts'), 'export function settlePayment() { return "paid" }')

    const service = createService(fixture)
    const [source] = await service.addSources([project], { waitForIndex: true })

    expect(source?.status).toBe('ready')
    expect(source?.documentCount).toBe(2)
    expect(service.search('事件总线')[0]?.title).toBe('README.md')
    expect(service.search('settlePayment')[0]?.title).toBe('worker.ts')

    await service.reindexSource(source!.id, { waitForIndex: true })
    expect(service.listDocuments({ sourceId: source!.id })).toHaveLength(2)
    expect(service.getStats().chunkCount).toBeGreaterThanOrEqual(2)
  })

  test('keeps binary files as metadata without reading their content', async () => {
    const fixture = await createFixture()
    const audioPath = join(fixture, 'meeting.wav')
    await writeFile(audioPath, new Uint8Array([0, 1, 2, 3, 4]))

    const service = createService(fixture)
    const [source] = await service.addSources([audioPath], { waitForIndex: true })
    const [document] = service.listDocuments({ sourceId: source!.id })

    expect(document?.indexMode).toBe('metadata')
    expect(document?.error).toContain('filename and path')
    expect(service.search('meeting')[0]?.title).toBe('meeting.wav')
  })

  test('removing a source deletes only the index', async () => {
    const fixture = await createFixture()
    const notePath = join(fixture, 'notes.txt')
    await writeFile(notePath, 'Persistent source file')

    const service = createService(fixture)
    const [source] = await service.addSources([notePath], { waitForIndex: true })
    expect(await service.removeSource(source!.id)).toBe(true)

    expect(service.listSources()).toHaveLength(0)
    expect(await readFile(notePath, 'utf8')).toBe('Persistent source file')
  })

  test('supports a file and its containing folder as separate sources', async () => {
    const fixture = await createFixture()
    const project = join(fixture, 'project')
    const notePath = join(project, 'notes.md')
    await mkdir(project)
    await writeFile(notePath, 'Shared source content')

    const service = createService(fixture)
    const [fileSource] = await service.addSources([notePath], { waitForIndex: true })
    const [folderSource] = await service.addSources([project], { waitForIndex: true })

    expect(service.listDocuments({ sourceId: fileSource!.id })).toHaveLength(1)
    expect(service.listDocuments({ sourceId: folderSource!.id })).toHaveLength(1)
    expect(service.search('Shared source content')).toHaveLength(2)
  })

  test('routes multiple knowledge databases through the bounded sqlite lane', async () => {
    const fixture = await createFixture()
    const scheduler = new BackgroundScheduler({ limits: { 'sqlite-write': 1 } })
    schedulers.push(scheduler)
    const firstPath = join(fixture, 'first.md')
    const secondPath = join(fixture, 'second.md')
    await writeFile(firstPath, '# First\n' + 'alpha '.repeat(20_000))
    await writeFile(secondPath, '# Second\n' + 'beta '.repeat(20_000))
    const first = new KnowledgeService(join(fixture, 'first.db'), { backgroundScheduler: scheduler })
    const second = new KnowledgeService(join(fixture, 'second.db'), { backgroundScheduler: scheduler })
    services.push(first, second)
    let running = 0
    let maximum = 0
    const unsubscribe = scheduler.subscribe((snapshot) => {
      if (snapshot.type !== 'knowledge-index') return
      running = (scheduler.snapshot() as Array<{ type: string; status: string }>)
        .filter(task => task.type === 'knowledge-index' && task.status === 'running').length
      maximum = Math.max(maximum, running)
    })

    await Promise.all([
      first.addSources([firstPath], { waitForIndex: true }),
      second.addSources([secondPath], { waitForIndex: true }),
    ])
    unsubscribe()
    expect(maximum).toBe(1)
  })

  test('returns scheduler-interrupted indexing to pending and resumes after restart', async () => {
    const fixture = await createFixture()
    const dbPath = join(fixture, 'shutdown-index.db')
    const notePath = join(fixture, 'shutdown-index.md')
    await writeFile(notePath, 'shutdown-index-marker')
    const scheduler = new BackgroundScheduler()
    schedulers.push(scheduler)
    let markParsingStarted!: () => void
    const parsingStarted = new Promise<void>(resolve => {
      markParsingStarted = resolve
    })
    let releaseParser!: () => void
    const parserGate = new Promise<void>(resolve => {
      releaseParser = resolve
    })
    const first = new KnowledgeService(dbPath, {
      backgroundScheduler: scheduler,
      parseDocument: async (_filePath, _sizeBytes, signal) => {
        markParsingStarted()
        await parserGate
        signal?.throwIfAborted()
        return { mode: 'text', content: 'interrupted-content', error: null }
      },
    })

    const [source] = await first.addSources([notePath])
    await parsingStarted
    const shutdown = scheduler.shutdown({ timeoutMs: 500 })
    releaseParser()
    await shutdown
    await first.waitForIdleForTesting()

    expect(first.getSource(source!.id)).toMatchObject({
      status: 'pending',
      error: null,
    })
    first.close()

    const restartScheduler = new BackgroundScheduler()
    schedulers.push(restartScheduler)
    const restarted = new KnowledgeService(dbPath, {
      backgroundScheduler: restartScheduler,
    })
    services.push(restarted)
    expect(restarted.listSources()[0]?.status).toBe('pending')
    await restarted.waitForIdleForTesting()
    expect(restarted.getSource(source!.id)?.status).toBe('ready')
    expect(restarted.search('shutdown-index-marker')).toHaveLength(1)
  })

  test('queues a rerun for reindex during indexing and waits for that round', async () => {
    const fixture = await createFixture()
    const scheduler = new BackgroundScheduler()
    schedulers.push(scheduler)
    const notePath = join(fixture, 'rerun.md')
    await writeFile(notePath, 'first-file-version')
    let invocation = 0
    let markFirstStarted!: () => void
    const firstStarted = new Promise<void>(resolve => {
      markFirstStarted = resolve
    })
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    let markSecondStarted!: () => void
    const secondStarted = new Promise<void>(resolve => {
      markSecondStarted = resolve
    })
    let releaseSecond!: () => void
    const secondGate = new Promise<void>(resolve => {
      releaseSecond = resolve
    })
    const service = new KnowledgeService(join(fixture, 'rerun.db'), {
      backgroundScheduler: scheduler,
      parseDocument: async (_filePath, _sizeBytes, signal) => {
        invocation += 1
        if (invocation === 1) {
          markFirstStarted()
          await firstGate
          signal?.throwIfAborted()
          return { mode: 'text', content: 'first-index-generation', error: null }
        }
        markSecondStarted()
        await secondGate
        signal?.throwIfAborted()
        return { mode: 'text', content: 'second-index-generation', error: null }
      },
    })
    services.push(service)

    const [source] = await service.addSources([notePath])
    await firstStarted
    await writeFile(notePath, 'second-file-version-with-a-different-size')
    let reindexSettled = false
    const reindex = service.reindexSource(source!.id, { waitForIndex: true })
      .then(result => {
        reindexSettled = true
        return result
      })
    releaseFirst()
    await Promise.race([
      secondStarted,
      Bun.sleep(1_000).then(() => {
        throw new Error('Timed out waiting for the queued reindex round')
      }),
    ])
    await Bun.sleep(20)

    expect(reindexSettled).toBe(false)
    expect(invocation).toBe(2)
    releaseSecond()
    const refreshed = await reindex
    expect(refreshed.status).toBe('ready')
    expect(service.search('first-index-generation')).toHaveLength(0)
    expect(service.search('second-index-generation')).toHaveLength(1)
  })

  test('waits for active parsing to stop before removal and never revives the source', async () => {
    const fixture = await createFixture()
    const scheduler = new BackgroundScheduler()
    schedulers.push(scheduler)
    const notePath = join(fixture, 'cancel-during-parse.md')
    await writeFile(notePath, '# Cancellation\nThis content must never be written after removal.')

    let markParsingStarted!: () => void
    const parsingStarted = new Promise<void>(resolve => {
      markParsingStarted = resolve
    })
    let releaseParser!: () => void
    const parserGate = new Promise<void>(resolve => {
      releaseParser = resolve
    })
    let parserReturned = false
    const service = new KnowledgeService(join(fixture, 'cancel.db'), {
      backgroundScheduler: scheduler,
      parseDocument: async (_filePath, _sizeBytes, signal) => {
        markParsingStarted()
        await parserGate
        signal?.throwIfAborted()
        parserReturned = true
        return { mode: 'text', content: 'must-not-be-indexed', error: null }
      },
    })
    services.push(service)

    const [source] = await service.addSources([notePath])
    await parsingStarted
    const removed = service.removeSource(source!.id)
    const removingWhileParsing = service.getSource(source!.id)?.status === 'removing'
    const countedUntilRemovalCompletes = service.getStats().sourceCount === 1
    let idleSettled = false
    const idle = service.waitForIdleForTesting().then(() => {
      idleSettled = true
    })
    await Bun.sleep(20)
    const waitedForParser = !idleSettled
    releaseParser()
    await idle
    await Bun.sleep(10)

    expect(await removed).toBe(true)
    expect(removingWhileParsing).toBe(true)
    expect(countedUntilRemovalCompletes).toBe(true)
    expect(waitedForParser).toBe(true)
    expect(parserReturned).toBe(false)
    expect(service.getSource(source!.id)).toBeNull()
    expect(service.listSources()).toHaveLength(0)
    expect(service.listDocuments({ sourceId: source!.id })).toHaveLength(0)
    expect(service.search('must-not-be-indexed')).toHaveLength(0)
  })

  test('resumes a persisted removal after restart before reporting it complete', async () => {
    const fixture = await createFixture()
    const dbPath = join(fixture, 'restart-removal.db')
    const notePath = join(fixture, 'restart-removal.md')
    await writeFile(notePath, 'restart-removal-marker')

    const firstScheduler = new BackgroundScheduler()
    schedulers.push(firstScheduler)
    const first = new KnowledgeService(dbPath, { backgroundScheduler: firstScheduler })
    const [source] = await first.addSources([notePath], { waitForIndex: true })
    first.close()

    const db = openKnowledgeDb(dbPath)
    db.query(`
      UPDATE knowledge_documents SET is_active = 0 WHERE source_id = ?
    `).run(source!.id)
    db.query(`
      UPDATE knowledge_sources SET status = 'removing', error = NULL WHERE id = ?
    `).run(source!.id)
    db.close()

    const restartScheduler = new BackgroundScheduler()
    schedulers.push(restartScheduler)
    const restarted = new KnowledgeService(dbPath, { backgroundScheduler: restartScheduler })
    services.push(restarted)
    expect(restarted.listSources()[0]?.status).toBe('removing')

    await restarted.waitForIdleForTesting()
    expect(restarted.listSources()).toHaveLength(0)
    expect(restarted.search('restart-removal-marker')).toHaveLength(0)
    expect(await readFile(notePath, 'utf8')).toBe('restart-removal-marker')
  })

  test('keeps a shutdown-interrupted removal resumable on next start', async () => {
    const fixture = await createFixture()
    const dbPath = join(fixture, 'shutdown-removal.db')
    const notePath = join(fixture, 'shutdown-removal.md')
    await writeFile(notePath, 'shutdown-removal-marker')
    const scheduler = new BackgroundScheduler({ limits: { 'sqlite-write': 1 } })
    schedulers.push(scheduler)
    const service = new KnowledgeService(dbPath, { backgroundScheduler: scheduler })
    const [source] = await service.addSources([notePath], { waitForIndex: true })

    let releaseBlocker!: () => void
    const blockerGate = new Promise<void>(resolve => {
      releaseBlocker = resolve
    })
    let markBlocked!: () => void
    const blocked = new Promise<void>(resolve => {
      markBlocked = resolve
    })
    const blocker = scheduler.enqueue({
      type: 'knowledge-test-blocker',
      key: 'shutdown-removal',
      priority: 0,
      lane: 'sqlite-write',
      dedupe: 'drop',
      run: async () => {
        markBlocked()
        await blockerGate
      },
    })
    await blocked

    const removal = service.removeSource(source!.id)
    await Bun.sleep(10)
    const shutdown = scheduler.shutdown({ timeoutMs: 500 })
    releaseBlocker()
    await shutdown
    await blocker.promise.catch(() => undefined)
    await expect(removal).rejects.toMatchObject({ name: 'AbortError' })
    expect(service.getSource(source!.id)?.status).toBe('removing')
    expect(service.search('shutdown-removal-marker')).toHaveLength(0)
    expect(service.listDocuments({ sourceId: source!.id })).toHaveLength(0)
    service.close()

    const restartScheduler = new BackgroundScheduler()
    schedulers.push(restartScheduler)
    const restarted = new KnowledgeService(dbPath, {
      backgroundScheduler: restartScheduler,
    })
    services.push(restarted)
    await restarted.waitForIdleForTesting()
    expect(restarted.getSource(source!.id)).toBeNull()
    expect(restarted.search('shutdown-removal-marker')).toHaveLength(0)
  })

  test('keeps a failed removal visible with an actionable error', async () => {
    const fixture = await createFixture()
    const notePath = join(fixture, 'failed-removal.md')
    await writeFile(notePath, 'failed-removal-marker')
    const scheduler = new BackgroundScheduler()
    schedulers.push(scheduler)
    const service = new KnowledgeService(join(fixture, 'failed-removal.db'), {
      backgroundScheduler: scheduler,
    })
    services.push(service)
    const [source] = await service.addSources([notePath], { waitForIndex: true })
    await scheduler.shutdown({ timeoutMs: 100 })

    await expect(service.removeSource(source!.id)).rejects.toThrow('shutting down')
    expect(service.getSource(source!.id)).toMatchObject({
      status: 'error',
      error: expect.stringContaining('shutting down'),
    })
    expect(service.listSources()).toHaveLength(1)
    expect(service.search('failed-removal-marker')).toHaveLength(1)
  })

  test('keeps the active document searchable until its replacement is ready', async () => {
    const fixture = await createFixture()
    const scheduler = new BackgroundScheduler()
    schedulers.push(scheduler)
    const notePath = join(fixture, 'atomic-refresh.md')
    await writeFile(notePath, 'old-source')
    let invocation = 0
    let markReplacementStarted!: () => void
    const replacementStarted = new Promise<void>(resolve => {
      markReplacementStarted = resolve
    })
    let releaseReplacement!: () => void
    const replacementGate = new Promise<void>(resolve => {
      releaseReplacement = resolve
    })
    const service = new KnowledgeService(join(fixture, 'atomic.db'), {
      backgroundScheduler: scheduler,
      parseDocument: async () => {
        invocation += 1
        if (invocation === 1) {
          return { mode: 'text', content: 'old-generation-marker', error: null }
        }
        markReplacementStarted()
        await replacementGate
        return { mode: 'text', content: 'new-generation-marker', error: null }
      },
    })
    services.push(service)

    const [source] = await service.addSources([notePath], { waitForIndex: true })
    await writeFile(notePath, 'new-source-with-different-size')
    const refresh = service.reindexSource(source!.id, { waitForIndex: true })
    await replacementStarted

    expect(service.search('old-generation-marker')).toHaveLength(1)
    expect(service.search('new-generation-marker')).toHaveLength(0)

    releaseReplacement()
    await refresh
    expect(service.search('old-generation-marker')).toHaveLength(0)
    expect(service.search('new-generation-marker')).toHaveLength(1)
  })

  test('never exposes inactive staging documents to search or document lists', async () => {
    const fixture = await createFixture()
    const notePath = join(fixture, 'staging.md')
    await writeFile(notePath, 'active-generation-marker')
    const service = createService(fixture)
    const [source] = await service.addSources([notePath], { waitForIndex: true })
    const db = openKnowledgeDb(join(fixture, 'knowledge.db'))
    try {
      const stagingId = 'staging-document-test'
      db.query(`
        INSERT INTO knowledge_documents (
          id, source_id, path, relative_path, title, extension, index_mode,
          size_bytes, mtime_ms, content_hash, indexed_at, error, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, 'text', 1, 1, 'hash', ?, NULL, 0)
      `).run(
        stagingId,
        source!.id,
        notePath,
        'staging.md',
        'staging.md',
        '.md',
        new Date().toISOString(),
      )
      const inserted = db.query(`
        INSERT INTO knowledge_chunks (source_id, document_id, ordinal, heading, content)
        VALUES (?, ?, 0, '', 'staging-only-marker')
      `).run(source!.id, stagingId)
      const chunkId = Number(inserted.lastInsertRowid)
      db.query(`
        INSERT INTO knowledge_fts (
          rowid, chunk_id, source_id, document_id, title, path, content
        ) VALUES (?, ?, ?, ?, 'staging.md', 'staging.md', 'staging-only-marker')
      `).run(chunkId, chunkId, source!.id, stagingId)
      db.query(`
        INSERT INTO knowledge_fts_trigram (
          rowid, chunk_id, source_id, document_id, title, path, content
        ) VALUES (?, ?, ?, ?, 'staging.md', 'staging.md', 'staging-only-marker')
      `).run(chunkId, chunkId, source!.id, stagingId)
    } finally {
      db.close()
    }

    expect(service.search('staging-only-marker')).toHaveLength(0)
    expect(service.listDocuments({ sourceId: source!.id })).toHaveLength(1)
    expect(service.search('active-generation-marker')).toHaveLength(1)
  })
})

async function createFixture(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'cybercode-knowledge-'))
  cleanupPaths.push(path)
  return path
}

function createService(fixture: string): KnowledgeService {
  const scheduler = new BackgroundScheduler()
  schedulers.push(scheduler)
  const service = new KnowledgeService(join(fixture, 'knowledge.db'), {
    backgroundScheduler: scheduler,
  })
  services.push(service)
  return service
}
