import './preload.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const configuredTestDir = process.env.CYBERCODE_TEST_CONFIG_DIR?.trim()
const testConfigDir = configuredTestDir || mkdtempSync(join(tmpdir(), 'cybercode-test-config-'))

delete process.env.CYBER_CONFIG_DIR
process.env.CLAUDE_CONFIG_DIR = testConfigDir

if (!configuredTestDir) {
  process.once('exit', () => {
    rmSync(testConfigDir, { recursive: true, force: true })
  })
}
