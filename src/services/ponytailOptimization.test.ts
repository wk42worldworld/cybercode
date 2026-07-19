import { afterEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleTokenOptimizationApi } from '../server/api/token-optimization.js'
import { _resetConfigHomeDirForTesting } from '../utils/envUtils.js'
import {
  PonytailOptimizationService,
  ponytailOptimizationService,
} from './ponytailOptimization.js'

const originalConfigDir = process.env.CYBER_CONFIG_DIR
const testRoots: string[] = []

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
  else process.env.CYBER_CONFIG_DIR = originalConfigDir
  _resetConfigHomeDirForTesting()
  ponytailOptimizationService.resetForTesting()
  for (const root of testRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('Ponytail token optimization', () => {
  test('persists a global opt-in and keeps the prompt disabled by default', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-ponytail-test-'))
    testRoots.push(root)
    process.env.CYBER_CONFIG_DIR = root
    _resetConfigHomeDirForTesting()

    const service = new PonytailOptimizationService()
    expect(service.getStatus()).toEqual({ enabled: false, mode: 'full' })
    expect(service.getSystemPrompt()).toBeNull()

    const writer = new PonytailOptimizationService()
    expect(writer.setEnabled(true)).toEqual({ enabled: true, mode: 'full' })
    expect(service.getStatus().enabled).toBe(true)
    expect(service.getSystemPrompt()).toContain('# Ponytail')
    expect(service.getSystemPrompt()).toContain('smallest complete change')
    expect(service.getSystemPrompt()).toContain('Reuse existing helpers')
    expect(service.getSystemPrompt()).toContain('validation, security')
    expect(service.getSystemPrompt()!.length).toBeLessThan(600)
    expect(service.getSystemPrompt()).not.toContain('Be concise and direct')
    expect(service.getSystemPrompt()).not.toContain('Lazy Programmer')

    writer.setEnabled(false)
    expect(service.getStatus().enabled).toBe(false)
    expect(service.getSystemPrompt()).toBeNull()
  })

  test('falls back to disabled when the persisted config is invalid', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-ponytail-invalid-test-'))
    testRoots.push(root)
    process.env.CYBER_CONFIG_DIR = root
    _resetConfigHomeDirForTesting()

    const configPath = path.join(root, 'cybercode', 'ponytail.json')
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, '{invalid json')

    const service = new PonytailOptimizationService()
    expect(service.getStatus()).toEqual({ enabled: false, mode: 'full' })
    expect(service.getSystemPrompt()).toBeNull()
  })

  test('serves the global switch through the token optimization API', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-ponytail-api-test-'))
    testRoots.push(root)
    process.env.CYBER_CONFIG_DIR = root
    _resetConfigHomeDirForTesting()
    ponytailOptimizationService.resetForTesting()

    const enableUrl = new URL('http://localhost/api/token-optimization/ponytail/enable')
    const enableResponse = await handleTokenOptimizationApi(
      new Request(enableUrl, { method: 'POST' }),
      enableUrl,
      ['api', 'token-optimization', 'ponytail', 'enable'],
    )
    expect(enableResponse.status).toBe(200)
    expect(await enableResponse.json()).toEqual({ enabled: true, mode: 'full' })

    const statusUrl = new URL('http://localhost/api/token-optimization/ponytail')
    const statusResponse = await handleTokenOptimizationApi(
      new Request(statusUrl),
      statusUrl,
      ['api', 'token-optimization', 'ponytail'],
    )
    expect(statusResponse.status).toBe(200)
    expect(await statusResponse.json()).toEqual({ enabled: true, mode: 'full' })

    const disableUrl = new URL('http://localhost/api/token-optimization/ponytail/disable')
    const disableResponse = await handleTokenOptimizationApi(
      new Request(disableUrl, { method: 'POST' }),
      disableUrl,
      ['api', 'token-optimization', 'ponytail', 'disable'],
    )
    expect(disableResponse.status).toBe(200)
    expect(await disableResponse.json()).toEqual({ enabled: false, mode: 'full' })
  })
})
