/**
 * Session Service — 会话文件的读写操作封装
 *
 * 读写 CLI 持久化在 ~/.cyber/projects/{sanitized_path}/{sessionId}.jsonl 的会话数据，
 * 确保 Desktop App 与 CLI 的数据完全互通。
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ApiError } from '../middleware/errorHandler.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { sanitizePath as sanitizePortablePath } from '../../utils/sessionStoragePortable.js'
import {
  deleteSessionFromSearchIndex,
  indexSessionSearchFile,
} from '../../sessionSearch/indexer.js'
import { stripProjectMemoryContext } from '../../sessionSearch/projectMemoryContext.js'
import type { FileHistorySnapshot } from '../../utils/fileHistory.js'
import { calculateUSDCost, MODEL_COSTS } from '../../utils/modelCost.js'
import {
  MODEL_CONTEXT_WINDOW_DEFAULT,
  getContextWindowForModel,
  getModelMaxOutputTokens,
} from '../../utils/context.js'
import { getCanonicalName } from '../../utils/model/model.js'

// ============================================================================
// Types
// ============================================================================

export type SessionListItem = {
  id: string
  title: string
  lastMessage: string
  createdAt: string
  modifiedAt: string
  messageCount: number
  projectPath: string
  workDir: string | null
  workDirExists: boolean
  isTemporary: boolean
}

export type SessionDetail = SessionListItem & {
  messages: MessageEntry[]
}

export type CreateSessionOptions = {
  workDir?: string
  temporary?: boolean
}

export type BranchSessionResult = {
  sessionId: string
  sourceSessionId: string
  targetAssistantMessageId: string
  session: SessionListItem
}

export type SessionLaunchInfo = {
  filePath: string
  projectDir: string
  workDir: string
  transcriptMessageCount: number
  customTitle: string | null
  isTemporary: boolean
}

export type TrimSessionResult = {
  removedCount: number
  removedMessageIds: string[]
}

export type MessageEntry = {
  id: string
  type: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result'
  content: unknown
  timestamp: string
  model?: string
  parentUuid?: string
  parentToolUseId?: string
  isSidechain?: boolean
}

export type TranscriptUsageSnapshot = {
  source: 'transcript'
  totalCostUSD: number
  costDisplay: string
  hasUnknownModelCost: boolean
  totalAPIDuration: number
  totalDuration: number
  totalLinesAdded: number
  totalLinesRemoved: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadInputTokens: number
  totalCacheCreationInputTokens: number
  totalWebSearchRequests: number
  models: Array<{
    model: string
    displayName: string
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
    webSearchRequests: number
    costUSD: number
    costDisplay: string
    contextWindow: number
    maxOutputTokens: number
  }>
}

export type TranscriptMetadataSnapshot = {
  model?: string
  cwd?: string
  version?: string
}

type TranscriptTokenUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export type TranscriptContextEstimate = {
  categories: Array<{
    name: string
    tokens: number
    color: string
    isDeferred?: boolean
  }>
  totalTokens: number
  maxTokens: number
  rawMaxTokens: number
  percentage: number
  gridRows: Array<Array<{
    color: string
    isFilled: boolean
    categoryName: string
    tokens: number
    percentage: number
    squareFullness: number
  }>>
  model: string
  memoryFiles: Array<{ path: string; type: string; tokens: number }>
  mcpTools: Array<{ name: string; serverName: string; tokens: number; isLoaded?: boolean }>
  agents: Array<{ agentType: string; source: string; tokens: number }>
  apiUsage: TranscriptTokenUsage
  latestTurnUsage: TranscriptTokenUsage
}

/** Raw entry parsed from a single JSONL line */
type RawEntry = {
  type?: string
  uuid?: string
  messageId?: string
  parentUuid?: string | null
  parent_tool_use_id?: string | null
  isSidechain?: boolean
  isMeta?: boolean
  cwd?: string
  message?: {
    role?: string
    content?: unknown
    model?: string
    id?: string
    type?: string
    stop_reason?: string | null
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
      server_tool_use?: {
        web_search_requests?: number
      }
      speed?: string
    }
  }
  timestamp?: string
  version?: string
  snapshot?: {
    messageId?: string
    trackedFileBackups?: Record<string, unknown>
    timestamp?: string
  }
  customTitle?: string
  title?: string
  [key: string]: unknown
}

function isTranscriptUserTurnBoundary(entry: RawEntry): boolean {
  if (
    entry.type !== 'user' ||
    entry.message?.role !== 'user' ||
    entry.isMeta === true ||
    entry.isSidechain === true
  ) {
    return false
  }

  const content = entry.message.content
  if (typeof content === 'string') return content.trim().length > 0
  if (!Array.isArray(content) || content.length === 0) return false

  const blockTypes = content.map((block) =>
    block && typeof block === 'object'
      ? (block as Record<string, unknown>).type
      : undefined,
  )
  return !blockTypes.includes('tool_result')
}

function emptyTranscriptTokenUsage(): TranscriptTokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
}

type TranscriptUsageRecord = {
  model: string
  usage: TranscriptTokenUsage
  webSearchRequests: number
  speed?: string
  timestamp?: string
  turnIndex: number
  order: number
  isTerminal: boolean
}

function transcriptTokenTotal(usage: TranscriptTokenUsage): number {
  return (
    usage.input_tokens +
    usage.output_tokens +
    usage.cache_read_input_tokens +
    usage.cache_creation_input_tokens
  )
}

function addTranscriptTokenUsage(
  total: TranscriptTokenUsage,
  usage: TranscriptTokenUsage,
): void {
  total.input_tokens += usage.input_tokens
  total.output_tokens += usage.output_tokens
  total.cache_read_input_tokens += usage.cache_read_input_tokens
  total.cache_creation_input_tokens += usage.cache_creation_input_tokens
}

function shouldReplaceTranscriptUsageRecord(
  current: TranscriptUsageRecord,
  candidate: TranscriptUsageRecord,
): boolean {
  if (current.isTerminal !== candidate.isTerminal) return candidate.isTerminal

  const currentTotal = transcriptTokenTotal(current.usage)
  const candidateTotal = transcriptTokenTotal(candidate.usage)
  if (currentTotal !== candidateTotal) return candidateTotal > currentTotal

  return candidate.order > current.order
}

function summarizeTranscriptUsage(entries: RawEntry[]): {
  records: TranscriptUsageRecord[]
  latestRequest: TranscriptUsageRecord | null
  latestTurnUsage: TranscriptTokenUsage
} {
  const recordsByKey = new Map<string, TranscriptUsageRecord>()
  let turnIndex = 0
  let latestUserTurnIndex = 0

  entries.forEach((entry, order) => {
    if (isTranscriptUserTurnBoundary(entry)) {
      turnIndex += 1
      latestUserTurnIndex = turnIndex
    }

    const rawUsage = entry.message?.usage
    const model = entry.message?.model
    if (!rawUsage || typeof model !== 'string') return

    const usage: TranscriptTokenUsage = {
      input_tokens: typeof rawUsage.input_tokens === 'number' ? rawUsage.input_tokens : 0,
      output_tokens: typeof rawUsage.output_tokens === 'number' ? rawUsage.output_tokens : 0,
      cache_read_input_tokens:
        typeof rawUsage.cache_read_input_tokens === 'number'
          ? rawUsage.cache_read_input_tokens
          : 0,
      cache_creation_input_tokens:
        typeof rawUsage.cache_creation_input_tokens === 'number'
          ? rawUsage.cache_creation_input_tokens
          : 0,
    }
    const webSearchRequests =
      typeof rawUsage.server_tool_use?.web_search_requests === 'number'
        ? rawUsage.server_tool_use.web_search_requests
        : 0
    if (transcriptTokenTotal(usage) === 0 && webSearchRequests === 0) return

    const messageId = entry.message?.id?.trim()
    const key = messageId
      ? `${turnIndex}\0${model}\0${messageId}`
      : `entry\0${order}`
    const candidate: TranscriptUsageRecord = {
      model,
      usage,
      webSearchRequests,
      speed: rawUsage.speed,
      timestamp: entry.timestamp,
      turnIndex,
      order,
      isTerminal:
        typeof entry.message?.stop_reason === 'string' &&
        entry.message.stop_reason.length > 0,
    }
    const current = recordsByKey.get(key)
    if (!current || shouldReplaceTranscriptUsageRecord(current, candidate)) {
      recordsByKey.set(key, candidate)
    }
  })

  const records = Array.from(recordsByKey.values()).sort((a, b) => a.order - b.order)
  const tokenRecords = records.filter((record) => transcriptTokenTotal(record.usage) > 0)
  const latestTurnUsage = emptyTranscriptTokenUsage()
  for (const record of tokenRecords) {
    if (record.turnIndex === latestUserTurnIndex) {
      addTranscriptTokenUsage(latestTurnUsage, record.usage)
    }
  }

  return {
    records,
    latestRequest: tokenRecords.at(-1) ?? null,
    latestTurnUsage,
  }
}

type ContentBlock = Record<string, unknown>
type SessionFileLocator = { projectPath?: string }
type HistoryLogEntry = {
  display?: string
  pastedContents?: Record<string, unknown>
  timestamp?: number | string
  project?: string
  sessionId?: string
}

const USER_INTERRUPTION_TEXTS = new Set([
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
])

const NO_RESPONSE_REQUESTED_TEXT = 'No response requested.'
const RECENT_HISTORY_CHUNK_BYTES = 256 * 1024
const RECENT_HISTORY_LOOKBACK_MESSAGES = 32

// ============================================================================
// Service
// ============================================================================

export class SessionService {
  // --------------------------------------------------------------------------
  // Config helpers
  // --------------------------------------------------------------------------

  private getConfigDir(): string {
    return getClaudeConfigHomeDir()
  }

  private getProjectsDir(): string {
    return path.join(this.getConfigDir(), 'projects')
  }

  /**
   * Sanitize a path the same way the shared session storage does.
   * This must remain Windows-safe, so reserved characters such as ':' are normalized too.
   */
  private sanitizePath(dirPath: string): string {
    return sanitizePortablePath(dirPath)
  }

  // --------------------------------------------------------------------------
  // JSONL parsing
  // --------------------------------------------------------------------------

  private async readJsonlFile(filePath: string): Promise<RawEntry[]> {
    let content: string
    try {
      content = await fs.readFile(filePath, 'utf-8')
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw err
    }

    const entries: RawEntry[] = []
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        entries.push(JSON.parse(trimmed) as RawEntry)
      } catch {
        // skip malformed lines
      }
    }
    return entries
  }

  /**
   * Read only the newest transcript entries without parsing the whole JSONL file.
   * Session files can contain multi-megabyte tool results, so a normal readFile()
   * makes a simple tab switch pay for every old screenshot and command output.
   */
  private async readRecentJsonlEntries(
    filePath: string,
    targetMessageCount: number,
  ): Promise<{ entries: RawEntry[]; hasEarlierEntries: boolean }> {
    let file: fs.FileHandle
    try {
      file = await fs.open(filePath, 'r')
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { entries: [], hasEarlierEntries: false }
      }
      throw err
    }

    try {
      const { size } = await file.stat()
      if (size === 0) return { entries: [], hasEarlierEntries: false }

      const reversedEntries: RawEntry[] = []
      let visibleMessageCount = 0
      let position = size
      let partialLine = Buffer.alloc(0)

      while (position > 0) {
        const start = Math.max(0, position - RECENT_HISTORY_CHUNK_BYTES)
        const length = position - start
        const chunk = Buffer.allocUnsafe(length)
        const { bytesRead } = await file.read(chunk, 0, length, start)
        const combined = Buffer.concat([chunk.subarray(0, bytesRead), partialLine])

        let completeLines: Buffer
        if (start === 0) {
          completeLines = combined
          partialLine = Buffer.alloc(0)
        } else {
          const firstNewline = combined.indexOf(0x0a)
          if (firstNewline < 0) {
            // A single JSONL record can be larger than a chunk (for example a
            // screenshot tool result). Keep collecting until its start arrives.
            partialLine = combined
            position = start
            continue
          }
          partialLine = Buffer.from(combined.subarray(0, firstNewline))
          completeLines = combined.subarray(firstNewline + 1)
        }

        const lines = completeLines.toString('utf-8').split('\n')
        for (let index = lines.length - 1; index >= 0; index -= 1) {
          const trimmed = lines[index]?.trim()
          if (!trimmed) continue
          try {
            const entry = JSON.parse(trimmed) as RawEntry
            reversedEntries.push(entry)
            if (this.isVisibleTranscriptEntry(entry)) {
              visibleMessageCount += 1
            }
          } catch {
            // Match readJsonlFile(): incomplete or malformed records are ignored.
          }
        }

        position = start
        if (visibleMessageCount >= targetMessageCount) break
      }

      return {
        entries: reversedEntries.reverse(),
        hasEarlierEntries: position > 0,
      }
    } finally {
      await file.close()
    }
  }

  private async appendJsonlEntry(filePath: string, entry: Record<string, unknown>): Promise<void> {
    const line = JSON.stringify(entry) + '\n'
    await fs.appendFile(filePath, line, 'utf-8')
  }

  private async syncSessionSearchIndex(file: {
    filePath: string
    projectDir: string
    sessionId: string
  }): Promise<void> {
    try {
      await indexSessionSearchFile({
        filePath: file.filePath,
        projectPath: file.projectDir,
        sessionId: file.sessionId,
      })
    } catch (error) {
      console.warn(
        `[SessionService] session search index sync failed for ${file.sessionId}:`,
        error,
      )
    }
  }

  private async removeSessionSearchIndex(
    sessionId: string,
    projectDir?: string,
  ): Promise<void> {
    try {
      await deleteSessionFromSearchIndex({
        sessionId,
        projectPath: projectDir,
      })
    } catch (error) {
      console.warn(
        `[SessionService] session search index delete failed for ${sessionId}:`,
        error,
      )
    }
  }

  private resolveWorkDirFromEntries(
    entries: RawEntry[],
    fallbackProjectDir?: string,
  ): string | null {
    for (const entry of entries) {
      if (entry.type === 'session-meta' && typeof (entry as Record<string, unknown>).workDir === 'string') {
        return (entry as Record<string, unknown>).workDir as string
      }
    }

    for (let i = entries.length - 1; i >= 0; i--) {
      const cwd = entries[i]?.cwd
      if (typeof cwd === 'string' && cwd.trim()) {
        return cwd
      }
    }

    return fallbackProjectDir ? this.desanitizePath(fallbackProjectDir) : null
  }

  private resolveIsTemporaryFromEntries(entries: RawEntry[]): boolean {
    return entries.some((entry) =>
      entry.type === 'session-meta' &&
      (entry as Record<string, unknown>).isTemporary === true
    )
  }

  private isMainTranscriptEntry(entry: RawEntry): boolean {
    if (entry.isMeta === true || entry.isSidechain === true) return false
    if (entry.type === 'attachment') return true
    return (
      (entry.type === 'user' || entry.type === 'assistant' || entry.type === 'system') &&
      typeof entry.message?.role === 'string'
    )
  }

  private extractToolUseIds(content: unknown): string[] {
    if (!Array.isArray(content)) return []
    return content.flatMap((block) => {
      if (!block || typeof block !== 'object') return []
      const record = block as Record<string, unknown>
      return record.type === 'tool_use' && typeof record.id === 'string'
        ? [record.id]
        : []
    })
  }

  private extractToolResultIds(content: unknown): string[] {
    if (!Array.isArray(content)) return []
    return content.flatMap((block) => {
      if (!block || typeof block !== 'object') return []
      const record = block as Record<string, unknown>
      return record.type === 'tool_result' && typeof record.tool_use_id === 'string'
        ? [record.tool_use_id]
        : []
    })
  }

  private normalizeBranchGuardText(value: string): string {
    return value.replace(/\r\n/g, '\n').trim()
  }

  private async getUniqueBranchTitle(sourceTitle: string, workDir: string): Promise<string> {
    const baseTitle = sourceTitle.replace(/\s+\(Branch(?: \d+)?\)$/i, '').trim() || 'Untitled Session'
    const { sessions } = await this.listSessions({
      project: workDir,
      limit: Number.MAX_SAFE_INTEGER,
    })
    const existingTitles = new Set(sessions.map((session) => session.title))

    const firstCandidate = `${baseTitle} (Branch)`
    if (!existingTitles.has(firstCandidate)) return firstCandidate

    let suffix = 2
    while (existingTitles.has(`${baseTitle} (Branch ${suffix})`)) {
      suffix += 1
    }
    return `${baseTitle} (Branch ${suffix})`
  }

  // --------------------------------------------------------------------------
  // Entry → MessageEntry conversion
  // --------------------------------------------------------------------------

  private entryToMessage(
    entry: RawEntry,
    parentToolUseId?: string,
  ): MessageEntry | null {
    const msg = entry.message
    if (!msg || !msg.role) return null
    const content = this.stripProjectMemoryContextFromContent(msg.content)

    // Determine our normalized type
    let type: MessageEntry['type']
    const role = msg.role

    if (role === 'user') {
      // Check if the content is a tool_result array
      if (Array.isArray(content)) {
        const hasToolResult = content.some(
          (block: Record<string, unknown>) => block.type === 'tool_result'
        )
        if (hasToolResult) {
          type = 'tool_result'
        } else {
          type = 'user'
        }
      } else {
        type = 'user'
      }
    } else if (role === 'assistant') {
      // Check if the content contains tool_use blocks
      if (Array.isArray(content)) {
        const hasToolUse = content.some(
          (block: Record<string, unknown>) => block.type === 'tool_use'
        )
        type = hasToolUse ? 'tool_use' : 'assistant'
      } else {
        type = 'assistant'
      }
    } else {
      type = 'system'
    }

    return {
      id: entry.uuid || crypto.randomUUID(),
      type,
      content,
      timestamp: entry.timestamp || new Date().toISOString(),
      model: msg.model,
      parentUuid: entry.parentUuid ?? undefined,
      parentToolUseId,
      isSidechain: entry.isSidechain,
    }
  }

  private extractTextBlocks(content: unknown): string[] {
    if (typeof content === 'string') return [stripProjectMemoryContext(content)]
    if (!Array.isArray(content)) return []

    return content
      .flatMap((block) => {
        if (!block || typeof block !== 'object') return []
        const record = block as Record<string, unknown>
        return record.type === 'text' && typeof record.text === 'string'
          ? [stripProjectMemoryContext(record.text)]
          : []
      })
      .map((text) => text.trim())
      .filter(Boolean)
  }

  private isInternalCommandBreadcrumb(content: unknown): boolean {
    if (typeof content !== 'string') return false

    return (
      content.includes('<command-name>') ||
      content.includes('<command-message>') ||
      content.includes('<command-args>') ||
      content.includes('<local-command-caveat>')
    )
  }

  private isSyntheticUserInterruption(content: unknown): boolean {
    const textBlocks = this.extractTextBlocks(content)
    return (
      textBlocks.length > 0 &&
      textBlocks.every((text) => USER_INTERRUPTION_TEXTS.has(text))
    )
  }

  private isSyntheticNoResponseAssistant(content: unknown): boolean {
    const textBlocks = this.extractTextBlocks(content)
    return (
      textBlocks.length > 0 &&
      textBlocks.every((text) => text === NO_RESPONSE_REQUESTED_TEXT)
    )
  }

  private shouldHideTranscriptEntry(entry: RawEntry): boolean {
    const role = entry.message?.role
    const content = entry.message?.content

    if (role === 'user') {
      return (
        this.isInternalCommandBreadcrumb(content) ||
        this.isSyntheticUserInterruption(content)
      )
    }

    if (role === 'assistant') {
      return this.isSyntheticNoResponseAssistant(content)
    }

    return false
  }

  private isVisibleTranscriptEntry(entry: RawEntry): boolean {
    if (!entry.message?.role || entry.isMeta) return false
    if (this.shouldHideTranscriptEntry(entry)) return false
    return entry.type === 'user' || entry.type === 'assistant' || entry.type === 'system'
  }

  private extractAgentToolUseId(entry: RawEntry): string | undefined {
    const content = entry.message?.content
    if (!Array.isArray(content)) return undefined

    for (const block of content as Array<Record<string, unknown>>) {
      if (
        block.type === 'tool_use' &&
        block.name === 'Agent' &&
        typeof block.id === 'string'
      ) {
        return block.id
      }
    }

    return undefined
  }

  private extractAgentToolUseIdsFromMessage(message: MessageEntry): string[] {
    if (message.type !== 'tool_use' || !Array.isArray(message.content)) {
      return []
    }

    return (message.content as ContentBlock[])
      .filter((block) => block.type === 'tool_use' && block.name === 'Agent')
      .flatMap((block) => (typeof block.id === 'string' ? [block.id] : []))
  }

  private extractTextFromContent(content: unknown): string {
    if (typeof content === 'string') return stripProjectMemoryContext(content)
    if (!Array.isArray(content)) return ''

    return (content as ContentBlock[])
      .flatMap((block) => (
        typeof block.text === 'string'
          ? [stripProjectMemoryContext(block.text)]
          : []
      ))
      .join('\n')
  }

  private stripProjectMemoryContextFromContent(content: unknown): unknown {
    if (typeof content === 'string') return stripProjectMemoryContext(content)
    if (!Array.isArray(content)) return content

    return (content as ContentBlock[]).map((block) => {
      if (!block || typeof block !== 'object') return block
      if (typeof block.text === 'string') {
        return {
          ...block,
          text: stripProjectMemoryContext(block.text),
        }
      }
      if (typeof block.content === 'string') {
        return {
          ...block,
          content: stripProjectMemoryContext(block.content),
        }
      }
      return block
    })
  }

  private extractAgentIdFromResultText(text: string): string | undefined {
    const match = text.match(/(?:^|\n)\s*agentId:\s*([A-Za-z0-9_-]+)/)
    return match?.[1]
  }

  private extractAgentResultLinks(messages: MessageEntry[]): Map<string, string> {
    const agentToolUseIds = new Set(
      messages.flatMap((message) => this.extractAgentToolUseIdsFromMessage(message)),
    )
    const resultLinks = new Map<string, string>()

    for (const message of messages) {
      if (message.type !== 'tool_result' || !Array.isArray(message.content)) {
        continue
      }

      for (const block of message.content as ContentBlock[]) {
        if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') {
          continue
        }
        if (!agentToolUseIds.has(block.tool_use_id)) {
          continue
        }

        const agentId = this.extractAgentIdFromResultText(
          this.extractTextFromContent(block.content),
        )
        if (agentId) {
          resultLinks.set(block.tool_use_id, agentId)
        }
      }
    }

    return resultLinks
  }

  private namespaceSubagentContentIds(content: unknown, namespace: string): unknown {
    if (!Array.isArray(content)) return content

    return (content as ContentBlock[]).map((block) => {
      if (!block || typeof block !== 'object') return block
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        return { ...block, id: `${namespace}/${block.id}` }
      }
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        return { ...block, tool_use_id: `${namespace}/${block.tool_use_id}` }
      }
      return block
    })
  }

  private subagentTranscriptPath(
    projectDir: string,
    sessionId: string,
    agentId: string,
  ): string {
    const normalizedAgentId = agentId.startsWith('agent-') ? agentId : `agent-${agentId}`
    return path.join(
      this.getProjectsDir(),
      projectDir,
      sessionId,
      'subagents',
      `${normalizedAgentId}.jsonl`,
    )
  }

  private async loadSubagentToolMessages(
    projectDir: string,
    sessionId: string,
    parentToolUseId: string,
    agentId: string,
  ): Promise<MessageEntry[]> {
    const filePath = this.subagentTranscriptPath(projectDir, sessionId, agentId)
    const entries = await this.readJsonlFile(filePath)
    const namespace = `${parentToolUseId}/${agentId}`
    const messages: MessageEntry[] = []

    for (const entry of entries) {
      if (!entry.message?.role || entry.isMeta) continue
      if (this.shouldHideTranscriptEntry(entry)) continue
      if (entry.type !== 'user' && entry.type !== 'assistant' && entry.type !== 'system') {
        continue
      }

      const message = this.entryToMessage(
        {
          ...entry,
          message: {
            ...entry.message,
            content: this.namespaceSubagentContentIds(entry.message.content, namespace),
          },
        },
        parentToolUseId,
      )
      if (message && (message.type === 'tool_use' || message.type === 'tool_result')) {
        messages.push(message)
      }
    }

    return messages
  }

  private async appendSubagentToolMessages(
    projectDir: string,
    sessionId: string,
    messages: MessageEntry[],
  ): Promise<MessageEntry[]> {
    const resultLinks = this.extractAgentResultLinks(messages)
    if (resultLinks.size === 0) {
      return messages
    }

    const childMessages = await Promise.all(
      [...resultLinks.entries()].map(([parentToolUseId, agentId]) =>
        this.loadSubagentToolMessages(projectDir, sessionId, parentToolUseId, agentId),
      ),
    )
    return [...messages, ...childMessages.flat()]
  }

  private resolveParentToolUseId(
    entry: RawEntry,
    entriesByUuid: Map<string, RawEntry>,
    cache: Map<string, string | undefined>,
  ): string | undefined {
    if (
      typeof entry.parent_tool_use_id === 'string' &&
      entry.parent_tool_use_id.length > 0
    ) {
      return entry.parent_tool_use_id
    }

    if (entry.isSidechain !== true) {
      return undefined
    }

    const cacheKey = entry.uuid
    if (cacheKey && cache.has(cacheKey)) {
      return cache.get(cacheKey)
    }

    let resolved: string | undefined
    let currentParentUuid =
      typeof entry.parentUuid === 'string' ? entry.parentUuid : undefined
    const visited = new Set<string>()

    while (currentParentUuid && !visited.has(currentParentUuid)) {
      visited.add(currentParentUuid)
      const parentEntry = entriesByUuid.get(currentParentUuid)
      if (!parentEntry) break

      const directAgentToolUseId = this.extractAgentToolUseId(parentEntry)
      if (directAgentToolUseId) {
        resolved = directAgentToolUseId
        break
      }

      if (parentEntry.uuid && cache.has(parentEntry.uuid)) {
        resolved = cache.get(parentEntry.uuid)
        break
      }

      currentParentUuid =
        typeof parentEntry.parentUuid === 'string'
          ? parentEntry.parentUuid
          : undefined
    }

    if (cacheKey) {
      cache.set(cacheKey, resolved)
    }

    return resolved
  }

  // --------------------------------------------------------------------------
  // Title extraction
  // --------------------------------------------------------------------------

  private extractTitle(entries: RawEntry[]): string {
    // 1. Look for custom title entry (appended by renameSession) — highest priority
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!
      if (e.type === 'custom-title' && e.customTitle) {
        return e.customTitle
      }
    }

    // 2. Look for first non-meta user message as title
    for (const e of entries) {
      if (e.type === 'user' && !e.isMeta && e.message?.role === 'user') {
        const content = e.message.content
        let text: string | undefined
        if (typeof content === 'string') {
          text = stripProjectMemoryContext(content)
        } else if (Array.isArray(content)) {
          const textBlock = content.find(
            (block: Record<string, unknown>) => block.type === 'text' && typeof block.text === 'string'
          )
          if (textBlock) text = stripProjectMemoryContext(textBlock.text as string)
        }
        if (text) {
          return text.length > 80 ? text.slice(0, 80) + '...' : text
        }
      }
    }

    // 3. Fall back to older AI-generated titles for legacy sessions that do
    // not have a readable first user message.
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!
      if (e.type === 'ai-title' && e.aiTitle) {
        return e.aiTitle as string
      }
    }

    return 'Untitled Session'
  }

  private extractLastMessage(entries: RawEntry[]): string {
    // Walk backward from the end to find the latest user or assistant message
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!
      if (e.isMeta || !e.message?.role) continue
      if (e.type !== 'user' && e.type !== 'assistant') continue
      if (this.shouldHideTranscriptEntry(e)) continue

      const text = this.extractTextFromContent(e.message.content)
      if (text) {
        return text.length > 80 ? text.slice(0, 80) + '...' : text
      }
    }

    return ''
  }

  // --------------------------------------------------------------------------
  // Session file discovery
  // --------------------------------------------------------------------------

  /**
   * Find all .jsonl session files across all project directories.
   * Returns an array of { filePath, projectDir, sessionId }.
   */
  private async discoverSessionFiles(projectFilter?: string): Promise<
    Array<{ filePath: string; projectDir: string; sessionId: string }>
  > {
    const projectsDir = this.getProjectsDir()
    let projectDirs: string[]

    try {
      projectDirs = await fs.readdir(projectsDir)
    } catch {
      return []
    }

    // Optionally filter to a specific project
    if (projectFilter) {
      const sanitized = this.sanitizePath(projectFilter)
      projectDirs = projectDirs.filter((d) => d === sanitized)
    }

    const results = new Map<
      string,
      { filePath: string; projectDir: string; sessionId: string; isPlaceholderBackup: boolean }
    >()

    for (const dir of projectDirs) {
      const dirPath = path.join(projectsDir, dir)

      // Ensure it's a directory
      try {
        const stat = await fs.stat(dirPath)
        if (!stat.isDirectory()) continue
      } catch {
        continue
      }

      let files: string[]
      try {
        files = await fs.readdir(dirPath)
      } catch {
        continue
      }

      for (const file of files) {
        const isPlaceholderBackup = file.endsWith('.jsonl.placeholder')
        if (!file.endsWith('.jsonl') && !isPlaceholderBackup) continue
        const sessionId = isPlaceholderBackup
          ? file.slice(0, -'.jsonl.placeholder'.length)
          : file.slice(0, -'.jsonl'.length)
        const key = `${dir}:${sessionId}`
        const existing = results.get(key)
        if (existing && !existing.isPlaceholderBackup) continue
        results.set(key, {
          filePath: path.join(dirPath, file),
          projectDir: dir,
          sessionId,
          isPlaceholderBackup,
        })
      }
    }

    return [...results.values()].map(({ isPlaceholderBackup: _, ...result }) => result)
  }

  private activeSessionFilePath(filePath: string): string {
    return filePath.endsWith('.jsonl.placeholder')
      ? filePath.slice(0, -'.placeholder'.length)
      : filePath
  }

  private placeholderBackupPath(filePath: string): string {
    return `${this.activeSessionFilePath(filePath)}.placeholder`
  }

  private historyLogPath(): string {
    return path.join(this.getConfigDir(), 'history.jsonl')
  }

  private async removeHistoryLogEntries(sessionId: string, projectPath?: string): Promise<void> {
    let content: string
    try {
      content = await fs.readFile(this.historyLogPath(), 'utf-8')
    } catch {
      return
    }

    let changed = false
    const keptLines: string[] = []
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as HistoryLogEntry
        const entryProjectPath =
          typeof parsed.project === 'string' ? this.sanitizePath(parsed.project) : undefined
        if (parsed.sessionId === sessionId && (!projectPath || entryProjectPath === projectPath)) {
          changed = true
          continue
        }
      } catch {
        // Keep malformed history lines untouched.
      }

      keptLines.push(line)
    }

    if (changed) {
      await fs.writeFile(
        this.historyLogPath(),
        keptLines.length > 0 ? `${keptLines.join('\n')}\n` : '',
        'utf-8',
      )
    }
  }

  private paginateMessages(
    allMessages: MessageEntry[],
    options?: { limit?: number; before?: string; after?: string },
  ): { messages: MessageEntry[]; hasMore: boolean } {
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 1000)

    if (options?.before) {
      const cursorIndex = allMessages.findIndex((m) => m.id === options.before)
      if (cursorIndex < 0) {
        return { messages: [], hasMore: false }
      }
      const sliceStart = Math.max(0, cursorIndex - limit)
      const slice = allMessages.slice(sliceStart, cursorIndex)
      return { messages: slice, hasMore: sliceStart > 0 }
    }

    if (options?.after) {
      const cursorIndex = allMessages.findIndex((m) => m.id === options.after)
      if (cursorIndex < 0) {
        return { messages: [], hasMore: false }
      }
      const sliceEnd = Math.min(allMessages.length, cursorIndex + 1 + limit)
      const slice = allMessages.slice(cursorIndex + 1, sliceEnd)
      return { messages: slice, hasMore: sliceEnd < allMessages.length }
    }

    const sliceStart = Math.max(0, allMessages.length - limit)
    const slice = allMessages.slice(sliceStart)
    return { messages: slice, hasMore: sliceStart > 0 }
  }

  /**
   * Convert a sanitized directory name back to the original absolute path.
   * Reverses sanitizePath(): `-Users-dev-workspace` → `/Users/dev/workspace`.
   */
  desanitizePath(sanitized: string): string {
    // The sanitized form replaces all '/' (and '\') with '-'.
    // On POSIX the original path starts with '/', so the sanitized form starts with '-'.
    // We restore by replacing every '-' with '/' (the platform separator).
    // On Windows the leading character would be a drive letter, but we handle POSIX here.
    return sanitized.replace(/-/g, path.sep)
  }

  /**
   * Find the .jsonl file for a given session ID.
   * Searches across all project directories since sessions may belong to any project.
   */
  async findSessionFile(
    sessionId: string,
    locator?: SessionFileLocator,
  ): Promise<{ filePath: string; projectDir: string } | null> {
    // Validate sessionId format to prevent path traversal
    if (!this.isValidSessionId(sessionId)) {
      return null
    }

    const projectsDir = this.getProjectsDir()

    if (locator?.projectPath) {
      if (!this.isValidProjectPath(locator.projectPath)) {
        return null
      }
      const filePath = path.join(projectsDir, locator.projectPath, `${sessionId}.jsonl`)
      for (const candidate of [filePath, this.placeholderBackupPath(filePath)]) {
        try {
          const stat = await fs.stat(candidate)
          if (!stat.isFile() || stat.size <= 0) continue
          return { filePath: candidate, projectDir: locator.projectPath }
        } catch {
          continue
        }
      }
      return null
    }

    let projectDirs: string[]

    try {
      projectDirs = await fs.readdir(projectsDir)
    } catch {
      return null
    }

    let latest: { filePath: string; projectDir: string; mtimeMs: number } | null = null

    for (const dir of projectDirs) {
      const filePath = path.join(projectsDir, dir, `${sessionId}.jsonl`)
      for (const candidate of [filePath, this.placeholderBackupPath(filePath)]) {
        try {
          const stat = await fs.stat(candidate)
          if (!stat.isFile() || stat.size <= 0) continue
          if (!latest || stat.mtimeMs > latest.mtimeMs) {
            latest = { filePath: candidate, projectDir: dir, mtimeMs: stat.mtimeMs }
          }
        } catch {
          continue
        }
      }
    }

    return latest ? { filePath: latest.filePath, projectDir: latest.projectDir } : null
  }

  private isValidSessionId(id: string): boolean {
    // UUID v4 format
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  }

  private isValidProjectPath(projectPath: string): boolean {
    return /^[A-Za-z0-9-]+$/.test(projectPath) && !projectPath.includes('..')
  }

  private formatCost(cost: number): string {
    return `$${cost > 0.5 ? (Math.round(cost * 100) / 100).toFixed(2) : cost.toFixed(4)}`
  }

  private getTranscriptContextWindow(model: string): number {
    try {
      return getContextWindowForModel(model)
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes('Config accessed before allowed')
      ) {
        return MODEL_CONTEXT_WINDOW_DEFAULT
      }
      throw err
    }
  }

  async getTranscriptMetadata(sessionId: string, locator?: SessionFileLocator): Promise<TranscriptMetadataSnapshot | null> {
    const found = await this.findSessionFile(sessionId, locator)
    if (!found) return null

    const entries = await this.readJsonlFile(found.filePath)
    const metadata: TranscriptMetadataSnapshot = {}

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!
      if (!metadata.model && typeof entry.message?.model === 'string') {
        metadata.model = entry.message.model
      }
      if (!metadata.cwd && typeof entry.cwd === 'string') {
        metadata.cwd = entry.cwd
      }
      if (!metadata.version && typeof entry.version === 'string') {
        metadata.version = entry.version
      }
      if (metadata.model && metadata.cwd && metadata.version) break
    }

    return metadata
  }

  async getTranscriptContextEstimate(sessionId: string, locator?: SessionFileLocator): Promise<TranscriptContextEstimate | null> {
    const found = await this.findSessionFile(sessionId, locator)
    if (!found) return null

    const entries = await this.readJsonlFile(found.filePath)
    const { latestRequest, latestTurnUsage } = summarizeTranscriptUsage(entries)
    if (!latestRequest) return null

    const latest = latestRequest.usage
    const rawMaxTokens = this.getTranscriptContextWindow(latestRequest.model)
    const totalTokens =
      latest.input_tokens +
      latest.cache_read_input_tokens +
      latest.cache_creation_input_tokens
    const percentage = rawMaxTokens > 0 ? Math.round((totalTokens / rawMaxTokens) * 100) : 0
    const categories: TranscriptContextEstimate['categories'] = [
      { name: 'Input tokens', tokens: latest.input_tokens, color: '#8f3217' },
      { name: 'Cache read', tokens: latest.cache_read_input_tokens, color: '#0f5c8f' },
      { name: 'Cache write', tokens: latest.cache_creation_input_tokens, color: '#7c3aed' },
      { name: 'Free space', tokens: Math.max(0, rawMaxTokens - totalTokens), color: '#a1a1aa', isDeferred: true },
    ].filter((category) => category.tokens > 0)

    const filledSquares = Math.max(0, Math.min(100, Math.round((totalTokens / Math.max(1, rawMaxTokens)) * 100)))
    const gridRows = Array.from({ length: 10 }, (_, row) =>
      Array.from({ length: 10 }, (_, col) => {
        const index = row * 10 + col
        const isFilled = index < filledSquares
        return {
          color: isFilled ? '#8f3217' : '#a1a1aa',
          isFilled,
          categoryName: isFilled ? 'Input context' : 'Free space',
          tokens: Math.round(rawMaxTokens / 100),
          percentage: 1,
          squareFullness: isFilled ? 1 : 0,
        }
      }),
    )

    return {
      categories,
      totalTokens,
      maxTokens: rawMaxTokens,
      rawMaxTokens,
      percentage,
      gridRows,
      model: latestRequest.model,
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      apiUsage: latest,
      latestTurnUsage,
    }
  }

  async getTranscriptUsage(sessionId: string, locator?: SessionFileLocator): Promise<TranscriptUsageSnapshot | null> {
    const found = await this.findSessionFile(sessionId, locator)
    if (!found) return null

    const entries = await this.readJsonlFile(found.filePath)
    const { records } = summarizeTranscriptUsage(entries)
    const models = new Map<string, TranscriptUsageSnapshot['models'][number]>()
    let totalCostUSD = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCacheReadInputTokens = 0
    let totalCacheCreationInputTokens = 0
    let totalWebSearchRequests = 0
    let hasUnknownModelCost = false
    let firstUsageAt: number | null = null
    let lastUsageAt: number | null = null

    for (const record of records) {
      const { model, usage, webSearchRequests } = record
      const inputTokens = usage.input_tokens
      const outputTokens = usage.output_tokens
      const cacheReadInputTokens = usage.cache_read_input_tokens
      const cacheCreationInputTokens = usage.cache_creation_input_tokens

      const canonical = getCanonicalName(model)
      if (!Object.prototype.hasOwnProperty.call(MODEL_COSTS, canonical)) {
        hasUnknownModelCost = true
      }

      const costUsage = {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: cacheReadInputTokens,
        cache_creation_input_tokens: cacheCreationInputTokens,
        server_tool_use: { web_search_requests: webSearchRequests },
        speed: record.speed,
      } as Parameters<typeof calculateUSDCost>[1]
      let costUSD = 0
      try {
        costUSD = calculateUSDCost(model, costUsage)
      } catch (err) {
        if (Object.prototype.hasOwnProperty.call(MODEL_COSTS, canonical)) {
          throw err
        }
        // Unknown model cost fallback can consult the default configured model,
        // which may require auth. Transcript reading should remain available
        // even when the current process has no auth environment.
      }

      let modelUsage = models.get(model)
      if (!modelUsage) {
        modelUsage = {
          model,
          displayName: canonical,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 0,
          costDisplay: '$0.0000',
          contextWindow: this.getTranscriptContextWindow(model),
          maxOutputTokens: getModelMaxOutputTokens(model).default,
        }
        models.set(model, modelUsage)
      }

      modelUsage.inputTokens += inputTokens
      modelUsage.outputTokens += outputTokens
      modelUsage.cacheReadInputTokens += cacheReadInputTokens
      modelUsage.cacheCreationInputTokens += cacheCreationInputTokens
      modelUsage.webSearchRequests += webSearchRequests
      modelUsage.costUSD += costUSD
      modelUsage.costDisplay = this.formatCost(modelUsage.costUSD)

      totalCostUSD += costUSD
      totalInputTokens += inputTokens
      totalOutputTokens += outputTokens
      totalCacheReadInputTokens += cacheReadInputTokens
      totalCacheCreationInputTokens += cacheCreationInputTokens
      totalWebSearchRequests += webSearchRequests

      if (record.timestamp) {
        const time = Date.parse(record.timestamp)
        if (!Number.isNaN(time)) {
          firstUsageAt = firstUsageAt === null ? time : Math.min(firstUsageAt, time)
          lastUsageAt = lastUsageAt === null ? time : Math.max(lastUsageAt, time)
        }
      }
    }

    if (models.size === 0) return null

    return {
      source: 'transcript',
      totalCostUSD,
      costDisplay: this.formatCost(totalCostUSD),
      hasUnknownModelCost,
      totalAPIDuration: 0,
      totalDuration:
        firstUsageAt !== null && lastUsageAt !== null
          ? Math.max(0, Math.round((lastUsageAt - firstUsageAt) / 1000))
          : 0,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadInputTokens,
      totalCacheCreationInputTokens,
      totalWebSearchRequests,
      models: Array.from(models.values()),
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * List all sessions, optionally filtered by project path.
   */
  async listSessions(options?: {
    project?: string
    limit?: number
    offset?: number
  }): Promise<{ sessions: SessionListItem[]; total: number }> {
    const sessionFiles = await this.discoverSessionFiles(options?.project)

    // Build session list items with metadata from file stats & first entries
    const items: SessionListItem[] = []

    for (const { filePath, projectDir, sessionId } of sessionFiles) {
      try {
        const stat = await fs.stat(filePath)
        const entries = await this.readJsonlFile(filePath)
        const workDir = this.resolveWorkDirFromEntries(entries, projectDir)
        const workDirExists = await this.pathExists(workDir)
        const isTemporary = this.resolveIsTemporaryFromEntries(entries)

        // Count transcript messages only (user + assistant)
        const messageCount = entries.filter(
          (e) => (e.type === 'user' || e.type === 'assistant') && e.message?.role
        ).length

        const title = this.extractTitle(entries)
        const lastMessage = this.extractLastMessage(entries)

        // Find the earliest timestamp from entries, fallback to file birthtime
        let createdAt = stat.birthtime.toISOString()
        for (const e of entries) {
          if (e.timestamp) {
            createdAt = e.timestamp
            break
          }
        }

        items.push({
          id: sessionId,
          title,
          lastMessage,
          createdAt,
          modifiedAt: stat.mtime.toISOString(),
          messageCount,
          projectPath: projectDir,
          workDir,
          workDirExists,
          isTemporary,
        })
      } catch {
        // Skip unreadable files
      }
    }

    // Sort by modifiedAt descending (most recent first)
    items.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())

    const total = items.length
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? 50
    const paginated = items.slice(offset, offset + limit)

    return { sessions: paginated, total }
  }

  /**
   * Get full session detail including all messages.
   */
  async getSession(sessionId: string, locator?: SessionFileLocator): Promise<SessionDetail | null> {
    const found = await this.findSessionFile(sessionId, locator)
    if (!found) return null

    const { filePath, projectDir } = found
    const stat = await fs.stat(filePath)
    const entries = await this.readJsonlFile(filePath)

    const messages = await this.appendSubagentToolMessages(
      projectDir,
      sessionId,
      this.entriesToMessages(entries),
    )
    const title = this.extractTitle(entries)
    const lastMessage = this.extractLastMessage(entries)
    const workDir = this.resolveWorkDirFromEntries(entries, projectDir)
    const workDirExists = await this.pathExists(workDir)
    const isTemporary = this.resolveIsTemporaryFromEntries(entries)

    let createdAt = stat.birthtime.toISOString()
    for (const e of entries) {
      if (e.timestamp) {
        createdAt = e.timestamp
        break
      }
    }

    return {
      id: sessionId,
      title,
      lastMessage,
      createdAt,
      modifiedAt: stat.mtime.toISOString(),
      messageCount: messages.length,
      projectPath: projectDir,
      workDir,
      workDirExists,
      isTemporary,
      messages,
    }
  }

  /**
   * Get messages for a session with optional cursor-based pagination.
   *
   * @param sessionId  Session UUID
   * @param options.limit  Max messages to return (default 50, capped at 1000)
   * @param options.before  Return messages older than this message ID (cursor)
   * @param options.after   Return messages newer than this message ID (cursor)
   *
   * When neither `before` nor `after` is given, returns the most recent messages
   * (tail of the transcript). When `before` is given, returns messages older than
   * that cursor. When `after` is given, returns messages newer than that cursor.
   *
   * Returns `{ messages, hasMore }` so the caller knows whether another page exists.
   */
  async getSessionMessages(
    sessionId: string,
    options?: { limit?: number; before?: string; after?: string; projectPath?: string },
  ): Promise<{ messages: MessageEntry[]; hasMore: boolean }> {
    let found = await this.findSessionFile(sessionId, { projectPath: options?.projectPath })
    if (!found && options?.projectPath) {
      // Session tabs can outlive project renames or moves. Reading history is
      // safe to recover by UUID; mutating operations keep their strict locator.
      found = await this.findSessionFile(sessionId)
    }
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sessionId}`)
    }

    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 1000)
    const isInitialPage = !options?.before && !options?.after
    const recentHistory = isInitialPage
      ? await this.readRecentJsonlEntries(
          found.filePath,
          limit + RECENT_HISTORY_LOOKBACK_MESSAGES,
        )
      : null
    const entries = recentHistory?.entries ?? await this.readJsonlFile(found.filePath)
    const allMessages = await this.appendSubagentToolMessages(
      found.projectDir,
      sessionId,
      this.entriesToMessages(entries),
    )
    const page = this.paginateMessages(allMessages, options)
    return {
      ...page,
      hasMore: page.hasMore || recentHistory?.hasEarlierEntries === true,
    }
  }

  async createProjectFolder(
    parentDir: string,
    name: string,
  ): Promise<{ path: string; existed: boolean }> {
    const parentPath = path.resolve(parentDir)
    let parentStat
    try {
      parentStat = await fs.stat(parentPath)
    } catch {
      throw ApiError.badRequest(`Parent directory does not exist: ${parentPath}`)
    }
    if (!parentStat.isDirectory()) {
      throw ApiError.badRequest(`Parent path is not a directory: ${parentPath}`)
    }

    const projectName = name.trim()
    if (!projectName || projectName === '.' || projectName === '..') {
      throw ApiError.badRequest('Project name is invalid')
    }
    if (/[<>:"/\\|?*\u0000-\u001F]/.test(projectName)) {
      throw ApiError.badRequest('Project name contains unsupported characters')
    }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(projectName)) {
      throw ApiError.badRequest('Project name is reserved on Windows')
    }

    const targetPath = path.resolve(parentPath, projectName)
    const relative = path.relative(parentPath, targetPath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw ApiError.badRequest('Project path must be inside the selected parent directory')
    }

    try {
      await fs.mkdir(targetPath)
      return { path: targetPath, existed: false }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }

    const targetStat = await fs.stat(targetPath).catch(() => null)
    if (!targetStat?.isDirectory()) {
      throw ApiError.badRequest(`Project path already exists and is not a directory: ${targetPath}`)
    }
    return { path: targetPath, existed: true }
  }

  /**
   * Create a new session file for the given working directory.
   */
  async createSession(
    input?: string | CreateSessionOptions,
  ): Promise<{ sessionId: string; session: SessionListItem }> {
    const workDir = typeof input === 'string' ? input : input?.workDir
    const isTemporary = typeof input === 'object' && input.temporary === true

    // Default to user home directory when no workDir specified
    const resolvedWorkDir = workDir || os.homedir()

    // Resolve to absolute path. NOTE: path.resolve() uses process.cwd() to
    // expand relative paths — in bundled sidecar mode the server's cwd is
    // typically '/'. Callers (IM adapters) already send absolute realPath,
    // but we log here so cwd regressions are caught early.
    const absWorkDir = path.resolve(resolvedWorkDir)
    console.log(
      `[SessionService] createSession: requested workDir=${JSON.stringify(
        workDir,
      )}, resolved=${absWorkDir} (process.cwd()=${process.cwd()})`,
    )
    let stat
    try {
      stat = await fs.stat(absWorkDir)
    } catch {
      throw ApiError.badRequest(`Working directory does not exist: ${absWorkDir}`)
    }
    if (!stat.isDirectory()) {
      throw ApiError.badRequest(`Working directory is not a directory: ${absWorkDir}`)
    }

    const sessionId = crypto.randomUUID()
    const sanitized = this.sanitizePath(absWorkDir)
    const dirPath = path.join(this.getProjectsDir(), sanitized)

    // Ensure the project directory exists
    await fs.mkdir(dirPath, { recursive: true })

    const filePath = path.join(dirPath, `${sessionId}.jsonl`)
    const now = new Date().toISOString()

    // Write an initial file-history-snapshot entry (matches CLI behavior)
    const initialEntry = {
      type: 'file-history-snapshot',
      messageId: crypto.randomUUID(),
      snapshot: {
        messageId: crypto.randomUUID(),
        trackedFileBackups: {},
        timestamp: now,
      },
      isSnapshotUpdate: false,
    }

    // Store actual workDir for later retrieval
    const metaEntry = {
      type: 'session-meta',
      isMeta: true,
      workDir: absWorkDir,
      isTemporary,
      timestamp: now,
    }

    await fs.writeFile(filePath, JSON.stringify(initialEntry) + '\n' + JSON.stringify(metaEntry) + '\n', 'utf-8')
    await this.syncSessionSearchIndex({ filePath, projectDir: sanitized, sessionId })

    return {
      sessionId,
      session: {
        id: sessionId,
        title: 'Untitled Session',
        lastMessage: '',
        createdAt: now,
        modifiedAt: now,
        messageCount: 0,
        projectPath: sanitized,
        workDir: absWorkDir,
        workDirExists: true,
        isTemporary,
      },
    }
  }

  /**
   * Create an independent conversation branch ending at an assistant response.
   * The source transcript is never modified.
   */
  async branchSession(
    sourceSessionId: string,
    targetAssistantMessageId: string,
    options?: { projectPath?: string; expectedContent?: string },
  ): Promise<BranchSessionResult> {
    const found = await this.findSessionFile(sourceSessionId, {
      projectPath: options?.projectPath,
    })
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sourceSessionId}`)
    }

    const sourceEntries = await this.readJsonlFile(found.filePath)
    const mainEntries = sourceEntries.filter((entry) => this.isMainTranscriptEntry(entry))
    const targetIndex = mainEntries.findIndex((entry) => entry.uuid === targetAssistantMessageId)
    if (targetIndex < 0) {
      throw ApiError.badRequest('The selected assistant response no longer exists')
    }

    const targetEntry = mainEntries[targetIndex]!
    if (targetEntry.type !== 'assistant' || targetEntry.message?.role !== 'assistant') {
      throw ApiError.badRequest('The selected message is not an assistant response')
    }

    if (typeof options?.expectedContent === 'string' && options.expectedContent.trim()) {
      const expected = this.normalizeBranchGuardText(options.expectedContent)
      const actual = this.normalizeBranchGuardText(
        this.extractTextFromContent(targetEntry.message.content),
      )
      if (!actual || (expected !== actual && !expected.endsWith(actual))) {
        throw ApiError.conflict('The selected assistant response changed; reload the conversation and try again')
      }
    }

    let cutoffIndex = targetIndex
    const unresolvedToolUseIds = new Set(
      this.extractToolUseIds(targetEntry.message.content),
    )
    if (unresolvedToolUseIds.size > 0) {
      for (let index = targetIndex + 1; index < mainEntries.length; index += 1) {
        const entry = mainEntries[index]!
        for (const toolUseId of this.extractToolResultIds(entry.message?.content)) {
          unresolvedToolUseIds.delete(toolUseId)
        }
        cutoffIndex = index
        if (unresolvedToolUseIds.size === 0) break
      }

      if (unresolvedToolUseIds.size > 0) {
        throw ApiError.badRequest('This response still has unfinished tool calls and cannot be branched yet')
      }
    }

    const selectedEntries = mainEntries.slice(0, cutoffIndex + 1)
    if (selectedEntries.length === 0) {
      throw ApiError.badRequest('No conversation messages are available to branch')
    }

    const workDir = this.resolveWorkDirFromEntries(sourceEntries, found.projectDir)
    if (!workDir) {
      throw ApiError.badRequest('The source session working directory could not be resolved')
    }

    const sessionId = crypto.randomUUID()
    const filePath = path.join(this.getProjectsDir(), found.projectDir, `${sessionId}.jsonl`)
    const temporaryFilePath = `${filePath}.${crypto.randomUUID()}.tmp`
    const now = new Date().toISOString()
    const title = await this.getUniqueBranchTitle(this.extractTitle(sourceEntries), workDir)
    const isTemporary = this.resolveIsTemporaryFromEntries(sourceEntries)

    let parentUuid: string | null = null
    const includedToolUseIds = new Set<string>()
    const branchedEntries = selectedEntries.map((entry) => {
      const sourceUuid = entry.uuid || crypto.randomUUID()
      for (const toolUseId of this.extractToolUseIds(entry.message?.content)) {
        includedToolUseIds.add(toolUseId)
      }

      const branchedEntry: RawEntry = {
        ...entry,
        uuid: sourceUuid,
        sessionId,
        parentUuid,
        isSidechain: false,
        forkedFrom: {
          sessionId: sourceSessionId,
          messageUuid: sourceUuid,
        },
      }
      parentUuid = sourceUuid
      return branchedEntry
    })

    const replacements = sourceEntries.flatMap((entry) => {
      if (entry.type !== 'content-replacement' || !Array.isArray(entry.replacements)) {
        return []
      }
      return entry.replacements.filter((replacement) => {
        if (!replacement || typeof replacement !== 'object') return false
        const toolUseId = (replacement as Record<string, unknown>).toolUseId
        return typeof toolUseId === 'string' && includedToolUseIds.has(toolUseId)
      })
    })

    const outputEntries: RawEntry[] = [
      {
        type: 'file-history-snapshot',
        messageId: crypto.randomUUID(),
        snapshot: {
          messageId: crypto.randomUUID(),
          trackedFileBackups: {},
          timestamp: now,
        },
        isSnapshotUpdate: false,
      },
      {
        type: 'session-meta',
        isMeta: true,
        workDir,
        isTemporary,
        timestamp: now,
        branchedFrom: {
          sessionId: sourceSessionId,
          messageUuid: targetAssistantMessageId,
        },
      },
      ...branchedEntries,
      ...(replacements.length > 0
        ? [{ type: 'content-replacement', sessionId, replacements }]
        : []),
      {
        type: 'custom-title',
        customTitle: title,
        timestamp: now,
      },
    ]

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    try {
      await fs.writeFile(
        temporaryFilePath,
        outputEntries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
        { encoding: 'utf-8', mode: 0o600 },
      )
      await fs.rename(temporaryFilePath, filePath)
    } catch (error) {
      await fs.rm(temporaryFilePath, { force: true }).catch(() => {})
      throw error
    }

    await this.syncSessionSearchIndex({
      filePath,
      projectDir: found.projectDir,
      sessionId,
    })

    const detail = await this.getSession(sessionId, { projectPath: found.projectDir })
    if (!detail) {
      throw new Error(`Created branch could not be loaded: ${sessionId}`)
    }
    const { messages: _messages, ...session } = detail

    return {
      sessionId,
      sourceSessionId,
      targetAssistantMessageId,
      session,
    }
  }

  /**
   * Delete a session's JSONL file.
   */
  async deleteSession(sessionId: string, locator?: SessionFileLocator): Promise<void> {
    const found = await this.findSessionFile(sessionId, locator)
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sessionId}`)
    }

    await fs.rm(this.activeSessionFilePath(found.filePath), { force: true })
    await fs.rm(this.placeholderBackupPath(found.filePath), { force: true }).catch(() => {})
    await fs.rm(path.join(this.getProjectsDir(), found.projectDir, sessionId), {
      recursive: true,
      force: true,
    }).catch(() => {})
    await this.removeHistoryLogEntries(sessionId, found.projectDir).catch(() => {})
    await this.removeSessionSearchIndex(sessionId, found.projectDir)
  }

  /**
   * Rename a session by appending a custom-title entry to its JSONL file.
   */
  async renameSession(sessionId: string, title: string, locator?: SessionFileLocator): Promise<void> {
    if (!title || typeof title !== 'string') {
      throw ApiError.badRequest('title is required')
    }

    const found = await this.findSessionFile(sessionId, locator)
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sessionId}`)
    }

    const entry = {
      type: 'custom-title',
      customTitle: title,
      timestamp: new Date().toISOString(),
    }

    await this.appendJsonlEntry(found.filePath, entry)
    await this.syncSessionSearchIndex({
      filePath: found.filePath,
      projectDir: found.projectDir,
      sessionId,
    })
  }

  /**
   * Append an AI-generated title entry to a session's JSONL file.
   */
  async appendAiTitle(sessionId: string, title: string): Promise<void> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return

    await this.appendJsonlEntry(found.filePath, {
      type: 'ai-title',
      aiTitle: title,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Get the actual working directory for a session.
   * First checks for stored session-meta entry, then falls back to desanitizePath.
   */
  async getSessionWorkDir(sessionId: string, locator?: SessionFileLocator): Promise<string | null> {
    const found = await this.findSessionFile(sessionId, locator)
    if (!found) return null

    const entries = await this.readJsonlFile(found.filePath)
    return this.resolveWorkDirFromEntries(entries, found.projectDir)
  }

  /**
   * Inspect how a session should be launched.
   * Placeholder desktop-created sessions have zero transcript messages.
   */
  async getSessionLaunchInfo(sessionId: string): Promise<SessionLaunchInfo | null> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return null

    const entries = await this.readJsonlFile(found.filePath)
    const workDir = this.resolveWorkDirFromEntries(entries, found.projectDir) || process.cwd()
    const isTemporary = this.resolveIsTemporaryFromEntries(entries)
    let customTitle: string | null = null
    let transcriptMessageCount = 0

    for (const entry of entries) {
      if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
        customTitle = entry.customTitle
      }
      if (
        !entry.isMeta &&
        entry.message?.role &&
        (entry.type === 'user' || entry.type === 'assistant' || entry.type === 'system')
      ) {
        transcriptMessageCount++
      }
    }

    return {
      filePath: found.filePath,
      projectDir: found.projectDir,
      workDir,
      transcriptMessageCount,
      customTitle,
      isTemporary,
    }
  }

  async deleteSessionFile(sessionId: string): Promise<void> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return
    await fs.rm(this.activeSessionFilePath(found.filePath), { force: true })
    await fs.rm(this.placeholderBackupPath(found.filePath), { force: true })
  }

  async moveSessionFileAsideForLaunch(sessionId: string): Promise<void> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return
    const activePath = this.activeSessionFilePath(found.filePath)
    const backupPath = this.placeholderBackupPath(found.filePath)
    if (found.filePath === backupPath) return

    await fs.rm(backupPath, { force: true }).catch(() => {})
    await fs.rename(activePath, backupPath)
  }

  async clearSessionTranscript(sessionId: string, fallbackWorkDir?: string): Promise<void> {
    let found = await this.findSessionFile(sessionId)
    if (!found && fallbackWorkDir) {
      const absWorkDir = path.resolve(fallbackWorkDir)
      const dirPath = path.join(this.getProjectsDir(), this.sanitizePath(absWorkDir))
      await fs.mkdir(dirPath, { recursive: true })
      found = {
        filePath: path.join(dirPath, `${sessionId}.jsonl`),
        projectDir: this.sanitizePath(absWorkDir),
      }
    }
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sessionId}`)
    }

    const entries = await this.readJsonlFile(found.filePath)
    const workDir = this.resolveWorkDirFromEntries(entries, found.projectDir) || fallbackWorkDir || process.cwd()
    let isTemporary = this.resolveIsTemporaryFromEntries(entries)
    const placeholderPath = this.placeholderBackupPath(found.filePath)
    if (placeholderPath !== found.filePath) {
      try {
        const placeholderEntries = await this.readJsonlFile(placeholderPath)
        isTemporary ||= this.resolveIsTemporaryFromEntries(placeholderEntries)
      } catch {
        // Missing placeholder backups are expected for normal active transcripts.
      }
    }
    const now = new Date().toISOString()

    const initialEntry = {
      type: 'file-history-snapshot',
      messageId: crypto.randomUUID(),
      snapshot: {
        messageId: crypto.randomUUID(),
        trackedFileBackups: {},
        timestamp: now,
      },
      isSnapshotUpdate: false,
    }

    const metaEntry = {
      type: 'session-meta',
      isMeta: true,
      workDir,
      isTemporary,
      timestamp: now,
    }

    await fs.writeFile(
      found.filePath,
      `${JSON.stringify(initialEntry)}\n${JSON.stringify(metaEntry)}\n`,
      'utf-8',
    )
  }

  async appendSessionMetadata(
    sessionId: string,
    metadata: { workDir: string; customTitle?: string | null }
  ): Promise<void> {
    let found = await this.findSessionFile(sessionId)
    let isTemporary = false
    if (!found) {
      if (!this.isValidSessionId(sessionId)) return

      const absWorkDir = path.resolve(metadata.workDir || os.homedir())
      const projectDir = this.sanitizePath(absWorkDir)
      const dirPath = path.join(this.getProjectsDir(), projectDir)
      const filePath = path.join(dirPath, `${sessionId}.jsonl`)
      const now = new Date().toISOString()
      const initialEntry = {
        type: 'file-history-snapshot',
        messageId: crypto.randomUUID(),
        snapshot: {
          messageId: crypto.randomUUID(),
          trackedFileBackups: {},
          timestamp: now,
        },
        isSnapshotUpdate: false,
      }

      await fs.mkdir(dirPath, { recursive: true })
      try {
        await fs.writeFile(filePath, `${JSON.stringify(initialEntry)}\n`, {
          encoding: 'utf-8',
          flag: 'wx',
        })
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      }
      found = { filePath, projectDir }
    } else {
      const activePath = this.activeSessionFilePath(found.filePath)
      const candidatePaths = new Set([found.filePath, this.placeholderBackupPath(activePath)])
      for (const candidatePath of candidatePaths) {
        try {
          const entries = await this.readJsonlFile(candidatePath)
          isTemporary ||= this.resolveIsTemporaryFromEntries(entries)
        } catch {
          // Missing placeholder backups are expected after the real transcript starts.
        }
      }

      if (!found.filePath.endsWith('.jsonl.placeholder')) {
        found = { filePath: activePath, projectDir: found.projectDir }
      } else {
        try {
          await fs.rename(found.filePath, activePath)
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        }
        found = { filePath: activePath, projectDir: found.projectDir }
      }
    }

    await this.appendJsonlEntry(found.filePath, {
      type: 'session-meta',
      isMeta: true,
      workDir: metadata.workDir,
      isTemporary,
      timestamp: new Date().toISOString(),
    })

    if (metadata.customTitle) {
      await this.appendJsonlEntry(found.filePath, {
        type: 'custom-title',
        customTitle: metadata.customTitle,
        timestamp: new Date().toISOString(),
      })
    }

    await fs.rm(this.placeholderBackupPath(found.filePath), { force: true }).catch(() => {})
  }

  async trimSessionMessagesFrom(
    sessionId: string,
    startMessageId: string,
    locator?: SessionFileLocator,
  ): Promise<TrimSessionResult> {
    const found = await this.findSessionFile(sessionId, locator)
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sessionId}`)
    }

    const entries = await this.readJsonlFile(found.filePath)
    const activeMessages = this.entriesToMessages(entries)
    const startIndex = activeMessages.findIndex((message) => message.id === startMessageId)

    if (startIndex < 0) {
      throw ApiError.badRequest(`Message not found in active session chain: ${startMessageId}`)
    }

    const removedMessageIds = activeMessages
      .slice(startIndex)
      .map((message) => message.id)

    if (removedMessageIds.length === 0) {
      return { removedCount: 0, removedMessageIds: [] }
    }

    const removedIds = new Set(removedMessageIds)
    const filteredEntries = entries.filter(
      (entry) => !(typeof entry.uuid === 'string' && removedIds.has(entry.uuid)),
    )

    const content =
      filteredEntries.length > 0
        ? filteredEntries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
        : ''
    await fs.writeFile(found.filePath, content, 'utf-8')

    return {
      removedCount: removedMessageIds.length,
      removedMessageIds,
    }
  }

  async getSessionFileHistorySnapshots(
    sessionId: string,
    locator?: SessionFileLocator,
  ): Promise<FileHistorySnapshot[]> {
    const found = await this.findSessionFile(sessionId, locator)
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sessionId}`)
    }

    const entries = await this.readJsonlFile(found.filePath)
    const snapshotsByMessageId = new Map<string, FileHistorySnapshot>()

    for (const entry of entries) {
      if (entry.type !== 'file-history-snapshot' || !entry.snapshot) continue

      const snapshotMessageId =
        typeof entry.snapshot.messageId === 'string'
          ? entry.snapshot.messageId
          : typeof entry.messageId === 'string'
            ? entry.messageId
            : null

      if (!snapshotMessageId) continue

      snapshotsByMessageId.set(snapshotMessageId, {
        messageId: snapshotMessageId as FileHistorySnapshot['messageId'],
        trackedFileBackups:
          entry.snapshot.trackedFileBackups &&
          typeof entry.snapshot.trackedFileBackups === 'object'
            ? (entry.snapshot.trackedFileBackups as FileHistorySnapshot['trackedFileBackups'])
            : {},
        timestamp: new Date(
          entry.snapshot.timestamp || entry.timestamp || new Date().toISOString(),
        ),
      })
    }

    return [...snapshotsByMessageId.values()]
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private entriesToMessages(entries: RawEntry[]): MessageEntry[] {
    const messages: MessageEntry[] = []
    const entriesByUuid = new Map<string, RawEntry>()
    const parentToolUseIdCache = new Map<string, string | undefined>()

    for (const entry of entries) {
      if (typeof entry.uuid === 'string' && entry.uuid.length > 0) {
        entriesByUuid.set(entry.uuid, entry)
      }
    }

    for (const entry of entries) {
      if (!this.isVisibleTranscriptEntry(entry)) continue

      const parentToolUseId = this.resolveParentToolUseId(
        entry,
        entriesByUuid,
        parentToolUseIdCache,
      )
      const msg = this.entryToMessage(entry, parentToolUseId)
      if (msg) {
        messages.push(msg)
      }
    }
    return messages
  }

  private async pathExists(targetPath: string | null): Promise<boolean> {
    if (!targetPath) return false

    try {
      const stat = await fs.stat(targetPath)
      return stat.isDirectory()
    } catch {
      return false
    }
  }
}

// Singleton instance for shared use across API handlers
export const sessionService = new SessionService()
