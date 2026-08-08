const INTERNAL_DIAGNOSTIC_LINE_PREFIXES = ['[ede_diagnostic]']

function sanitizeErrorText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .split(/\r?\n/)
    .filter((line) => !INTERNAL_DIAGNOSTIC_LINE_PREFIXES.some(
      (prefix) => line.trimStart().startsWith(prefix),
    ))
    .join('\n')
    .trim()
}

export type ResolvedCliResultError = {
  message: string
  code: string
  retryable?: boolean
}

export function resolveCliResultError(cliMsg: unknown): ResolvedCliResultError {
  const result = cliMsg && typeof cliMsg === 'object'
    ? cliMsg as Record<string, unknown>
    : {}
  const resultMessage = sanitizeErrorText(result.result)
  if (resultMessage) return { message: resultMessage, code: 'CLI_ERROR' }

  const errors = Array.isArray(result.errors)
    ? result.errors.map(sanitizeErrorText).filter(Boolean)
    : []
  if (errors.length > 0) {
    return { message: errors.join('\n'), code: 'CLI_ERROR' }
  }

  if (result.subtype === 'error_during_execution') {
    return {
      message: 'The model connection ended before returning a displayable response.',
      code: 'MODEL_NO_RESPONSE',
      retryable: true,
    }
  }

  return { message: 'Unknown error', code: 'CLI_ERROR' }
}
