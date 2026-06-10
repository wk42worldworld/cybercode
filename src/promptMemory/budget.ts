export const SOUL_CHAR_LIMIT = 3000
export const BRIEF_CHAR_LIMIT = 2200
export const USER_PROMPT_MEMORY_CHAR_LIMIT = 1375
export const PROMPT_MEMORY_TOTAL_CHAR_LIMIT =
  BRIEF_CHAR_LIMIT + USER_PROMPT_MEMORY_CHAR_LIMIT

export type BoundedText = {
  content: string
  originalLength: number
  limit: number
  truncated: boolean
}

export function boundPromptMemoryText(
  label: string,
  raw: string,
  limit: number,
): BoundedText {
  const trimmed = raw.trim()
  if (trimmed.length <= limit) {
    return {
      content: trimmed,
      originalLength: trimmed.length,
      limit,
      truncated: false,
    }
  }

  const notice = `\n\n[Truncated ${label}: kept ${limit} of ${trimmed.length} characters. Shorten this file so the full content loads next session.]`
  const keep = Math.max(0, limit - notice.length)
  return {
    content: trimmed.slice(0, keep).trimEnd() + notice,
    originalLength: trimmed.length,
    limit,
    truncated: true,
  }
}

export function boundPromptMemoryPair(params: {
  brief: string
  user: string
}): {
  brief: BoundedText
  user: BoundedText
} {
  const brief = boundPromptMemoryText('BRIEF.md', params.brief, BRIEF_CHAR_LIMIT)
  const remainingForUser = Math.max(
    0,
    PROMPT_MEMORY_TOTAL_CHAR_LIMIT - brief.content.length,
  )
  const userLimit = Math.min(USER_PROMPT_MEMORY_CHAR_LIMIT, remainingForUser)
  const user = boundPromptMemoryText('USER.md', params.user, userLimit)
  return { brief, user }
}
