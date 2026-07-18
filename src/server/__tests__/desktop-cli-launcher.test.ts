import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { ensureDesktopCliLauncherInstalled } from '../services/desktopCliLauncherService.js'

const isWindows = process.platform === 'win32'
const unixOnly = isWindows ? it.skip : it

const ORIGINAL_HOME = process.env.HOME
const ORIGINAL_USERPROFILE = process.env.USERPROFILE
const ORIGINAL_SHELL = process.env.SHELL
const ORIGINAL_PATH = process.env.PATH
const ORIGINAL_CLAUDE_CLI_PATH = process.env.CLAUDE_CLI_PATH

describe('ensureDesktopCliLauncherInstalled', () => {
  let tempHome = ''
  let tempSourceDir = ''

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'desktop-cli-home-'))
    tempSourceDir = await mkdtemp(join(tmpdir(), 'desktop-cli-source-'))
    process.env.HOME = tempHome
    process.env.USERPROFILE = tempHome
    process.env.SHELL = '/bin/zsh'
    process.env.PATH = ''
  })

  afterEach(async () => {
    if (ORIGINAL_HOME === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = ORIGINAL_HOME
    }

    if (ORIGINAL_USERPROFILE === undefined) {
      delete process.env.USERPROFILE
    } else {
      process.env.USERPROFILE = ORIGINAL_USERPROFILE
    }

    if (ORIGINAL_SHELL === undefined) {
      delete process.env.SHELL
    } else {
      process.env.SHELL = ORIGINAL_SHELL
    }

    if (ORIGINAL_PATH === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = ORIGINAL_PATH
    }

    if (ORIGINAL_CLAUDE_CLI_PATH === undefined) {
      delete process.env.CLAUDE_CLI_PATH
    } else {
      process.env.CLAUDE_CLI_PATH = ORIGINAL_CLAUDE_CLI_PATH
    }

    await rm(tempHome, { recursive: true, force: true })
    await rm(tempSourceDir, { recursive: true, force: true })
  })

  unixOnly('copies the bundled sidecar into the user bin dir and configures PATH', async () => {
    const sourcePath = join(tempSourceDir, 'cybercode-sidecar')
    await writeFile(sourcePath, '#!/bin/sh\necho desktop-sidecar\n', 'utf8')
    await chmod(sourcePath, 0o755)
    process.env.CLAUDE_CLI_PATH = sourcePath

    const status = await ensureDesktopCliLauncherInstalled()
    const launcherPath = join(tempHome, '.local', 'bin', 'cybercode')
    const shellConfigPath = join(tempHome, '.zshrc')

    expect(status.supported).toBe(true)
    expect(status.installed).toBe(true)
    expect(status.command).toBe('cybercode')
    expect(status.launcherPath).toBe(launcherPath)
    expect(status.availableInNewTerminals).toBe(true)
    expect(status.needsTerminalRestart).toBe(true)
    expect(status.configTarget).toBe(shellConfigPath)

    expect(await readFile(launcherPath, 'utf8')).toContain('desktop-sidecar')
    expect(await readFile(shellConfigPath, 'utf8')).toContain(
      'export PATH="$HOME/.local/bin:$PATH"',
    )
  })

  it('reports unsupported status when the current launcher is not a bundled sidecar', async () => {
    const sourcePath = join(tempSourceDir, 'claude')
    await writeFile(sourcePath, '#!/bin/sh\necho plain-cli\n', 'utf8')
    process.env.CLAUDE_CLI_PATH = sourcePath

    const status = await ensureDesktopCliLauncherInstalled()

    expect(status.supported).toBe(false)
    expect(status.installed).toBe(false)
    expect(status.command).toBe('cybercode')
  })
})
