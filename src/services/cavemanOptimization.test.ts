import { afterEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  CavemanOptimizationService,
  cavemanOptimizationService,
} from './cavemanOptimization.js'
import { handleTokenOptimizationApi } from '../server/api/token-optimization.js'
import { _resetConfigHomeDirForTesting } from '../utils/envUtils.js'

const originalConfigDir = process.env.CYBER_CONFIG_DIR
const testRoots: string[] = []

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
  else process.env.CYBER_CONFIG_DIR = originalConfigDir
  _resetConfigHomeDirForTesting()
  cavemanOptimizationService.resetForTesting()
  for (const root of testRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('Caveman token optimization', () => {
  test('persists a global opt-in and keeps the prompt disabled by default', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-caveman-test-'))
    testRoots.push(root)
    process.env.CYBER_CONFIG_DIR = root
    _resetConfigHomeDirForTesting()

    const service = new CavemanOptimizationService()
    expect(service.getStatus()).toEqual({ enabled: false, mode: 'full' })
    expect(service.getSystemPrompt()).toBeNull()

    const writer = new CavemanOptimizationService()
    expect(writer.setEnabled(true).enabled).toBe(true)
    expect(service.getStatus().enabled).toBe(true)
    expect(service.getSystemPrompt()).toContain('Be concise and direct')
    expect(service.getSystemPrompt()).toContain('irreversible actions')
    expect(service.getSystemPrompt()!.length).toBeLessThan(400)

    writer.setEnabled(false)
    expect(service.getStatus().enabled).toBe(false)
    expect(service.getSystemPrompt()).toBeNull()
  })

  test('falls back to disabled when the persisted config is invalid', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-caveman-invalid-test-'))
    testRoots.push(root)
    process.env.CYBER_CONFIG_DIR = root
    _resetConfigHomeDirForTesting()

    const configPath = path.join(root, 'cybercode', 'caveman.json')
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, '{invalid json')

    const service = new CavemanOptimizationService()
    expect(service.getStatus()).toEqual({ enabled: false, mode: 'full' })
    expect(service.getSystemPrompt()).toBeNull()
  })

  test('serves the global switch through the token optimization API', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-caveman-api-test-'))
    testRoots.push(root)
    process.env.CYBER_CONFIG_DIR = root
    _resetConfigHomeDirForTesting()
    cavemanOptimizationService.resetForTesting()

    const enableUrl = new URL('http://localhost/api/token-optimization/caveman/enable')
    const enableResponse = await handleTokenOptimizationApi(
      new Request(enableUrl, { method: 'POST' }),
      enableUrl,
      ['api', 'token-optimization', 'caveman', 'enable'],
    )
    expect(enableResponse.status).toBe(200)
    expect(await enableResponse.json()).toEqual({ enabled: true, mode: 'full' })

    const statusUrl = new URL('http://localhost/api/token-optimization/caveman')
    const statusResponse = await handleTokenOptimizationApi(
      new Request(statusUrl),
      statusUrl,
      ['api', 'token-optimization', 'caveman'],
    )
    expect(statusResponse.status).toBe(200)
    expect(await statusResponse.json()).toEqual({ enabled: true, mode: 'full' })

    const disableUrl = new URL('http://localhost/api/token-optimization/caveman/disable')
    const disableResponse = await handleTokenOptimizationApi(
      new Request(disableUrl, { method: 'POST' }),
      disableUrl,
      ['api', 'token-optimization', 'caveman', 'disable'],
    )
    expect(disableResponse.status).toBe(200)
    expect(await disableResponse.json()).toEqual({ enabled: false, mode: 'full' })
  })
})
