import type Anthropic from '@anthropic-ai/sdk'
import { APIError } from '@anthropic-ai/sdk'
import { describe, expect, test } from 'bun:test'

import { CannotRetryError, withRetry } from './withRetry.js'

describe('provider retry policy', () => {
  test('does not retry an exhausted GLM balance response', async () => {
    let attempts = 0
    const error = new APIError(
      429,
      {
        type: 'error',
        error: {
          type: 'rate_limit_error',
          code: '1113',
          message: '[1113][余额不足或无可用资源包,请充值。][request-id]',
        },
      },
      undefined,
      new Headers(),
    )

    const request = withRetry(
      async () => ({}) as Anthropic,
      async () => {
        attempts++
        throw error
      },
      {
        model: 'glm-5.2',
        thinkingConfig: { type: 'disabled' },
      },
    )

    await expect(request.next()).rejects.toBeInstanceOf(CannotRetryError)
    expect(attempts).toBe(1)
  })

  test('does not retry a local-proxy 502 flagged with x-should-retry: false', async () => {
    let attempts = 0
    // The ant-only bypass ignores x-should-retry on 5xx; pin the external
    // user path so the header is honored.
    const previousUserType = process.env.USER_TYPE
    delete process.env.USER_TYPE
    const error = new APIError(
      502,
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: 'upstream request timed out',
        },
      },
      undefined,
      new Headers({ 'x-should-retry': 'false' }),
    )

    const request = withRetry(
      async () => ({}) as Anthropic,
      async () => {
        attempts++
        throw error
      },
      {
        model: 'qwen3-local',
        thinkingConfig: { type: 'disabled' },
      },
    )

    await expect(request.next()).rejects.toBeInstanceOf(CannotRetryError)
    expect(attempts).toBe(1)
    if (previousUserType === undefined) {
      delete process.env.USER_TYPE
    } else {
      process.env.USER_TYPE = previousUserType
    }
  })
})
