import { describe, expect, test } from 'bun:test'

import { resolveCliResultError } from './cliResultError.js'

describe('resolveCliResultError', () => {
  test('turns an internal-only execution diagnostic into a retryable model response error', () => {
    expect(resolveCliResultError({
      subtype: 'error_during_execution',
      errors: [
        '[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null',
      ],
    })).toEqual({
      message: 'The model connection ended before returning a displayable response.',
      code: 'MODEL_NO_RESPONSE',
      retryable: true,
    })
  })

  test('removes diagnostics while preserving a real provider error', () => {
    expect(resolveCliResultError({
      subtype: 'error_during_execution',
      errors: [
        '[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null',
        'Insufficient balance',
      ],
    })).toEqual({
      message: 'Insufficient balance',
      code: 'CLI_ERROR',
    })
  })

  test('removes an embedded diagnostic line without hiding adjacent details', () => {
    expect(resolveCliResultError({
      subtype: 'error_during_execution',
      result: 'Connection closed\n[ede_diagnostic] result_type=user\nRequest id: req-1',
    })).toEqual({
      message: 'Connection closed\nRequest id: req-1',
      code: 'CLI_ERROR',
    })
  })
})
