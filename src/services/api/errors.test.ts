import { APIError } from '@anthropic-ai/sdk'
import { describe, expect, test } from 'bun:test'

import { getAssistantMessageFromError } from './errors.js'

function firstText(message: ReturnType<typeof getAssistantMessageFromError>): string {
  const [block] = message.message.content
  return block?.type === 'text' ? block.text : ''
}

describe('provider API error messages', () => {
  test('turns unsupported model provider errors into actionable copy', () => {
    const message = getAssistantMessageFromError(
      new APIError(
        400,
        { message: 'Upstream returned HTTP 400: {"error":{"code":"400","message":"Unsupported model mimo-v2.5-flash"}}' },
        undefined,
        new Headers(),
      ),
      'mimo-v2.5-flash',
    )

    const text = firstText(message)
    expect(text).toContain('does not support model "mimo-v2.5-flash"')
    expect(text).toContain('Model Configuration')
    expect(text).not.toContain('Upstream returned HTTP 400')
  })

  test('turns provider subscription errors into plan guidance', () => {
    const message = getAssistantMessageFromError(
      new APIError(
        400,
        {
          message:
            '{"error":{"code":"InvalidSubscription","message":"Your account does not have a valid AgentPlan subscription, or your subscription has expired."}}',
        },
        undefined,
        new Headers(),
      ),
      'doubao-seed-code',
    )

    const text = firstText(message)
    expect(text).toContain('required coding/agent subscription')
    expect(text).not.toContain('InvalidSubscription')
  })

  test('turns enabled-only thinking errors into restart guidance', () => {
    const message = getAssistantMessageFromError(
      new APIError(
        400,
        {
          message:
            '{"error":{"type":"invalid_request_error","message":"invalid thinking: only type=enabled is allowed for this model"}}',
        },
        undefined,
        new Headers(),
      ),
      'glm-5.2',
    )

    const text = firstText(message)
    expect(text).toContain('requires thinking to be enabled')
    expect(text).not.toContain('invalid thinking')
  })

  test('turns invalid provider API keys into entry guidance', () => {
    const message = getAssistantMessageFromError(
      new APIError(
        400,
        {
          message:
            'The API Key appears to be invalid or may have expired. Please verify your credentials and try again.',
        },
        undefined,
        new Headers(),
      ),
      'kimi-for-coding',
    )

    const text = firstText(message)
    expect(text).toContain('API key is invalid')
    expect(text).toContain('selected provider base URL')
  })

  test('turns 401 provider API key failures into entry guidance', () => {
    const message = getAssistantMessageFromError(
      new APIError(
        401,
        {
          message: 'invalid api key',
        },
        undefined,
        new Headers(),
      ),
      'glm-5.2',
    )

    const text = firstText(message)
    expect(text).toContain('API key is invalid')
    expect(text).toContain('selected provider base URL')
  })

  test('turns image input provider errors into non-vision guidance', () => {
    const message = getAssistantMessageFromError(
      new APIError(
        400,
        {
          message: 'This model does not support image input.',
        },
        undefined,
        new Headers(),
      ),
      'kimi-k2.6',
    )

    const text = firstText(message)
    expect(text).toContain('does not accept image input directly')
    expect(text).toContain('image-processing MCP tool')
  })
})
