import { describe, expect, test } from 'bun:test'
import {
  CYBERCODE_LOCAL_MODEL_PERFORMANCE_ENV,
  LOCAL_MODEL_CORE_PROMPT,
  compactLocalSystemPromptParts,
  compactLocalToolSchemas,
  isLocalInferenceBaseUrl,
  isLocalInferenceProvider,
  shouldUseLocalModelPerformanceProfile,
} from './localModelPerformance.js'

describe('local model performance profile', () => {
  test('recognizes known local presets and explicitly custom loopback providers', () => {
    expect(isLocalInferenceBaseUrl('http://localhost:11434')).toBe(true)
    expect(isLocalInferenceBaseUrl('http://127.0.0.1:8080/v1')).toBe(true)
    expect(isLocalInferenceBaseUrl('http://[::1]:1234/v1')).toBe(true)
    expect(isLocalInferenceBaseUrl('http://host.docker.internal:8080')).toBe(true)
    expect(isLocalInferenceBaseUrl('https://api.openai.com/v1')).toBe(false)
    // RFC1918 LAN addresses count as local (self-hosted inference on another
    // machine, e.g. ollama at 192.168.x.x).
    expect(isLocalInferenceBaseUrl('http://192.168.1.20:8080/v1')).toBe(true)
    expect(isLocalInferenceBaseUrl('http://10.0.0.5:11434')).toBe(true)
    expect(isLocalInferenceBaseUrl('http://172.16.3.9:1234/v1')).toBe(true)
    expect(isLocalInferenceBaseUrl('http://172.15.3.9:1234/v1')).toBe(false)
    expect(isLocalInferenceBaseUrl('http://172.32.3.9:1234/v1')).toBe(false)

    expect(isLocalInferenceProvider({
      presetId: 'ollama',
      baseUrl: 'http://192.168.1.20:11434',
    })).toBe(true)
    expect(isLocalInferenceProvider({
      presetId: 'lmstudio',
      baseUrl: 'http://192.168.1.20:1234/v1',
    })).toBe(true)
    expect(isLocalInferenceProvider({
      presetId: 'llama.cpp',
      baseUrl: 'http://192.168.1.20:8080/v1',
    })).toBe(true)
    expect(isLocalInferenceProvider({
      presetId: 'custom',
      baseUrl: 'http://127.0.0.1:8080/v1',
    })).toBe(true)
    expect(isLocalInferenceProvider({
      presetId: 'custom',
      baseUrl: 'https://api.example.com/v1',
    })).toBe(false)
    // A known cloud preset wins over the URL signal: loopback there is a
    // gateway (LiteLLM / one-api / ssh -L), not local inference.
    expect(isLocalInferenceProvider({
      presetId: 'openai',
      baseUrl: 'http://127.0.0.1:8080/v1',
    })).toBe(false)
    expect(isLocalInferenceProvider({
      presetId: 'deepseek',
      baseUrl: 'http://localhost:9000/v1',
    })).toBe(false)
    expect(isLocalInferenceProvider({
      presetId: 'anthropic',
      baseUrl: 'http://localhost:4000/v1',
    })).toBe(false)
    expect(isLocalInferenceProvider({
      presetId: 'ollama-cloud',
      baseUrl: 'http://127.0.0.1:8080/v1',
    })).toBe(false)
    // custom/unknown presets fall back to the URL signal.
    expect(isLocalInferenceProvider({
      presetId: 'my-selfhosted-thing',
      baseUrl: 'http://[::1]:8080/v1',
    })).toBe(true)
    expect(isLocalInferenceProvider({
      presetId: 'my-selfhosted-thing',
      baseUrl: 'http://192.168.1.20:8080/v1',
    })).toBe(true)
    expect(isLocalInferenceProvider({
      presetId: 'custom',
      baseUrl: 'http://192.168.1.20:11434',
    })).toBe(true)
    expect(isLocalInferenceProvider({
      presetId: 'my-selfhosted-thing',
      baseUrl: 'https://api.example.com/v1',
    })).toBe(false)
    expect(isLocalInferenceProvider({
      baseUrl: 'http://127.0.0.1:11434/v1',
    })).toBe(true)
  })

  test('does not mistake the internal route proxy for a local model', () => {
    expect(shouldUseLocalModelPerformanceProfile({
      ANTHROPIC_BASE_URL:
        'http://127.0.0.1:3456/proxy/routes/balanced/sessions/test',
    })).toBe(false)
    expect(shouldUseLocalModelPerformanceProfile({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:3456/proxy/v1/messages',
      CYBERCODE_PROVIDER_BASE_URL: 'https://api.example.com/v1',
    })).toBe(false)
    expect(shouldUseLocalModelPerformanceProfile({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:3456/proxy/v1/messages',
      CYBERCODE_PROVIDER_BASE_URL: 'http://127.0.0.1:8080/v1',
    })).toBe(false)
    expect(shouldUseLocalModelPerformanceProfile({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8080/v1/messages',
    })).toBe(true)
    expect(shouldUseLocalModelPerformanceProfile({
      [CYBERCODE_LOCAL_MODEL_PERFORMANCE_ENV]: '1',
      CYBERCODE_PROVIDER_BASE_URL: 'http://127.0.0.1:8080/v1',
      ANTHROPIC_BASE_URL: 'https://api.example.com',
    })).toBe(true)
  })

  test('compacts descriptions without removing tools or schema constraints', () => {
    const tools = [{
      name: 'Read',
      description: `Read a file. ${'Long example text. '.repeat(80)}`,
      input_schema: {
        title: 'Read input',
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: `Absolute file path. ${'More detail. '.repeat(30)}`,
            examples: ['/tmp/example'],
          },
          mode: { type: 'string', enum: ['text', 'binary'] },
        },
        required: ['path'],
      },
    }]

    const compacted = compactLocalToolSchemas(tools)
    expect(compacted).toHaveLength(1)
    expect(compacted[0]?.name).toBe('Read')
    expect(compacted[0]?.description.length).toBeLessThanOrEqual(360)
    expect(compacted[0]?.input_schema).toMatchObject({
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string' },
        mode: { type: 'string', enum: ['text', 'binary'] },
      },
    })
    expect(compacted[0]?.input_schema).not.toHaveProperty('title')
    expect(
      compacted[0]?.input_schema.properties.path,
    ).not.toHaveProperty('examples')
    expect(tools[0]?.input_schema).toHaveProperty('title')
  })

  test('replaces only CyberCode boilerplate and preserves dynamic instructions', () => {
    const compacted = compactLocalSystemPromptParts([
      'You are an interactive agent that helps users with software engineering tasks.',
      '# System\nAll text you output outside of tool use is displayed to the user.\n' +
        'General system details. '.repeat(100),
      '# Doing tasks\nThe user will primarily request you to perform software engineering tasks.\n' +
        'General task details. '.repeat(100),
      '# Agent Work Rules\nKeep scoped changes.',
      '# Language\nAlways respond in Chinese.',
      '# Memory\nThe user prefers Bun.',
    ])

    expect(compacted.filter((part) => part === LOCAL_MODEL_CORE_PROMPT)).toHaveLength(1)
    expect(compacted.join('\n')).not.toContain('# Doing tasks')
    expect(compacted.join('\n')).toContain('# Agent Work Rules')
    expect(compacted.join('\n')).toContain('Always respond in Chinese')
    expect(compacted.join('\n')).toContain('The user prefers Bun')
  })
})
