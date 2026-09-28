import { afterEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleTokenOptimizationApi } from '../server/api/token-optimization.js'
import { _resetConfigHomeDirForTesting } from '../utils/envUtils.js'
import {
  pruneMessagesForAPI,
  SmartPruningOptimizationService,
  smartPruningOptimizationService,
} from './smartPruningOptimization.js'

const originalConfigDir = process.env.CYBER_CONFIG_DIR
const testRoots: string[] = []

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
  else process.env.CYBER_CONFIG_DIR = originalConfigDir
  _resetConfigHomeDirForTesting()
  smartPruningOptimizationService.resetForTesting()
  for (const root of testRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('Smart pruning token optimization', () => {
  test('is globally disabled by default and restores full context immediately when disabled', () => {
    const root = useTemporaryConfig('cybercode-pruning-toggle-test-')
    const service = new SmartPruningOptimizationService()
    const writer = new SmartPruningOptimizationService()
    const messages = createRepeatedReadConversation()

    expect(service.getStatus()).toEqual({
      enabled: false,
      level: 'balanced',
      mode: 'deterministic',
    })
    expect(service.optimizeMessages(messages).messages).toEqual(messages)

    writer.setEnabled(true)
    const optimized = service.optimizeMessages(messages)
    expect(service.getStatus().enabled).toBe(true)
    expect(getToolResultText(optimized.messages[1]!)).toContain('Smart pruning: omitted older duplicate output')
    expect(optimized.stats.savedCharacters).toBeGreaterThan(0)
    expect(messages).toEqual(createRepeatedReadConversation())

    writer.setEnabled(false)
    expect(service.getStatus().enabled).toBe(false)
    expect(service.optimizeMessages(messages).messages).toEqual(messages)
    expect(fs.existsSync(path.join(root, 'cybercode', 'smart-pruning.json'))).toBe(true)
  })

  test('applies visibly different conservative, balanced, and aggressive limits', () => {
    const longOutput = '0123456789'.repeat(2_000)
    const messages = createOldToolResultConversation(longOutput)

    const conservative = pruneMessagesForAPI(messages, 'conservative')
    const balanced = pruneMessagesForAPI(messages, 'balanced')
    const aggressive = pruneMessagesForAPI(messages, 'aggressive')

    expect(getToolResultText(conservative.messages[1]!)).toBe(longOutput)
    expect(getToolResultText(balanced.messages[1]!).length).toBeLessThan(longOutput.length)
    expect(getToolResultText(aggressive.messages[1]!).length)
      .toBeLessThan(getToolResultText(balanced.messages[1]!).length)
    expect(balanced.stats.truncatedResults).toBe(1)
    expect(aggressive.stats.truncatedResults).toBe(1)
  })

  test('preserves recent results, errors, user text, and non-text tool content', () => {
    const longOutput = 'result '.repeat(2_000)
    const messages = createOldToolResultConversation(longOutput)
    messages[1]!.message.content = [{
      type: 'tool_result',
      tool_use_id: 'old-tool',
      is_error: true,
      content: longOutput,
    }]
    messages.push({
      type: 'user',
      message: { content: 'Keep this exact user instruction.' },
    })
    messages.push({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'media-tool', name: 'Read', input: { file_path: 'image.png' } }] },
    })
    messages.push({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'media-tool',
          content: [{ type: 'image', source: { type: 'base64', data: 'abc' } }],
        }],
      },
    })

    const optimized = pruneMessagesForAPI(messages, 'aggressive')
    expect(getToolResultText(optimized.messages[1]!)).toBe(longOutput)
    expect(optimized.messages.at(-3)?.message.content).toBe('Keep this exact user instruction.')
    expect(optimized.messages.at(-1)).toEqual(messages.at(-1))
  })

  test('serves enable, disable, and pruning strength through the global API', async () => {
    useTemporaryConfig('cybercode-pruning-api-test-')
    smartPruningOptimizationService.resetForTesting()

    const levelUrl = new URL('http://localhost/api/token-optimization/pruning/level')
    const levelResponse = await handleTokenOptimizationApi(
      new Request(levelUrl, {
        method: 'POST',
        body: JSON.stringify({ level: 'aggressive' }),
      }),
      levelUrl,
      ['api', 'token-optimization', 'pruning', 'level'],
    )
    expect(levelResponse.status).toBe(200)
    expect(await levelResponse.json()).toEqual({
      enabled: false,
      level: 'aggressive',
      mode: 'deterministic',
    })

    const enableUrl = new URL('http://localhost/api/token-optimization/pruning/enable')
    const enableResponse = await handleTokenOptimizationApi(
      new Request(enableUrl, { method: 'POST' }),
      enableUrl,
      ['api', 'token-optimization', 'pruning', 'enable'],
    )
    expect(await enableResponse.json()).toEqual({
      enabled: true,
      level: 'aggressive',
      mode: 'deterministic',
    })

    const disableUrl = new URL('http://localhost/api/token-optimization/pruning/disable')
    const disableResponse = await handleTokenOptimizationApi(
      new Request(disableUrl, { method: 'POST' }),
      disableUrl,
      ['api', 'token-optimization', 'pruning', 'disable'],
    )
    expect(await disableResponse.json()).toEqual({
      enabled: false,
      level: 'aggressive',
      mode: 'deterministic',
    })

    const invalidResponse = await handleTokenOptimizationApi(
      new Request(levelUrl, {
        method: 'POST',
        body: JSON.stringify({ level: 'maximum' }),
      }),
      levelUrl,
      ['api', 'token-optimization', 'pruning', 'level'],
    )
    expect(invalidResponse.status).toBe(400)
  })
})

type TestMessage = {
  type: string
  message: { content: unknown }
}

function useTemporaryConfig(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  testRoots.push(root)
  process.env.CYBER_CONFIG_DIR = root
  _resetConfigHomeDirForTesting()
  return root
}

function createRepeatedReadConversation(): TestMessage[] {
  const output = 'export const answer = 42\n'.repeat(40)
  const messages: TestMessage[] = [
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'old-read', name: 'Read', input: { file_path: 'src/app.ts' } }] },
    },
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'old-read', content: output }] },
    },
  ]
  for (let index = 0; index < 15; index++) {
    messages.push({ type: 'user', message: { content: `User instruction ${index}` } })
  }
  messages.push({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'new-read', name: 'Read', input: { file_path: 'src/app.ts' } }] },
  })
  messages.push({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'new-read', content: output }] },
  })
  return messages
}

function createOldToolResultConversation(output: string): TestMessage[] {
  const messages: TestMessage[] = [
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'old-tool', name: 'Bash', input: { command: 'build' } }] },
    },
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'old-tool', content: output }] },
    },
  ]
  for (let index = 0; index < 24; index++) {
    messages.push({ type: index % 2 === 0 ? 'assistant' : 'user', message: { content: `Message ${index}` } })
  }
  return messages
}

function getToolResultText(message: TestMessage) {
  const content = message.message.content as Array<{ content: string }>
  return content[0]!.content
}
