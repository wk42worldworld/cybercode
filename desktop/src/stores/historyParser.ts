import { AGENT_LIFECYCLE_TYPES } from '../types/team'
import type { MessageEntry } from '../types/session'
import type { AgentTaskNotification, UIAttachment, UIMessage } from '../types/chat'

export type HistoryMappingOptions = { includeTeammateMessages?: boolean }
export type IdGenerator = () => string

export type AssistantHistoryBlock = {
  type: string
  text?: string
  thinking?: string
  name?: string
  id?: string
  input?: unknown
}

export type UserHistoryBlock = {
  type: string
  text?: string
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
  source?: { data?: string }
  mimeType?: string
  media_type?: string
  name?: string
}

export type ParsedHistory = {
  uiMessages: UIMessage[]
  restoredNotifications: Record<string, AgentTaskNotification>
  lastTodos: Array<{ content: string; status: string; activeForm?: string }> | null
  hasMessagesAfterTaskCompletion: boolean
}

const TEAMMATE_CONTENT_REGEX =
  /<teammate-message\s+teammate_id="([^"]+)"[^>]*>\n?([\s\S]*?)\n?<\/teammate-message>/g

function isTeammateMessage(text: string): boolean {
  return text.includes('<teammate-message') && text.includes('</teammate-message>')
}

function extractVisibleTeammateMessageContents(text: string): string[] {
  const contents: string[] = []
  for (const match of text.matchAll(TEAMMATE_CONTENT_REGEX)) {
    const content = match[2]?.trim()
    if (!content) continue
    if (content.startsWith('{') && content.endsWith('}')) {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown>
        if (typeof parsed.type === 'string' && AGENT_LIFECYCLE_TYPES.has(parsed.type)) continue
      } catch {
        // not JSON, keep it
      }
    }
    contents.push(content)
  }
  return contents
}

function pushAssistantHistoryText(
  messages: UIMessage[],
  content: string,
  timestamp: number,
  idGen: IdGenerator,
  model?: string,
  serverId?: string,
): void {
  if (!content.trim()) return
  const last = messages[messages.length - 1]
  if (last?.type === 'assistant_text') {
    last.content += content
    if (model && !last.model) last.model = model
    return
  }
  messages.push({
    id: idGen(),
    type: 'assistant_text',
    content,
    timestamp,
    ...(model ? { model } : {}),
    ...(serverId ? { serverId } : {}),
  })
}

export function mapHistoryMessages(
  messages: MessageEntry[],
  idGen: IdGenerator,
  options?: HistoryMappingOptions,
): UIMessage[] {
  const includeTeammateMessages = options?.includeTeammateMessages === true
  const uiMessages: UIMessage[] = []
  for (const msg of messages) {
    const timestamp = new Date(msg.timestamp).getTime()
    if (msg.type === 'user' && typeof msg.content === 'string') {
      if (isTeammateMessage(msg.content)) {
        if (!includeTeammateMessages) continue
        const teammateContents = extractVisibleTeammateMessageContents(msg.content)
        if (teammateContents.length === 0) continue
        uiMessages.push({
          id: msg.id || idGen(),
          type: 'user_text',
          content: teammateContents.join('\n\n'),
          timestamp,
          serverId: msg.id,
        })
        continue
      }
      uiMessages.push({ id: msg.id || idGen(), type: 'user_text', content: msg.content, timestamp, serverId: msg.id })
      continue
    }
    if (msg.type === 'assistant' && typeof msg.content === 'string') {
      uiMessages.push({
        id: msg.id || idGen(),
        type: 'assistant_text',
        content: msg.content,
        timestamp,
        model: msg.model,
        serverId: msg.id,
      })
      continue
    }
    if ((msg.type === 'assistant' || msg.type === 'tool_use') && Array.isArray(msg.content)) {
      for (const block of msg.content as AssistantHistoryBlock[]) {
        if (block.type === 'thinking' && block.thinking)
          uiMessages.push({ id: idGen(), type: 'thinking', content: block.thinking, timestamp, serverId: msg.id })
        else if (block.type === 'text' && block.text)
          pushAssistantHistoryText(uiMessages, block.text, timestamp, idGen, msg.model, msg.id)
        else if (block.type === 'tool_use')
          uiMessages.push({
            id: idGen(),
            type: 'tool_use',
            toolName: block.name ?? 'unknown',
            toolUseId: block.id ?? '',
            input: block.input,
            timestamp,
            parentToolUseId: msg.parentToolUseId,
            serverId: msg.id,
          })
      }
      continue
    }
    if ((msg.type === 'user' || msg.type === 'tool_result') && Array.isArray(msg.content)) {
      const textParts: string[] = []
      const attachments: UIAttachment[] = []
      for (const block of msg.content as UserHistoryBlock[]) {
        if (block.type === 'text' && block.text && isTeammateMessage(block.text)) {
          if (!includeTeammateMessages) continue
          textParts.push(...extractVisibleTeammateMessageContents(block.text))
        } else if (block.type === 'text' && block.text) {
          textParts.push(block.text)
        } else if (block.type === 'image') {
          const rawData = block.source?.data
          const mimeType = block.mimeType || block.media_type
          // JSONL stores raw base64 without the data: prefix (Anthropic API format).
          // Wrap it so <img src> doesn't try to fetch it as a relative URL.
          const data =
            rawData && !rawData.startsWith('data:')
              ? `data:${mimeType || 'image/png'};base64,${rawData}`
              : rawData
          attachments.push({
            type: 'image',
            name: block.name || 'image',
            data,
            mimeType,
          })
        }
        else if (block.type === 'file')
          attachments.push({ type: 'file', name: block.name || 'file' })
        else if (block.type === 'tool_result')
          uiMessages.push({
            id: idGen(),
            type: 'tool_result',
            toolUseId: block.tool_use_id ?? '',
            content: block.content,
            isError: !!block.is_error,
            timestamp,
            parentToolUseId: msg.parentToolUseId,
            serverId: msg.id,
          })
      }
      if (textParts.length > 0 || attachments.length > 0) {
        uiMessages.push({
          id: msg.id || idGen(),
          type: 'user_text',
          content: textParts.join('\n'),
          attachments: attachments.length > 0 ? attachments : undefined,
          timestamp,
          serverId: msg.id,
        })
      }
    }
  }
  return uiMessages
}

export function reconstructAgentNotifications(
  messages: MessageEntry[],
): Record<string, AgentTaskNotification> {
  const agentNameToToolUseId = new Map<string, string>()

  for (const msg of messages) {
    if ((msg.type === 'assistant' || msg.type === 'tool_use') && Array.isArray(msg.content)) {
      for (const block of msg.content as AssistantHistoryBlock[]) {
        if (block.type === 'tool_use' && block.name === 'Agent' && block.id) {
          const input = block.input as Record<string, unknown> | undefined
          const name = input?.name as string | undefined
          if (name && !agentNameToToolUseId.has(name)) agentNameToToolUseId.set(name, block.id)
        }
      }
    }
  }

  if (agentNameToToolUseId.size === 0) return {}

  const teammateContent = new Map<string, string>()
  for (const msg of messages) {
    if (msg.type !== 'user') continue
    const text =
      typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? (msg.content as Array<{ type?: string; text?: string }>)
              .filter((b) => b.type === 'text' && b.text)
              .map((b) => b.text)
              .join('\n')
          : ''
    if (!text.includes('<teammate-message')) continue
    for (const match of text.matchAll(TEAMMATE_CONTENT_REGEX)) {
      if (match[1] && match[2]) {
        const content = match[2].trim()
        if (content.startsWith('{') && content.endsWith('}')) {
          try {
            const parsed = JSON.parse(content) as Record<string, unknown>
            if (typeof parsed.type === 'string' && AGENT_LIFECYCLE_TYPES.has(parsed.type)) continue
          } catch {
            /* not JSON, keep it */
          }
        }
        if (!teammateContent.has(match[1])) {
          teammateContent.set(match[1], content)
        }
      }
    }
  }

  const notifications: Record<string, AgentTaskNotification> = {}
  for (const [name, toolUseId] of agentNameToToolUseId) {
    const content = teammateContent.get(name)
    if (content) {
      notifications[toolUseId] = {
        taskId: toolUseId,
        toolUseId,
        status: 'completed',
        summary: content,
      }
    }
  }

  return notifications
}

const TASK_RELATED_TOOL_NAMES = new Set([
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'TaskGet',
  'TaskList',
])

export function extractLastTodoWriteFromHistory(
  messages: MessageEntry[],
): Array<{ content: string; status: string; activeForm?: string }> | null {
  let foundIndex = -1
  let todos: Array<{ content: string; status: string; activeForm?: string }> | null = null
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if ((msg.type === 'assistant' || msg.type === 'tool_use') && Array.isArray(msg.content)) {
      const blocks = msg.content as AssistantHistoryBlock[]
      for (let j = blocks.length - 1; j >= 0; j--) {
        const block = blocks[j]!
        if (block.type === 'tool_use' && block.name === 'TodoWrite') {
          const input = block.input as { todos?: unknown } | undefined
          if (input && Array.isArray(input.todos)) {
            todos = input.todos as Array<{ content: string; status: string; activeForm?: string }>
            foundIndex = i
            break
          }
        }
      }
      if (todos) break
    }
  }
  if (!todos) return null
  const allDone = todos.every((t) => t.status === 'completed')
  if (allDone) {
    for (let i = foundIndex + 1; i < messages.length; i++) {
      if (messages[i]!.type === 'user' && messages[i]!.content) return null
    }
  }
  return todos
}

export function hasUserMessagesAfterTaskCompletion(messages: MessageEntry[]): boolean {
  let lastTaskIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if ((msg.type === 'assistant' || msg.type === 'tool_use') && Array.isArray(msg.content)) {
      const blocks = msg.content as AssistantHistoryBlock[]
      if (blocks.some((b) => b.type === 'tool_use' && TASK_RELATED_TOOL_NAMES.has(b.name ?? ''))) {
        lastTaskIndex = i
        break
      }
    }
  }
  if (lastTaskIndex < 0) return false
  for (let i = lastTaskIndex + 1; i < messages.length; i++) {
    if (messages[i]!.type === 'user') return true
  }
  return false
}

export function parseHistory(
  messages: MessageEntry[],
  idGen: IdGenerator,
  options?: HistoryMappingOptions,
): ParsedHistory {
  return {
    uiMessages: mapHistoryMessages(messages, idGen, options),
    restoredNotifications: reconstructAgentNotifications(messages),
    lastTodos: extractLastTodoWriteFromHistory(messages),
    hasMessagesAfterTaskCompletion: hasUserMessagesAfterTaskCompletion(messages),
  }
}
