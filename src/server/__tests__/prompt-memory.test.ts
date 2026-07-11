import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  _resetConfigHomeDirForTesting,
  _setConfigHomeDirHomeForTesting,
} from '../../utils/envUtils.js'
import { addPromptMemoryEntry, readPromptMemoryFile } from '../../promptMemory/store.js'
import { handlePromptMemoryApi } from '../api/prompt-memory.js'

function makeRequest(
  path: string,
  init: RequestInit = {},
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(path, 'http://localhost:3456')
  return {
    req: new Request(url, { method: 'GET', ...init }),
    url,
    segments: url.pathname.split('/').filter(Boolean),
  }
}

describe('Prompt Memory API', () => {
  let tmpRoot: string
  let tmpHome: string
  let originalHome: string | undefined
  let originalUserProfile: string | undefined
  let originalCyberConfigDir: string | undefined
  let originalClaudeConfigDir: string | undefined

  beforeEach(async () => {
    tmpRoot = join(tmpdir(), `cyber-prompt-memory-api-${randomUUID()}`)
    tmpHome = join(tmpRoot, 'home')
    await mkdir(tmpHome, { recursive: true })
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    originalCyberConfigDir = process.env.CYBER_CONFIG_DIR
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.HOME = tmpHome
    process.env.USERPROFILE = tmpHome
    delete process.env.CYBER_CONFIG_DIR
    delete process.env.CLAUDE_CONFIG_DIR
    _setConfigHomeDirHomeForTesting(tmpHome)
  })

  afterEach(async () => {
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

  test('returns categorized self-evolution insights', async () => {
    await addPromptMemoryEntry('user', '用户给 CyberCode 取名为「零」。')
    await addPromptMemoryEntry(
      'brief',
      '[meta-method] Discuss ambiguous behavior before implementation.',
    )

    const request = makeRequest('/api/prompt-memory/insights')
    const response = await handlePromptMemoryApi(
      request.req,
      request.url,
      request.segments,
    )
    expect(response.status).toBe(200)
    const body = await response.json() as {
      stats: { total: number; user: number; methods: number }
      insights: Array<{ target: string; category: string; content: string }>
    }
    expect(body.stats).toMatchObject({ total: 2, user: 1, methods: 1 })
    expect(body.insights).toContainEqual(
      expect.objectContaining({ target: 'user', category: 'identity' }),
    )
    expect(body.insights).toContainEqual(
      expect.objectContaining({ target: 'brief', category: 'meta-method' }),
    )
  })

  test('removes a profile memory through the existing entry endpoint', async () => {
    const entry = '[communication] User prefers concise replies.'
    await addPromptMemoryEntry('user', entry)
    const request = makeRequest('/api/prompt-memory/user/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove', oldText: entry }),
    })
    const response = await handlePromptMemoryApi(
      request.req,
      request.url,
      request.segments,
    )
    expect(response.status).toBe(200)
    expect((await readPromptMemoryFile('user')).entries).toEqual([])
  })
})
