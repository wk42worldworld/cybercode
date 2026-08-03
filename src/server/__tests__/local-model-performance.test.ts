import { describe, expect, test } from 'bun:test'
import {
  optimizeAnthropicRequestForLocalModel,
  prepareAnthropicRequestForProvider,
} from '../proxy/localModelPerformance.js'
import type { AnthropicRequest } from '../proxy/transform/types.js'

function request(): AnthropicRequest {
  return {
    model: 'qwen3.6',
    max_tokens: 1024,
    stream: true,
    system: [
      {
        type: 'text',
        text: '# System\nAll text you output outside of tool use is displayed to the user.\n' +
          'Verbose rules. '.repeat(100),
      },
      { type: 'text', text: '# Memory\nKeep the project convention.' },
    ],
    messages: [{ role: 'user', content: 'Fix the test.' }],
    tools: [{
      name: 'Read',
      description: `Read files. ${'Example. '.repeat(100)}`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute path. '.repeat(30),
          },
        },
        required: ['path'],
      },
    }],
  }
}

describe('local provider request preparation', () => {
  test('returns the original cloud request without any mutation', () => {
    const body = request()
    const prepared = prepareAnthropicRequestForProvider({
      presetId: 'custom',
      baseUrl: 'https://api.example.com/v1',
    }, body)

    expect(prepared.localModelPerformance).toBe(false)
    expect(prepared.body).toBe(body)
    expect(prepared.body.tools?.[0]?.description).toBe(body.tools?.[0]?.description)
  })

  test('does not classify a cloud preset behind a loopback proxy as local', () => {
    const body = request()
    const prepared = prepareAnthropicRequestForProvider({
      presetId: 'openai',
      baseUrl: 'http://127.0.0.1:8080/v1',
    }, body)

    expect(prepared.localModelPerformance).toBe(false)
    expect(prepared.body).toBe(body)
  })

  test('classifies a custom preset on an RFC1918 LAN host as local', () => {
    const body = request()
    const prepared = prepareAnthropicRequestForProvider({
      presetId: 'custom',
      baseUrl: 'http://192.168.1.20:11434/v1',
    }, body)

    expect(prepared.localModelPerformance).toBe(true)
    expect(prepared.body).not.toBe(body)
  })

  test('compacts local requests while preserving tools, memory, and messages', () => {
    const body = request()
    const prepared = prepareAnthropicRequestForProvider({
      presetId: 'custom',
      baseUrl: 'http://127.0.0.1:8080/v1',
    }, body)

    expect(prepared.localModelPerformance).toBe(true)
    expect(prepared.body).not.toBe(body)
    expect(prepared.body.messages).toBe(body.messages)
    expect(prepared.body.tools?.map((tool) => tool.name)).toEqual(['Read'])
    expect(prepared.body.tools?.[0]?.description.length).toBeLessThanOrEqual(360)
    expect(JSON.stringify(prepared.body.system)).toContain('Keep the project convention')
    expect(JSON.stringify(prepared.body.system)).not.toContain('Verbose rules')
  })

  test('automatically compacts known local runtime presets on non-loopback hosts', () => {
    const body = request()
    const prepared = prepareAnthropicRequestForProvider({
      presetId: 'ollama',
      baseUrl: 'http://192.168.1.20:11434',
    }, body)

    expect(prepared.localModelPerformance).toBe(true)
    expect(prepared.body).not.toBe(body)
  })

  test('is deterministic when a local request is optimized more than once', () => {
    const once = optimizeAnthropicRequestForLocalModel(request())
    const twice = optimizeAnthropicRequestForLocalModel(once)
    expect(twice).toEqual(once)
  })
})
