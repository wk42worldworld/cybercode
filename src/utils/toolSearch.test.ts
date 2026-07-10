import { afterEach, describe, expect, test } from 'bun:test'
import type { Tools } from '../Tool.js'
import type { UserMessage } from '../types/message.js'
import { stripToolReferenceBlocksFromUserMessage } from './messages.js'
import {
  isToolSearchEnabled,
  isToolSearchEnabledOptimistic,
} from './toolSearch.js'

const ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ENABLE_TOOL_SEARCH',
  'CYBERCODE_ENABLE_TOOL_REFERENCE',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
] as const

const originalEnv = Object.fromEntries(
  ENV_KEYS.map(key => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>

function restoreEnvironment(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function useCustomAnthropicGateway(): void {
  delete process.env.ENABLE_TOOL_SEARCH
  delete process.env.CYBERCODE_ENABLE_TOOL_REFERENCE
  delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com/anthropic'
}

const toolSearchOnly = [{ name: 'ToolSearch' }] as unknown as Tools
const getToolPermissionContext = async () =>
  ({}) as Awaited<ReturnType<Parameters<typeof isToolSearchEnabled>[2]>>

afterEach(restoreEnvironment)

describe('third-party tool search compatibility', () => {
  test('disables tool_reference for a custom gateway despite legacy ENABLE_TOOL_SEARCH', async () => {
    useCustomAnthropicGateway()
    process.env.ENABLE_TOOL_SEARCH = 'true'

    expect(isToolSearchEnabledOptimistic()).toBe(false)
    expect(
      await isToolSearchEnabled(
        'glm-5.2',
        toolSearchOnly,
        getToolPermissionContext,
        [],
      ),
    ).toBe(false)
  })

  test('allows an explicit opt-in for a proxy that supports tool_reference', async () => {
    useCustomAnthropicGateway()
    process.env.ENABLE_TOOL_SEARCH = 'true'
    process.env.CYBERCODE_ENABLE_TOOL_REFERENCE = 'true'

    expect(isToolSearchEnabledOptimistic()).toBe(true)
    expect(
      await isToolSearchEnabled(
        'claude-sonnet-4-5',
        toolSearchOnly,
        getToolPermissionContext,
        [],
      ),
    ).toBe(true)
  })

  test('converts saved tool_reference-only results into ordinary text', () => {
    const message = {
      type: 'user',
      uuid: 'tool-result-message',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-use-id',
            content: [{ type: 'tool_reference', tool_name: 'WebSearch' }],
          },
        ],
      },
    } as unknown as UserMessage

    const cleaned = stripToolReferenceBlocksFromUserMessage(message)
    const content = cleaned.message.content

    expect(Array.isArray(content)).toBe(true)
    if (!Array.isArray(content)) return
    const toolResult = content[0]
    expect(toolResult?.type).toBe('tool_result')
    if (toolResult?.type !== 'tool_result') return
    expect(toolResult.content).toEqual([
      {
        type: 'text',
        text: '[Tool references removed - tool search not enabled]',
      },
    ])
  })
})
