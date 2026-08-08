// Source: src/server/services/sessionService.ts

export type SessionListItem = {
  id: string
  title: string
  lastMessage?: string
  createdAt: string
  modifiedAt: string
  messageCount: number
  projectPath: string
  workDir: string | null
  workDirExists: boolean
  isTemporary: boolean
}

export type CreateSessionInput = string | {
  workDir?: string
  temporary?: boolean
} | undefined

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

export type SessionDetail = SessionListItem & {
  messages: MessageEntry[]
}

/** A real user question in the session transcript (see server sessionAnchors).
 *  Covers the entire history, not just the loaded message window. */
export type SessionMessageAnchor = {
  /** Global 0-based index of the question across the whole session. */
  seq: number
  /** Transcript message id (matches the UI message's serverId). */
  messageId: string
  preview: string
  /** Short preview of the final assistant text before the next user turn. */
  answerPreview?: string
}
