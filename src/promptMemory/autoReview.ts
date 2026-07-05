import { appendFile, mkdir, readFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { dirname, join } from 'path'
import { getSessionId } from '../bootstrap/state.js'
import type { QuerySource } from '../constants/querySource.js'
import { isAutoMemoryEnabled } from '../memdir/paths.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { Tool } from '../Tool.js'
import type { Message } from '../types/message.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import {
  createCacheSafeParams,
  runForkedAgent,
} from '../utils/forkedAgent.js'
import type { REPLHookContext } from '../utils/hooks/postSamplingHooks.js'
import { createSystemMessage, createUserMessage } from '../utils/messages.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { PROMPT_MEMORY_TOOL_NAME } from '../tools/PromptMemoryTool/constants.js'
import {
  getBriefPath,
  getPromptMemoryDir,
  getUserPromptMemoryPath,
} from './paths.js'
import {
  readPromptMemoryFile,
  type PromptMemoryAction,
  type PromptMemoryEntryTarget,
} from './store.js'

const DEFAULT_REVIEW_INTERVAL_TURNS = 6
const LOG_FILENAME = 'AUTO_REVIEW_LOG.jsonl'
export const PROMPT_MEMORY_AUTO_REVIEW_TOOL_USE_ID =
  'prompt_memory_auto_review'

const EXPLICIT_MEMORY_SIGNAL =
  /(?:\bremember\b|\bforget\b|\bpreference\b|\bprefer\b|\bmy name is\b|\bcall me\b|\bcall you\b|\brespond in\b|\breply in\b|记住|记得|记忆|忘记|忘掉|以后|以后默认|默认|偏好|我喜欢|我不喜欢|我希望|每次|下次|不要再|别再|取名|新名字|名字叫|叫做|我叫|你叫|我的名字|你的名字|称呼|叫你|叫我|用中文|中文回复|中文回答|英文回复|英文回答|用英文|说中文|说英文|習慣|覚えて|忘れて|기억|잊어|선호)/i

type ReviewTrigger = 'explicit' | 'interval'

export type PromptMemoryAutoReviewLogEntry = {
  id: string
  timestamp: string
  sessionId: string
  trigger: ReviewTrigger
  target: PromptMemoryEntryTarget
  action: PromptMemoryAction
  changed: boolean
  content?: string
  oldText?: string
  message: string
}

type PendingReview = {
  context: REPLHookContext
  trigger: ReviewTrigger
}

let lastReviewedMessageUuid: string | undefined
let lastSeenMessageUuid: string | undefined
let turnsSinceLastReview = 0
let inProgress = false
let pendingReview: PendingReview | undefined
const inFlightReviews = new Set<Promise<void>>()

function getReviewIntervalTurns(): number {
  const raw = process.env.CYBER_PROMPT_MEMORY_REVIEW_INTERVAL
  if (!raw) return DEFAULT_REVIEW_INTERVAL_TURNS
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_REVIEW_INTERVAL_TURNS
}

function getAutoReviewLogPath(): string {
  return join(getPromptMemoryDir(), LOG_FILENAME).normalize('NFC')
}

function isVisibleMessage(message: Message): boolean {
  return message.type === 'user' || message.type === 'assistant'
}

function getMessagesSince(
  messages: Message[],
  sinceUuid: string | undefined,
): Message[] {
  if (!sinceUuid) return messages
  const start = messages.findIndex(message => message.uuid === sinceUuid)
  if (start === -1) return messages
  return messages.slice(start + 1)
}

function countUserMessages(messages: Message[]): number {
  return messages.filter(message => message.type === 'user').length
}

function countVisibleMessages(messages: Message[]): number {
  return messages.filter(isVisibleMessage).length
}

function getUserText(message: Message): string {
  if (message.type !== 'user') return ''
  const content = (message as { message?: { content?: unknown } }).message
    ?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map(block => block.text)
    .join('\n')
}

export function hasExplicitPromptMemorySignal(messages: Message[]): boolean {
  return messages.some(message => EXPLICIT_MEMORY_SIGNAL.test(getUserText(message)))
}

function getPromptMemoryToolInput(block: unknown):
  | {
      id: string
      input: Record<string, unknown>
    }
  | undefined {
  if (typeof block !== 'object' || block === null) return undefined
  const candidate = block as {
    type?: unknown
    name?: unknown
    id?: unknown
    input?: unknown
  }
  if (
    candidate.type !== 'tool_use' ||
    candidate.name !== PROMPT_MEMORY_TOOL_NAME ||
    typeof candidate.id !== 'string' ||
    typeof candidate.input !== 'object' ||
    candidate.input === null
  ) {
    return undefined
  }
  return {
    id: candidate.id,
    input: candidate.input as Record<string, unknown>,
  }
}

function hasPromptMemoryMutation(messages: Message[]): boolean {
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    const content = (message as { message?: { content?: unknown } }).message
      ?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const toolUse = getPromptMemoryToolInput(block)
      if (!toolUse) continue
      const action = toolUse.input.action
      if (
        action === 'add' ||
        action === 'replace' ||
        action === 'remove' ||
        action === 'write'
      ) {
        return true
      }
    }
  }
  return false
}

export function shouldRunPromptMemoryAutoReview(params: {
  messages: Message[]
  sinceUuid: string | undefined
  turnsSinceLastReview: number
  intervalTurns?: number
}): { shouldRun: boolean; trigger: ReviewTrigger | null; nextTurnCount: number } {
  const messagesSince = getMessagesSince(params.messages, params.sinceUuid)
  const newUserMessages = countUserMessages(messagesSince)
  if (newUserMessages === 0) {
    return {
      shouldRun: false,
      trigger: null,
      nextTurnCount: params.turnsSinceLastReview,
    }
  }

  if (hasExplicitPromptMemorySignal(messagesSince)) {
    return {
      shouldRun: true,
      trigger: 'explicit',
      nextTurnCount: 0,
    }
  }

  const nextTurnCount = params.turnsSinceLastReview + newUserMessages
  if (nextTurnCount >= (params.intervalTurns ?? DEFAULT_REVIEW_INTERVAL_TURNS)) {
    return {
      shouldRun: true,
      trigger: 'interval',
      nextTurnCount: 0,
    }
  }

  return {
    shouldRun: false,
    trigger: null,
    nextTurnCount,
  }
}

function formatEntries(label: string, entries: string[]): string {
  if (entries.length === 0) return `${label}: empty`
  return [
    `${label}:`,
    ...entries.map((entry, index) => `${index + 1}. ${entry}`),
  ].join('\n')
}

export function buildPromptMemoryAutoReviewPrompt(params: {
  newMessageCount: number
  trigger: ReviewTrigger
  briefEntries: string[]
  userEntries: string[]
}): string {
  return [
    'You are the automatic Prompt Memory reviewer for CyberCode.',
    '',
    `Analyze only the most recent ~${params.newMessageCount} visible messages above. Decide whether future conversations would benefit from updating the short prompt-memory files.`,
    '',
    'Current prompt-memory entries:',
    '',
    formatEntries('BRIEF.md', params.briefEntries),
    '',
    formatEntries('USER.md', params.userEntries),
    '',
    'Write rules:',
    '- Use the PromptMemory tool only when there is a durable memory change.',
    '- Allowed actions: add, replace, remove.',
    '- Allowed targets: brief, user.',
    '- Never write or modify SOUL.md from this automatic review.',
    '- BRIEF.md stores stable agent facts, environment facts, tool quirks, and cross-session working lessons.',
    '- USER.md stores user preferences, communication style, stable personal workflow preferences, and explicit remember/forget requests.',
    '- Basic user relationship facts must go in USER.md, not project memory: the user\'s preferred language, communication style, the user\'s name/nickname, and any name/nickname the user gives CyberCode/the assistant/agent.',
    '- If the user names CyberCode/the assistant/agent or says how they want to call it, save that in USER.md so every project can answer identity/name questions consistently.',
    '- Prefer replace/remove when an existing entry is stale, wrong, or duplicated.',
    '- Keep each new entry concise, declarative, and under 220 characters.',
    '- Do not store secrets, credentials, API keys, private tokens, one-off tasks, transient plans, temporary prices, or details that are only useful inside the current conversation.',
    '- Do not store project-specific facts in BRIEF.md when the project memory directory is the better home.',
    '',
    params.trigger === 'explicit'
      ? 'The recent user text contained an explicit memory/preference signal. Prioritize it, but still reject unsafe or temporary content.'
      : 'This is a periodic review. Be conservative; no tool call is better than low-value memory.',
    '',
    'If no update is warranted, do not call any tool. Reply exactly: No prompt-memory changes.',
  ].join('\n')
}

function denyPromptMemoryReviewTool(tool: Tool, reason: string) {
  logForDebugging(`[prompt-memory-review] denied ${tool.name}: ${reason}`)
  return {
    behavior: 'deny' as const,
    message: reason,
    decisionReason: { type: 'other' as const, reason },
  }
}

function createPromptMemoryReviewCanUseTool(): CanUseToolFn {
  return async (tool, input) => {
    if (tool.name !== PROMPT_MEMORY_TOOL_NAME) {
      return denyPromptMemoryReviewTool(
        tool,
        'Automatic prompt-memory review can only use the PromptMemory tool.',
      )
    }

    const action = input.action
    const target = input.target
    if (action === 'status' || action === 'read') {
      return { behavior: 'allow' as const, updatedInput: input }
    }
    if (
      (action === 'add' || action === 'replace' || action === 'remove') &&
      (target === 'brief' || target === 'user')
    ) {
      return { behavior: 'allow' as const, updatedInput: input }
    }

    return denyPromptMemoryReviewTool(
      tool,
      'Automatic prompt-memory review may only add, replace, or remove BRIEF.md/USER.md entries.',
    )
  }
}

function toolResultContentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        return (block as { text: string }).text
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function safeParseToolResult(content: unknown): Record<string, unknown> | null {
  const text = toolResultContentToText(content).trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function coerceMutationAction(value: unknown): PromptMemoryAction | null {
  return value === 'add' || value === 'replace' || value === 'remove'
    ? value
    : null
}

function coerceEntryTarget(value: unknown): PromptMemoryEntryTarget | null {
  return value === 'brief' || value === 'user' ? value : null
}

function truncateLogText(text: string | undefined): string | undefined {
  if (!text) return undefined
  const trimmed = text.trim()
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed
}

export function extractPromptMemoryAutoReviewLogs(params: {
  messages: Message[]
  sessionId: string
  trigger: ReviewTrigger
}): PromptMemoryAutoReviewLogEntry[] {
  const toolInputs = new Map<string, Record<string, unknown>>()
  const entries: PromptMemoryAutoReviewLogEntry[] = []

  for (const message of params.messages) {
    if (message.type === 'assistant') {
      const content = (message as { message?: { content?: unknown } }).message
        ?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        const toolUse = getPromptMemoryToolInput(block)
        if (toolUse) toolInputs.set(toolUse.id, toolUse.input)
      }
      continue
    }

    if (message.type !== 'user') continue
    const content = (message as { message?: { content?: unknown } }).message
      ?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (
        typeof block !== 'object' ||
        block === null ||
        (block as { type?: unknown }).type !== 'tool_result'
      ) {
        continue
      }
      const toolUseId = (block as { tool_use_id?: unknown }).tool_use_id
      if (typeof toolUseId !== 'string') continue
      const input = toolInputs.get(toolUseId)
      if (!input) continue

      const action = coerceMutationAction(input.action)
      const target = coerceEntryTarget(input.target)
      if (!action || !target) continue

      const output = safeParseToolResult((block as { content?: unknown }).content)
      if (!output || output.changed !== true) continue

      entries.push({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sessionId: params.sessionId,
        trigger: params.trigger,
        target,
        action,
        changed: true,
        content: truncateLogText(
          typeof input.content === 'string' ? input.content : undefined,
        ),
        oldText: truncateLogText(
          typeof input.oldText === 'string' ? input.oldText : undefined,
        ),
        message:
          typeof output.message === 'string'
            ? output.message
            : 'Prompt memory updated.',
      })
    }
  }

  return entries
}

export async function appendPromptMemoryAutoReviewLogs(
  entries: PromptMemoryAutoReviewLogEntry[],
): Promise<void> {
  if (entries.length === 0) return
  const logPath = getAutoReviewLogPath()
  await mkdir(dirname(logPath), { recursive: true })
  await appendFile(
    logPath,
    entries.map(entry => jsonStringify(entry)).join('\n') + '\n',
    'utf-8',
  )
}

export async function readPromptMemoryAutoReviewLogs(
  limit = 50,
): Promise<PromptMemoryAutoReviewLogEntry[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 200))
  try {
    const raw = await readFile(getAutoReviewLogPath(), 'utf-8')
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as PromptMemoryAutoReviewLogEntry
        } catch {
          return null
        }
      })
      .filter((entry): entry is PromptMemoryAutoReviewLogEntry => entry !== null)
      .reverse()
      .slice(0, boundedLimit)
  } catch {
    return []
  }
}

function summarizeLogEntries(entries: PromptMemoryAutoReviewLogEntry[]): string {
  if (entries.length === 0) return 'no prompt-memory changes'
  return entries
    .map(entry => `${entry.action} ${entry.target}`)
    .join(', ')
}

function formatPromptMemoryTargetLabel(target: PromptMemoryEntryTarget): string {
  return target === 'brief' ? 'BRIEF' : 'USER'
}

export function formatPromptMemoryAutoReviewNotice(
  entries: PromptMemoryAutoReviewLogEntry[],
): string | null {
  if (entries.length === 0) return null

  const targets = Array.from(
    new Set(entries.map(entry => formatPromptMemoryTargetLabel(entry.target))),
  ).sort((a, b) => (a === 'BRIEF' ? -1 : b === 'BRIEF' ? 1 : 0))
  const countText = entries.length > 1 ? `（${entries.length} 条）` : ''
  return `提示记忆已更新：${targets.join(' / ')}${countText}，将在新会话生效。`
}

async function runPromptMemoryAutoReview({
  context,
  trigger,
  isTrailingRun,
}: PendingReview & { isTrailingRun?: boolean }): Promise<void> {
  const messagesSince = getMessagesSince(context.messages, lastReviewedMessageUuid)
  const newVisibleMessages = countVisibleMessages(messagesSince)
  if (newVisibleMessages === 0) return

  if (hasPromptMemoryMutation(messagesSince)) {
    const lastMessage = context.messages.at(-1)
    if (lastMessage?.uuid) lastReviewedMessageUuid = lastMessage.uuid
    logForDebugging(
      '[prompt-memory-review] skipped because the main agent already mutated prompt memory',
    )
    return
  }

  inProgress = true
  try {
    const [brief, user] = await Promise.all([
      readPromptMemoryFile('brief'),
      readPromptMemoryFile('user'),
    ])

    const prompt = buildPromptMemoryAutoReviewPrompt({
      newMessageCount: newVisibleMessages,
      trigger,
      briefEntries: brief.entries,
      userEntries: user.entries,
    })

    const result = await runForkedAgent({
      promptMessages: [createUserMessage({ content: prompt })],
      cacheSafeParams: createCacheSafeParams(context),
      canUseTool: createPromptMemoryReviewCanUseTool(),
      querySource: 'prompt_memory_review' as QuerySource,
      forkLabel: 'prompt_memory_review',
      skipTranscript: true,
      skipCacheWrite: true,
      maxTurns: 4,
    })

    const logEntries = extractPromptMemoryAutoReviewLogs({
      messages: result.messages,
      sessionId: getSessionId(),
      trigger,
    })
    await appendPromptMemoryAutoReviewLogs(logEntries)
    const notice = formatPromptMemoryAutoReviewNotice(logEntries)
    if (notice) {
      context.toolUseContext.appendSystemMessage?.(
        createSystemMessage(
          notice,
          'suggestion',
          PROMPT_MEMORY_AUTO_REVIEW_TOOL_USE_ID,
        ),
      )
    }

    const lastMessage = context.messages.at(-1)
    if (lastMessage?.uuid) lastReviewedMessageUuid = lastMessage.uuid

    logForDebugging(
      `[prompt-memory-review] finished (${trigger}${isTrailingRun ? ', trailing' : ''}): ${summarizeLogEntries(logEntries)}`,
    )
  } catch (error) {
    logForDebugging(
      `[prompt-memory-review] error: ${errorMessage(error)}`,
      { level: 'debug' },
    )
  } finally {
    inProgress = false
    const trailing = pendingReview
    pendingReview = undefined
    if (trailing) {
      await runPromptMemoryAutoReview({ ...trailing, isTrailingRun: true })
    }
  }
}

async function executePromptMemoryAutoReviewImpl(
  context: REPLHookContext,
): Promise<void> {
  if (context.toolUseContext.agentId) return
  if (context.querySource === ('prompt_memory_review' as QuerySource)) return
  if (!isAutoMemoryEnabled()) return

  const decision = shouldRunPromptMemoryAutoReview({
    messages: context.messages,
    sinceUuid: lastSeenMessageUuid,
    turnsSinceLastReview,
    intervalTurns: getReviewIntervalTurns(),
  })

  const lastMessage = context.messages.at(-1)
  if (lastMessage?.uuid) {
    lastSeenMessageUuid = lastMessage.uuid
  }

  turnsSinceLastReview = decision.nextTurnCount
  if (!decision.shouldRun || !decision.trigger) return

  if (inProgress) {
    pendingReview = { context, trigger: decision.trigger }
    return
  }

  await runPromptMemoryAutoReview({
    context,
    trigger: decision.trigger,
  })
}

export async function executePromptMemoryAutoReview(
  context: REPLHookContext,
): Promise<void> {
  const review = executePromptMemoryAutoReviewImpl(context)
  inFlightReviews.add(review)
  try {
    await review
  } finally {
    inFlightReviews.delete(review)
  }
}

export async function drainPendingPromptMemoryAutoReview(
  timeoutMs = 60_000,
): Promise<void> {
  if (inFlightReviews.size === 0) return
  await Promise.race([
    Promise.all(inFlightReviews).catch(() => {}),
    // eslint-disable-next-line no-restricted-syntax -- sleep() has no .unref(); timer must not block exit
    new Promise<void>(resolve => setTimeout(resolve, timeoutMs).unref()),
  ])
}

export function resetPromptMemoryAutoReviewForTesting(): void {
  lastReviewedMessageUuid = undefined
  lastSeenMessageUuid = undefined
  turnsSinceLastReview = 0
  inProgress = false
  pendingReview = undefined
  inFlightReviews.clear()
}

export const promptMemoryAutoReviewPathsForTesting = {
  getAutoReviewLogPath,
  getBriefPath,
  getUserPromptMemoryPath,
}
