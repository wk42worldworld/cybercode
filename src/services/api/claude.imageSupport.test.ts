import { afterEach, describe, expect, test } from 'bun:test'

import { replaceImagesForTextOnlyModel } from './claude.js'
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
