import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { mkdir, rm, writeFile, appendFile, stat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  discoverSessionSearch,
  readSessionSearch,
  scrollSessionSearch,
} from './search.js'
import { buildPastSessionPromptContext } from './promptContext.js'
import {
  deleteSessionFromSearchIndex,
  cancelScheduledSessionSearchIndexRefreshes,
  ensureSessionSearchIndexFresh,
  indexSessionSearchTranscript,
  refreshSessionSearchPathMetadata,
  resetSessionSearchIndex,
  scheduleSessionSearchIndexRefresh,
  sessionSearchIndexerForTesting,
} from './indexer.js'
import { openSessionSearchDb } from './db.js'
import { SESSION_SEARCH_CONTENT_MAX_CHARS } from './indexText.js'
import { searchProjectMemories, buildProjectMemoryPromptContext } from './projectMemory.js'
import {
  PROJECT_MEMORY_CONTEXT_TAG,
  appendProjectMemoryContext,
} from './projectMemoryContext.js'
import { SearchService } from '../server/services/searchService.js'
import { SessionService } from '../server/services/sessionService.js'
import {
  backgroundScheduler,
  BackgroundScheduler,
} from '../server/background/scheduler.js'
import {
  TRANSCRIPT_JSONL_WORKER_THRESHOLD_BYTES,
  type TranscriptWorkerLike,
} from './transcript.js'

const originalCyberConfigDir = process.env.CYBER_CONFIG_DIR
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR

let configDir: string

function line(value: Record<string, unknown>): string {
  return `${JSON.stringify(value)}\n`
}

async function writeSession(params: {
  projectPath: string
  sessionId: string
  lines: Record<string, unknown>[]
}): Promise<string> {
  const dir = join(configDir, 'projects', params.projectPath)
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, `${params.sessionId}.jsonl`)
  await writeFile(filePath, params.lines.map(line).join(''), 'utf-8')
  return filePath
}

function user(uuid: string, text: string, timestamp: string): Record<string, unknown> {
  return {
    type: 'user',
    uuid,
    timestamp,
    message: { role: 'user', content: text },
  }
}

function assistant(uuid: string, text: string, timestamp: string): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'claude-test',
    },
  }
}

function assistantTool(
  uuid: string,
  name: string,
  input: Record<string, unknown>,
  timestamp: string,
): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp,
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: `toolu_${uuid}`, name, input }],
      model: 'claude-test',
    },
  }
}

function getActiveGenerationKey(db: Database, filePath: string): string {
  const row = db.query<{ session_key: string }, [string]>(`
    SELECT session_key FROM indexed_files WHERE file_path = ?
  `).get(filePath)
  if (!row) throw new Error(`Missing active generation for ${filePath}`)
  return row.session_key
}

function countGenerationMessages(db: Database, generationKey: string): number {
  const row = db.query<{ count: number }, [string]>(`
    SELECT COUNT(*) AS count FROM messages WHERE session_key = ?
  `).get(generationKey)
  return row?.count ?? 0
}

function countVisibleMessages(db: Database, text: string): number {
  const row = db.query<{ count: number }, [string]>(`
    SELECT COUNT(*) AS count
    FROM messages m
    JOIN indexed_files i
      ON i.session_key = m.session_key
     AND i.session_id = m.session_id
     AND i.project_path = m.project_path
    JOIN sessions s
      ON s.session_id = i.session_id
     AND s.project_path = i.project_path
     AND s.file_path = i.file_path
    WHERE m.content_text LIKE ?
  `).get(`%${text}%`)
  return row?.count ?? 0
}

describe('session search memory index', () => {
  beforeEach(async () => {
    configDir = join(
      tmpdir(),
      `cyber-session-search-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    process.env.CYBER_CONFIG_DIR = configDir
    delete process.env.CLAUDE_CONFIG_DIR
    await mkdir(configDir, { recursive: true })
    await resetSessionSearchIndex()
  })

  afterEach(async () => {
    await cancelScheduledSessionSearchIndexRefreshes()
    if (originalCyberConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
    else process.env.CYBER_CONFIG_DIR = originalCyberConfigDir
    if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
    await rm(configDir, { recursive: true, force: true })
  })

  it('indexes JSONL sessions and returns anchored FTS windows', async () => {
    await writeSession({
      projectPath: '-Users-wang-demo',
      sessionId: '11111111-1111-4111-8111-111111111111',
      lines: [
        { type: 'session-meta', isMeta: true, workDir: '/Users/wang/demo' },
        user('u1', 'Discuss the neural cache bug', '2026-01-01T00:00:00.000Z'),
        assistant('a1', 'The neural cache bug was caused by stale rows.', '2026-01-01T00:01:00.000Z'),
        user('u2', 'Please remember the fix for later.', '2026-01-01T00:02:00.000Z'),
      ],
    })

    const result = await discoverSessionSearch({ query: 'neural cache', limit: 3 })

    expect(result.mode).toBe('discover')
    expect(result.count).toBe(1)
    expect(result.results[0]?.sessionId).toBe('11111111-1111-4111-8111-111111111111')
    expect(result.results[0]?.projectPath).toBe('-Users-wang-demo')
    expect(result.results[0]?.messages.some(message => message.anchor)).toBe(true)
    expect(result.results[0]?.matches[0]?.text).toContain('neural')
  })

  it('indexes history.jsonl user prompts as fallback FTS sessions', async () => {
    await writeFile(
      join(configDir, 'history.jsonl'),
      [
        line({
          display: '我创建了一个叫做 CyberCamera 的 Xcode iOS 项目',
          project: '/Users/wang',
          sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          timestamp: Date.parse('2026-01-02T00:00:00.000Z'),
        }),
        line({
          display: '/Users/wang/Documents/MyProject/iosapp/CyberCamera',
          project: '/Users/wang',
          sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          timestamp: Date.parse('2026-01-02T00:01:00.000Z'),
        }),
      ].join(''),
      'utf-8',
    )

    const result = await discoverSessionSearch({ query: 'CyberCamera', limit: 3 })

    expect(result.count).toBe(1)
    expect(result.results[0]?.projectPath).toBe('-Users-wang')
    expect(result.results[0]?.messages.map(message => message.content).join('\n')).toContain('CyberCamera')
  })

  it('keeps a middle history session indexed when the shared log exceeds retention bounds', async () => {
    const historyPath = join(configDir, 'history.jsonl')
    const middleSessionId = 'acacacac-acac-4cac-8cac-acacacacacac'
    const headSessionId = 'adadadad-adad-4dad-8dad-adadadadadad'
    const tailSessionId = 'aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae'
    const middleEntry = {
      display: 'history-middle-session-marker',
      project: '/Users/wang/shared-history',
      sessionId: middleSessionId,
      timestamp: Date.parse('2026-01-02T00:30:00.000Z'),
    }
    await writeFile(historyPath, line(middleEntry), 'utf8')
    await ensureSessionSearchIndexFresh()
    const initialDb = openSessionSearchDb()
    try {
      expect(countVisibleMessages(initialDb, 'history-middle-session-marker')).toBe(1)
    } finally {
      initialDb.close()
    }

    const entries = Array.from({ length: 12_003 }, (_, index) => {
      if (index === 6_001) return middleEntry
      const inHead = index < 6_001
      return {
        display: `${inHead ? 'history-head' : 'history-tail'} ${index} ${'x'.repeat(32)}`,
        project: '/Users/wang/shared-history',
        sessionId: inHead ? headSessionId : tailSessionId,
        timestamp: Date.parse('2026-01-02T00:00:00.000Z') + index,
      }
    })
    await writeFile(historyPath, entries.map(line).join(''), 'utf8')
    expect((await stat(historyPath)).size)
      .toBeGreaterThan(TRANSCRIPT_JSONL_WORKER_THRESHOLD_BYTES)

    await ensureSessionSearchIndexFresh()

    const db = openSessionSearchDb()
    try {
      expect(countVisibleMessages(db, 'history-middle-session-marker')).toBe(1)
      const middleMessages = db.query<{ count: number }, [string]>(`
        SELECT COUNT(*) AS count FROM messages WHERE session_id = ?
      `).get(middleSessionId)?.count ?? 0
      const stagingRows = db.query<{ count: number }, []>(`
        SELECT COUNT(*) AS count FROM history_session_staging
      `).get()?.count ?? 0
      expect(middleMessages).toBe(1)
      expect(stagingRows).toBe(0)
    } finally {
      db.close()
    }
  }, 30_000)

  it('bounds a huge history prompt before it crosses back to the main thread', async () => {
    const sessionId = 'abababab-abab-4bab-8bab-abababababab'
    const headNeedle = 'history-head-needle'
    const errorNeedle = 'history-error-needle'
    const tailNeedle = 'history-tail-needle'
    const display = [
      headNeedle,
      'a'.repeat(4 * 1024 * 1024),
      `FATAL ${errorNeedle}: process exited with code 91`,
      'b'.repeat(4 * 1024 * 1024),
      tailNeedle,
    ].join('\n')
    const historyPath = join(configDir, 'history.jsonl')
    await writeFile(historyPath, line({
      display,
      project: '/Users/wang/huge-history',
      sessionId,
      timestamp: Date.parse('2026-01-02T01:00:00.000Z'),
    }))
    const originalStat = await stat(historyPath)
    expect(originalStat.size).toBeGreaterThan(8 * 1024 * 1024)

    let maximumTimerGap = 0
    let previousTick = performance.now()
    const interval = setInterval(() => {
      const now = performance.now()
      maximumTimerGap = Math.max(maximumTimerGap, now - previousTick)
      previousTick = now
    }, 5)
    await Bun.sleep(15)
    maximumTimerGap = 0
    previousTick = performance.now()
    try {
      await ensureSessionSearchIndexFresh()
    } finally {
      clearInterval(interval)
    }

    expect(maximumTimerGap).toBeLessThan(100)
    const db = openSessionSearchDb()
    try {
      const message = db.query<{ content_text: string }, [string]>(`
        SELECT content_text FROM messages WHERE session_id = ?
      `).get(sessionId)
      expect(message?.content_text.length).toBeLessThanOrEqual(
        SESSION_SEARCH_CONTENT_MAX_CHARS,
      )
      expect(message?.content_text).toContain(headNeedle)
      expect(message?.content_text).toContain(errorNeedle)
      expect(message?.content_text).toContain(tailNeedle)
    } finally {
      db.close()
    }
    const finalStat = await stat(historyPath)
    expect(finalStat.size).toBe(originalStat.size)
    expect(finalStat.mtimeMs).toBe(originalStat.mtimeMs)
  }, 30_000)

  it('builds first-turn past-session context from recent history for vague recall queries', async () => {
    await writeFile(
      join(configDir, 'history.jsonl'),
      line({
        display: '我创建了一个叫做 CyberCamera 的 Xcode iOS 项目',
        project: '/Users/wang',
        sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        timestamp: Date.parse('2026-01-03T00:00:00.000Z'),
      }),
      'utf-8',
    )

    const db = openSessionSearchDb()
    try {
      const context = await buildPastSessionPromptContext({
        db,
        query: '之前那个项目叫什么',
        currentSessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        limit: 2,
      })

      expect(context).toContain('previous CyberCode conversations')
      expect(context).toContain('CyberCamera')
    } finally {
      db.close()
    }
  })

  it('builds first-turn past-session context for assistant name questions', async () => {
    await writeFile(
      join(configDir, 'history.jsonl'),
      line({
        display: '我现在给你取一个新名字，叫做零。',
        project: '/Users/wang',
        sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        timestamp: Date.parse('2026-01-04T00:00:00.000Z'),
      }),
      'utf-8',
    )

    const db = openSessionSearchDb()
    try {
      const context = await buildPastSessionPromptContext({
        db,
        query: '你叫什么',
        currentSessionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        limit: 2,
      })

      expect(context).toContain('previous CyberCode conversations')
      expect(context).toContain('叫做零')
    } finally {
      db.close()
    }
  })

  it('supports CJK trigram search without external dependencies', async () => {
    await writeSession({
      projectPath: '-Users-wang-cjk',
      sessionId: '22222222-2222-4222-8222-222222222222',
      lines: [
        user('u1', '大别山项目的索引方案怎么做', '2026-01-02T00:00:00.000Z'),
        assistant('a1', '大别山项目应该使用本地 SQLite trigram 搜索。', '2026-01-02T00:01:00.000Z'),
      ],
    })

    const result = await discoverSessionSearch({ query: '大别山项目', limit: 3 })

    expect(result.count).toBe(1)
    expect(result.results[0]?.matches[0]?.text).toContain('大别山')
  })

  it('refreshes the index when a transcript file changes', async () => {
    const filePath = await writeSession({
      projectPath: '-Users-wang-refresh',
      sessionId: '33333333-3333-4333-8333-333333333333',
      lines: [
        user('u1', 'Initial topic only', '2026-01-03T00:00:00.000Z'),
      ],
    })

    expect((await discoverSessionSearch({ query: 'afterburner' })).count).toBe(0)

    await appendFile(
      filePath,
      line(assistant('a1', 'The afterburner setting is stored in USER.md.', '2026-01-03T00:01:00.000Z')),
      'utf-8',
    )

    const result = await discoverSessionSearch({ query: 'afterburner' })
    expect(result.count).toBe(1)
  })

  it('bounds a cold-search refresh and completes the same refresh in background', async () => {
    await writeSession({
      projectPath: '-Users-wang-cold-search',
      sessionId: '34343434-3434-4434-8434-343434343434',
      lines: [user('u1', 'Cold index eventually finds aurora marker', '2026-01-03T01:00:00.000Z')],
    })
    let releaseWriter!: () => void
    const gate = new Promise<void>(resolve => {
      releaseWriter = resolve
    })
    const blocker = backgroundScheduler.enqueue({
      type: 'test-cold-search-blocker',
      key: configDir,
      priority: 0,
      lane: 'sqlite-write',
      resourceKey: 'session-search-db',
      dedupe: 'join',
      run: () => gate,
    })
    await Bun.sleep(0)

    const startedAt = Date.now()
    expect((await discoverSessionSearch({ query: 'aurora marker' })).count).toBe(0)
    expect(Date.now() - startedAt).toBeLessThan(200)
    releaseWriter()
    await blocker.promise
    await scheduleSessionSearchIndexRefresh()
    expect((await discoverSessionSearch({ query: 'aurora marker' })).count).toBe(1)
  })

  it('keeps the 75ms timer responsive during worker parsing and batched SQLite writes', async () => {
    const projectPath = '-Users-wang-large-event-loop'
    const sessionId = '35353535-3535-4535-8535-353535353535'
    const payload = `large-history-marker ${'x'.repeat(1_200)}`
    const messageCount = 4_000
    const filePath = await writeSession({
      projectPath,
      sessionId,
      lines: Array.from({ length: messageCount }, (_, index) =>
        user(`large-${index}`, `${index} ${payload}`, '2026-01-03T02:00:00.000Z')),
    })
    expect((await stat(filePath)).size).toBeGreaterThan(512 * 1024)

    const scheduler = new BackgroundScheduler()
    let maximumTimerGap = 0
    let previousTick = performance.now()
    const interval = setInterval(() => {
      const now = performance.now()
      maximumTimerGap = Math.max(maximumTimerGap, now - previousTick)
      previousTick = now
    }, 10)
    const timerStartedAt = performance.now()
    const budgetTimer = new Promise<number>(resolve => {
      setTimeout(() => resolve(performance.now() - timerStartedAt), 75)
    })

    try {
      const refresh = scheduleSessionSearchIndexRefresh({ scheduler })
      expect(refresh).not.toBeNull()
      let refreshSettled = false
      void refresh?.then(
        () => { refreshSettled = true },
        () => { refreshSettled = true },
      )
      const timerDelay = await budgetTimer
      const timerRanWhileIndexing = !refreshSettled
      await refresh

      if (process.env.CYBER_REPORT_SESSION_SEARCH_PERF === '1') {
        console.info(
          `[session-search perf] timerDelay=${timerDelay.toFixed(2)}ms maximumTimerGap=${maximumTimerGap.toFixed(2)}ms`,
        )
      }
      expect(timerRanWhileIndexing).toBe(true)
      expect(timerDelay).toBeLessThan(250)
      expect(maximumTimerGap).toBeLessThan(100)
      const db = openSessionSearchDb()
      try {
        const row = db.query<{ message_count: number }, [string]>(`
          SELECT message_count FROM sessions WHERE session_id = ?
        `).get(sessionId)
        expect(row?.message_count).toBe(messageCount)
      } finally {
        db.close()
      }
    } finally {
      clearInterval(interval)
      await scheduler.shutdown({ timeoutMs: 1_000 })
    }
  }, 30_000)

  it('bounds one 8MB tool result in the worker while preserving searchable head, tail, and errors', async () => {
    const projectPath = '-Users-wang-huge-tool-result'
    const sessionId = '45454545-4545-4545-8545-454545454545'
    const headNeedle = 'hugetoolheadneedle'
    const errorNeedle = 'hugetoolmiddleerrorneedle'
    const tailNeedle = 'hugetooltailneedle'
    const halfPayload = 4 * 1024 * 1024
    const toolOutput = [
      headNeedle,
      'a'.repeat(halfPayload),
      `FATAL ${errorNeedle}: worker process exited with code 73`,
      'b'.repeat(halfPayload),
      tailNeedle,
    ].join('\n')
    const filePath = await writeSession({
      projectPath,
      sessionId,
      lines: [{
        type: 'user',
        uuid: 'huge-tool-result',
        timestamp: '2026-01-03T02:30:00.000Z',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'toolu_huge',
            content: toolOutput,
          }],
        },
      }],
    })
    const originalFileStat = await stat(filePath)
    expect(originalFileStat.size).toBeGreaterThan(8 * 1024 * 1024)

    let maximumTimerGap = 0
    let previousTick = performance.now()
    const interval = setInterval(() => {
      const now = performance.now()
      maximumTimerGap = Math.max(maximumTimerGap, now - previousTick)
      previousTick = now
    }, 5)
    await Bun.sleep(15)
    maximumTimerGap = 0
    previousTick = performance.now()

    try {
      await indexSessionSearchTranscript(filePath, { sessionId })
    } finally {
      clearInterval(interval)
    }

    expect(maximumTimerGap).toBeLessThan(100)
    const db = openSessionSearchDb()
    try {
      const message = db.query<{
        content_text: string
        type: string
      }, [string]>(`
        SELECT content_text, type FROM messages WHERE session_id = ?
      `).get(sessionId)
      expect(message?.type).toBe('tool_result')
      expect(message?.content_text.length).toBeLessThanOrEqual(
        SESSION_SEARCH_CONTENT_MAX_CHARS,
      )
      expect(message?.content_text).toContain(headNeedle)
      expect(message?.content_text).toContain(errorNeedle)
      expect(message?.content_text).toContain(tailNeedle)
    } finally {
      db.close()
    }

    expect((await discoverSessionSearch({ query: headNeedle })).count).toBe(1)
    expect((await discoverSessionSearch({ query: errorNeedle })).count).toBe(1)
    expect((await discoverSessionSearch({ query: tailNeedle })).count).toBe(1)
    const finalFileStat = await stat(filePath)
    expect(finalFileStat.size).toBe(originalFileStat.size)
    expect(finalFileStat.mtimeMs).toBe(originalFileStat.mtimeMs)
  }, 30_000)

  it('keeps the complete old generation visible while a replacement is staging', async () => {
    const projectPath = '-Users-wang-stale-while-revalidate'
    const sessionId = '36363636-3636-4636-8636-363636363636'
    const oldCount = 40
    const newCount = 80
    const filePath = await writeSession({
      projectPath,
      sessionId,
      lines: Array.from({ length: oldCount }, (_, index) =>
        user(`old-${index}`, `old-generation-complete ${index}`, '2026-01-03T03:00:00.000Z')),
    })
    await indexSessionSearchTranscript(filePath, { sessionId })
    await writeSession({
      projectPath,
      sessionId,
      lines: Array.from({ length: newCount }, (_, index) =>
        user(`new-${index}`, `new-generation-ready ${index}`, '2026-01-03T04:00:00.000Z')),
    })

    const db = openSessionSearchDb()
    try {
      const oldActiveKey = getActiveGenerationKey(db, filePath)
      let markStagingReached!: () => void
      const stagingReached = new Promise<void>(resolve => {
        markStagingReached = resolve
      })
      let releaseStaging!: () => void
      const stagingGate = new Promise<void>(resolve => {
        releaseStaging = resolve
      })
      let firstYield = true
      const refresh = indexSessionSearchTranscript(filePath, {
        sessionId,
        db,
        yieldIfNeeded: async () => {
          if (!firstYield) return
          firstYield = false
          markStagingReached()
          await stagingGate
        },
      })

      let duringActiveKey = ''
      let duringOldCount = 0
      let duringNewCount = 0
      let hiddenRows = 0
      await stagingReached
      try {
        duringActiveKey = getActiveGenerationKey(db, filePath)
        duringOldCount = countVisibleMessages(db, 'old-generation-complete')
        duringNewCount = countVisibleMessages(db, 'new-generation-ready')
        hiddenRows = db.query<{ count: number }, [string, string]>(`
          SELECT COUNT(*) AS count FROM messages
          WHERE session_id = ? AND session_key <> ?
        `).get(sessionId, oldActiveKey)?.count ?? 0
      } finally {
        releaseStaging()
      }
      await refresh

      const newActiveKey = getActiveGenerationKey(db, filePath)
      expect(duringActiveKey).toBe(oldActiveKey)
      expect(duringOldCount).toBe(oldCount)
      expect(duringNewCount).toBe(0)
      expect(hiddenRows).toBeGreaterThan(0)
      expect(newActiveKey).not.toBe(oldActiveKey)
      expect(countGenerationMessages(db, newActiveKey)).toBe(newCount)
      expect(countGenerationMessages(db, oldActiveKey)).toBe(0)
    } finally {
      db.close()
    }
  })

  it('releases the SQLite writer before yielding between staging batches', async () => {
    const projectPath = '-Users-wang-staging-lock'
    const sessionId = '35353535-3535-4535-8535-353535353535'
    const filePath = await writeSession({
      projectPath,
      sessionId,
      lines: [
        user('old', 'staging-lock-old', '2026-01-03T02:00:00.000Z'),
      ],
    })
    await indexSessionSearchTranscript(filePath, { sessionId })
    await writeSession({
      projectPath,
      sessionId,
      lines: Array.from({ length: 48 }, (_, index) =>
        user(
          `new-${index}`,
          `staging-lock-new ${index}`,
          '2026-01-03T02:30:00.000Z',
        )),
    })

    const db = openSessionSearchDb()
    const competingDb = openSessionSearchDb()
    competingDb.exec('PRAGMA busy_timeout = 25')
    let competingWriteRan = false
    try {
      await indexSessionSearchTranscript(filePath, {
        sessionId,
        db,
        yieldIfNeeded: async () => {
          if (competingWriteRan) return
          competingWriteRan = true
          competingDb.exec('BEGIN IMMEDIATE')
          competingDb.exec('ROLLBACK')
        },
      })

      expect(competingWriteRan).toBe(true)
      expect(countVisibleMessages(db, 'staging-lock-new')).toBe(48)
      expect(countVisibleMessages(db, 'staging-lock-old')).toBe(0)
    } finally {
      competingDb.close()
      db.close()
    }
  })

  it('keeps the old generation intact when staging is cancelled', async () => {
    const projectPath = '-Users-wang-cancel-staging'
    const sessionId = '37373737-3737-4737-8737-373737373737'
    const oldCount = 24
    const filePath = await writeSession({
      projectPath,
      sessionId,
      lines: Array.from({ length: oldCount }, (_, index) =>
        user(`old-${index}`, `cancel-safe-old ${index}`, '2026-01-03T05:00:00.000Z')),
    })
    await indexSessionSearchTranscript(filePath, { sessionId })
    await writeSession({
      projectPath,
      sessionId,
      lines: Array.from({ length: 80 }, (_, index) =>
        user(`new-${index}`, `cancel-hidden-new ${index}`, '2026-01-03T06:00:00.000Z')),
    })

    const db = openSessionSearchDb()
    const controller = new AbortController()
    try {
      const oldActiveKey = getActiveGenerationKey(db, filePath)
      let markStagingReached!: () => void
      const stagingReached = new Promise<void>(resolve => {
        markStagingReached = resolve
      })
      let releaseStaging!: () => void
      const stagingGate = new Promise<void>(resolve => {
        releaseStaging = resolve
      })
      let firstYield = true
      const refresh = indexSessionSearchTranscript(filePath, {
        sessionId,
        db,
        signal: controller.signal,
        yieldIfNeeded: async () => {
          if (!firstYield) return
          firstYield = false
          markStagingReached()
          await stagingGate
        },
      })

      await stagingReached
      const duringActiveKey = getActiveGenerationKey(db, filePath)
      const duringOldCount = countVisibleMessages(db, 'cancel-safe-old')
      const duringNewCount = countVisibleMessages(db, 'cancel-hidden-new')
      controller.abort()
      releaseStaging()
      await expect(refresh).rejects.toMatchObject({ name: 'AbortError' })

      const remainingHidden = db.query<{ count: number }, [string, string]>(`
        SELECT COUNT(*) AS count FROM messages
        WHERE session_id = ? AND session_key <> ?
      `).get(sessionId, oldActiveKey)?.count ?? 0
      expect(duringActiveKey).toBe(oldActiveKey)
      expect(duringOldCount).toBe(oldCount)
      expect(duringNewCount).toBe(0)
      expect(getActiveGenerationKey(db, filePath)).toBe(oldActiveKey)
      expect(countGenerationMessages(db, oldActiveKey)).toBe(oldCount)
      expect(remainingHidden).toBe(0)
      expect(countVisibleMessages(db, 'cancel-hidden-new')).toBe(0)
    } finally {
      controller.abort()
      db.close()
    }
  })

  it('retries an incomplete worker fallback and eventually indexes the tail', async () => {
    const projectPath = '-Users-wang-incomplete-retry'
    const sessionId = '38383838-3838-4838-8838-383838383838'
    const filePath = await writeSession({
      projectPath,
      sessionId,
      lines: [user('old', 'fallback-old-visible', '2026-01-03T07:00:00.000Z')],
    })
    await indexSessionSearchTranscript(filePath, { sessionId })
    const payload = 'x'.repeat(900)
    await writeSession({
      projectPath,
      sessionId,
      lines: Array.from({ length: 900 }, (_, index) =>
        user(
          `large-${index}`,
          index === 899 ? `fallback-tail-marker ${payload}` : `${index} ${payload}`,
          '2026-01-03T08:00:00.000Z',
        )),
    })

    let workerTerminated = false
    const failedWorkerFactory = (): TranscriptWorkerLike => ({
      onmessage: null,
      onerror: null,
      postMessage() {
        queueMicrotask(() => this.onerror?.({} as ErrorEvent))
      },
      terminate() {
        workerTerminated = true
      },
    })
    const db = openSessionSearchDb()
    try {
      const oldActiveKey = getActiveGenerationKey(db, filePath)
      const oldIndexedSize = db.query<{ file_size: number }, [string]>(`
        SELECT file_size FROM indexed_files WHERE file_path = ?
      `).get(filePath)!.file_size
      const currentSize = (await stat(filePath)).size

      await indexSessionSearchTranscript(filePath, {
        sessionId,
        db,
        workerFactory: failedWorkerFactory,
      })
      const fallbackIndexedSize = db.query<{ file_size: number }, [string]>(`
        SELECT file_size FROM indexed_files WHERE file_path = ?
      `).get(filePath)!.file_size

      expect(workerTerminated).toBe(true)
      expect(fallbackIndexedSize).toBe(oldIndexedSize)
      expect(fallbackIndexedSize).not.toBe(currentSize)
      expect(getActiveGenerationKey(db, filePath)).toBe(oldActiveKey)
      expect(countVisibleMessages(db, 'fallback-old-visible')).toBe(1)
      expect(countVisibleMessages(db, 'fallback-tail-marker')).toBe(0)

      await indexSessionSearchTranscript(filePath, { sessionId, db })
      const completedSize = db.query<{ file_size: number }, [string]>(`
        SELECT file_size FROM indexed_files WHERE file_path = ?
      `).get(filePath)!.file_size
      const newActiveKey = getActiveGenerationKey(db, filePath)
      expect(completedSize).toBe(currentSize)
      expect(newActiveKey).not.toBe(oldActiveKey)
      expect(countGenerationMessages(db, newActiveKey)).toBe(900)
      expect(countVisibleMessages(db, 'fallback-tail-marker')).toBe(1)
    } finally {
      db.close()
    }
  }, 20_000)

  it('filters staging FTS rows before applying the result limit', async () => {
    const projectPath = '-Users-wang-staging-limit'
    const sessionId = '39393939-3939-4939-8939-393939393939'
    const filePath = await writeSession({
      projectPath,
      sessionId,
      lines: [
        user('active', 'limit-visible-needle active-generation', '2026-01-03T09:00:00.000Z'),
      ],
    })
    await indexSessionSearchTranscript(filePath, { sessionId })

    const db = openSessionSearchDb()
    try {
      const activeKey = getActiveGenerationKey(db, filePath)
      const hiddenKey = `${projectPath}:${sessionId}#staging:manual-hidden`
      const insertMessage = db.query(`
        INSERT INTO messages (
          session_key, session_id, project_path, message_uuid, role, type,
          content_text, timestamp, model, line_no, is_sidechain
        ) VALUES (?, ?, ?, ?, 'user', 'user', ?, ?, NULL, ?, 0)
      `)
      const insertFts = db.query('INSERT INTO messages_fts(rowid, content_text) VALUES (?, ?)')
      const insertTrigram = db.query(
        'INSERT INTO messages_fts_trigram(rowid, content_text) VALUES (?, ?)',
      )
      db.transaction(() => {
        for (let index = 0; index < 16; index += 1) {
          const content = `${'limit-visible-needle '.repeat(20)}hidden-staging-${index}`
          const result = insertMessage.run(
            hiddenKey,
            sessionId,
            projectPath,
            `hidden-${index}`,
            content,
            '2026-01-03T10:00:00.000Z',
            index + 1,
          )
          const id = Number(result.lastInsertRowid)
          insertFts.run(id, content)
          insertTrigram.run(id, content)
        }
      })()

      const result = await discoverSessionSearch({
        query: 'limit-visible-needle',
        limit: 1,
        db,
      })
      expect(countGenerationMessages(db, activeKey)).toBe(1)
      expect(countGenerationMessages(db, hiddenKey)).toBe(16)
      expect(result.count).toBe(1)
      expect(result.results[0]?.sessionId).toBe(sessionId)
      expect(result.results[0]?.matches[0]?.text).toContain('active-generation')
      expect(result.results[0]?.matches[0]?.text).not.toContain('hidden-staging')
    } finally {
      db.close()
    }
  })

  it('indexes a single current transcript for turn-end refresh', async () => {
    const sessionId = '77777777-7777-4777-8777-777777777777'
    const filePath = await writeSession({
      projectPath: '-Users-wang-turn-end',
      sessionId,
      lines: [
        user('u1', 'Turn-end direct indexing request', '2026-01-07T00:00:00.000Z'),
        assistant('a1', 'The turn-end index contains the starlight marker.', '2026-01-07T00:01:00.000Z'),
      ],
    })

    await indexSessionSearchTranscript(filePath, { sessionId })

    const db = openSessionSearchDb()
    try {
      const session = db
        .query(
          'SELECT project_path, message_count FROM sessions WHERE session_id = ?',
        )
        .get(sessionId) as { project_path: string; message_count: number } | null
      const message = db
        .query(
          `SELECT content_text FROM messages
           WHERE session_id = ? AND content_text LIKE ?`,
        )
        .get(sessionId, '%starlight marker%') as { content_text: string } | null

      expect(session?.project_path).toBe('-Users-wang-turn-end')
      expect(session?.message_count).toBe(2)
      expect(message?.content_text).toContain('starlight marker')
    } finally {
      db.close()
    }
  })

  it('distills temporary sessions into searchable project memories', async () => {
    const sessionId = '99999999-9999-4999-8999-999999999999'
    const filePath = await writeSession({
      projectPath: '-Users-wang-temp-memory',
      sessionId,
      lines: [
        {
          type: 'session-meta',
          isMeta: true,
          workDir: '/Users/wang',
          isTemporary: true,
          timestamp: '2026-01-08T00:00:00.000Z',
        },
        user(
          'u1',
          'CyberCode desktop project lives at /Volumes/thinkplus/下载/myproject/cybercode. password=super-secret',
          '2026-01-08T00:00:01.000Z',
        ),
        assistantTool(
          'a1',
          'Bash',
          { command: 'cd /Volumes/thinkplus/下载/myproject/cybercode && bun test' },
          '2026-01-08T00:00:02.000Z',
        ),
        assistant(
          'a2',
          'The project memory should remember the desktop UI work without storing secrets.',
          '2026-01-08T00:00:03.000Z',
        ),
      ],
    })

    await indexSessionSearchTranscript(filePath, { sessionId })

    const memories = searchProjectMemories({ query: 'CyberCode', limit: 3 })
    expect(memories).toHaveLength(1)
    expect(memories[0]?.sessionId).toBe(sessionId)
    expect(memories[0]?.summary).toContain('/Volumes/thinkplus/下载/myproject/cybercode')
    expect(memories[0]?.summary).not.toContain('super-secret')

    const context = buildProjectMemoryPromptContext({
      query: 'continue CyberCode',
      currentSessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })
    expect(context).toContain('Lightweight memories')
    expect(context).toContain('CyberCode')
  })

  it('refreshes portable path metadata without rebuilding transcript messages', async () => {
    const projectPath = '-Users-wang-portable-memory'
    const sessionId = '98989898-9898-4898-8989-989898989898'
    const filePath = await writeSession({
      projectPath,
      sessionId,
      lines: [
        {
          type: 'session-meta',
          isMeta: true,
          workDir: 'D:\\workspace\\portable-memory',
          isTemporary: true,
          timestamp: '2026-01-08T00:00:00.000Z',
        },
        user('u1', 'Remember the portable memory project.', '2026-01-08T00:00:01.000Z'),
        assistant('a1', 'Portable memory recorded.', '2026-01-08T00:00:02.000Z'),
      ],
    })
    await indexSessionSearchTranscript(filePath, { sessionId })
    await appendFile(filePath, line({
      type: 'session-meta',
      isMeta: true,
      workDir: 'cybercode-portable://projects/portable-memory',
    }))

    const repairedWorkDir = 'E:\\CyberCode-Portable\\projects\\portable-memory'
    await refreshSessionSearchPathMetadata(
      { filePath, projectPath, sessionId },
      repairedWorkDir,
    )

    const fileStat = await stat(filePath)
    const db = openSessionSearchDb()
    try {
      expect(db.query(
        'SELECT work_dir, file_size, message_count FROM sessions WHERE session_key = ?',
      ).get(`${projectPath}:${sessionId}`)).toMatchObject({
        work_dir: repairedWorkDir,
        file_size: fileStat.size,
        message_count: 2,
      })
      expect(db.query(
        'SELECT work_dir FROM project_memories WHERE session_key = ?',
      ).get(`${projectPath}:${sessionId}`)).toEqual({ work_dir: repairedWorkDir })
      expect(db.query(
        `SELECT project_memories_fts.work_dir AS work_dir
         FROM project_memories_fts
         JOIN project_memories ON project_memories.id = project_memories_fts.rowid
         WHERE project_memories.session_key = ?`,
      ).get(`${projectPath}:${sessionId}`)).toEqual({ work_dir: repairedWorkDir })
    } finally {
      db.close()
    }
  })

  it('indexes project auto-memory markdown into globally searchable memory FTS', async () => {
    const memoryDir = join(configDir, 'projects', '-Users-wang-CyberCamera', 'memory')
    await mkdir(memoryDir, { recursive: true })
    await writeFile(
      join(memoryDir, 'MEMORY.md'),
      '# CyberCamera\n\n这是一个 iOS 相机项目，项目名叫 CyberCamera。',
      'utf-8',
    )

    const db = openSessionSearchDb()
    try {
      await ensureSessionSearchIndexFresh({ db })
      const memories = searchProjectMemories({
        db,
        query: 'CyberCamera',
        currentSessionId: '11111111-1111-4111-8111-111111111111',
      })

      expect(memories).toHaveLength(1)
      expect(memories[0]?.source).toBe('auto-memory-file')
      expect(memories[0]?.summary).toContain('CyberCamera')

      const context = buildProjectMemoryPromptContext({
        db,
        query: '之前那个相机项目叫什么',
        currentSessionId: '22222222-2222-4222-8222-222222222222',
      })
      expect(context).toContain('CyberCamera')
    } finally {
      db.close()
    }
  })

  it('indexes global prompt memory into the shared memory FTS', async () => {
    const promptMemoryDir = join(configDir, 'prompt-memory')
    await mkdir(promptMemoryDir, { recursive: true })
    await writeFile(
      join(promptMemoryDir, 'USER.md'),
      '用户给 CyberCode 取名为「零」；被问到名字时应回答自己叫「零」。',
      'utf-8',
    )

    const db = openSessionSearchDb()
    try {
      await ensureSessionSearchIndexFresh({ db })
      const memories = searchProjectMemories({
        db,
        query: '零',
        currentSessionId: '33333333-3333-4333-8333-333333333333',
      })

      expect(memories).toHaveLength(1)
      expect(memories[0]?.source).toBe('prompt-memory')
      expect(memories[0]?.summary).toContain('零')

      expect(searchProjectMemories({
        db,
        query: '零',
        includePromptMemory: false,
      })).toHaveLength(0)
      expect(buildProjectMemoryPromptContext({
        db,
        query: '零',
        includePromptMemory: false,
      })).toBeNull()
    } finally {
      db.close()
    }
  })

  it('removes memory-file FTS rows when markdown memory files disappear', async () => {
    const memoryDir = join(configDir, 'projects', '-Users-wang-stale-memory', 'memory')
    const memoryPath = join(memoryDir, 'project.md')
    await mkdir(memoryDir, { recursive: true })
    await writeFile(memoryPath, 'stale-memory-needle should be searchable.', 'utf-8')

    const db = openSessionSearchDb()
    try {
      await ensureSessionSearchIndexFresh({ db })
      expect(searchProjectMemories({ db, query: 'stale-memory-needle' })).toHaveLength(1)

      await rm(memoryPath, { force: true })
      await ensureSessionSearchIndexFresh({ db })

      expect(searchProjectMemories({ db, query: 'stale-memory-needle' })).toHaveLength(0)
    } finally {
      db.close()
    }
  })

  it('does not distill normal project sessions into temporary project memories', async () => {
    const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const filePath = await writeSession({
      projectPath: '-Users-wang-normal-memory',
      sessionId,
      lines: [
        {
          type: 'session-meta',
          isMeta: true,
          workDir: '/Users/wang/normal-memory',
          isTemporary: false,
          timestamp: '2026-01-09T00:00:00.000Z',
        },
        user('u1', 'Normal project memory should stay out of the temp recall table.', '2026-01-09T00:00:01.000Z'),
      ],
    })

    await indexSessionSearchTranscript(filePath, { sessionId })

    expect(searchProjectMemories({ query: 'normal-memory' })).toHaveLength(0)
  })

  it('strips injected project memory context from transcript search text', async () => {
    const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    await writeSession({
      projectPath: '-Users-wang-context-strip',
      sessionId,
      lines: [
        {
          type: 'session-meta',
          isMeta: true,
          workDir: '/Users/wang',
          isTemporary: true,
          timestamp: '2026-01-10T00:00:00.000Z',
        },
        user(
          'u1',
          appendProjectMemoryContext(
            'Please continue the visible user request.',
            'Hidden recall needle should not be indexed.',
          ),
          '2026-01-10T00:00:01.000Z',
        ),
      ],
    })

    expect((await discoverSessionSearch({ query: 'visible user request' })).count).toBe(1)
    expect((await discoverSessionSearch({ query: 'Hidden recall needle' })).count).toBe(0)

    const read = await readSessionSearch({ sessionId })
    expect(read?.mode).toBe('read')
    expect(read?.messages[0]?.content).toBe('Please continue the visible user request.')
    expect(read?.messages[0]?.content).not.toContain(PROJECT_MEMORY_CONTEXT_TAG)
  })

  it('removes project memory rows when a session leaves the search index', async () => {
    const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const projectPath = '-Users-wang-delete-memory'
    const filePath = await writeSession({
      projectPath,
      sessionId,
      lines: [
        {
          type: 'session-meta',
          isMeta: true,
          workDir: '/Users/wang',
          isTemporary: true,
          timestamp: '2026-01-11T00:00:00.000Z',
        },
        user('u1', 'Delete-memory project path is /tmp/delete-memory-project.', '2026-01-11T00:00:01.000Z'),
      ],
    })

    await indexSessionSearchTranscript(filePath, { sessionId })
    expect(searchProjectMemories({ query: 'delete-memory-project' })).toHaveLength(1)

    await deleteSessionFromSearchIndex({ sessionId, projectPath })

    expect(searchProjectMemories({ query: 'delete-memory-project' })).toHaveLength(0)
  })

  it('does not treat nested subagent transcripts as main sessions', () => {
    const main = join(
      configDir,
      'projects',
      '-Users-wang-main',
      '88888888-8888-4888-8888-888888888888.jsonl',
    )
    const nested = join(
      configDir,
      'projects',
      '-Users-wang-main',
      '88888888-8888-4888-8888-888888888888',
      'subagents',
      '99999999-9999-4999-8999-999999999999.jsonl',
    )

    expect(
      sessionSearchIndexerForTesting.sessionSearchFileInfoFromTranscriptPath(
        main,
      )?.projectPath,
    ).toBe('-Users-wang-main')
    expect(
      sessionSearchIndexerForTesting.sessionSearchFileInfoFromTranscriptPath(
        nested,
      ),
    ).toBeNull()
  })

  it('reads and scrolls historical sessions by message id', async () => {
    await writeSession({
      projectPath: '-Users-wang-scroll',
      sessionId: '44444444-4444-4444-8444-444444444444',
      lines: [
        user('u1', 'Start scroll test', '2026-01-04T00:00:00.000Z'),
        assistant('a1', 'Middle anchor remembers the launch checklist.', '2026-01-04T00:01:00.000Z'),
        user('u2', 'End scroll test', '2026-01-04T00:02:00.000Z'),
      ],
    })

    const read = await readSessionSearch({
      sessionId: '44444444-4444-4444-8444-444444444444',
    })
    expect(read?.mode).toBe('read')
    expect(read?.messages.length).toBe(3)

    const match = await discoverSessionSearch({ query: 'launch checklist' })
    const anchor = match.results[0]?.matchMessageId
    expect(anchor).toBeDefined()

    const scrolled = await scrollSessionSearch({
      sessionId: '44444444-4444-4444-8444-444444444444',
      aroundMessageId: anchor!,
      window: 1,
    })
    expect(scrolled?.mode).toBe('scroll')
    expect(scrolled?.messages.some(message => message.anchor)).toBe(true)
  })

  it('keeps SearchService session search backward compatible', async () => {
    await writeSession({
      projectPath: '-Users-wang-api',
      sessionId: '55555555-5555-4555-8555-555555555555',
      lines: [
        user('u1', 'Find the comet protocol note', '2026-01-05T00:00:00.000Z'),
      ],
    })

    const results = await new SearchService().searchSessions('comet protocol')
    expect(results).toHaveLength(1)
    expect(results[0]?.sessionId).toBe('55555555-5555-4555-8555-555555555555')
    expect(results[0]?.matches[0]?.text).toContain('comet')
  })

  it('syncs the search index when SessionService renames a session', async () => {
    await writeSession({
      projectPath: '-Users-wang-rename',
      sessionId: '66666666-6666-4666-8666-666666666666',
      lines: [
        user('u1', 'Original title text with rename needle', '2026-01-06T00:00:00.000Z'),
      ],
    })

    await new SessionService().renameSession(
      '66666666-6666-4666-8666-666666666666',
      'Renamed Search Title',
      { projectPath: '-Users-wang-rename' },
    )

    const read = await readSessionSearch({
      sessionId: '66666666-6666-4666-8666-666666666666',
      projectPath: '-Users-wang-rename',
    })
    expect(read?.title).toBe('Renamed Search Title')
  })
})
