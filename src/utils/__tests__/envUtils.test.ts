import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getGlobalClaudeFile } from '../env.js'
import {
  _resetConfigHomeDirForTesting,
  _setConfigHomeDirHomeForTesting,
  getClaudeConfigHomeDir,
} from '../envUtils.js'

describe('Cyber config home directory', () => {
  let tmpHome: string
  let originalHome: string | undefined
  let originalUserProfile: string | undefined
  let originalCyberConfigDir: string | undefined
  let originalClaudeConfigDir: string | undefined

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `cyber-config-test-${randomUUID()}`)
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
    getGlobalClaudeFile.cache.clear?.()
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
    getGlobalClaudeFile.cache.clear?.()
    await rm(tmpHome, { recursive: true, force: true })
  })

  test('defaults to ~/.cyber', () => {
    expect(getClaudeConfigHomeDir()).toBe(join(tmpHome, '.cyber'))
  })

  test('prefers CYBER_CONFIG_DIR while keeping CLAUDE_CONFIG_DIR compatibility', () => {
    process.env.CLAUDE_CONFIG_DIR = join(tmpHome, 'legacy-override')
    expect(getClaudeConfigHomeDir()).toBe(join(tmpHome, 'legacy-override'))

    process.env.CYBER_CONFIG_DIR = join(tmpHome, 'cyber-override')
    expect(getClaudeConfigHomeDir()).toBe(join(tmpHome, 'cyber-override'))
  })

  test('copies an existing ~/.claude directory into ~/.cyber on first default lookup', async () => {
    const legacySettings = join(tmpHome, '.claude', 'settings.json')
    await mkdir(join(tmpHome, '.claude'), { recursive: true })
    await writeFile(legacySettings, '{"theme":"dark"}')

    expect(getClaudeConfigHomeDir()).toBe(join(tmpHome, '.cyber'))
    await expect(readFile(join(tmpHome, '.cyber', 'settings.json'), 'utf8')).resolves.toBe(
      '{"theme":"dark"}',
    )
  })

  test('uses ~/.cyber/.config.json and copies legacy ~/.claude.json once', async () => {
    await writeFile(join(tmpHome, '.claude.json'), '{"firstStartTime":"legacy"}')

    const globalConfigPath = getGlobalClaudeFile()

    expect(globalConfigPath).toBe(join(tmpHome, '.cyber', '.config.json'))
    await expect(readFile(globalConfigPath, 'utf8')).resolves.toBe(
      '{"firstStartTime":"legacy"}',
    )
  })
})
