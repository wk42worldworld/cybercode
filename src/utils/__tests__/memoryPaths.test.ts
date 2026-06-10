import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { mkdir, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getExistingMemoryPath,
  getLegacyMemoryPath,
  getLegacyMemoryPathForPreferredPath,
  getMemoryPath,
} from '../config.js'
import { clearMemoryFileCaches, getMemoryFiles } from '../claudemd.js'
import {
  _resetConfigHomeDirForTesting,
  _setConfigHomeDirHomeForTesting,
} from '../envUtils.js'
import { getOriginalCwd, setOriginalCwd } from '../../bootstrap/state.js'
import { updateSettingsForSource } from '../settings/settings.js'

describe('Cyber instruction memory paths', () => {
  let tmpRoot: string
  let tmpHome: string
  let tmpProject: string
  let originalCwd: string
  let originalHome: string | undefined
  let originalUserProfile: string | undefined
  let originalCyberConfigDir: string | undefined
  let originalClaudeConfigDir: string | undefined

  beforeEach(async () => {
    tmpRoot = join(tmpdir(), `cyber-memory-paths-${randomUUID()}`)
    tmpHome = join(tmpRoot, 'home')
    tmpProject = join(tmpRoot, 'project')
    await mkdir(tmpHome, { recursive: true })
    await mkdir(tmpProject, { recursive: true })

    originalCwd = getOriginalCwd()
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    originalCyberConfigDir = process.env.CYBER_CONFIG_DIR
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR

    process.env.HOME = tmpHome
    process.env.USERPROFILE = tmpHome
    delete process.env.CYBER_CONFIG_DIR
    delete process.env.CLAUDE_CONFIG_DIR

    _setConfigHomeDirHomeForTesting(tmpHome)
    setOriginalCwd(tmpProject)
    clearMemoryFileCaches()
  })

  afterEach(async () => {
    clearMemoryFileCaches()
    setOriginalCwd(originalCwd)

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

  test('defaults instruction files to CYBER names', () => {
    expect(getMemoryPath('User')).toBe(join(tmpHome, '.cyber', 'CYBER.md'))
    expect(getMemoryPath('Project')).toBe(join(tmpProject, 'CYBER.md'))
    expect(getMemoryPath('Local')).toBe(join(tmpProject, 'CYBER.local.md'))
  })

  test('keeps legacy CLAUDE path helpers for migration and fallback', () => {
    expect(getLegacyMemoryPath('User')).toBe(
      join(tmpHome, '.cyber', 'CLAUDE.md'),
    )
    expect(getLegacyMemoryPath('Project')).toBe(join(tmpProject, 'CLAUDE.md'))
    expect(getLegacyMemoryPath('Local')).toBe(
      join(tmpProject, 'CLAUDE.local.md'),
    )
  })

  test('falls back to legacy files when CYBER files are absent', async () => {
    await mkdir(join(tmpHome, '.cyber'), { recursive: true })
    await writeFile(join(tmpHome, '.cyber', 'CLAUDE.md'), 'legacy user')
    await writeFile(join(tmpProject, 'CLAUDE.md'), 'legacy project')
    await writeFile(join(tmpProject, 'CLAUDE.local.md'), 'legacy local')

    expect(getExistingMemoryPath('User')).toBe(
      join(tmpHome, '.cyber', 'CLAUDE.md'),
    )
    expect(getExistingMemoryPath('Project')).toBe(
      join(tmpProject, 'CLAUDE.md'),
    )
    expect(getExistingMemoryPath('Local')).toBe(
      join(tmpProject, 'CLAUDE.local.md'),
    )
  })

  test('falls back to the old ~/.claude user memory if ~/.cyber already exists', async () => {
    await mkdir(join(tmpHome, '.cyber'), { recursive: true })
    await mkdir(join(tmpHome, '.claude'), { recursive: true })
    await writeFile(join(tmpHome, '.claude', 'CLAUDE.md'), 'old home memory')

    expect(getExistingMemoryPath('User')).toBe(
      join(tmpHome, '.claude', 'CLAUDE.md'),
    )
    expect(getLegacyMemoryPathForPreferredPath(getMemoryPath('User'))).toBe(
      join(tmpHome, '.claude', 'CLAUDE.md'),
    )
  })

  test('prefers CYBER files when both CYBER and legacy files exist', async () => {
    await mkdir(join(tmpHome, '.cyber'), { recursive: true })
    await writeFile(join(tmpHome, '.cyber', 'CYBER.md'), 'new user')
    await writeFile(join(tmpHome, '.cyber', 'CLAUDE.md'), 'legacy user')
    await writeFile(join(tmpProject, 'CYBER.md'), 'new project')
    await writeFile(join(tmpProject, 'CLAUDE.md'), 'legacy project')
    await writeFile(join(tmpProject, 'CYBER.local.md'), 'new local')
    await writeFile(join(tmpProject, 'CLAUDE.local.md'), 'legacy local')

    expect(getExistingMemoryPath('User')).toBe(
      join(tmpHome, '.cyber', 'CYBER.md'),
    )
    expect(getExistingMemoryPath('Project')).toBe(join(tmpProject, 'CYBER.md'))
    expect(getExistingMemoryPath('Local')).toBe(
      join(tmpProject, 'CYBER.local.md'),
    )
  })

  test('maps preferred CYBER paths back to legacy paths for one-time migration', () => {
    expect(getLegacyMemoryPathForPreferredPath(getMemoryPath('User'))).toBe(
      join(tmpHome, '.cyber', 'CLAUDE.md'),
    )
    expect(getLegacyMemoryPathForPreferredPath(getMemoryPath('Project'))).toBe(
      join(tmpProject, 'CLAUDE.md'),
    )
    expect(getLegacyMemoryPathForPreferredPath(getMemoryPath('Local'))).toBe(
      join(tmpProject, 'CLAUDE.local.md'),
    )
  })

  test('loads legacy project and local files when CYBER files are absent', async () => {
    await writeFile(join(tmpProject, 'CLAUDE.md'), 'legacy project')
    await writeFile(join(tmpProject, 'CLAUDE.local.md'), 'legacy local')
    clearMemoryFileCaches()

    const files = await getMemoryFiles()

    expect(files.map(file => file.path)).toContain(
      join(tmpProject, 'CLAUDE.md'),
    )
    expect(files.map(file => file.path)).toContain(
      join(tmpProject, 'CLAUDE.local.md'),
    )
  })

  test('loads CYBER files instead of same-layer legacy files when both exist', async () => {
    await writeFile(join(tmpProject, 'CYBER.md'), 'new project')
    await writeFile(join(tmpProject, 'CLAUDE.md'), 'legacy project')
    await writeFile(join(tmpProject, 'CYBER.local.md'), 'new local')
    await writeFile(join(tmpProject, 'CLAUDE.local.md'), 'legacy local')
    clearMemoryFileCaches()

    const files = await getMemoryFiles()
    const paths = files.map(file => file.path)

    expect(paths).toContain(join(tmpProject, 'CYBER.md'))
    expect(paths).toContain(join(tmpProject, 'CYBER.local.md'))
    expect(paths).not.toContain(join(tmpProject, 'CLAUDE.md'))
    expect(paths).not.toContain(join(tmpProject, 'CLAUDE.local.md'))
  })

  test('loads old ~/.claude user rules when ~/.cyber/rules is absent', async () => {
    await mkdir(join(tmpHome, '.cyber'), { recursive: true })
    await mkdir(join(tmpHome, '.claude', 'rules'), { recursive: true })
    await writeFile(join(tmpHome, '.claude', 'rules', 'legacy.md'), 'legacy rule')
    clearMemoryFileCaches()

    const files = await getMemoryFiles()
    const legacyRulePath = await realpath(
      join(tmpHome, '.claude', 'rules', 'legacy.md'),
    )

    expect(files.map(file => file.path)).toContain(legacyRulePath)
  })

  test('prefers ~/.cyber user rules when both new and old rules dirs exist', async () => {
    await mkdir(join(tmpHome, '.cyber', 'rules'), { recursive: true })
    await mkdir(join(tmpHome, '.claude', 'rules'), { recursive: true })
    await writeFile(join(tmpHome, '.cyber', 'rules', 'new.md'), 'new rule')
    await writeFile(join(tmpHome, '.claude', 'rules', 'legacy.md'), 'legacy rule')
    clearMemoryFileCaches()

    const paths = (await getMemoryFiles()).map(file => file.path)
    const newRulePath = await realpath(
      join(tmpHome, '.cyber', 'rules', 'new.md'),
    )
    const legacyRulePath = await realpath(
      join(tmpHome, '.claude', 'rules', 'legacy.md'),
    )

    expect(paths).toContain(newRulePath)
    expect(paths).not.toContain(legacyRulePath)
  })

  test('keeps legacy CLAUDE exclude patterns effective for CYBER files', async () => {
    await writeFile(join(tmpProject, 'CYBER.md'), 'excluded project memory')
    updateSettingsForSource('userSettings', {
      claudeMdExcludes: ['**/CLAUDE.md'],
    })
    clearMemoryFileCaches()

    const paths = (await getMemoryFiles()).map(file => file.path)

    expect(paths).not.toContain(join(tmpProject, 'CYBER.md'))
  })
})
