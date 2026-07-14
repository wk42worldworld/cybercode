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
})
