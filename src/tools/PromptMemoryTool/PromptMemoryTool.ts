import { z } from 'zod/v4'
import {
  addPromptMemoryEntry,
  getPromptMemoryStatus,
  parsePromptMemoryTarget,
  readPromptMemoryFile,
  removePromptMemoryEntry,
  replacePromptMemoryEntry,
  writePromptMemoryFile,
  type PromptMemoryAction,
  type PromptMemoryTarget,
} from '../../promptMemory/store.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { PROMPT_MEMORY_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const actionSchema = z.enum(['status', 'read', 'add', 'replace', 'remove', 'write'])
const targetSchema = z.enum(['soul', 'brief', 'user'])

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: actionSchema.describe(
      'Operation to perform. Use add/replace/remove for BRIEF.md and USER.md entries. Use write for explicit full-file writes.',
    ),
    target: targetSchema
      .optional()
      .describe('Target file: soul, brief, or user. Required except for status.'),
    content: z
      .string()
      .optional()
      .describe('New entry or full file content, required for add/replace/write.'),
    oldText: z
      .string()
      .optional()
      .describe('Text to match for replace/remove. Must identify one entry.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    message: z.string(),
    assistantGuidance: z.string().optional(),
    action: actionSchema.optional(),
    target: targetSchema.optional(),
    changed: z.boolean().optional(),
    path: z.string().optional(),
    charCount: z.number().optional(),
    limit: z.number().optional(),
    entryCount: z.number().optional(),
    content: z.string().optional(),
    files: z
      .record(
        z.string(),
        z.object({
          path: z.string(),
          charCount: z.number(),
          limit: z.number(),
          entryCount: z.number(),
          overLimit: z.boolean(),
          exists: z.boolean(),
        }),
      )
      .optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

const NATURAL_ACK_GUIDANCE =
  'When replying to the user, acknowledge naturally in the user language. Do not mention PromptMemory, USER.md, BRIEF.md, SOUL.md, files, storage, databases, indexes, or a memory system. For a name/nickname request, respond like "好，我叫零。" or "好，以后就这么叫我。"'

function requireTarget(input: Input): PromptMemoryTarget {
  const target = parsePromptMemoryTarget(input.target)
  if (!target) throw new Error('target is required and must be soul, brief, or user')
  return target
}

function requireContent(input: Input): string {
  const content = input.content?.trim()
  if (!content) throw new Error('content is required')
  return content
}

function requireOldText(input: Input): string {
  const oldText = input.oldText?.trim()
  if (!oldText) throw new Error('oldText is required')
  return oldText
}

function assertEntryActionTarget(
  action: PromptMemoryAction,
  target: PromptMemoryTarget,
): asserts target is Exclude<PromptMemoryTarget, 'soul'> {
  if (target === 'soul') {
    throw new Error(`${action} is only supported for brief or user memory`)
  }
}

export const PromptMemoryTool = buildTool({
  name: PROMPT_MEMORY_TOOL_NAME,
  searchHint: 'save persistent user and agent memory',
  maxResultSizeChars: 20_000,
  strict: true,
  alwaysLoad: true,
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
    return 'PromptMemory'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly(input: Input) {
    return input.action === 'status' || input.action === 'read'
  },
  isDestructive(input: Input) {
    return input.action === 'write' || input.action === 'remove'
  },
  toAutoClassifierInput(input: Input) {
    return `${input.action} ${input.target ?? 'all'}`
  },
  async checkPermissions(input: Input) {
    if (input.action === 'status' || input.action === 'read') {
      return { behavior: 'allow' as const, updatedInput: input }
    }
    if (input.target === 'soul') {
      return {
        behavior: 'ask' as const,
        message: 'Update long-term SOUL.md identity?',
        updatedInput: input,
      }
    }
    return { behavior: 'allow' as const, updatedInput: input }
  },
  renderToolUseMessage() {
    return null
  },
  async call(input: Input): Promise<{ data: Output }> {
    switch (input.action) {
      case 'status': {
        const status = await getPromptMemoryStatus()
        return {
          data: {
            success: true,
            action: input.action,
            message: 'Prompt memory status loaded.',
            files: Object.fromEntries(
              Object.entries(status.files).map(([target, file]) => [
                target,
                {
                  path: file.path,
                  charCount: file.charCount,
                  limit: file.limit,
                  entryCount: file.entries.length,
                  overLimit: file.overLimit,
                  exists: file.exists,
                },
              ]),
            ),
          },
        }
      }
      case 'read': {
        const target = requireTarget(input)
        const file = await readPromptMemoryFile(target)
        return {
          data: {
            success: true,
            action: input.action,
            target,
            path: file.path,
            content: file.content,
            charCount: file.charCount,
            limit: file.limit,
            entryCount: file.entries.length,
            message: `${target} prompt memory loaded.`,
          },
        }
      }
      case 'write': {
        const target = requireTarget(input)
        const file = await writePromptMemoryFile(target, requireContent(input))
        return {
          data: {
            success: true,
            action: input.action,
            target,
            changed: true,
            path: file.path,
            charCount: file.charCount,
            limit: file.limit,
            entryCount: file.entries.length,
            message: 'Saved.',
            assistantGuidance: NATURAL_ACK_GUIDANCE,
          },
        }
      }
      case 'add': {
        const target = requireTarget(input)
        assertEntryActionTarget(input.action, target)
        const result = await addPromptMemoryEntry(target, requireContent(input))
        return {
          data: {
            success: true,
            action: input.action,
            target,
            changed: result.changed,
            path: result.path,
            charCount: result.charCount,
            limit: result.limit,
            entryCount: result.entryCount,
            message: result.changed ? 'Saved.' : 'Already up to date.',
            assistantGuidance: NATURAL_ACK_GUIDANCE,
          },
        }
      }
      case 'replace': {
        const target = requireTarget(input)
        assertEntryActionTarget(input.action, target)
        const result = await replacePromptMemoryEntry(
          target,
          requireOldText(input),
          requireContent(input),
        )
        return {
          data: {
            success: true,
            action: input.action,
            target,
            changed: result.changed,
            path: result.path,
            charCount: result.charCount,
            limit: result.limit,
            entryCount: result.entryCount,
            message: result.changed ? 'Saved.' : 'Already up to date.',
            assistantGuidance: NATURAL_ACK_GUIDANCE,
          },
        }
      }
      case 'remove': {
        const target = requireTarget(input)
        assertEntryActionTarget(input.action, target)
        const result = await removePromptMemoryEntry(target, requireOldText(input))
        return {
          data: {
            success: true,
            action: input.action,
            target,
            changed: result.changed,
            path: result.path,
            charCount: result.charCount,
            limit: result.limit,
            entryCount: result.entryCount,
            message: result.changed ? 'Removed.' : 'Already up to date.',
            assistantGuidance: NATURAL_ACK_GUIDANCE,
          },
        }
      }
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(content),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
