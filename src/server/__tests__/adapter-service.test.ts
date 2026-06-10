import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { adapterService } from '../services/adapterService.js'
import {
  _resetConfigHomeDirForTesting,
  _setConfigHomeDirHomeForTesting,
} from '../../utils/envUtils.js'

describe('AdapterService', () => {
  let tmpHome: string
  let originalCyberConfigDir: string | undefined
  let originalClaudeConfigDir: string | undefined

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `adapter-service-test-${randomUUID()}`)
    await mkdir(tmpHome, { recursive: true })
    originalCyberConfigDir = process.env.CYBER_CONFIG_DIR
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    delete process.env.CYBER_CONFIG_DIR
    delete process.env.CLAUDE_CONFIG_DIR
    _setConfigHomeDirHomeForTesting(tmpHome)
    _resetConfigHomeDirForTesting()
  })

  afterEach(async () => {
    if (originalCyberConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
    else process.env.CYBER_CONFIG_DIR = originalCyberConfigDir

    if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir

    _setConfigHomeDirHomeForTesting(undefined)
    _resetConfigHomeDirForTesting()
    await rm(tmpHome, { recursive: true, force: true })
  })

  test('reads legacy adapter config when the new file is absent', async () => {
    await mkdir(join(tmpHome, '.cyber'), { recursive: true })
    await mkdir(join(tmpHome, '.claude'), { recursive: true })
    await writeFile(
      join(tmpHome, '.claude', 'adapters.json'),
      JSON.stringify({ telegram: { botToken: 'legacy-token' } }),
    )

    const config = await adapterService.getRawConfig()

    expect(config.telegram?.botToken).toBe('legacy-token')
  })

  test('merges legacy adapter config and writes updates to ~/.cyber', async () => {
    await mkdir(join(tmpHome, '.cyber'), { recursive: true })
    await mkdir(join(tmpHome, '.claude'), { recursive: true })
    await writeFile(
      join(tmpHome, '.claude', 'adapters.json'),
      JSON.stringify({ feishu: { appId: 'legacy-app', appSecret: 'legacy-secret' } }),
    )

    await adapterService.updateConfig({ telegram: { botToken: 'new-token' } })

    const written = JSON.parse(
      await readFile(join(tmpHome, '.cyber', 'adapters.json'), 'utf-8'),
    )
    expect(written.feishu.appId).toBe('legacy-app')
    expect(written.telegram.botToken).toBe('new-token')
  })
})
