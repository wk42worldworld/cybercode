import { afterEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildRtkCommand,
  buildTestRunnerFallback,
  RtkOptimizationService,
  rtkOptimizationService,
} from './rtkOptimization.js'
import { _resetConfigHomeDirForTesting } from '../utils/envUtils.js'
import { handleTokenOptimizationApi } from '../server/api/token-optimization.js'

const originalConfigDir = process.env.CYBER_CONFIG_DIR
const originalRtkPath = process.env.CYBER_RTK_PATH
const testRoots: string[] = []

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
  else process.env.CYBER_CONFIG_DIR = originalConfigDir
  if (originalRtkPath === undefined) delete process.env.CYBER_RTK_PATH
  else process.env.CYBER_RTK_PATH = originalRtkPath
  _resetConfigHomeDirForTesting()
  rtkOptimizationService.resetForTesting()
  for (const root of testRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('RTK token optimization', () => {
  test('persists a global opt-in and defaults to disabled', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-rtk-test-'))
    testRoots.push(root)
    process.env.CYBER_CONFIG_DIR = root
    process.env.CYBER_RTK_PATH = path.join(root, 'missing-rtk')
    _resetConfigHomeDirForTesting()

    const service = new RtkOptimizationService()
    expect(service.isEnabled()).toBe(false)

    const writer = new RtkOptimizationService()
    const status = await writer.setEnabled(true)
    expect(status.enabled).toBe(true)

    expect(service.isEnabled()).toBe(true)

    await writer.setEnabled(false)
    expect(service.isEnabled()).toBe(false)
    expect(await service.rewriteCommand('git status', 'bash')).toBe('git status')
  })

  test('builds shell-specific commands without changing unsupported rewrites', () => {
    expect(buildRtkCommand('rtk git status', "/Applications/Cyber Code/rtk", 'bash'))
      .toBe("'/Applications/Cyber Code/rtk' git status")
    expect(buildRtkCommand('rtk git status', "C:\\Program Files\\CyberCode\\rtk.exe", 'powershell'))
      .toBe("& 'C:\\Program Files\\CyberCode\\rtk.exe' git status")
    expect(buildRtkCommand('rtk git status && rtk ls -la', '/tmp/rtk', 'bash'))
      .toBe("'/tmp/rtk' git status && '/tmp/rtk' ls -la")
    expect(buildRtkCommand('cd desktop && rtk git status', '/tmp/rtk', 'bash'))
      .toBe("cd desktop && '/tmp/rtk' git status")
    expect(buildRtkCommand('echo rtk && rtk git status', '/tmp/rtk', 'bash'))
      .toBe("echo rtk && '/tmp/rtk' git status")
    expect(buildRtkCommand('git status', '/tmp/rtk', 'bash')).toBeNull()
  })

  test('fills the upstream rewrite gap for common package-manager test commands', () => {
    expect(buildTestRunnerFallback('bun test src/example.test.ts'))
      .toBe('rtk test bun test src/example.test.ts')
    expect(buildTestRunnerFallback('npm run test -- --watch=false'))
      .toBe('rtk test npm run test -- --watch=false')
    expect(buildTestRunnerFallback('pnpm test'))
      .toBe('rtk test pnpm test')
    expect(buildTestRunnerFallback('yarn test unit'))
      .toBe('rtk test yarn test unit')
    expect(buildTestRunnerFallback('bun run build')).toBe('')
    expect(buildTestRunnerFallback('echo bun test')).toBe('')
  })

  test('serves the global switch through the token optimization API', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-rtk-api-test-'))
    testRoots.push(root)
    process.env.CYBER_CONFIG_DIR = root
    _resetConfigHomeDirForTesting()
    rtkOptimizationService.resetForTesting()

    const enableUrl = new URL('http://localhost/api/token-optimization/rtk/enable')
    const enableResponse = await handleTokenOptimizationApi(
      new Request(enableUrl, { method: 'POST' }),
      enableUrl,
      ['api', 'token-optimization', 'rtk', 'enable'],
    )
    expect(enableResponse.status).toBe(200)
    expect((await enableResponse.json()).enabled).toBe(true)

    const statusUrl = new URL('http://localhost/api/token-optimization/rtk')
    const statusResponse = await handleTokenOptimizationApi(
      new Request(statusUrl),
      statusUrl,
      ['api', 'token-optimization', 'rtk'],
    )
    expect(statusResponse.status).toBe(200)
    expect((await statusResponse.json()).enabled).toBe(true)

    const disableUrl = new URL('http://localhost/api/token-optimization/rtk/disable')
    const disableResponse = await handleTokenOptimizationApi(
      new Request(disableUrl, { method: 'POST' }),
      disableUrl,
      ['api', 'token-optimization', 'rtk', 'disable'],
    )
    expect(disableResponse.status).toBe(200)
    expect((await disableResponse.json()).enabled).toBe(false)
    expect(await rtkOptimizationService.rewriteCommand('git status', 'powershell'))
      .toBe('git status')
  })
})
