import { afterEach, describe, expect, test } from 'bun:test'

import { isEmbeddedProxyBaseUrl, isLocalInferenceBaseUrl, replaceImagesForTextOnlyModel } from './claude.js'
import { createUserMessage } from '../../utils/messages.js'
import { modelSupportsImages } from '../../utils/model/imageSupport.js'

const originalBaseUrl = process.env.ANTHROPIC_BASE_URL
const originalSonnetModel = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
const originalSonnetCapabilities = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES

afterEach(() => {
  if (originalBaseUrl === undefined) {
    delete process.env.ANTHROPIC_BASE_URL
  } else {
    process.env.ANTHROPIC_BASE_URL = originalBaseUrl
  }
  if (originalSonnetModel === undefined) {
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  } else {
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = originalSonnetModel
  }
  if (originalSonnetCapabilities === undefined) {
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES
  } else {
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES = originalSonnetCapabilities
  }
})

function imageBlock() {
  return {
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: 'image/png' as const,
      data: 'AAAA',
    },
  }
}

describe('image support safeguards', () => {
  test('uses 3P model image capability env overrides', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://example.com'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'text-model-no-image'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES = ''
    expect(modelSupportsImages('text-model-no-image')).toBe(false)

    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'vision-model-with-image'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES = 'images'
    expect(modelSupportsImages('vision-model-with-image')).toBe(true)
  })

  test('replaces top-level image blocks before text-only model requests', () => {
    const messages = [
      createUserMessage({
        content: [
          { type: 'text', text: 'Inspect this image.' },
          imageBlock(),
        ],
      }),
    ]

    const result = replaceImagesForTextOnlyModel(messages)
    const raw = JSON.stringify(result)
    expect(raw).not.toContain('"type":"image"')
    expect(raw).toContain('Raw image block withheld')
    expect(raw).toContain('image/OCR/MCP tool')
  })

  test('replaces tool_result image blocks before text-only model requests', () => {
    const messages = [
      createUserMessage({
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: 'toolu_1',
            content: [imageBlock()],
          },
        ],
        isMeta: true,
      }),
    ]

    const result = replaceImagesForTextOnlyModel(messages)
    const raw = JSON.stringify(result)
    expect(raw).not.toContain('"type":"image"')
    expect(raw).toContain('Raw image block withheld')
    expect(raw).toContain('image/OCR/MCP tool')
  })
})

describe('isLocalInferenceBaseUrl', () => {
  test('detects loopback and ollama hosts', () => {
    expect(isLocalInferenceBaseUrl('http://127.0.0.1:8080/v1')).toBe(true)
    expect(isLocalInferenceBaseUrl('http://localhost:11434')).toBe(true)
    expect(isLocalInferenceBaseUrl('http://[::1]:8080')).toBe(true)
    expect(isLocalInferenceBaseUrl('http://ollama:11434')).toBe(true)
    expect(isLocalInferenceBaseUrl('http://127.0.1.5:3000')).toBe(true)
  })

  test('detects RFC1918 LAN hosts as local self-hosted inference', () => {
    expect(isLocalInferenceBaseUrl('http://192.168.1.20:11434')).toBe(true)
    expect(isLocalInferenceBaseUrl('http://10.0.0.5:1234/v1')).toBe(true)
    expect(isLocalInferenceBaseUrl('http://172.16.3.9:8080')).toBe(true)
    expect(isLocalInferenceBaseUrl('http://172.32.3.9:8080')).toBe(false)
  })

  test('rejects remote and missing URLs', () => {
    expect(isLocalInferenceBaseUrl('https://api.anthropic.com')).toBe(false)
    expect(isLocalInferenceBaseUrl('https://api.openai.com/v1')).toBe(false)
    expect(isLocalInferenceBaseUrl(undefined)).toBe(false)
    expect(isLocalInferenceBaseUrl('not a url')).toBe(false)
  })
})

describe('isEmbeddedProxyBaseUrl', () => {
  test('detects embedded proxy URLs so the watchdog skips them', () => {
    // The desktop app routes every provider through the embedded proxy, so a
    // loopback /proxy/ URL must not count as a local inference target.
    expect(isEmbeddedProxyBaseUrl('http://127.0.0.1:3456/proxy/v1/messages')).toBe(true)
    expect(isEmbeddedProxyBaseUrl('http://127.0.0.1:3456/proxy/routes/balanced/sessions/test')).toBe(true)
    expect(isLocalInferenceBaseUrl('http://127.0.0.1:3456/proxy/v1/messages')).toBe(true)
    expect(
      isLocalInferenceBaseUrl('http://127.0.0.1:3456/proxy/v1/messages') &&
        !isEmbeddedProxyBaseUrl('http://127.0.0.1:3456/proxy/v1/messages'),
    ).toBe(false)
  })

  test('ignores direct local inference URLs', () => {
    expect(isEmbeddedProxyBaseUrl('http://127.0.0.1:8080/v1/messages')).toBe(false)
    expect(isEmbeddedProxyBaseUrl('http://192.168.1.20:11434/v1')).toBe(false)
    expect(isEmbeddedProxyBaseUrl(undefined)).toBe(false)
  })
})
