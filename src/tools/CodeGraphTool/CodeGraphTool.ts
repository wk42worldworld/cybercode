import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolResult } from '../../Tool.js'
import {
  buildCodeGraphPreflight,
  isCodeGraphEnabled,
  resolveIndexedProject,
} from '../../services/codeGraphPreflight.js'
import { limitTextToTokenBudget } from '../../services/codeGraphTextBudget.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  CODEGRAPH_MCP_SERVER_NAME,
  CODEGRAPH_MCP_TOOL_NAMES,
  CODEGRAPH_TOOL_NAME,
} from './constants.js'

const actions = ['search', 'explore', 'impact', 'architecture', 'status'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(actions)
      .describe(
        'search finds symbols, explore answers implementation questions, impact traces dependents, architecture summarizes the project, and status checks readiness.',
      ),
    query: z
      .string()
      .optional()
      .describe('Symbol, code concept, or implementation question. Required for search, explore, and impact.'),
    depth: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe('Impact traversal depth. Defaults to 3.'),
    tokenBudget: z
      .number()
      .int()
      .min(300)
      .max(6_000)
      .optional()
      .describe('Maximum estimated tokens returned. Use the smallest useful budget.'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    source: z.enum(['runtime', 'local']),
    content: z.string(),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const CodeGraphTool = buildTool({
  name: CODEGRAPH_TOOL_NAME,
  searchHint: 'find symbols architecture dependencies and change impact',
  alwaysLoad: true,
  maxResultSizeChars: 24_000,
  strict: true,
  async description() {
    return 'Query the current project code graph before broad scans. Use search for symbols, impact before changing or deleting behavior, explore for implementation context, and architecture for project structure. Use Grep first only for exact text, config, CSS, Markdown, or error strings.'
  },
  async prompt() {
    return 'Use CodeGraph for symbol discovery, architecture, and change-impact analysis. For exact literals, search with Grep and then use CodeGraph impact on the owning symbol before broad file reads.'
  },
  userFacingName() {
    return 'Code Graph'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isCodeGraphEnabled()
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
  isSearchOrReadCommand() {
    return { isSearch: true, isRead: true }
  },
  toAutoClassifierInput(input) {
    return `${input.action}${input.query ? ` ${input.query}` : ''}`
  },
  async validateInput(input) {
    if (
      (input.action === 'search' || input.action === 'explore' || input.action === 'impact') &&
      !input.query?.trim()
    ) {
      return {
        result: false,
        message: `CodeGraph ${input.action} requires a query.`,
        errorCode: 1,
      }
    }
    return { result: true }
  },
  async checkPermissions(input) {
    return { behavior: 'allow' as const, updatedInput: input }
  },
  renderToolUseMessage(input: Partial<Input>) {
    const query = input.query?.trim()
    return query ? `${input.action ?? 'search'}: ${query}` : input.action ?? 'status'
  },
  getToolUseSummary(input: Partial<Input> | undefined) {
    if (!input) return null
    return input.query?.trim() || input.action || null
  },
  getActivityDescription(input: Partial<Input> | undefined) {
    return `Reading code graph${input?.query?.trim() ? ` for ${input.query.trim()}` : ''}`
  },
  async call(input, context, canUseTool, parentMessage, onProgress) {
    if (!isCodeGraphEnabled()) {
      return localResult(false, 'Code Graph is disabled globally. Use Grep and targeted Read as fallbacks.')
    }
    const projectPath = resolveIndexedProject(getCwd())
    if (!projectPath) {
      return localResult(false, 'Code Graph index is not ready for this project. Use Grep as a fallback and retry after indexing finishes.')
    }

    const dbPath = path.join(projectPath, '.codegraph', 'codegraph.db')
    if (!fs.existsSync(dbPath)) {
      return localResult(false, 'Code Graph index is still preparing. Use Grep as a fallback for this turn.')
    }

    const mcpToolName = CODEGRAPH_MCP_TOOL_NAMES[input.action]
    const runtimeTool = context.getAppState().mcp.tools.find((tool) =>
      tool.mcpInfo?.serverName === CODEGRAPH_MCP_SERVER_NAME &&
      tool.mcpInfo.toolName === mcpToolName,
    )
    if (runtimeTool) {
      try {
        const result = await runtimeTool.call(
          runtimeArgs(input),
          context,
          canUseTool,
          parentMessage,
          onProgress,
        )
        return {
          data: {
            success: true,
            source: 'runtime' as const,
            content: textFromMcpResult(result),
          },
        }
      } catch (error) {
        if (context.abortController.signal.aborted) throw error
      }
    }

    return localCodeGraphResult(projectPath, input, context.abortController.signal)
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: content.content,
      ...(!content.success && { is_error: true }),
    }
  },
} satisfies ToolDef<InputSchema, Output>)

function runtimeArgs(input: Input) {
  const tokenBudget = input.tokenBudget ?? (
    input.action === 'search' || input.action === 'status' ? 1_200 : 1_800
  )
  switch (input.action) {
    case 'search':
      return { query: input.query!.trim(), limit: 12, tokenBudget }
    case 'explore':
      return { query: input.query!.trim(), maxNodes: 24, tokenBudget }
    case 'impact':
      return { symbol: input.query!.trim(), depth: input.depth ?? 3, tokenBudget }
    case 'architecture':
      return { tokenBudget }
    case 'status':
      return {}
  }
}

function localCodeGraphResult(
  projectPath: string,
  input: Input,
  signal: AbortSignal,
): ToolResult<Output> {
  if (input.action === 'status') {
    return localResult(true, JSON.stringify({
      projectPath,
      indexState: 'ready',
      databasePath: path.join(projectPath, '.codegraph', 'codegraph.db'),
    }, null, 2))
  }

  const query = input.action === 'architecture'
    ? 'project architecture modules entry points relationships'
    : input.query!.trim()
  const content = buildCodeGraphPreflight(projectPath, query, signal)
  if (!content) {
    return localResult(
      false,
      `No indexed symbol matched: ${query}. Use Grep for exact text, then retry CodeGraph impact with the owning symbol name.`,
    )
  }
  return localResult(
    true,
    limitTextToTokenBudget(content, input.tokenBudget ?? 640),
  )
}

function localResult(success: boolean, content: string): ToolResult<Output> {
  return {
    data: {
      success,
      source: 'local',
      content,
    },
  }
}

function textFromMcpResult(result: ToolResult<unknown>) {
  const data = result.data
  if (typeof data === 'string') return data
  if (Array.isArray(data)) {
    const text = data.map((block) => {
      if (typeof block === 'string') return block
      if (block && typeof block === 'object' && 'text' in block) {
        return String((block as { text?: unknown }).text ?? '')
      }
      return ''
    }).filter(Boolean).join('\n')
    if (text) return text
  }
  return JSON.stringify(data, null, 2) ?? ''
}
