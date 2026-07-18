import { afterEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleTokenOptimizationApi } from '../server/api/token-optimization.js'
import { _resetConfigHomeDirForTesting } from '../utils/envUtils.js'
import {
  cleanSystemPromptParts,
  LiteOptimizationService,
  liteOptimizationService,
} from './liteOptimization.js'

const originalConfigDir = process.env.CYBER_CONFIG_DIR
const testRoots: string[] = []

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
  else process.env.CYBER_CONFIG_DIR = originalConfigDir
  _resetConfigHomeDirForTesting()
  liteOptimizationService.resetForTesting()
  for (const root of testRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('Lite deterministic token optimization', () => {
  test('removes trailing whitespace, collapses blank lines, and deduplicates prompt parts', () => {
    expect(cleanSystemPromptParts([
      'Rules  \n\n\nKeep this.\t',
      'Rules\n\nKeep this.',
      'Another rule.   ',
    ])).toEqual([
      'Rules\n\nKeep this.',
      'Another rule.',
    ])
  })

  test('preserves whitespace and blank lines inside fenced code', () => {
    const prompt = 'Example  \n\n\n```py\nx = 1  \n\n\nprint(x)\n```\n\n\nDone  '
    expect(cleanSystemPromptParts([prompt])).toEqual([
      'Example\n\n```py\nx = 1  \n\n\nprint(x)\n```\n\nDone',
    ])
  })

  test('persists the global switch and only cleans when enabled', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-lite-test-'))
    testRoots.push(root)
    process.env.CYBER_CONFIG_DIR = root
    _resetConfigHomeDirForTesting()

    const service = new LiteOptimizationService()
    expect(service.getStatus()).toEqual({ enabled: false, mode: 'deterministic' })
    expect(service.cleanSystemPrompt(['Rule  \n\n\nNext'])).toEqual(['Rule  \n\n\nNext'])

    const writer = new LiteOptimizationService()
    writer.setEnabled(true)
    expect(service.getStatus().enabled).toBe(true)
    expect(service.cleanSystemPrompt(['Rule  \n\n\nNext'])).toEqual(['Rule\n\nNext'])
  })

  test('serves the global switch through the token optimization API', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-lite-api-test-'))
    testRoots.push(root)
    process.env.CYBER_CONFIG_DIR = root
    _resetConfigHomeDirForTesting()
    liteOptimizationService.resetForTesting()

    const enableUrl = new URL('http://localhost/api/token-optimization/lite/enable')
    const enableResponse = await handleTokenOptimizationApi(
      new Request(enableUrl, { method: 'POST' }),
      enableUrl,
      ['api', 'token-optimization', 'lite', 'enable'],
    )
    expect(await enableResponse.json()).toEqual({ enabled: true, mode: 'deterministic' })

    const statusUrl = new URL('http://localhost/api/token-optimization/lite')
    const statusResponse = await handleTokenOptimizationApi(
      new Request(statusUrl),
      statusUrl,
      ['api', 'token-optimization', 'lite'],
    )
    expect(await statusResponse.json()).toEqual({ enabled: true, mode: 'deterministic' })

    const disableUrl = new URL('http://localhost/api/token-optimization/lite/disable')
    const disableResponse = await handleTokenOptimizationApi(
      new Request(disableUrl, { method: 'POST' }),
      disableUrl,
      ['api', 'token-optimization', 'lite', 'disable'],
    )
    expect(await disableResponse.json()).toEqual({ enabled: false, mode: 'deterministic' })
    expect(liteOptimizationService.cleanSystemPrompt(['Rule  \n\n\nNext']))
      .toEqual(['Rule  \n\n\nNext'])
  })
})
