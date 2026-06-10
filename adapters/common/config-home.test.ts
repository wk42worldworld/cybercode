import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _setAdapterConfigHomeForTesting,
  getAdapterConfigHomeDir,
  getAdapterConfigPath,
  getExistingAdapterConfigPath,
} from './config-home.js'

describe('adapter config home', () => {
  let tmpHome: string
  let originalHome: string | undefined
  let originalCyberConfigDir: string | undefined
  let originalClaudeConfigDir: string | undefined

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `cyber-adapter-home-${randomUUID()}`)
    await mkdir(tmpHome, { recursive: true })
    originalHome = process.env.HOME
    originalCyberConfigDir = process.env.CYBER_CONFIG_DIR
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.HOME = tmpHome
    _setAdapterConfigHomeForTesting(tmpHome)
    delete process.env.CYBER_CONFIG_DIR
    delete process.env.CLAUDE_CONFIG_DIR
  })

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome

    if (originalCyberConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
    else process.env.CYBER_CONFIG_DIR = originalCyberConfigDir

    if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir

    _setAdapterConfigHomeForTesting(undefined)
    await rm(tmpHome, { recursive: true, force: true })
  })

  test('defaults adapter files to ~/.cyber', () => {
    expect(getAdapterConfigHomeDir()).toBe(join(tmpHome, '.cyber'))
    expect(getAdapterConfigPath('adapters.json')).toBe(
      join(tmpHome, '.cyber', 'adapters.json'),
    )
  })

  test('prefers CYBER_CONFIG_DIR while keeping CLAUDE_CONFIG_DIR compatibility', () => {
    process.env.CLAUDE_CONFIG_DIR = join(tmpHome, 'legacy-override')
    expect(getAdapterConfigHomeDir()).toBe(join(tmpHome, 'legacy-override'))

    process.env.CYBER_CONFIG_DIR = join(tmpHome, 'cyber-override')
    expect(getAdapterConfigHomeDir()).toBe(join(tmpHome, 'cyber-override'))
  })

  test('reads legacy ~/.claude adapter config when ~/.cyber file is absent', async () => {
    await mkdir(join(tmpHome, '.claude'), { recursive: true })
    await writeFile(join(tmpHome, '.claude', 'adapters.json'), '{}\n')

    expect(getExistingAdapterConfigPath('adapters.json')).toBe(
      join(tmpHome, '.claude', 'adapters.json'),
    )
    expect(getAdapterConfigPath('adapters.json')).toBe(
      join(tmpHome, '.cyber', 'adapters.json'),
    )
  })

  test('prefers ~/.cyber adapter config when both files exist', async () => {
    await mkdir(join(tmpHome, '.cyber'), { recursive: true })
    await mkdir(join(tmpHome, '.claude'), { recursive: true })
    await writeFile(join(tmpHome, '.cyber', 'adapters.json'), '{}\n')
    await writeFile(join(tmpHome, '.claude', 'adapters.json'), '{}\n')

    expect(getExistingAdapterConfigPath('adapters.json')).toBe(
      join(tmpHome, '.cyber', 'adapters.json'),
    )
  })
})
