/**
 * Unit tests for SessionService and Sessions API
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { SessionService } from '../services/sessionService.js'
import { clearCommandsCache } from '../../commands.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'
import { appendProjectMemoryContext } from '../../sessionSearch/projectMemoryContext.js'

// ============================================================================
// Test helpers
// ============================================================================

let tmpDir: string
let service: SessionService

/** Create a temporary config dir and configure the service to use it. */
async function setupTmpConfigDir(): Promise<string> {
  tmpDir = path.join(os.tmpdir(), `claude-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await fs.mkdir(path.join(tmpDir, 'projects'), { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  return tmpDir
}

async function cleanupTmpDir(): Promise<void> {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
  delete process.env.CLAUDE_CONFIG_DIR
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

/** Write a JSONL session file with given entries. */
async function writeSessionFile(
  projectDir: string,
  sessionId: string,
  entries: Record<string, unknown>[]
): Promise<string> {
  const dir = path.join(tmpDir, 'projects', projectDir)
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${sessionId}.jsonl`)
  const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
  await fs.writeFile(filePath, content, 'utf-8')
  return filePath
}

async function writeSubagentTranscriptFile(
  projectDir: string,
  sessionId: string,
  agentId: string,
  entries: Record<string, unknown>[],
): Promise<string> {
  const dir = path.join(tmpDir, 'projects', projectDir, sessionId, 'subagents')
  await fs.mkdir(dir, { recursive: true })
  const normalizedAgentId = agentId.startsWith('agent-') ? agentId : `agent-${agentId}`
  const filePath = path.join(dir, `${normalizedAgentId}.jsonl`)
  const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
  await fs.writeFile(filePath, content, 'utf-8')
  return filePath
}

async function writeHistoryLog(entries: Record<string, unknown>[]): Promise<string> {
  const filePath = path.join(tmpDir, 'history.jsonl')
  const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
  await fs.writeFile(filePath, content, 'utf-8')
  return filePath
}

async function writeSkill(
  rootDir: string,
  skillName: string,
  description: string,
): Promise<void> {
  const skillDir = path.join(rootDir, skillName)
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    ['---', `description: ${description}`, '---', '', `# ${skillName}`].join('\n'),
    'utf-8',
  )
}

// Sample entries matching real CLI format
function makeSnapshotEntry(): Record<string, unknown> {
  return {
    type: 'file-history-snapshot',
    messageId: crypto.randomUUID(),
    snapshot: {
      messageId: crypto.randomUUID(),
      trackedFileBackups: {},
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    isSnapshotUpdate: false,
  }
}

function makeFileHistorySnapshotEntry(
  snapshotMessageId: string,
  trackedFileBackups: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: 'file-history-snapshot',
    messageId: crypto.randomUUID(),
    snapshot: {
      messageId: snapshotMessageId,
      trackedFileBackups,
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    isSnapshotUpdate: false,
  }
}

function makeUserEntry(content: string, uuid?: string): Record<string, unknown> {
  return {
    parentUuid: null,
    isSidechain: false,
    type: 'user',
    message: { role: 'user', content },
    uuid: uuid || crypto.randomUUID(),
    timestamp: '2026-01-01T00:01:00.000Z',
    userType: 'external',
    cwd: '/tmp/test',
    sessionId: 'test-session',
  }
}

function makeAssistantEntry(content: string, parentUuid?: string): Record<string, unknown> {
  return {
    parentUuid: parentUuid || null,
    isSidechain: false,
    type: 'assistant',
    message: {
      model: 'claude-opus-4-7',
      id: `msg_${crypto.randomUUID().slice(0, 20)}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: content }],
    },
    uuid: crypto.randomUUID(),
    timestamp: '2026-01-01T00:02:00.000Z',
  }
}

function makeMetaUserEntry(): Record<string, unknown> {
  return {
    parentUuid: null,
    isSidechain: false,
    type: 'user',
    message: { role: 'user', content: '<local-command-caveat>internal</local-command-caveat>' },
    isMeta: true,
    uuid: crypto.randomUUID(),
    timestamp: '2026-01-01T00:00:30.000Z',
  }
}

function makeSessionMetaEntry(workDir: string): Record<string, unknown> {
  return {
    type: 'session-meta',
    isMeta: true,
    workDir,
    timestamp: '2026-01-01T00:00:00.000Z',
  }
}

async function writeFileHistoryBackup(
  sessionId: string,
  backupFileName: string,
  content: string,
): Promise<void> {
  const dir = path.join(tmpDir, 'file-history', sessionId)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, backupFileName), content, 'utf-8')
}

// ============================================================================
// SessionService tests
// ============================================================================

describe('SessionService', () => {
  beforeEach(async () => {
    await setupTmpConfigDir()
    service = new SessionService()
  })

  afterEach(async () => {
    clearCommandsCache()
    await cleanupTmpDir()
  })

  // --------------------------------------------------------------------------
  // listSessions
  // --------------------------------------------------------------------------

  it('should return empty list when no sessions exist', async () => {
    const result = await service.listSessions()
    expect(result.sessions).toEqual([])
    expect(result.total).toBe(0)
  })

  it('should list sessions from JSONL files', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-testproject', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('Hello Claude'),
      makeAssistantEntry('Hi there!'),
    ])

    const result = await service.listSessions()
    expect(result.total).toBe(1)
    expect(result.sessions).toHaveLength(1)

    const session = result.sessions[0]!
    expect(session.id).toBe(sessionId)
    expect(session.title).toBe('Hello Claude')
    expect(session.messageCount).toBe(2) // 1 user + 1 assistant
    expect(session.projectPath).toBe('-tmp-testproject')
  })

  it('should paginate results with limit and offset', async () => {
    // Create 3 sessions
    for (let i = 0; i < 3; i++) {
      const id = `0000000${i}-bbbb-cccc-dddd-eeeeeeeeeeee`
      await writeSessionFile('-tmp-test', id, [
        makeSnapshotEntry(),
        makeUserEntry(`Message ${i}`),
      ])
    }

    const page1 = await service.listSessions({ limit: 2, offset: 0 })
    expect(page1.total).toBe(3)
    expect(page1.sessions).toHaveLength(2)

    const page2 = await service.listSessions({ limit: 2, offset: 2 })
    expect(page2.total).toBe(3)
    expect(page2.sessions).toHaveLength(1)
  })

  it('should filter sessions by project', async () => {
    const id1 = 'aaaaaaaa-1111-cccc-dddd-eeeeeeeeeeee'
    const id2 = 'aaaaaaaa-2222-cccc-dddd-eeeeeeeeeeee'

    await writeSessionFile('-project-a', id1, [makeSnapshotEntry(), makeUserEntry('In A')])
    await writeSessionFile('-project-b', id2, [makeSnapshotEntry(), makeUserEntry('In B')])

    const resultA = await service.listSessions({ project: '/project/a' })
    expect(resultA.total).toBe(1)
    expect(resultA.sessions[0]!.id).toBe(id1)
  })

  // --------------------------------------------------------------------------
  // getSession
  // --------------------------------------------------------------------------

  it('should return null for non-existent session', async () => {
    const result = await service.getSession('00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })

  it('should return session detail with messages', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const userUuid = crypto.randomUUID()
    await writeSessionFile('-tmp-project', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('Tell me a joke', userUuid),
      makeAssistantEntry('Why did the chicken cross the road?', userUuid),
    ])

    const detail = await service.getSession(sessionId)
    expect(detail).not.toBeNull()
    expect(detail!.id).toBe(sessionId)
    expect(detail!.title).toBe('Tell me a joke')
    expect(detail!.messages).toHaveLength(2)
    expect(detail!.messages[0]!.type).toBe('user')
    expect(detail!.messages[1]!.type).toBe('assistant')
  })

  it('should skip meta entries in messages', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-project', sessionId, [
      makeSnapshotEntry(),
      makeMetaUserEntry(),
      makeUserEntry('Real message'),
    ])

    const detail = await service.getSession(sessionId)
    expect(detail!.messages).toHaveLength(1)
    expect(detail!.messages[0]!.content).toBe('Real message')
  })

  // --------------------------------------------------------------------------
  // getSessionMessages
  // --------------------------------------------------------------------------

  it('should throw for non-existent session messages', async () => {
    expect(
      service.getSessionMessages('00000000-0000-0000-0000-000000000000')
    ).rejects.toThrow('Session not found')
  })

  it('should return messages only', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-project', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('Hello'),
      makeAssistantEntry('World'),
    ])

    const messages = await service.getSessionMessages(sessionId).then(r => r.messages)
    expect(messages).toHaveLength(2)
  })

  it('should load messages from the requested projectPath when duplicate session ids exist', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const olderPath = await writeSessionFile('-project-old', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('old transcript'),
    ])
    const newerPath = await writeSessionFile('-project-new', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('new transcript'),
    ])
    const oldDate = new Date('2026-01-01T00:00:00.000Z')
    const newDate = new Date('2026-01-02T00:00:00.000Z')
    await fs.utimes(olderPath, oldDate, oldDate)
    await fs.utimes(newerPath, newDate, newDate)

    const precise = await service.getSessionMessages(sessionId, { projectPath: '-project-old' })
    expect(precise.messages[0]!.content).toBe('old transcript')

    const fallback = await service.getSessionMessages(sessionId)
    expect(fallback.messages[0]!.content).toBe('new transcript')
  })

  it('should append subagent tool calls under their parent agent tool result', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const projectDir = '-tmp-project'
    const agentId = 'abc123'

    await writeSessionFile(projectDir, sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('Dispatch an agent'),
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'Agent:0',
              name: 'Agent',
              input: { description: 'Inspect alpha' },
            },
          ],
        },
        uuid: crypto.randomUUID(),
        timestamp: '2026-01-01T00:00:02.000Z',
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'Agent:0',
              content: [
                {
                  type: 'text',
                  text: `alpha summary\nagentId: ${agentId} (use SendMessage with to: '${agentId}' to continue this agent)\n<usage>total_tokens: 10\ntool_uses: 2\nduration_ms: 30</usage>`,
                },
              ],
            },
          ],
        },
        uuid: crypto.randomUUID(),
        timestamp: '2026-01-01T00:00:03.000Z',
      },
    ])
    await writeSubagentTranscriptFile(projectDir, sessionId, agentId, [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'Read:0',
              name: 'Read',
              input: { file_path: '/tmp/alpha.txt' },
            },
          ],
        },
        uuid: crypto.randomUUID(),
        timestamp: '2026-01-01T00:00:04.000Z',
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'Read:0',
              content: 'alpha body',
            },
          ],
        },
        uuid: crypto.randomUUID(),
        timestamp: '2026-01-01T00:00:05.000Z',
      },
    ])

    const messages = await service.getSessionMessages(sessionId).then(r => r.messages)
    const childToolUse = messages.find(
      (message) => message.type === 'tool_use' && message.parentToolUseId === 'Agent:0',
    )
    const childToolResult = messages.find(
      (message) => message.type === 'tool_result' && message.parentToolUseId === 'Agent:0',
    )

    expect(childToolUse?.content).toEqual([
      {
        type: 'tool_use',
        id: 'Agent:0/abc123/Read:0',
        name: 'Read',
        input: { file_path: '/tmp/alpha.txt' },
      },
    ])
    expect(childToolResult?.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'Agent:0/abc123/Read:0',
        content: 'alpha body',
      },
    ])
  })

  it('should hide synthetic interruption, no-response, and command breadcrumb transcript entries', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-project', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('正常用户消息', crypto.randomUUID()),
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '[Request interrupted by user]' }],
        },
        uuid: crypto.randomUUID(),
        timestamp: '2026-01-01T00:00:02.000Z',
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'No response requested.' }],
          model: '<synthetic>',
        },
        uuid: crypto.randomUUID(),
        timestamp: '2026-01-01T00:00:03.000Z',
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: '<command-name>/exit</command-name>\n<command-message>exit</command-message>\n<command-args></command-args>',
        },
        uuid: crypto.randomUUID(),
        timestamp: '2026-01-01T00:00:04.000Z',
      },
      makeAssistantEntry('正常助手消息', crypto.randomUUID()),
    ])

    const messages = await service.getSessionMessages(sessionId).then(r => r.messages)

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ type: 'user', content: '正常用户消息' })
    expect(messages[1]).toMatchObject({
      type: 'assistant',
      content: [{ type: 'text', text: '正常助手消息' }],
    })
  })

  it('should strip injected project memory context from visible session messages', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-project', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry(appendProjectMemoryContext(
        'Continue the visible project.',
        'Hidden project memory should stay internal.',
      )),
      makeAssistantEntry('Visible answer'),
    ])

    const detail = await service.getSession(sessionId)
    const messages = await service.getSessionMessages(sessionId).then(r => r.messages)

    expect(detail?.title).toBe('Continue the visible project.')
    expect(detail?.lastMessage).toBe('Visible answer')
    expect(messages[0]?.content).toBe('Continue the visible project.')
    expect(JSON.stringify(messages)).not.toContain('Hidden project memory')
  })

  it('should reconstruct parent agent tool linkage from parentUuid chains', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const userUuid = crypto.randomUUID()
    const agentAssistantUuid = crypto.randomUUID()
    const childAssistantUuid = crypto.randomUUID()

    await writeSessionFile('-tmp-project', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('Inspect the codebase', userUuid),
      {
        parentUuid: userUuid,
        isSidechain: false,
        type: 'assistant',
        message: {
          model: 'claude-opus-4-7',
          id: `msg_${crypto.randomUUID().slice(0, 20)}`,
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Agent',
              id: 'agent-tool-1',
              input: { description: 'Inspect src/components' },
            },
          ],
        },
        uuid: agentAssistantUuid,
        timestamp: '2026-01-01T00:02:00.000Z',
      },
      {
        parentUuid: agentAssistantUuid,
        isSidechain: true,
        type: 'assistant',
        message: {
          model: 'claude-opus-4-7',
          id: `msg_${crypto.randomUUID().slice(0, 20)}`,
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              id: 'read-tool-1',
              input: { file_path: 'src/components/App.tsx' },
            },
          ],
        },
        uuid: childAssistantUuid,
        timestamp: '2026-01-01T00:02:30.000Z',
      },
      {
        parentUuid: childAssistantUuid,
        isSidechain: true,
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'read-tool-1',
              content: 'ok',
              is_error: false,
            },
          ],
        },
        uuid: crypto.randomUUID(),
        timestamp: '2026-01-01T00:03:00.000Z',
        userType: 'external',
        cwd: '/tmp/test',
        sessionId: 'test-session',
      },
    ])

    const messages = await service.getSessionMessages(sessionId).then(r => r.messages)

    expect(messages[1]).toMatchObject({
      type: 'tool_use',
      parentToolUseId: undefined,
    })
    expect(messages[2]).toMatchObject({
      type: 'tool_use',
      parentToolUseId: 'agent-tool-1',
    })
    expect(messages[3]).toMatchObject({
      type: 'tool_result',
      parentToolUseId: 'agent-tool-1',
    })
  })

  it('should recover workDir from session-meta entries', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-project', sessionId, [
      makeSnapshotEntry(),
      makeSessionMetaEntry('/tmp/from-meta'),
      makeUserEntry('Hello'),
    ])

    const workDir = await service.getSessionWorkDir(sessionId)
    expect(workDir).toBe('/tmp/from-meta')
  })

  it('should recover workDir from transcript cwd when session-meta is missing', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-project', sessionId, [
      makeSnapshotEntry(),
      {
        ...makeUserEntry('Hello'),
        cwd: '/tmp/from-cwd',
      },
    ])

    const workDir = await service.getSessionWorkDir(sessionId)
    expect(workDir).toBe('/tmp/from-cwd')
  })

  // --------------------------------------------------------------------------
  // createSession
  // --------------------------------------------------------------------------

  it('should create a new session file', async () => {
    const workDir = path.join(tmpDir, 'workspace', 'my-project')
    await fs.mkdir(workDir, { recursive: true })
    const { sessionId } = await service.createSession(workDir)
    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )

    // Verify the file was created
    const sanitized = sanitizePath(workDir)
    const filePath = path.join(tmpDir, 'projects', sanitized, `${sessionId}.jsonl`)
    const stat = await fs.stat(filePath)
    expect(stat.isFile()).toBe(true)

    // Verify the file starts with the initial snapshot entry
    const content = await fs.readFile(filePath, 'utf-8')
    const entry = JSON.parse(content.trim().split('\n')[0]!)
    expect(entry.type).toBe('file-history-snapshot')
  })

  it('should create a Windows-safe project directory name', async () => {
    if (process.platform !== 'win32') return

    const workDir = process.cwd()
    const { sessionId } = await service.createSession(workDir)
    const sanitized = sanitizePath(workDir)
    const projectDir = path.join(tmpDir, 'projects', sanitized)

    expect(sanitized.includes(':')).toBe(false)
    const stat = await fs.stat(path.join(projectDir, `${sessionId}.jsonl`))
    expect(stat.isFile()).toBe(true)
  })

  it('should create a project folder inside the selected parent directory', async () => {
    const parentDir = path.join(tmpDir, 'workspace')
    await fs.mkdir(parentDir, { recursive: true })

    const result = await service.createProjectFolder(parentDir, 'new-app')

    expect(result).toEqual({
      path: path.join(parentDir, 'new-app'),
      existed: false,
    })
    const stat = await fs.stat(result.path)
    expect(stat.isDirectory()).toBe(true)
  })

  it('should default to the user home directory when workDir is missing', async () => {
    const { sessionId, session } = await service.createSession('')
    const filePath = path.join(
      tmpDir,
      'projects',
      sanitizePath(os.homedir()),
      `${sessionId}.jsonl`,
    )

    const stat = await fs.stat(filePath)
    expect(stat.isFile()).toBe(true)
    expect(session.isTemporary).toBe(false)
  })

  it('should keep explicitly temporary sessions discoverable as temporary', async () => {
    const { sessionId, session } = await service.createSession({ temporary: true })
    expect(session).toMatchObject({
      id: sessionId,
      projectPath: sanitizePath(os.homedir()),
      workDir: path.resolve(os.homedir()),
      isTemporary: true,
    })

    const list = await service.listSessions()
    expect(list.sessions.find((item) => item.id === sessionId)).toMatchObject({
      id: sessionId,
      isTemporary: true,
      projectPath: sanitizePath(os.homedir()),
      workDir: path.resolve(os.homedir()),
    })

    const detail = await service.getSession(sessionId)
    expect(detail).toMatchObject({
      id: sessionId,
      isTemporary: true,
    })
  })

  it('should branch a conversation at the selected assistant response without changing the source', async () => {
    const sourceSessionId = '11111111-bbbb-cccc-dddd-eeeeeeeeeeee'
    const firstUserId = crypto.randomUUID()
    const attachmentId = crypto.randomUUID()
    const firstAssistantId = crypto.randomUUID()
    const secondUserId = crypto.randomUUID()
    const secondAssistantId = crypto.randomUUID()
    const workDir = path.join(tmpDir, 'branch-project')
    const projectDir = sanitizePath(workDir)
    await fs.mkdir(workDir, { recursive: true })

    await writeSessionFile(projectDir, sourceSessionId, [
      makeSnapshotEntry(),
      {
        ...makeSessionMetaEntry(workDir),
        isTemporary: true,
      },
      {
        ...makeUserEntry('first prompt', firstUserId),
        sessionId: sourceSessionId,
      },
      {
        type: 'attachment',
        uuid: attachmentId,
        parentUuid: firstUserId,
        isSidechain: false,
        sessionId: sourceSessionId,
        timestamp: '2026-01-01T00:01:30.000Z',
        attachment: {
          type: 'file',
          filePath: '/tmp/spec.md',
          content: 'branch requirements',
        },
      },
      {
        ...makeAssistantEntry('first reply', attachmentId),
        uuid: firstAssistantId,
        sessionId: sourceSessionId,
      },
      {
        ...makeUserEntry('second prompt', secondUserId),
        parentUuid: firstAssistantId,
        sessionId: sourceSessionId,
      },
      {
        ...makeAssistantEntry('second reply', secondUserId),
        uuid: secondAssistantId,
        sessionId: sourceSessionId,
      },
      {
        type: 'custom-title',
        customTitle: 'Parser repair',
        timestamp: '2026-01-01T00:05:00.000Z',
      },
    ])

    const firstBranch = await service.branchSession(
      sourceSessionId,
      firstAssistantId,
      { projectPath: projectDir, expectedContent: 'first reply' },
    )
    const secondBranch = await service.branchSession(
      sourceSessionId,
      firstAssistantId,
      { projectPath: projectDir, expectedContent: 'first reply' },
    )

    expect(firstBranch.sessionId).not.toBe(sourceSessionId)
    expect(firstBranch.session).toMatchObject({
      title: 'Parser repair (Branch)',
      projectPath: projectDir,
      workDir,
      isTemporary: true,
    })
    expect(secondBranch.session.title).toBe('Parser repair (Branch 2)')

    const sourceMessages = await service.getSessionMessages(sourceSessionId, { projectPath: projectDir })
    expect(sourceMessages.messages.map((message) => message.id)).toEqual([
      firstUserId,
      firstAssistantId,
      secondUserId,
      secondAssistantId,
    ])

    const branchMessages = await service.getSessionMessages(firstBranch.sessionId, { projectPath: projectDir })
    expect(branchMessages.messages.map((message) => message.id)).toEqual([
      firstUserId,
      firstAssistantId,
    ])

    const branchFile = path.join(tmpDir, 'projects', projectDir, `${firstBranch.sessionId}.jsonl`)
    const branchEntries = (await fs.readFile(branchFile, 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const transcriptEntries = branchEntries.filter(
      (entry) => entry.type === 'user' || entry.type === 'attachment' || entry.type === 'assistant',
    )
    expect(transcriptEntries.map((entry) => entry.parentUuid)).toEqual([
      null,
      firstUserId,
      attachmentId,
    ])
    expect(transcriptEntries.every((entry) => entry.sessionId === firstBranch.sessionId)).toBe(true)
    expect(transcriptEntries[1]).toMatchObject({
      type: 'attachment',
      attachment: { filePath: '/tmp/spec.md' },
    })
    expect(transcriptEntries[2]?.forkedFrom).toEqual({
      sessionId: sourceSessionId,
      messageUuid: firstAssistantId,
    })
  })

  it('should include matching tool results and replacement metadata in a branch', async () => {
    const sourceSessionId = '22222222-bbbb-cccc-dddd-eeeeeeeeeeee'
    const userId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()
    const toolResultId = crypto.randomUUID()
    const laterAssistantId = crypto.randomUUID()
    const workDir = path.join(tmpDir, 'branch-tool-project')
    const projectDir = sanitizePath(workDir)
    await fs.mkdir(workDir, { recursive: true })

    await writeSessionFile(projectDir, sourceSessionId, [
      makeSnapshotEntry(),
      makeSessionMetaEntry(workDir),
      {
        ...makeUserEntry('inspect the file', userId),
        sessionId: sourceSessionId,
      },
      {
        parentUuid: userId,
        isSidechain: false,
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-7',
          content: [
            { type: 'text', text: 'I will inspect it.' },
            { type: 'tool_use', id: 'tool-read-1', name: 'Read', input: { file_path: 'src/app.ts' } },
          ],
        },
        uuid: assistantId,
        sessionId: sourceSessionId,
        timestamp: '2026-01-01T00:02:00.000Z',
      },
      {
        parentUuid: assistantId,
        isSidechain: false,
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tool-read-1', content: 'const answer = 42' },
          ],
        },
        uuid: toolResultId,
        sessionId: sourceSessionId,
        timestamp: '2026-01-01T00:03:00.000Z',
      },
      {
        ...makeAssistantEntry('The answer is 42.', toolResultId),
        uuid: laterAssistantId,
        sessionId: sourceSessionId,
      },
      {
        type: 'content-replacement',
        sessionId: sourceSessionId,
        replacements: [
          { toolUseId: 'tool-read-1', replacement: 'preview' },
          { toolUseId: 'tool-not-in-branch', replacement: 'unrelated' },
        ],
      },
    ])

    const branch = await service.branchSession(sourceSessionId, assistantId, {
      projectPath: projectDir,
      expectedContent: 'I will inspect it.',
    })
    const messages = await service.getSessionMessages(branch.sessionId, { projectPath: projectDir })

    expect(messages.messages.map((message) => message.id)).toEqual([
      userId,
      assistantId,
      toolResultId,
    ])
    expect(messages.messages.map((message) => message.type)).toEqual([
      'user',
      'tool_use',
      'tool_result',
    ])
    expect(messages.messages.some((message) => message.id === laterAssistantId)).toBe(false)

    const branchFile = path.join(tmpDir, 'projects', projectDir, `${branch.sessionId}.jsonl`)
    const branchEntries = (await fs.readFile(branchFile, 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(branchEntries.find((entry) => entry.type === 'content-replacement')).toMatchObject({
      sessionId: branch.sessionId,
      replacements: [{ toolUseId: 'tool-read-1', replacement: 'preview' }],
    })
  })

  it('should reject non-assistant and unfinished-tool branch targets', async () => {
    const sourceSessionId = '33333333-bbbb-cccc-dddd-eeeeeeeeeeee'
    const userId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()
    const workDir = path.join(tmpDir, 'invalid-branch-project')
    const projectDir = sanitizePath(workDir)
    await fs.mkdir(workDir, { recursive: true })

    await writeSessionFile(projectDir, sourceSessionId, [
      makeSessionMetaEntry(workDir),
      {
        ...makeUserEntry('run it', userId),
        sessionId: sourceSessionId,
      },
      {
        parentUuid: userId,
        isSidechain: false,
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'pending-tool', name: 'Bash', input: {} }],
        },
        uuid: assistantId,
        sessionId: sourceSessionId,
        timestamp: '2026-01-01T00:02:00.000Z',
      },
    ])

    expect(
      service.branchSession(sourceSessionId, userId, { projectPath: projectDir }),
    ).rejects.toThrow('not an assistant response')
    expect(
      service.branchSession(sourceSessionId, assistantId, { projectPath: projectDir }),
    ).rejects.toThrow('unfinished tool calls')
  })

  it('should throw when workDir does not exist', async () => {
    expect(service.createSession('/tmp/definitely-missing-cybercode')).rejects.toThrow(
      'Working directory does not exist'
    )
  })

  // --------------------------------------------------------------------------
  // deleteSession
  // --------------------------------------------------------------------------

  it('should delete an existing session', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const otherSessionId = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'
    const filePath = await writeSessionFile('-tmp-project', sessionId, [makeSnapshotEntry()])
    const auxDir = path.join(tmpDir, 'projects', '-tmp-project', sessionId, 'tool-results')
    await fs.mkdir(auxDir, { recursive: true })
    await fs.writeFile(path.join(auxDir, 'result.txt'), 'tool output', 'utf-8')
    await writeHistoryLog([
      {
        display: 'Deleted prompt',
        timestamp: 1778000000000,
        project: '/tmp/project',
        sessionId,
      },
      {
        display: 'Other prompt',
        timestamp: 1778000001000,
        project: '/tmp/project',
        sessionId: otherSessionId,
      },
    ])

    await service.deleteSession(sessionId)

    // File should no longer exist
    await expect(fs.access(filePath)).rejects.toThrow()
    await expect(fs.access(path.join(tmpDir, 'projects', '-tmp-project', sessionId))).rejects.toThrow()

    const history = await fs.readFile(path.join(tmpDir, 'history.jsonl'), 'utf-8')
    expect(history).not.toContain(sessionId)
    expect(history).toContain(otherSessionId)
  })

  it('should throw when deleting non-existent session', async () => {
    expect(
      service.deleteSession('00000000-0000-0000-0000-000000000000')
    ).rejects.toThrow('Session not found')
  })

  // --------------------------------------------------------------------------
  // renameSession
  // --------------------------------------------------------------------------

  it('should rename a session by appending custom-title entry', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const filePath = await writeSessionFile('-tmp-project', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('Original message'),
    ])

    await service.renameSession(sessionId, 'My Custom Title')

    // Read the file and check the last entry
    const content = await fs.readFile(filePath, 'utf-8')
    const lines = content.trim().split('\n')
    const lastEntry = JSON.parse(lines[lines.length - 1]!)
    expect(lastEntry.type).toBe('custom-title')
    expect(lastEntry.customTitle).toBe('My Custom Title')

    // Verify the title is now returned in list
    const detail = await service.getSession(sessionId)
    expect(detail!.title).toBe('My Custom Title')
  })

  it('should throw when renaming non-existent session', async () => {
    expect(
      service.renameSession('00000000-0000-0000-0000-000000000000', 'Title')
    ).rejects.toThrow('Session not found')
  })

  // --------------------------------------------------------------------------
  // Title extraction
  // --------------------------------------------------------------------------

  it('should use first user message as title when no custom title', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-project', sessionId, [
      makeSnapshotEntry(),
      makeMetaUserEntry(),
      makeUserEntry('This is my first real question'),
    ])

    const detail = await service.getSession(sessionId)
    expect(detail!.title).toBe('This is my first real question')
  })

  it('should prefer first user message over AI title when no custom title', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-project', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('Use this first sentence as the title'),
      {
        type: 'ai-title',
        aiTitle: 'AI summary should not win',
        timestamp: '2026-01-01T00:03:00.000Z',
      },
    ])

    const detail = await service.getSession(sessionId)
    expect(detail!.title).toBe('Use this first sentence as the title')
  })

  it('should truncate long titles to 80 chars', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const longMessage = 'A'.repeat(120)
    await writeSessionFile('-tmp-project', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry(longMessage),
    ])

    const detail = await service.getSession(sessionId)
    expect(detail!.title.length).toBe(83) // 80 + '...'
    expect(detail!.title.endsWith('...')).toBe(true)
  })

  it('should fall back to "Untitled Session" when no user message', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-project', sessionId, [makeSnapshotEntry()])

    const detail = await service.getSession(sessionId)
    expect(detail!.title).toBe('Untitled Session')
  })

  it('should detect placeholder launch info for desktop-created sessions', async () => {
    const { sessionId } = await service.createSession(os.tmpdir())

    const launchInfo = await service.getSessionLaunchInfo(sessionId)
    expect(launchInfo).not.toBeNull()
    expect(launchInfo!.workDir).toBe(os.tmpdir())
    expect(launchInfo!.transcriptMessageCount).toBe(0)
    expect(launchInfo!.customTitle).toBeNull()
  })

  it('should recreate placeholder metadata after a zero-message placeholder is replaced', async () => {
    const workDir = os.tmpdir()
    const { sessionId } = await service.createSession(workDir)

    await service.deleteSessionFile(sessionId)
    expect(await service.findSessionFile(sessionId)).toBeNull()

    await service.appendSessionMetadata(sessionId, { workDir })

    const projectPath = sanitizePath(path.resolve(workDir))
    const list = await service.listSessions()
    const restored = list.sessions.find((session) => session.id === sessionId)
    expect(restored).toMatchObject({
      id: sessionId,
      title: 'Untitled Session',
      lastMessage: '',
      messageCount: 0,
      projectPath,
      workDir: path.resolve(workDir),
    })

    const messages = await service.getSessionMessages(sessionId, { projectPath })
    expect(messages).toEqual({ messages: [], hasMore: false })
  })

  it('should keep zero-message placeholders discoverable while moved aside for launch', async () => {
    const workDir = os.tmpdir()
    const { sessionId } = await service.createSession(workDir)
    const projectPath = sanitizePath(path.resolve(workDir))
    const activePath = path.join(tmpDir, 'projects', projectPath, `${sessionId}.jsonl`)
    const backupPath = `${activePath}.placeholder`

    await service.moveSessionFileAsideForLaunch(sessionId)

    expect(await pathExists(activePath)).toBe(false)
    expect(await pathExists(backupPath)).toBe(true)

    const list = await service.listSessions()
    expect(list.sessions.find((session) => session.id === sessionId)).toMatchObject({
      id: sessionId,
      title: 'Untitled Session',
      messageCount: 0,
      projectPath,
    })
    expect(await service.getSessionMessages(sessionId, { projectPath })).toEqual({
      messages: [],
      hasMore: false,
    })

    await service.appendSessionMetadata(sessionId, { workDir })

    expect(await pathExists(activePath)).toBe(true)
    expect(await pathExists(backupPath)).toBe(false)
  })

  it('should detect resumable launch info for transcript sessions', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const userUuid = crypto.randomUUID()
    await writeSessionFile('-tmp-project', sessionId, [
      makeSnapshotEntry(),
      { type: 'session-meta', isMeta: true, workDir: '/tmp/project', timestamp: '2026-01-01T00:00:00.000Z' },
      makeUserEntry('Hello again', userUuid),
      makeAssistantEntry('Welcome back', userUuid),
      { type: 'custom-title', customTitle: 'Saved chat', timestamp: '2026-01-01T00:03:00.000Z' },
    ])

    const launchInfo = await service.getSessionLaunchInfo(sessionId)
    expect(launchInfo).not.toBeNull()
    expect(launchInfo!.workDir).toBe('/tmp/project')
    expect(launchInfo!.transcriptMessageCount).toBe(2)
    expect(launchInfo!.customTitle).toBe('Saved chat')
  })
})

// ============================================================================
// Sessions API integration tests
// ============================================================================

describe('Sessions API', () => {
  let baseUrl: string
  let server: ReturnType<typeof Bun.serve> | null = null

  beforeEach(async () => {
    await setupTmpConfigDir()
    service = new SessionService()

    // Import and start a minimal test server
    const { handleSessionsApi } = await import('../api/sessions.js')
    const { handleConversationsApi } = await import('../api/conversations.js')

    const port = 30000 + Math.floor(Math.random() * 10000)
    baseUrl = `http://127.0.0.1:${port}`

    server = Bun.serve({
      port,
      hostname: '127.0.0.1',

      async fetch(req) {
        const url = new URL(req.url)
        const segments = url.pathname.split('/').filter(Boolean)

        if (segments[0] === 'api' && segments[1] === 'sessions') {
          // Route chat sub-resource to conversations handler
          if (segments[3] === 'chat') {
            return handleConversationsApi(req, url, segments)
          }
          return handleSessionsApi(req, url, segments)
        }

        return new Response('Not Found', { status: 404 })
      },
    })
  })

  afterEach(async () => {
    if (server) {
      server.stop(true)
      server = null
    }
    await cleanupTmpDir()
  })

  it('GET /api/sessions should return empty list', async () => {
    const res = await fetch(`${baseUrl}/api/sessions`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as { sessions: unknown[]; total: number }
    expect(body.sessions).toEqual([])
    expect(body.total).toBe(0)
  })

  it('POST /api/sessions should create a session', async () => {
    const workDir = await fs.mkdtemp(path.join(tmpDir, 'api-session-'))
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workDir }),
    })
    expect(res.status).toBe(201)

    const body = (await res.json()) as { sessionId: string }
    expect(body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('POST /api/sessions/:id/branch should create and return an independent branch', async () => {
    const sourceSessionId = '44444444-bbbb-cccc-dddd-eeeeeeeeeeee'
    const userId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()
    const workDir = path.join(tmpDir, 'api-branch-project')
    const projectDir = sanitizePath(workDir)
    await fs.mkdir(workDir, { recursive: true })
    await writeSessionFile(projectDir, sourceSessionId, [
      makeSessionMetaEntry(workDir),
      {
        ...makeUserEntry('branch this reply', userId),
        sessionId: sourceSessionId,
      },
      {
        ...makeAssistantEntry('branch point', userId),
        uuid: assistantId,
        sessionId: sourceSessionId,
      },
    ])

    const response = await fetch(
      `${baseUrl}/api/sessions/${sourceSessionId}/branch?projectPath=${encodeURIComponent(projectDir)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetAssistantMessageId: assistantId,
          expectedContent: 'branch point',
        }),
      },
    )

    expect(response.status).toBe(201)
    const body = await response.json() as {
      sessionId: string
      sourceSessionId: string
      targetAssistantMessageId: string
      session: { id: string; title: string; projectPath: string }
    }
    expect(body).toMatchObject({
      sourceSessionId,
      targetAssistantMessageId: assistantId,
      session: {
        id: body.sessionId,
        title: 'branch this reply (Branch)',
        projectPath: projectDir,
      },
    })
    expect(body.sessionId).not.toBe(sourceSessionId)

    const sourceMessages = await service.getSessionMessages(sourceSessionId, { projectPath: projectDir })
    const branchMessages = await service.getSessionMessages(body.sessionId, { projectPath: projectDir })
    expect(sourceMessages.messages).toHaveLength(2)
    expect(branchMessages.messages.map((message) => message.id)).toEqual([userId, assistantId])
  })

  it('POST /api/sessions/project-folders should create a project folder', async () => {
    const parentDir = await fs.mkdtemp(path.join(tmpDir, 'api-project-parent-'))
    const res = await fetch(`${baseUrl}/api/sessions/project-folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentDir, name: 'new-app' }),
    })
    expect(res.status).toBe(201)

    const body = (await res.json()) as { path: string; existed: boolean }
    expect(body).toEqual({
      path: path.join(parentDir, 'new-app'),
      existed: false,
    })
    const stat = await fs.stat(body.path)
    expect(stat.isDirectory()).toBe(true)
  })

  it('POST /api/sessions should create a session when workDir is omitted', async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(201)

    const body = (await res.json()) as { sessionId: string }
    expect(body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('POST /api/sessions should create an explicit temporary session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ temporary: true }),
    })
    expect(res.status).toBe(201)

    const body = (await res.json()) as {
      sessionId: string
      session: { isTemporary: boolean; projectPath: string; workDir: string }
    }
    expect(body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    expect(body.session).toMatchObject({
      isTemporary: true,
      projectPath: sanitizePath(os.homedir()),
      workDir: path.resolve(os.homedir()),
    })
  })

  it('GET /api/sessions/:id should return session detail', async () => {
    // Create a session file
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-api-test', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('API test message'),
      makeAssistantEntry('API test response'),
    ])

    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as { id: string; title: string; messages: unknown[] }
    expect(body.id).toBe(sessionId)
    expect(body.title).toBe('API test message')
    expect(body.messages).toHaveLength(2)
  })

  it('GET /api/sessions/:id should 404 for unknown session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/00000000-0000-0000-0000-000000000000`)
    expect(res.status).toBe(404)
  })

  it('GET /api/sessions/:id/messages should return messages', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-api-test', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('Hello'),
      makeAssistantEntry('World'),
    ])

    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as { messages: unknown[] }
    expect(body.messages).toHaveLength(2)
  })

  it('GET /api/sessions/:id/usage should return transcript token totals', async () => {
    const sessionId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'
    const assistant = makeAssistantEntry('Usage response')
    ;(assistant.message as Record<string, unknown>).usage = {
      input_tokens: 1_200,
      output_tokens: 300,
      cache_read_input_tokens: 400,
      cache_creation_input_tokens: 100,
    }
    await writeSessionFile('-tmp-api-usage', sessionId, [
      makeSessionMetaEntry('/tmp/api-usage'),
      makeUserEntry('Count this turn'),
      assistant,
    ])

    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/usage`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      usage: {
        totalInputTokens: number
        totalOutputTokens: number
        totalCacheReadInputTokens: number
        totalCacheCreationInputTokens: number
      }
      context: {
        usedTokens: number
        contextWindow: number
        percentage: number
        latestTurn: {
          inputTokens: number
          outputTokens: number
          cacheReadInputTokens: number
          cacheCreationInputTokens: number
        }
      }
    }
    expect(body.usage).toMatchObject({
      totalInputTokens: 1_200,
      totalOutputTokens: 300,
      totalCacheReadInputTokens: 400,
      totalCacheCreationInputTokens: 100,
    })
    expect(body.context.usedTokens).toBe(1_700)
    expect(body.context.contextWindow).toBeGreaterThan(0)
    expect(body.context.percentage).toBeGreaterThanOrEqual(0)
    expect(body.context.latestTurn).toEqual({
      inputTokens: 1_200,
      outputTokens: 300,
      cacheReadInputTokens: 400,
      cacheCreationInputTokens: 100,
    })
  })

  it('DELETE /api/sessions/:id should delete the session', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-api-test', sessionId, [makeSnapshotEntry()])

    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}`, { method: 'DELETE' })
    expect(res.status).toBe(200)

    // Verify it's gone
    const res2 = await fetch(`${baseUrl}/api/sessions/${sessionId}`)
    expect(res2.status).toBe(404)
  })

  it('PATCH /api/sessions/:id should rename the session', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-api-test', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('Old title message'),
    ])

    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Custom Title' }),
    })
    expect(res.status).toBe(200)

    // Verify new title
    const detailRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`)
    const detail = (await detailRes.json()) as { title: string }
    expect(detail.title).toBe('New Custom Title')
  })

  it('GET /api/sessions/:id/slash-commands should include user and project skills before CLI init', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const workDir = path.join(tmpDir, 'workspace', 'app')

    await fs.mkdir(path.join(workDir, '.cyber', 'skills'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'skills'), { recursive: true })
    await writeSkill(path.join(tmpDir, 'skills'), 'user-skill', 'User skill description')
    await writeSkill(path.join(workDir, '.cyber', 'skills'), 'project-skill', 'Project skill description')

    await writeSessionFile('-tmp-api-test', sessionId, [
      makeSnapshotEntry(),
      makeSessionMetaEntry(workDir),
    ])

    clearCommandsCache()

    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/slash-commands`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      commands: Array<{ name: string; description: string }>
    }

    expect(body.commands).toContainEqual(
      expect.objectContaining({ name: 'user-skill', description: 'User skill description' }),
    )
    expect(body.commands).toContainEqual(
      expect.objectContaining({ name: 'project-skill', description: 'Project skill description' }),
    )
  })

  it('POST /api/sessions/:id/rewind should preview and trim the active conversation chain', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const firstUserId = crypto.randomUUID()
    const firstAssistantId = crypto.randomUUID()
    const secondUserId = crypto.randomUUID()
    const secondAssistantId = crypto.randomUUID()

    await writeSessionFile('-tmp-api-test', sessionId, [
      makeSnapshotEntry(),
      {
        parentUuid: null,
        isSidechain: false,
        type: 'user',
        message: { role: 'user', content: 'first prompt' },
        uuid: firstUserId,
        timestamp: '2026-01-01T00:01:00.000Z',
        userType: 'external',
        cwd: '/tmp/test',
        sessionId,
      },
      {
        parentUuid: firstUserId,
        isSidechain: false,
        type: 'assistant',
        message: {
          model: 'claude-opus-4-7',
          id: `msg_${crypto.randomUUID().slice(0, 20)}`,
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'first reply' }],
        },
        uuid: firstAssistantId,
        timestamp: '2026-01-01T00:02:00.000Z',
      },
      {
        parentUuid: firstAssistantId,
        isSidechain: false,
        type: 'user',
        message: { role: 'user', content: 'second prompt' },
        uuid: secondUserId,
        timestamp: '2026-01-01T00:03:00.000Z',
        userType: 'external',
        cwd: '/tmp/test',
        sessionId,
      },
      {
        parentUuid: secondUserId,
        isSidechain: false,
        type: 'assistant',
        message: {
          model: 'claude-opus-4-7',
          id: `msg_${crypto.randomUUID().slice(0, 20)}`,
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'second reply' }],
        },
        uuid: secondAssistantId,
        timestamp: '2026-01-01T00:04:00.000Z',
      },
    ])

    const previewRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessageIndex: 1, dryRun: true }),
    })
    expect(previewRes.status).toBe(200)

    const previewBody = await previewRes.json() as {
      conversation: { messagesRemoved: number }
      code: { available: boolean }
    }
    expect(previewBody.conversation.messagesRemoved).toBe(2)
    expect(previewBody.code.available).toBe(false)

    const executeRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessageIndex: 1 }),
    })
    expect(executeRes.status).toBe(200)

    const executeBody = await executeRes.json() as {
      conversation: { messagesRemoved: number; removedMessageIds: string[] }
    }
    expect(executeBody.conversation.messagesRemoved).toBe(2)
    expect(executeBody.conversation.removedMessageIds).toEqual([
      secondUserId,
      secondAssistantId,
    ])

    const remainingMessages = await service.getSessionMessages(sessionId).then(r => r.messages)
    expect(remainingMessages.map((message) => message.id)).toEqual([
      firstUserId,
      firstAssistantId,
    ])
  })

  it('POST /api/sessions/:id/rewind should target the selected message id instead of a shifted visible index', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff'
    const firstUserId = crypto.randomUUID()
    const firstAssistantId = crypto.randomUUID()
    const hiddenUserId = crypto.randomUUID()
    const targetUserId = crypto.randomUUID()
    const targetAssistantId = crypto.randomUUID()

    await writeSessionFile('-tmp-api-rewind-id-target', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('first prompt', firstUserId),
      {
        ...makeAssistantEntry('first reply', firstUserId),
        uuid: firstAssistantId,
      },
      makeUserEntry(
        '<teammate-message teammate_id="reviewer">internal status that the main chat hides</teammate-message>',
        hiddenUserId,
      ),
      makeUserEntry('second visible prompt', targetUserId),
      {
        ...makeAssistantEntry('second reply', targetUserId),
        uuid: targetAssistantId,
      },
    ])

    const executeRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userMessageIndex: 1,
        targetUserMessageId: targetUserId,
        expectedContent: 'second visible prompt',
      }),
    })
    expect(executeRes.status).toBe(200)

    const executeBody = await executeRes.json() as {
      target: { targetUserMessageId: string; userMessageIndex: number }
      conversation: { messagesRemoved: number; removedMessageIds: string[] }
    }
    expect(executeBody.target.targetUserMessageId).toBe(targetUserId)
    expect(executeBody.target.userMessageIndex).toBe(2)
    expect(executeBody.conversation.messagesRemoved).toBe(2)
    expect(executeBody.conversation.removedMessageIds).toEqual([
      targetUserId,
      targetAssistantId,
    ])

    const remainingMessages = await service.getSessionMessages(sessionId).then(r => r.messages)
    expect(remainingMessages.map((message) => message.id)).toEqual([
      firstUserId,
      firstAssistantId,
      hiddenUserId,
    ])
  })

  it('POST /api/sessions/:id/rewind should reject an index fallback when the selected prompt no longer matches', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-000000000000'
    const firstUserId = crypto.randomUUID()
    const hiddenUserId = crypto.randomUUID()
    const targetUserId = crypto.randomUUID()

    await writeSessionFile('-tmp-api-rewind-index-guard', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('first prompt', firstUserId),
      makeUserEntry(
        '<teammate-message teammate_id="reviewer">internal status that the main chat hides</teammate-message>',
        hiddenUserId,
      ),
      makeUserEntry('second visible prompt', targetUserId),
    ])

    const executeRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userMessageIndex: 1,
        expectedContent: 'second visible prompt',
      }),
    })
    expect(executeRes.status).toBe(400)

    const body = await executeRes.json() as { message: string }
    expect(body.message).toContain('does not match the selected prompt')

    const remainingMessages = await service.getSessionMessages(sessionId).then(r => r.messages)
    expect(remainingMessages.map((message) => message.id)).toEqual([
      firstUserId,
      hiddenUserId,
      targetUserId,
    ])
  })

  it('POST /api/sessions/:id/rewind should restore a single edited file', async () => {
    const sessionId = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'
    const workDir = path.join(tmpDir, 'single-file-fixture')
    const targetFile = path.join(workDir, 'src', 'app.js')
    const userId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()
    const backupName = 'single-file@v1'

    await fs.mkdir(path.dirname(targetFile), { recursive: true })
    await fs.writeFile(
      targetFile,
      "export const ORIGINAL_VALUE = 'after-rewind'\n",
      'utf-8',
    )
    await writeFileHistoryBackup(
      sessionId,
      backupName,
      "export const ORIGINAL_VALUE = 'before-rewind'\n",
    )

    await writeSessionFile('-tmp-api-single-file', sessionId, [
      makeSessionMetaEntry(workDir),
      makeFileHistorySnapshotEntry(userId, {
        'src/app.js': {
          backupFileName: backupName,
          version: 1,
          backupTime: '2026-01-01T00:00:00.000Z',
        },
      }),
      {
        ...makeUserEntry('edit app.js', userId),
        cwd: workDir,
        sessionId,
      },
      {
        ...makeAssistantEntry('DONE', userId),
        uuid: assistantId,
      },
    ])

    const previewRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessageIndex: 0, dryRun: true }),
    })
    expect(previewRes.status).toBe(200)
    const preview = await previewRes.json() as {
      code: { available: boolean; filesChanged: string[] }
    }
    expect(preview.code.available).toBe(true)
    expect(preview.code.filesChanged).toEqual([targetFile])

    const executeRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessageIndex: 0 }),
    })
    expect(executeRes.status).toBe(200)
    expect(await fs.readFile(targetFile, 'utf-8')).toBe(
      "export const ORIGINAL_VALUE = 'before-rewind'\n",
    )

    const remainingMessages = await service.getSessionMessages(sessionId).then(r => r.messages)
    expect(remainingMessages).toHaveLength(0)
  })

  it('POST /api/sessions/:id/rewind should restore multiple files and remove created files', async () => {
    const sessionId = 'cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee'
    const workDir = path.join(tmpDir, 'multi-file-fixture')
    const appFile = path.join(workDir, 'src', 'app.js')
    const readmeFile = path.join(workDir, 'README.md')
    const createdFile = path.join(workDir, 'notes', 'generated.txt')
    const userId = crypto.randomUUID()
    const backupApp = 'multi-app@v1'
    const backupReadme = 'multi-readme@v1'

    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.mkdir(path.dirname(createdFile), { recursive: true })
    await fs.writeFile(appFile, "export const VALUE = 'edited'\n", 'utf-8')
    await fs.writeFile(readmeFile, '# changed\n', 'utf-8')
    await fs.writeFile(createdFile, 'new file\n', 'utf-8')
    await writeFileHistoryBackup(sessionId, backupApp, "export const VALUE = 'original'\n")
    await writeFileHistoryBackup(sessionId, backupReadme, '# original\n')

    await writeSessionFile('-tmp-api-multi-file', sessionId, [
      makeSessionMetaEntry(workDir),
      makeFileHistorySnapshotEntry(userId, {
        'src/app.js': {
          backupFileName: backupApp,
          version: 1,
          backupTime: '2026-01-01T00:00:00.000Z',
        },
        'README.md': {
          backupFileName: backupReadme,
          version: 1,
          backupTime: '2026-01-01T00:00:00.000Z',
        },
        'notes/generated.txt': {
          backupFileName: null,
          version: 1,
          backupTime: '2026-01-01T00:00:00.000Z',
        },
      }),
      {
        ...makeUserEntry('edit multiple files', userId),
        cwd: workDir,
        sessionId,
      },
      makeAssistantEntry('DONE', userId),
    ])

    const previewRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessageIndex: 0, dryRun: true }),
    })
    expect(previewRes.status).toBe(200)
    const preview = await previewRes.json() as {
      code: { available: boolean; filesChanged: string[] }
    }
    expect(preview.code.available).toBe(true)
    expect(preview.code.filesChanged.sort()).toEqual([
      appFile,
      createdFile,
      readmeFile,
    ].sort())

    const executeRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessageIndex: 0 }),
    })
    expect(executeRes.status).toBe(200)

    expect(await fs.readFile(appFile, 'utf-8')).toBe("export const VALUE = 'original'\n")
    expect(await fs.readFile(readmeFile, 'utf-8')).toBe('# original\n')
    await expect(fs.stat(createdFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('POST /api/sessions/:id/rewind should restore the previous version when rewinding the second edit of the same file', async () => {
    const sessionId = 'dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee'
    const workDir = path.join(tmpDir, 'same-file-two-turns')
    const targetFile = path.join(workDir, 'src', 'app.js')
    const firstUserId = crypto.randomUUID()
    const secondUserId = crypto.randomUUID()
    const backupV1 = 'same-file@v1'
    const backupV2 = 'same-file@v2'

    await fs.mkdir(path.dirname(targetFile), { recursive: true })
    await fs.writeFile(targetFile, "export const STEP = 'v2'\n", 'utf-8')
    await writeFileHistoryBackup(sessionId, backupV1, "export const STEP = 'base'\n")
    await writeFileHistoryBackup(sessionId, backupV2, "export const STEP = 'v1'\n")

    await writeSessionFile('-tmp-api-two-turns', sessionId, [
      makeSessionMetaEntry(workDir),
      makeFileHistorySnapshotEntry(firstUserId, {
        'src/app.js': {
          backupFileName: backupV1,
          version: 1,
          backupTime: '2026-01-01T00:00:00.000Z',
        },
      }),
      {
        ...makeUserEntry('make v1', firstUserId),
        cwd: workDir,
        sessionId,
      },
      makeAssistantEntry('DONE', firstUserId),
      makeFileHistorySnapshotEntry(secondUserId, {
        'src/app.js': {
          backupFileName: backupV2,
          version: 2,
          backupTime: '2026-01-01T00:00:00.000Z',
        },
      }),
      {
        ...makeUserEntry('make v2', secondUserId),
        cwd: workDir,
        sessionId,
      },
      makeAssistantEntry('DONE', secondUserId),
    ])

    const executeRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessageIndex: 1 }),
    })
    expect(executeRes.status).toBe(200)
    expect(await fs.readFile(targetFile, 'utf-8')).toBe("export const STEP = 'v1'\n")

    const remainingMessages = await service.getSessionMessages(sessionId).then(r => r.messages)
    expect(remainingMessages.map((message) => message.id)).toHaveLength(2)
    expect(remainingMessages[0]?.id).toBe(firstUserId)
  })

  // --------------------------------------------------------------------------
  // Conversations API via /api/sessions/:id/chat
  // --------------------------------------------------------------------------

  it('GET /api/sessions/:id/chat/status should return idle by default', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/chat/status`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as { state: string }
    expect(body.state).toBe('idle')
  })

  it('POST /api/sessions/:id/chat should queue a message', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-api-test', sessionId, [
      makeSnapshotEntry(),
      makeUserEntry('Previous'),
    ])

    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'New question' }),
    })
    expect(res.status).toBe(202)

    const body = (await res.json()) as { messageId: string; status: string }
    expect(body.status).toBe('queued')
    expect(body.messageId).toBeTruthy()
  })

  it('POST /api/sessions/:id/chat/stop should reset state to idle', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/chat/stop`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)

    // Verify state is idle
    const statusRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/chat/status`)
    const status = (await statusRes.json()) as { state: string }
    expect(status.state).toBe('idle')
  })
})
