export const SESSION_SEARCH_CONTENT_MAX_CHARS = 32 * 1024

const SESSION_SEARCH_HEAD_CHARS = 10 * 1024
const SESSION_SEARCH_TAIL_CHARS = 10 * 1024
const SESSION_SEARCH_TRUNCATION_MARKER = '\n...[search index truncated]...\n'
const ERROR_CLUE_RE = /(?:\berror\b|\bfatal\b|\bexception\b|\bpanic\b|\bfailed\b|\bfailure\b|\btraceback\b|\bstderr\b|\bwarning\b|\bexit(?:ed)?\s+(?:code|status)\b|错误|失败|异常|崩溃|警告)/giu
const ERROR_CLUE_CONTEXT_BEFORE = 192
const ERROR_CLUE_CONTEXT_AFTER = 512
const ERROR_CLUE_LIMIT = 48

function collectErrorClues(text: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  ERROR_CLUE_RE.lastIndex = 0
  const clues: string[] = []
  let usedChars = 0
  let previousEnd = -1
  let match: RegExpExecArray | null

  while (
    clues.length < ERROR_CLUE_LIMIT &&
    (match = ERROR_CLUE_RE.exec(text)) !== null
  ) {
    const start = Math.max(0, match.index - ERROR_CLUE_CONTEXT_BEFORE)
    const end = Math.min(
      text.length,
      match.index + match[0].length + ERROR_CLUE_CONTEXT_AFTER,
    )
    if (start < previousEnd) continue

    const separatorChars = clues.length === 0 ? 0 : 1
    const remaining = maxChars - usedChars - separatorChars
    if (remaining <= 0) break
    const clue = text.slice(start, end).trim().slice(0, remaining)
    if (!clue) continue
    clues.push(clue)
    usedChars += separatorChars + clue.length
    previousEnd = end
  }

  return clues.join('\n')
}

export function boundSessionSearchContent(value: string): string {
  const text = value.trim()
  if (text.length <= SESSION_SEARCH_CONTENT_MAX_CHARS) return text

  const clueBudget = Math.max(
    0,
    SESSION_SEARCH_CONTENT_MAX_CHARS -
      SESSION_SEARCH_HEAD_CHARS -
      SESSION_SEARCH_TAIL_CHARS -
      SESSION_SEARCH_TRUNCATION_MARKER.length * 2,
  )
  const clues = collectErrorClues(text, clueBudget)
  const bounded = [
    text.slice(0, SESSION_SEARCH_HEAD_CHARS),
    SESSION_SEARCH_TRUNCATION_MARKER,
    clues,
    SESSION_SEARCH_TRUNCATION_MARKER,
    text.slice(-SESSION_SEARCH_TAIL_CHARS),
  ].join('')

  return bounded.slice(0, SESSION_SEARCH_CONTENT_MAX_CHARS)
}

export function boundSessionSearchMetadata(
  value: string | null | undefined,
  maxChars: number,
): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  return text.length <= maxChars ? text : text.slice(0, maxChars)
}
