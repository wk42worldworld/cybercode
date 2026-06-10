import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getSessionId,
  regenerateSessionId,
  switchSession,
} from '../bootstrap/state.js'
import type { SessionId } from '../types/ids.js'
import {
  _resetConfigHomeDirForTesting,
  _setConfigHomeDirHomeForTesting,
} from '../utils/envUtils.js'
import {
  BRIEF_CHAR_LIMIT,
  SOUL_CHAR_LIMIT,
  USER_PROMPT_MEMORY_CHAR_LIMIT,
} from './budget.js'
import {
  clearPromptMemorySnapshotForTesting,
  loadPromptMemory,
} from './loadPromptMemory.js'
import {
  appendPromptMemoryAutoReviewLogs,
  buildPromptMemoryAutoReviewPrompt,
  extractPromptMemoryAutoReviewLogs,
  formatPromptMemoryAutoReviewNotice,
  hasExplicitPromptMemorySignal,
  readPromptMemoryAutoReviewLogs,
  resetPromptMemoryAutoReviewForTesting,
  shouldRunPromptMemoryAutoReview,
  type PromptMemoryAutoReviewLogEntry,
} from './autoReview.js'
import {
  getBriefPath,
  getPromptMemoryDir,
  getSoulPath,
  getUserPromptMemoryPath,
} from './paths.js'
import {
  PROMPT_MEMORY_ENTRY_DELIMITER,
  PromptMemoryError,
  addPromptMemoryEntry,
  readPromptMemoryFile,
  removePromptMemoryEntry,
  replacePromptMemoryEntry,
  writePromptMemoryFile,
} from './store.js'

describe('prompt memory', () => {
  let tmpRoot: string
  let tmpHome: string
  let originalHome: string | undefined
  let originalUserProfile: string | undefined
  let originalCyberConfigDir: string | undefined
  let originalClaudeConfigDir: string | undefined
  let originalSessionId: SessionId

  beforeEach(async () => {
    tmpRoot = join(tmpdir(), `cyber-prompt-memory-${randomUUID()}`)
    tmpHome = join(tmpRoot, 'home')
    await mkdir(tmpHome, { recursive: true })

    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    originalCyberConfigDir = process.env.CYBER_CONFIG_DIR
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalSessionId = getSessionId()

    process.env.HOME = tmpHome
    process.env.USERPROFILE = tmpHome
    delete process.env.CYBER_CONFIG_DIR
    delete process.env.CLAUDE_CONFIG_DIR

    _setConfigHomeDirHomeForTesting(tmpHome)
    clearPromptMemorySnapshotForTesting()
    resetPromptMemoryAutoReviewForTesting()
    regenerateSessionId()
  })

  afterEach(async () => {
    clearPromptMemorySnapshotForTesting()
    resetPromptMemoryAutoReviewForTesting()
    switchSession(originalSessionId, null)

    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome

    if (originalUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = originalUserProfile

    if (originalCyberConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
    else process.env.CYBER_CONFIG_DIR = originalCyberConfigDir

    if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir

    _setConfigHomeDirHomeForTesting(undefined)
    _resetConfigHomeDirForTesting()
    await rm(tmpRoot, { recursive: true, force: true })
  })

  test('uses cyber prompt memory paths', () => {
    expect(getSoulPath()).toBe(join(tmpHome, '.cyber', 'SOUL.md'))
    expect(getPromptMemoryDir()).toBe(
      join(tmpHome, '.cyber', 'prompt-memory'),
    )
    expect(getBriefPath()).toBe(
      join(tmpHome, '.cyber', 'prompt-memory', 'BRIEF.md'),
    )
    expect(getUserPromptMemoryPath()).toBe(
      join(tmpHome, '.cyber', 'prompt-memory', 'USER.md'),
    )
  })

  test('seeds default SOUL.md when prompt memory files are missing', async () => {
    const prompt = await loadPromptMemory()

    expect(prompt).toContain('# CyberCode Soul')
    expect(prompt).toContain('You are CyberCode')
    await expect(readFile(getSoulPath(), 'utf-8')).resolves.toContain(
      'You are CyberCode',
    )
  })

  test('loads soul, brief, and user as one prompt section', async () => {
    await mkdir(getPromptMemoryDir(), { recursive: true })
    await writeFile(getSoulPath(), 'You are CyberCode with a calm style.')
    await writeFile(getBriefPath(), '- Use Bun for this project.')
    await writeFile(getUserPromptMemoryPath(), '- User prefers Chinese.')

    const prompt = await loadPromptMemory()

    expect(prompt).toContain('# CyberCode Soul')
    expect(prompt).toContain('You are CyberCode with a calm style.')
    expect(prompt).toContain('# Prompt Memory')
    expect(prompt).toContain('## Brief')
    expect(prompt).toContain('- Use Bun for this project.')
    expect(prompt).toContain('## User')
    expect(prompt).toContain('- User prefers Chinese.')
  })

  test('freezes prompt memory for the active session', async () => {
    await mkdir(getPromptMemoryDir(), { recursive: true })
    await writeFile(getBriefPath(), 'first snapshot')

    const first = await loadPromptMemory()
    await writeFile(getBriefPath(), 'second snapshot')
    const second = await loadPromptMemory()

    expect(second).toBe(first)
    expect(second).toContain('first snapshot')
    expect(second).not.toContain('second snapshot')

    regenerateSessionId()
    const nextSession = await loadPromptMemory()
    expect(nextSession).toContain('second snapshot')
  })

  test('bounds prompt memory file sizes', async () => {
    await mkdir(getPromptMemoryDir(), { recursive: true })
    await writeFile(getSoulPath(), 's'.repeat(SOUL_CHAR_LIMIT + 100))
    await writeFile(getBriefPath(), 'b'.repeat(BRIEF_CHAR_LIMIT + 100))
    await writeFile(
      getUserPromptMemoryPath(),
      'u'.repeat(USER_PROMPT_MEMORY_CHAR_LIMIT + 100),
    )

    const prompt = await loadPromptMemory()

    expect(prompt).toContain('Truncated SOUL.md')
    expect(prompt).toContain('Truncated BRIEF.md')
    expect(prompt).toContain('Truncated USER.md')
    expect(prompt!.length).toBeLessThan(
      SOUL_CHAR_LIMIT + BRIEF_CHAR_LIMIT + USER_PROMPT_MEMORY_CHAR_LIMIT + 800,
    )
  })

  test('adds, replaces, and removes USER.md entries', async () => {
    const first = await addPromptMemoryEntry('user', 'User prefers Chinese.')
    expect(first.changed).toBe(true)
    expect(first.entryCount).toBe(1)

    const duplicate = await addPromptMemoryEntry('user', 'User prefers Chinese.')
    expect(duplicate.changed).toBe(false)
    expect(duplicate.entryCount).toBe(1)

    const second = await addPromptMemoryEntry('user', 'User likes concise replies.')
    expect(second.entryCount).toBe(2)
    await expect(readFile(getUserPromptMemoryPath(), 'utf-8')).resolves.toContain(
      PROMPT_MEMORY_ENTRY_DELIMITER,
    )

    const replaced = await replacePromptMemoryEntry(
      'user',
      'concise',
      'User likes concise Chinese replies.',
    )
    expect(replaced.entries).toContain('User likes concise Chinese replies.')

    const removed = await removePromptMemoryEntry('user', 'prefers Chinese')
    expect(removed.entries).toEqual(['User likes concise Chinese replies.'])
  })

  test('treats plain BRIEF.md text as one entry before normalizing mutations', async () => {
    await mkdir(getPromptMemoryDir(), { recursive: true })
    await writeFile(getBriefPath(), 'Plain existing note.')

    const before = await readPromptMemoryFile('brief')
    expect(before.format).toBe('plain')
    expect(before.entries).toEqual(['Plain existing note.'])

    await addPromptMemoryEntry('brief', 'Second note.')
    const raw = await readFile(getBriefPath(), 'utf-8')
    expect(raw).toContain(PROMPT_MEMORY_ENTRY_DELIMITER)
  })

  test('does not allow entry mutations for SOUL.md', async () => {
    await expect(
      addPromptMemoryEntry('soul', 'Change identity.'),
    ).rejects.toBeInstanceOf(PromptMemoryError)
  })

  test('writes SOUL.md explicitly with limit enforcement', async () => {
    const file = await writePromptMemoryFile(
      'soul',
      'You are CyberCode with a quiet engineering voice.',
    )
    expect(file.content).toBe('You are CyberCode with a quiet engineering voice.')

    await expect(
      writePromptMemoryFile('soul', 's'.repeat(SOUL_CHAR_LIMIT + 1)),
    ).rejects.toBeInstanceOf(PromptMemoryError)
  })

  test('detects explicit prompt-memory signals and interval review triggers', () => {
    const firstUserMessage = {
      type: 'user',
      uuid: 'u1',
      message: { content: '以后默认用中文回复我。' },
    } as any
    const secondUserMessage = {
      type: 'user',
      uuid: 'u2',
      message: { content: '普通问题' },
    } as any

    expect(hasExplicitPromptMemorySignal([firstUserMessage])).toBe(true)

    expect(
      shouldRunPromptMemoryAutoReview({
        messages: [secondUserMessage],
        sinceUuid: undefined,
        turnsSinceLastReview: 1,
        intervalTurns: 3,
      }),
    ).toEqual({
      shouldRun: false,
      trigger: null,
      nextTurnCount: 2,
    })

    expect(
      shouldRunPromptMemoryAutoReview({
        messages: [secondUserMessage],
        sinceUuid: undefined,
        turnsSinceLastReview: 2,
        intervalTurns: 3,
      }),
    ).toEqual({
      shouldRun: true,
      trigger: 'interval',
      nextTurnCount: 0,
    })

    expect(
      shouldRunPromptMemoryAutoReview({
        messages: [firstUserMessage, secondUserMessage],
        sinceUuid: 'u1',
        turnsSinceLastReview: 1,
        intervalTurns: 3,
      }),
    ).toEqual({
      shouldRun: false,
      trigger: null,
      nextTurnCount: 2,
    })
  })

  test('builds an automatic review prompt that forbids SOUL writes', () => {
    const prompt = buildPromptMemoryAutoReviewPrompt({
      newMessageCount: 2,
      trigger: 'explicit',
      briefEntries: ['Use Bun for local scripts.'],
      userEntries: ['User prefers Chinese.'],
    })

    expect(prompt).toContain('PromptMemory tool')
    expect(prompt).toContain('Allowed targets: brief, user.')
    expect(prompt).toContain('Never write or modify SOUL.md')
    expect(prompt).toContain('User prefers Chinese.')
  })

  test('extracts changed PromptMemory tool results into auto-review logs', () => {
    const assistantMessage = {
      type: 'assistant',
      uuid: 'a1',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'PromptMemory',
            input: {
              action: 'add',
              target: 'user',
              content: 'User prefers concise Chinese replies.',
            },
          },
        ],
      },
    } as any
    const toolResultMessage = {
      type: 'user',
      uuid: 'u1',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: JSON.stringify({
              success: true,
              changed: true,
              message: 'Entry added. It will affect future conversations.',
            }),
          },
        ],
      },
    } as any

    const logs = extractPromptMemoryAutoReviewLogs({
      messages: [assistantMessage, toolResultMessage],
      sessionId: 'session-1',
      trigger: 'explicit',
    })

    expect(logs).toHaveLength(1)
    expect(logs[0]!.target).toBe('user')
    expect(logs[0]!.action).toBe('add')
    expect(logs[0]!.content).toBe('User prefers concise Chinese replies.')
  })

  test('writes and reads auto-review logs newest first', async () => {
    const entries: PromptMemoryAutoReviewLogEntry[] = [
      {
        id: 'one',
        timestamp: '2026-06-10T00:00:00.000Z',
        sessionId: 's1',
        trigger: 'explicit',
        target: 'user',
        action: 'add',
        changed: true,
        content: 'User prefers Chinese.',
        message: 'Entry added.',
      },
      {
        id: 'two',
        timestamp: '2026-06-10T00:01:00.000Z',
        sessionId: 's1',
        trigger: 'interval',
        target: 'brief',
        action: 'add',
        changed: true,
        content: 'Use Bun for local scripts.',
        message: 'Entry added.',
      },
    ]

    await appendPromptMemoryAutoReviewLogs(entries)

    const logs = await readPromptMemoryAutoReviewLogs(1)
    expect(logs).toHaveLength(1)
    expect(logs[0]!.id).toBe('two')
  })

  test('formats a compact auto-review notice for changed prompt memory', () => {
    const notice = formatPromptMemoryAutoReviewNotice([
      {
        id: 'one',
        timestamp: '2026-06-10T00:00:00.000Z',
        sessionId: 's1',
        trigger: 'explicit',
        target: 'user',
        action: 'add',
        changed: true,
        content: 'User prefers Chinese.',
        message: 'Entry added.',
      },
      {
        id: 'two',
        timestamp: '2026-06-10T00:01:00.000Z',
        sessionId: 's1',
        trigger: 'interval',
        target: 'brief',
        action: 'add',
        changed: true,
        content: 'Use Bun for local scripts.',
        message: 'Entry added.',
      },
    ])

    expect(notice).toBe('提示记忆已更新：BRIEF / USER（2 条），将在新会话生效。')
    expect(formatPromptMemoryAutoReviewNotice([])).toBeNull()
  })
})
