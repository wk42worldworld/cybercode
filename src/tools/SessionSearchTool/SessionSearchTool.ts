import { z } from 'zod/v4'
import { getSessionId } from '../../bootstrap/state.js'
import { sessionSearch } from '../../sessionSearch/search.js'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { SESSION_SEARCH_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    query: z
      .string()
      .optional()
      .describe('Search query for past sessions. Omit to browse recent sessions.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Maximum number of sessions to return for search/browse.'),
    sessionId: z
      .string()
      .optional()
      .describe('Session id to read or scroll.'),
    projectPath: z
      .string()
      .optional()
      .describe('Optional sanitized project path to disambiguate a session id.'),
    aroundMessageId: z
      .number()
      .int()
      .optional()
      .describe('Message id anchor for scrolling within a historical session.'),
    window: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Number of messages before/after aroundMessageId for scroll.'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z
    .object({
      success: z.boolean(),
      mode: z.string().optional(),
      message: z.string().optional(),
    })
    .passthrough(),
)

type OutputSchema = ReturnType<typeof outputSchema>

export const SessionSearchTool = buildTool({
  name: SESSION_SEARCH_TOOL_NAME,
  searchHint: 'search past conversations and session history',
  maxResultSizeChars: 30_000,
  strict: true,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'SessionSearch'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  isDestructive() {
    return false
  },
  async checkPermissions(input) {
    return { behavior: 'allow' as const, updatedInput: input }
  },
  renderToolUseMessage(input: Input) {
    if (input.sessionId && input.aroundMessageId !== undefined) {
      return `Scroll session ${input.sessionId}`
    }
    if (input.sessionId) return `Read session ${input.sessionId}`
    if (input.query?.trim()) return `Search sessions for "${input.query.trim()}"`
    return 'Browse recent sessions'
  },
  async call(input: Input) {
    const result = await sessionSearch({
      query: input.query,
      limit: input.limit,
      sessionId: input.sessionId,
      projectPath: input.projectPath,
      aroundMessageId: input.aroundMessageId,
      window: input.window,
      currentSessionId: getSessionId(),
    })
    if (!result) {
      return {
        data: {
          success: false,
          message: 'No matching session history found.',
        },
      }
    }
    return { data: result }
  },
})
