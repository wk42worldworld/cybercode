import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, rm, writeFile, appendFile } from 'fs/promises'
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
  ensureSessionSearchIndexFresh,
  indexSessionSearchTranscript,
  resetSessionSearchIndex,
  sessionSearchIndexerForTesting,
} from './indexer.js'
import { openSessionSearchDb } from './db.js'
import { searchProjectMemories, buildProjectMemoryPromptContext } from './projectMemory.js'
import {
  PROJECT_MEMORY_CONTEXT_TAG,
  appendProjectMemoryContext,
} from './projectMemoryContext.js'
import { SearchService } from '../server/services/searchService.js'
import { SessionService } from '../server/services/sessionService.js'

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
