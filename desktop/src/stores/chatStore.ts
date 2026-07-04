import { create } from 'zustand'
import { wsManager } from '../api/websocket'
import { sessionsApi } from '../api/sessions'
import { ApiError } from '../api/client'
import { useTeamStore } from './teamStore'
import { useSessionStore } from './sessionStore'
import { useCLITaskStore } from './cliTaskStore'
import { useSessionRuntimeStore } from './sessionRuntimeStore'
import { useTabStore } from './tabStore'
import { t } from '../i18n'
import { randomSpinnerVerb } from '../config/spinnerVerbs'
import { getDefaultSessionTitle, isDefaultSessionTitle } from '../utils/sessionTitle'
import type { MessageEntry } from '../types/session'
import {
  mapHistoryMessages as mapHistoryMessagesImpl,
  reconstructAgentNotifications as reconstructAgentNotificationsImpl,
  parseHistory,
  type HistoryMappingOptions,
} from './historyParser'
import type { PermissionMode } from '../types/settings'
import type { RuntimeSelection } from '../types/runtime'
import type {
  AgentTaskNotification,
  AttachmentRef,
  ChatState,
  ComputerUsePermissionRequest,
  ComputerUsePermissionResponse,
  UIAttachment,
  UIMessage,
  ServerMessage,
  TokenUsage,
} from '../types/chat'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export type PendingSteer = {
  id: string
  content: string
  attachments?: UIAttachment[]
  createdAt: number
  status: 'draft' | 'queued' | 'processing' | 'processed' | 'cancelled' | 'failed'
  priority?: 'next' | 'later'
  error?: string
}

/** How many messages to request when loading older history via loadMoreHistory. */
export const HISTORY_PAGE_SIZE = 50
/** How many messages to request on initial history load (loadHistory / reloadHistory). */
export const HISTORY_LOAD_LIMIT = 200
/** Max messages kept in the visible window. Sliding window trims beyond this. */
export const WINDOW_SIZE = 200

export type PerSessionState = {
  projectPath?: string
  messages: UIMessage[]
  /** Whether all historical messages have been loaded into `messages`.
   * When false, server-side pagination may provide more via loadMoreHistory. */
  allMessagesLoaded?: boolean
  /** Older messages that were trimmed from the head of `messages` when the
   *  user scrolled down (loadMoreRecent).  Restored by loadMoreHistory. */
  historyBuffer: UIMessage[]
  /** Newer messages that were trimmed from the tail of `messages` when the
   *  user scrolled up (loadMoreHistory).  Restored by loadMoreRecent. */
  recentBuffer: UIMessage[]
  /** Initial-history fetch state machine.
   * - idle:    not yet attempted (or was reset)
   * - loading: HTTP request in flight; re-entry guarded
   * - loaded:  history is in memory (could be empty for a brand-new session)
   * - error:   last attempt failed; user can retry
   * Decouples history loading from WS connection: the previous code conflated
   * the two and silently swallowed errors, so a transient network blip during
   * tab-switch left the session permanently empty until the user navigated
   * away+back several times. */
  historyLoadState?: 'idle' | 'loading' | 'loaded' | 'error'
  chatState: ChatState
  connectionState: ConnectionState
  streamingText: string
  streamingToolInput: string
  activeToolUseId: string | null
  activeToolName: string | null
  activeThinkingId: string | null
  dismissedThinkingPanelIdentityKey?: string | null
  pendingPermission: {
    requestId: string
    toolName: string
    toolUseId?: string
    input: unknown
    description?: string
  } | null
  pendingComputerUsePermission: {
    requestId: string
    request: ComputerUsePermissionRequest
  } | null
  pendingSteers?: PendingSteer[]
  tokenUsage: TokenUsage
  elapsedSeconds: number
  statusVerb: string
  turnStartedAt?: number | null
  lastModelActivityAt?: number | null
  lastConnectionActivityAt?: number | null
  slashCommands: Array<{ name: string; description: string }>
  agentTaskNotifications: Record<string, AgentTaskNotification>
  elapsedTimer: ReturnType<typeof setInterval> | null
  composerPrefill?: {
    text: string
    attachments?: UIAttachment[]
    nonce: number
  } | null
}

const DEFAULT_SESSION_STATE: PerSessionState = {
  messages: [],
  historyBuffer: [],
  recentBuffer: [],
  allMessagesLoaded: false,
  historyLoadState: 'idle',
  chatState: 'idle',
  connectionState: 'disconnected',
  streamingText: '',
  streamingToolInput: '',
  activeToolUseId: null,
  activeToolName: null,
  activeThinkingId: null,
  dismissedThinkingPanelIdentityKey: null,
  pendingPermission: null,
  pendingComputerUsePermission: null,
  pendingSteers: [],
  tokenUsage: { input_tokens: 0, output_tokens: 0 },
  elapsedSeconds: 0,
  statusVerb: '',
  turnStartedAt: null,
  lastModelActivityAt: null,
  lastConnectionActivityAt: null,
  slashCommands: [],
  agentTaskNotifications: {},
  elapsedTimer: null,
  composerPrefill: null,
}

function createDefaultSessionState(): PerSessionState {
  return {
    ...DEFAULT_SESSION_STATE,
    messages: [],
    pendingSteers: [],
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
  }
}

function getThinkingPanelIdentityKey(sessionId: string, messages: UIMessage[]): string {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message): message is Extract<UIMessage, { type: 'user_text' }> => message.type === 'user_text')

  return `${sessionId}:${latestUserMessage?.id ?? 'initial'}`
}

type ChatStore = {
  sessions: Record<string, PerSessionState>

  getSession: (sessionId: string) => PerSessionState
  connectToSession: (sessionId: string, projectPath?: string) => void
  disconnectSession: (sessionId: string) => void
  ensureSessionReady: (sessionId: string, projectPath?: string) => Promise<void>
  sendMessage: (
    sessionId: string,
    content: string,
    attachments?: AttachmentRef[],
    options?: { displayContent?: string },
  ) => void
  queuePendingSteer: (
    sessionId: string,
    content: string,
    attachments?: AttachmentRef[],
    options?: { displayContent?: string },
  ) => string
  sendPendingSteers: (sessionId: string, priority: 'next' | 'later', steerIds?: string[]) => void
  autoSendPendingSteers: (sessionId: string) => void
  editPendingSteer: (sessionId: string, steerId: string) => void
  cancelPendingSteer: (sessionId: string, steerId: string) => void
  respondToPermission: (
    sessionId: string,
    requestId: string,
    allowed: boolean,
    options?: {
      rule?: string
      updatedInput?: Record<string, unknown>
    },
  ) => void
  respondToComputerUsePermission: (
    sessionId: string,
    requestId: string,
    response: ComputerUsePermissionResponse,
  ) => void
  setSessionRuntime: (sessionId: string, selection: RuntimeSelection) => void
  setSessionPermissionMode: (sessionId: string, mode: PermissionMode) => void
  stopGeneration: (sessionId: string) => void
  loadHistory: (sessionId: string, projectPath?: string) => Promise<void>
  /** Load older messages via server-side pagination. No-op if all messages are loaded. */
  loadMoreHistory: (sessionId: string) => Promise<void>
  /** Restore newer messages that were trimmed from the tail of `messages`. */
  loadMoreRecent: (sessionId: string) => void
  reloadHistory: (sessionId: string, projectPath?: string) => Promise<void>
  queueComposerPrefill: (
    sessionId: string,
    prefill: { text: string; attachments?: UIAttachment[] },
  ) => void
  clearMessages: (sessionId: string) => void
  handleServerMessage: (sessionId: string, msg: ServerMessage) => void
}

const TASK_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite'])
const pendingTaskToolUseIds = new Set<string>()
const USER_TITLE_MAX_LEN = 80

function deriveUserMessageTitle(content: string): string | null {
  const title = content.replace(/\s+/g, ' ').trim()
  if (!title) return null
  return title.length > USER_TITLE_MAX_LEN
    ? `${title.slice(0, USER_TITLE_MAX_LEN)}...`
    : title
}

function getFirstUserMessageTitle(messages: UIMessage[]): string | null {
  const firstUserMessage = messages.find(
    (message): message is Extract<UIMessage, { type: 'user_text' }> =>
      message.type === 'user_text' && Boolean(message.content.trim()),
  )
  return firstUserMessage ? deriveUserMessageTitle(firstUserMessage.content) : null
}

function currentSessionTitle(sessionId: string): string | null {
  const tabTitle = useTabStore.getState().tabs.find((tab) => tab.sessionId === sessionId)?.title
  if (tabTitle) return tabTitle
  return useSessionStore.getState().sessions.find((session) => session.id === sessionId)?.title ?? null
}

function shouldApplyFirstUserTitle(sessionId: string, title: string): boolean {
  const currentTitle = currentSessionTitle(sessionId)
  return !currentTitle || isDefaultSessionTitle(currentTitle) || currentTitle === title
}

function resolveSessionTitleUpdate(sessionId: string, incomingTitle: string): string {
  const firstUserTitle = getFirstUserMessageTitle(
    useChatStore.getState().sessions[sessionId]?.messages ?? [],
  )
  if (!firstUserTitle) return incomingTitle

  const currentTitle = currentSessionTitle(sessionId)
  if (
    !currentTitle ||
    isDefaultSessionTitle(currentTitle) ||
    currentTitle === incomingTitle ||
    currentTitle === firstUserTitle ||
    incomingTitle === firstUserTitle
  ) {
    return firstUserTitle
  }

  return currentTitle
}

let msgCounter = 0
const nextId = () => `msg-${++msgCounter}-${Date.now()}`

function nextSteerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `00000000-0000-4000-8000-${String(++msgCounter).padStart(12, '0')}`
}

function isPendingSteerActionable(steer: PendingSteer): boolean {
  return steer.status === 'draft' || steer.status === 'failed'
}

function isPendingSteerAutoSendable(steer: PendingSteer): boolean {
  return steer.status === 'draft'
}

function pendingSteerAttachmentsToRefs(attachments?: UIAttachment[]): AttachmentRef[] | undefined {
  if (!attachments?.length) return undefined
  return attachments.map((attachment) => ({
    type: attachment.type,
    name: attachment.name,
    path: attachment.path,
    data: attachment.data,
    mimeType: attachment.mimeType,
  }))
}

function mergePendingSteers(steers: PendingSteer[]): { content: string; attachments?: AttachmentRef[] } {
  const content = steers
    .map((steer) => steer.content.trim())
    .filter(Boolean)
    .join('\n\n')
  const attachments = steers.flatMap((steer) => pendingSteerAttachmentsToRefs(steer.attachments) ?? [])
  return {
    content,
    attachments: attachments.length > 0 ? attachments : undefined,
  }
}

// Streaming throttle for content_delta
const pendingDeltas = new Map<string, string>()
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>()
const historyLoadTokens = new Map<string, symbol>()

function consumePendingDelta(sessionId: string): string {
  const timer = flushTimers.get(sessionId)
  if (timer) {
    clearTimeout(timer)
    flushTimers.delete(sessionId)
  }
  const text = pendingDeltas.get(sessionId) ?? ''
  pendingDeltas.delete(sessionId)
  return text
}

function clearPendingDelta(sessionId: string) {
  const timer = flushTimers.get(sessionId)
  if (timer) clearTimeout(timer)
  flushTimers.delete(sessionId)
  pendingDeltas.delete(sessionId)
}

function beginHistoryLoad(sessionId: string) {
  const token = Symbol(sessionId)
  historyLoadTokens.set(sessionId, token)
  return token
}

function isCurrentHistoryLoad(sessionId: string, token: symbol) {
  return historyLoadTokens.get(sessionId) === token
}

function finishHistoryLoad(sessionId: string, token: symbol) {
  if (isCurrentHistoryLoad(sessionId, token)) {
    historyLoadTokens.delete(sessionId)
  }
}

function isEmptyHistoryState(session?: PerSessionState) {
  return (
    !session ||
    (session.messages.length === 0 &&
      session.historyBuffer.length === 0 &&
      session.recentBuffer.length === 0)
  )
}

function isNotFoundError(error: unknown) {
  return error instanceof ApiError && error.status === 404
}

function appendAssistantTextMessage(
  messages: UIMessage[],
  content: string,
  timestamp: number,
  model?: string,
): UIMessage[] {
  if (!content.trim()) return messages

  const last = messages[messages.length - 1]
  if (last?.type === 'assistant_text') {
    const merged: UIMessage = {
      ...last,
      content: last.content + content,
      ...(model ?? last.model ? { model: model ?? last.model } : {}),
    }
    return [...messages.slice(0, -1), merged]
  }

  return [
    ...messages,
    {
      id: nextId(),
      type: 'assistant_text',
      content,
      timestamp,
      ...(model ? { model } : {}),
    },
  ]
}

/** Helper: immutably update a specific session within the sessions record */
function updateSessionIn(
  sessions: Record<string, PerSessionState>,
  sessionId: string,
  updater: (s: PerSessionState) => Partial<PerSessionState>,
): Record<string, PerSessionState> {
  const session = sessions[sessionId]
  if (!session) return sessions
  return { ...sessions, [sessionId]: { ...session, ...updater(session) } }
}

async function fetchAndMapSessionHistory(
  sessionId: string,
  params?: { limit?: number; before?: string; after?: string; projectPath?: string },
) {
  const { messages, hasMore } = await sessionsApi.getMessages(sessionId, params)
  const parsed = parseHistory(messages, nextId)
  return {
    rawMessages: messages,
    uiMessages: parsed.uiMessages,
    restoredNotifications: parsed.restoredNotifications,
    lastTodos: parsed.lastTodos,
    hasMessagesAfterTaskCompletion: parsed.hasMessagesAfterTaskCompletion,
    hasMore,
  }
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: {},

  getSession: (sessionId) => get().sessions[sessionId] ?? createDefaultSessionState(),

  connectToSession: (sessionId, projectPath) => {
    void useCLITaskStore.getState().fetchSessionTasks(sessionId)

    const existing = get().sessions[sessionId]
    const locatorChanged = !!projectPath && !!existing?.projectPath && existing.projectPath !== projectPath
    if (locatorChanged) {
      historyLoadTokens.delete(sessionId)
      clearPendingDelta(sessionId)
      set((s) => ({
        sessions: updateSessionIn(s.sessions, sessionId, (session) => ({
          ...session,
          projectPath,
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          allMessagesLoaded: false,
          historyLoadState: 'idle',
          streamingText: '',
          streamingToolInput: '',
          activeThinkingId: null,
          activeToolUseId: null,
          activeToolName: null,
        })),
      }))
    } else if (projectPath && existing?.projectPath !== projectPath) {
      set((s) => ({
        sessions: updateSessionIn(s.sessions, sessionId, () => ({ projectPath })),
      }))
    }
    // Only `'connected'` counts as "WS already active". The previous code
    // treated `'connecting'` as active too, which left the UI stuck in
    // connecting forever if the initial WS handshake failed (since
    // `connectionState` was never written back to `'disconnected'` from
    // ws.onclose). Now `'connecting'` triggers a re-init, which is safe
    // because wsManager.connect() is idempotent for live sockets.
    const wsAlreadyActive = !!existing && existing.connectionState === 'connected'

    // 1) WS layer — only (re)connect when not actively connected
    if (!wsAlreadyActive) {
      set((s) => ({
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...createDefaultSessionState(),
            projectPath: projectPath ?? existing?.projectPath,
            connectionState: 'connecting',
            messages: locatorChanged ? [] : existing?.messages ?? [],
            historyBuffer: locatorChanged ? [] : existing?.historyBuffer ?? [],
            recentBuffer: locatorChanged ? [] : existing?.recentBuffer ?? [],
            allMessagesLoaded: locatorChanged ? false : existing?.allMessagesLoaded ?? false,
            historyLoadState: locatorChanged ? 'idle' : existing?.historyLoadState ?? 'idle',
          },
        },
      }))

      wsManager.clearHandlers(sessionId)
      wsManager.connect(sessionId)
      // Bridge socket-level state into chatStore so a dropped/closed socket
      // unsticks the UI from `'connecting'`. Without this the only path to
      // `'connected'` was a server-sent `{type:'connected'}` message, which
      // never arrives if the handshake itself failed.
      wsManager.onStateChange(sessionId, (state) => {
        set((s) => {
          const sess = s.sessions[sessionId]
          if (!sess) return s
          if (state === 'open') {
            // Server `connected` message will set the formal 'connected'.
            // Until then we stay in 'connecting' to suppress message-send.
            return s
          }
          if (state === 'closed') {
            // Show as disconnected so connectToSession() will re-init on
            // the next focus instead of short-circuiting.
            return { sessions: updateSessionIn(s.sessions, sessionId, () => ({
              connectionState: 'disconnected',
            }))}
          }
          return s
        })
      })
      wsManager.onMessage(sessionId, (msg) => {
        if (msg.type === 'connected') {
          set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, () => ({ connectionState: 'connected' })) }))
        }
        get().handleServerMessage(sessionId, msg)
      })

      const runtimeSelection = useSessionRuntimeStore.getState().selections[sessionId]
      if (runtimeSelection) {
        wsManager.send(sessionId, { type: 'set_runtime_config', ...runtimeSelection })
      }
      if (!sessionId.startsWith('__') && !useTeamStore.getState().getMemberBySessionId(sessionId)) {
        wsManager.send(sessionId, { type: 'prewarm_session' })
      }
    }

    // 2) History layer — driven by AppShell bootstrap (explicit await before
    // setReady). connectToSession no longer auto-triggers loadHistory so the
    // caller controls when data is ready vs when the UI is revealed.

    // 3) Slash commands — independent fetch
    if (!wsAlreadyActive) {
      sessionsApi.getSlashCommands(sessionId, { projectPath: projectPath ?? existing?.projectPath })
        .then(({ commands }) => {
          if (get().sessions[sessionId]) {
            set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, () => ({ slashCommands: commands })) }))
          }
        })
        .catch(() => {
          if (get().sessions[sessionId]) {
            set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, () => ({ slashCommands: [] })) }))
          }
        })
    }
  },

  ensureSessionReady: async (sessionId, projectPath) => {
    get().connectToSession(sessionId, projectPath)
    await get().loadHistory(sessionId, projectPath)
  },

  disconnectSession: (sessionId) => {
    const session = get().sessions[sessionId]
    if (session?.elapsedTimer) clearInterval(session.elapsedTimer)
    const pendingDelta = pendingDeltas.get(sessionId)
    if (pendingDelta) {
      const text = consumePendingDelta(sessionId)
      set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, (sess) => ({ streamingText: sess.streamingText + text })) }))
    } else {
      clearPendingDelta(sessionId)
    }
    historyLoadTokens.delete(sessionId)
    wsManager.disconnect(sessionId)
    set((s) => {
      const { [sessionId]: _, ...rest } = s.sessions
      return { sessions: rest }
    })
  },

  sendMessage: (sessionId, content, attachments, options) => {
    const userFacingContent =
      options?.displayContent?.trim() || content.trim()
    const isMemberSession = !!useTeamStore.getState().getMemberBySessionId(sessionId)
    const existingSession = get().sessions[sessionId]
    const firstUserTitle = !isMemberSession && !getFirstUserMessageTitle(existingSession?.messages ?? [])
      ? deriveUserMessageTitle(userFacingContent)
      : null
    const uiAttachments: UIAttachment[] | undefined =
      attachments && attachments.length > 0
        ? attachments.map((a) => ({
            type: a.type,
            name: a.name || a.path || a.mimeType || a.type,
            path: a.path,
            data: a.data,
            mimeType: a.mimeType,
          }))
        : undefined

    const taskStore = useCLITaskStore.getState()
    const allTasksDone = taskStore.tasks.length > 0 && taskStore.tasks.every((t) => t.status === 'completed')
    const completedTaskSummary = allTasksDone
      ? taskStore.tasks.map((t) => ({ id: t.id, subject: t.subject, status: t.status, activeForm: t.activeForm }))
      : []

    if (!isMemberSession && allTasksDone) {
      void taskStore.resetCompletedTasks()
    }

    set((s) => {
      const session = s.sessions[sessionId] ?? createDefaultSessionState()
      const bufferedDelta = consumePendingDelta(sessionId)
      const pendingAssistantText = `${session.streamingText}${bufferedDelta}`

      const newMessages = pendingAssistantText.trim()
        ? appendAssistantTextMessage(session.messages, pendingAssistantText, Date.now())
        : [...session.messages]
      if (!isMemberSession && allTasksDone) {
        newMessages.push({
          id: nextId(),
          type: 'task_summary',
          tasks: completedTaskSummary,
          timestamp: Date.now(),
        })
      }
      const now = Date.now()
      newMessages.push({
        id: nextId(),
        type: 'user_text',
        content: userFacingContent,
        attachments: isMemberSession ? undefined : uiAttachments,
        timestamp: now,
        ...(isMemberSession ? { pending: true } : {}),
      })

      if (!isMemberSession && session.elapsedTimer) clearInterval(session.elapsedTimer)

      const timer = !isMemberSession
        ? setInterval(() => {
            set((st) => ({ sessions: updateSessionIn(st.sessions, sessionId, (sess) => ({ elapsedSeconds: sess.elapsedSeconds + 1 })) }))
          }, 1000)
        : null

      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            messages: newMessages,
            chatState: 'thinking',
            elapsedSeconds: 0,
            streamingText: '',
            dismissedThinkingPanelIdentityKey: null,
            statusVerb: isMemberSession ? '' : randomSpinnerVerb(),
            turnStartedAt: now,
            lastModelActivityAt: null,
            lastConnectionActivityAt: now,
            elapsedTimer: timer,
            connectionState: isMemberSession ? 'connected' : session.connectionState,
            pendingSteers: (session.pendingSteers ?? []).filter(isPendingSteerActionable),
          },
        },
      }
    })

    if (firstUserTitle && shouldApplyFirstUserTitle(sessionId, firstUserTitle)) {
      useSessionStore.getState().updateSessionTitle(sessionId, firstUserTitle)
      useTabStore.getState().updateTabTitle(sessionId, firstUserTitle)
    }

    if (isMemberSession) {
      void useTeamStore.getState().sendMessageToMember(sessionId, userFacingContent)
        .catch((err) => {
          set((s) => ({
            sessions: updateSessionIn(s.sessions, sessionId, (session) => ({
              chatState: 'idle',
              messages: [
                ...session.messages,
                {
                  id: nextId(),
                  type: 'error',
                  message: err instanceof Error ? err.message : String(err),
                  code: 'TEAM_MEMBER_MESSAGE_FAILED',
                  timestamp: Date.now(),
                },
              ],
            })),
          }))
        })
      return
    }

    wsManager.send(sessionId, { type: 'user_message', content, attachments })
  },

  queuePendingSteer: (sessionId, content, attachments, options) => {
    const userFacingContent = options?.displayContent?.trim() || content.trim()
    const uiAttachments: UIAttachment[] | undefined =
      attachments && attachments.length > 0
        ? attachments.map((a) => ({
            type: a.type,
            name: a.name || a.path || a.mimeType || a.type,
            path: a.path,
            data: a.data,
            mimeType: a.mimeType,
          }))
        : undefined
    const id = nextSteerId()

    set((s) => {
      const session = s.sessions[sessionId] ?? createDefaultSessionState()
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            pendingSteers: [
              ...(session.pendingSteers ?? []),
              {
                id,
                content: userFacingContent,
                attachments: uiAttachments,
                createdAt: Date.now(),
                status: 'draft',
              },
            ],
          },
        },
      }
    })

    return id
  },

  sendPendingSteers: (sessionId, priority, steerIds) => {
    const session = get().sessions[sessionId]
    if (!session) return
    const targetIds = steerIds ? new Set(steerIds) : null
    const targets = (session.pendingSteers ?? []).filter((steer) =>
      isPendingSteerActionable(steer) && (!targetIds || targetIds.has(steer.id))
    )
    if (targets.length === 0) return

    set((s) => ({
      sessions: updateSessionIn(s.sessions, sessionId, (current) => ({
        pendingSteers: (current.pendingSteers ?? []).map((steer) =>
          targets.some((target) => target.id === steer.id)
            ? { ...steer, status: 'queued', priority, error: undefined }
            : steer,
        ),
      })),
    }))

    for (const steer of targets) {
      wsManager.send(sessionId, {
        type: 'user_steer',
        steerId: steer.id,
        content: steer.content,
        attachments: steer.attachments?.map((attachment) => ({
          type: attachment.type,
          name: attachment.name,
          path: attachment.path,
          data: attachment.data,
          mimeType: attachment.mimeType,
        })),
        priority,
      })
    }
  },

  autoSendPendingSteers: (sessionId) => {
    const session = get().sessions[sessionId]
    if (!session) return
    const targets = (session.pendingSteers ?? [])
      .filter(isPendingSteerAutoSendable)
      .sort((a, b) => a.createdAt - b.createdAt)
    if (targets.length === 0) return

    const targetIds = new Set(targets.map((steer) => steer.id))
    const { content, attachments } = mergePendingSteers(targets)

    set((s) => ({
      sessions: updateSessionIn(s.sessions, sessionId, (current) => ({
        pendingSteers: (current.pendingSteers ?? []).filter((steer) => !targetIds.has(steer.id)),
      })),
    }))

    get().sendMessage(sessionId, content, attachments)
  },

  editPendingSteer: (sessionId, steerId) => {
    const steer = get().sessions[sessionId]?.pendingSteers?.find((entry) => entry.id === steerId)
    if (!steer || !isPendingSteerActionable(steer)) return

    set((s) => ({
      sessions: updateSessionIn(s.sessions, sessionId, (session) => ({
        pendingSteers: (session.pendingSteers ?? []).filter((entry) => entry.id !== steerId),
        composerPrefill: {
          text: steer.content,
          attachments: steer.attachments,
          nonce: Date.now(),
        },
      })),
    }))
  },

  cancelPendingSteer: (sessionId, steerId) => {
    const steer = get().sessions[sessionId]?.pendingSteers?.find((entry) => entry.id === steerId)
    if (!steer) return
    if (steer.status === 'queued' || steer.status === 'processing') {
      wsManager.send(sessionId, { type: 'cancel_steer', steerId })
    }
    set((s) => ({
      sessions: updateSessionIn(s.sessions, sessionId, (session) => ({
        pendingSteers: (session.pendingSteers ?? []).filter((entry) => entry.id !== steerId),
      })),
    }))
  },

  respondToPermission: (sessionId, requestId, allowed, options) => {
    wsManager.send(sessionId, {
      type: 'permission_response',
      requestId,
      allowed,
      ...(options?.rule ? { rule: options.rule } : {}),
      ...(options?.updatedInput ? { updatedInput: options.updatedInput } : {}),
    })
    set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, () => ({ pendingPermission: null, chatState: allowed ? 'tool_executing' : 'idle' })) }))
  },

  respondToComputerUsePermission: (sessionId, requestId, response) => {
    wsManager.send(sessionId, {
      type: 'computer_use_permission_response',
      requestId,
      response,
    })
    set((s) => ({
      sessions: updateSessionIn(s.sessions, sessionId, () => ({
        pendingComputerUsePermission: null,
        chatState: response.userConsented === false ? 'idle' : 'tool_executing',
      })),
    }))
  },

  setSessionRuntime: (sessionId, selection) => {
    wsManager.send(sessionId, {
      type: 'set_runtime_config',
      ...selection,
    })
  },

  setSessionPermissionMode: (sessionId, mode) => {
    if (!get().sessions[sessionId]) return
    wsManager.send(sessionId, { type: 'set_permission_mode', mode })
  },

  stopGeneration: (sessionId) => {
    wsManager.send(sessionId, { type: 'stop_generation' })
    const pendingDelta = pendingDeltas.get(sessionId)
    if (pendingDelta) {
      const text = consumePendingDelta(sessionId)
      set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, (sess) => ({ streamingText: sess.streamingText + text })) }))
    } else {
      clearPendingDelta(sessionId)
    }
    set((s) => {
      const session = s.sessions[sessionId]
      if (!session) return s
      if (session.elapsedTimer) clearInterval(session.elapsedTimer)
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            chatState: 'idle',
            pendingPermission: null,
            pendingComputerUsePermission: null,
            activeThinkingId: null,
            dismissedThinkingPanelIdentityKey: getThinkingPanelIdentityKey(sessionId, session.messages),
            elapsedTimer: null,
            statusVerb: '',
            turnStartedAt: null,
            lastModelActivityAt: null,
          },
        },
      }
    })
  },

  loadMoreHistory: async (sessionId) => {
    const session = get().sessions[sessionId]
    if (!session) return
    if (session.allMessagesLoaded && session.historyBuffer.length === 0) return

    let olderMessages: UIMessage[] = []
    let fetchedFromServer = false
    let serverHasMore = false

    // 1. First try historyBuffer (local, instant)
    if (session.historyBuffer.length > 0) {
      const takeCount = Math.min(HISTORY_PAGE_SIZE, session.historyBuffer.length)
      olderMessages = session.historyBuffer.slice(-takeCount)
    } else if (!session.allMessagesLoaded) {
      // 2. Fetch older messages from server using before cursor
      const firstMsgWithServerId = session.messages.find((m) => 'serverId' in m && m.serverId)
      const cursor = firstMsgWithServerId?.serverId
      if (!cursor) {
        // Can't paginate without a server-side cursor — mark done
        set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, () => ({ allMessagesLoaded: true })) }))
        return
      }
      try {
        const result = await fetchAndMapSessionHistory(sessionId, {
          limit: HISTORY_PAGE_SIZE,
          before: cursor,
          projectPath: session.projectPath,
        })
        olderMessages = result.uiMessages
        serverHasMore = result.hasMore
        fetchedFromServer = true
      } catch (err) {
        console.error('[chatStore] loadMoreHistory failed', err)
        return
      }
    }

    if (olderMessages.length === 0) return

    set((s) => {
      const sess = s.sessions[sessionId]
      if (!sess) return s

      // If we took from historyBuffer, remove those items
      let historyBuffer = sess.historyBuffer
      if (!fetchedFromServer && historyBuffer.length > 0) {
        const takenCount = Math.min(HISTORY_PAGE_SIZE, historyBuffer.length)
        historyBuffer = historyBuffer.slice(0, -takenCount)
      }

      // Prepend older messages
      let messages = [...olderMessages, ...sess.messages]
      let recentBuffer = sess.recentBuffer

      // Trim tail (newest) into recentBuffer if window exceeds WINDOW_SIZE
      if (messages.length > WINDOW_SIZE) {
        const trimCount = messages.length - WINDOW_SIZE
        recentBuffer = [...messages.slice(-trimCount), ...recentBuffer]
        messages = messages.slice(0, WINDOW_SIZE)
      }

      const allLoaded = (fetchedFromServer ? !serverHasMore : sess.allMessagesLoaded) && historyBuffer.length === 0

      return {
        sessions: updateSessionIn(s.sessions, sessionId, () => ({
          messages,
          historyBuffer,
          recentBuffer,
          allMessagesLoaded: allLoaded,
        })),
      }
    })
  },

  loadMoreRecent: (sessionId) => {
    const session = get().sessions[sessionId]
    if (!session || session.recentBuffer.length === 0) return

    const takeCount = Math.min(HISTORY_PAGE_SIZE, session.recentBuffer.length)
    const newerMessages = session.recentBuffer.slice(0, takeCount)
    const remainingRecentBuffer = session.recentBuffer.slice(takeCount)

    // Insert recentBuffer messages at the correct chronological position.
    // They were trimmed from the tail before any WS-pushed messages arrived,
    // so they should go before any messages with a later timestamp.
    const lastRecentTimestamp = newerMessages[newerMessages.length - 1]!.timestamp
    let insertIndex = session.messages.length
    for (let i = 0; i < session.messages.length; i++) {
      if (session.messages[i]!.timestamp > lastRecentTimestamp) {
        insertIndex = i
        break
      }
    }

    let messages = [
      ...session.messages.slice(0, insertIndex),
      ...newerMessages,
      ...session.messages.slice(insertIndex),
    ]

    // Trim head (oldest) into historyBuffer if window exceeds WINDOW_SIZE
    let historyBuffer = session.historyBuffer
    if (messages.length > WINDOW_SIZE) {
      const trimCount = messages.length - WINDOW_SIZE
      historyBuffer = [...messages.slice(0, trimCount), ...historyBuffer]
      messages = messages.slice(trimCount)
    }

    set((s) => ({
      sessions: updateSessionIn(s.sessions, sessionId, () => ({
        messages,
        historyBuffer,
        recentBuffer: remainingRecentBuffer,
        allMessagesLoaded: session.allMessagesLoaded && historyBuffer.length === 0,
      })),
    }))
  },

  loadHistory: async (sessionId, projectPath) => {
    const current = get().sessions[sessionId]
    if (!current) return
    const locatorChanged = !!projectPath && !!current.projectPath && current.projectPath !== projectPath
    const effectiveProjectPath = projectPath ?? current.projectPath
    // Re-entry guard: an in-flight fetch is in progress
    if (current.historyLoadState === 'loading' && !locatorChanged) return
    // Already-loaded guard: an empty transcript is still a successfully loaded
    // transcript. Brand-new sessions can legitimately have zero messages, so
    // don't keep refetching them on every tab switch and risk turning a brief
    // locator/server race into a visible error state.
    if (!locatorChanged && current.historyLoadState === 'loaded') return

    const historyToken = beginHistoryLoad(sessionId)

    set((s) => ({
      sessions: updateSessionIn(s.sessions, sessionId, () => ({
        projectPath: effectiveProjectPath,
        ...(locatorChanged ? {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          allMessagesLoaded: false,
        } : {}),
        historyLoadState: 'loading',
      })),
    }))

    try {
      const {
        uiMessages,
        restoredNotifications,
        lastTodos,
        hasMessagesAfterTaskCompletion,
        hasMore,
      } = await fetchAndMapSessionHistory(sessionId, { limit: HISTORY_LOAD_LIMIT, projectPath: effectiveProjectPath })
      if (!isCurrentHistoryLoad(sessionId, historyToken)) return

      set((state) => {
        if (!isCurrentHistoryLoad(sessionId, historyToken)) return state
        const session = state.sessions[sessionId]
        if (!session) return state
        if (state.sessions[sessionId] !== undefined && session.historyLoadState !== 'loading') {
          return state
        }
        // Merge server history with any WS-pushed messages that arrived
        // during the fetch.  Deduplicate by serverId.
        const serverIds = new Set(
          uiMessages
            .filter((m) => 'serverId' in m && m.serverId)
            .map((m) => (m as { serverId: string }).serverId),
        )
        const localOnly = session.messages.filter(
          (m) => !('serverId' in m && m.serverId && serverIds.has(m.serverId)),
        )
        const merged = [...uiMessages, ...localOnly]

        // Apply sliding window: if merged exceeds WINDOW_SIZE, trim from head
        // (oldest) into historyBuffer.
        let messages = merged
        let historyBuffer = session.historyBuffer
        if (messages.length > WINDOW_SIZE) {
          const trimCount = messages.length - WINDOW_SIZE
          historyBuffer = [...messages.slice(0, trimCount), ...historyBuffer]
          messages = messages.slice(trimCount)
        }

        return { sessions: updateSessionIn(state.sessions, sessionId, (s) => ({
          messages,
          historyBuffer,
          recentBuffer: [],
          allMessagesLoaded: !hasMore && historyBuffer.length === 0,
          historyLoadState: 'loaded',
          projectPath: effectiveProjectPath,
          agentTaskNotifications: { ...s.agentTaskNotifications, ...restoredNotifications },
        })) }
      })
      if (isCurrentHistoryLoad(sessionId, historyToken) && get().sessions[sessionId]?.historyLoadState === 'loaded') {
        finishHistoryLoad(sessionId, historyToken)
        if (lastTodos && lastTodos.length > 0) {
          const taskStore = useCLITaskStore.getState()
          if (taskStore.tasks.length === 0) taskStore.setTasksFromTodos(lastTodos)
        } else {
          useCLITaskStore.getState().setTasksFromTodos([])
        }
        if (hasMessagesAfterTaskCompletion) {
          useCLITaskStore.getState().markCompletedAndDismissed()
        }
      }
    } catch (err) {
      if (!isCurrentHistoryLoad(sessionId, historyToken)) return
      const currentSession = get().sessions[sessionId]
      if (isNotFoundError(err) && isEmptyHistoryState(currentSession)) {
        set((s) => {
          const session = s.sessions[sessionId]
          if (!session || session.historyLoadState !== 'loading') return s
          return {
            sessions: updateSessionIn(s.sessions, sessionId, () => ({
              messages: [],
              historyBuffer: [],
              recentBuffer: [],
              allMessagesLoaded: true,
              historyLoadState: 'loaded',
              projectPath: effectiveProjectPath,
            })),
          }
        })
        if (get().sessions[sessionId]?.historyLoadState === 'loaded') {
          useCLITaskStore.getState().setTasksFromTodos([])
        }
        finishHistoryLoad(sessionId, historyToken)
        return
      }

      console.error('[chatStore] loadHistory failed for', sessionId, err)
      // Only mark error if the session is still in 'loading' (still ours).
      set((s) => {
        const session = s.sessions[sessionId]
        if (!session || session.historyLoadState !== 'loading') return s
        return {
          sessions: updateSessionIn(s.sessions, sessionId, () => ({
            historyLoadState: 'error',
          })),
        }
      })
      finishHistoryLoad(sessionId, historyToken)
    }
  },

  reloadHistory: async (sessionId, projectPath) => {
    const effectiveProjectPath = projectPath ?? get().sessions[sessionId]?.projectPath
    const historyToken = beginHistoryLoad(sessionId)
    set((s) => ({
      sessions: updateSessionIn(s.sessions, sessionId, () => ({
        projectPath: effectiveProjectPath,
        historyLoadState: 'loading',
      })),
    }))
    try {
      const {
        uiMessages,
        restoredNotifications,
        lastTodos,
        hasMessagesAfterTaskCompletion,
        hasMore,
      } = await fetchAndMapSessionHistory(sessionId, { limit: HISTORY_LOAD_LIMIT, projectPath: effectiveProjectPath })
      if (!isCurrentHistoryLoad(sessionId, historyToken)) return

      set((state) => {
        if (!isCurrentHistoryLoad(sessionId, historyToken)) return state
        const session = state.sessions[sessionId]
        if (!session) return state
        if (session.elapsedTimer) clearInterval(session.elapsedTimer)

        // Apply sliding window: trim head into historyBuffer if exceeds WINDOW_SIZE
        let messages = uiMessages
        let historyBuffer: UIMessage[] = []
        if (messages.length > WINDOW_SIZE) {
          const trimCount = messages.length - WINDOW_SIZE
          historyBuffer = messages.slice(0, trimCount)
          messages = messages.slice(trimCount)
        }

        return {
          sessions: updateSessionIn(state.sessions, sessionId, () => ({
            messages,
            historyBuffer,
            recentBuffer: [],
            allMessagesLoaded: !hasMore && historyBuffer.length === 0,
            agentTaskNotifications: restoredNotifications,
            historyLoadState: 'loaded',
            projectPath: effectiveProjectPath,
            chatState: 'idle',
            activeThinkingId: null,
            activeToolUseId: null,
            activeToolName: null,
            streamingText: '',
            streamingToolInput: '',
            pendingPermission: null,
            pendingComputerUsePermission: null,
            elapsedTimer: null,
            statusVerb: '',
            turnStartedAt: null,
            lastModelActivityAt: null,
          })),
        }
      })

      if (isCurrentHistoryLoad(sessionId, historyToken) && get().sessions[sessionId]?.historyLoadState === 'loaded') {
        finishHistoryLoad(sessionId, historyToken)
        if (lastTodos && lastTodos.length > 0) {
          useCLITaskStore.getState().setTasksFromTodos(lastTodos)
        } else {
          useCLITaskStore.getState().setTasksFromTodos([])
        }
        if (hasMessagesAfterTaskCompletion) {
          useCLITaskStore.getState().markCompletedAndDismissed()
        }
      }
    } catch (err) {
      if (!isCurrentHistoryLoad(sessionId, historyToken)) return
      const currentSession = get().sessions[sessionId]
      if (isNotFoundError(err) && isEmptyHistoryState(currentSession)) {
        set((s) => ({
          sessions: updateSessionIn(s.sessions, sessionId, () => ({
            messages: [],
            historyBuffer: [],
            recentBuffer: [],
            allMessagesLoaded: true,
            historyLoadState: 'loaded',
            projectPath: effectiveProjectPath,
            agentTaskNotifications: {},
          })),
        }))
        if (get().sessions[sessionId]?.historyLoadState === 'loaded') {
          useCLITaskStore.getState().setTasksFromTodos([])
        }
        finishHistoryLoad(sessionId, historyToken)
        return
      }

      console.error('[chatStore] reloadHistory failed for', sessionId, err)
      set((s) => ({
        sessions: updateSessionIn(s.sessions, sessionId, () => ({
          historyLoadState: 'error',
        })),
      }))
      finishHistoryLoad(sessionId, historyToken)
    }
  },

  queueComposerPrefill: (sessionId, prefill) => {
    set((state) => ({
      sessions: updateSessionIn(state.sessions, sessionId, () => ({
        composerPrefill: {
          text: prefill.text,
          attachments: prefill.attachments,
          nonce: Date.now(),
        },
      })),
    }))
  },

  clearMessages: (sessionId) => {
    set((s) => ({
      sessions: updateSessionIn(s.sessions, sessionId, () => ({
        messages: [],
        streamingText: '',
        activeThinkingId: null,
        dismissedThinkingPanelIdentityKey: null,
        chatState: 'idle',
        turnStartedAt: null,
        lastModelActivityAt: null,
        pendingSteers: [],
      })),
    }))
  },

  handleServerMessage: (sessionId, msg) => {
    const update = (updater: (session: PerSessionState) => Partial<PerSessionState>) => {
      set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, updater) }))
    }
    const receivedAt = Date.now()
    const markConnectionActivity = () => ({ lastConnectionActivityAt: receivedAt })
    const markModelActivity = () => ({
      lastConnectionActivityAt: receivedAt,
      lastModelActivityAt: receivedAt,
    })

    switch (msg.type) {
      case 'connected':
        update(() => markConnectionActivity())
        break

      case 'status':
        update((session) => {
          const pendingText = `${session.streamingText}${consumePendingDelta(sessionId)}`
          const hasPendingStreamText =
            session.chatState === 'streaming' && pendingText.trim().length > 0
          // Background task progress can arrive while the assistant is still
          // streaming one markdown reply. Keep that turn intact so we do not
          // split formatting markers (for example backticks/strong markers)
          // across separate bubbles.
          const preserveStreamingTurn = hasPendingStreamText && msg.state !== 'idle'
          const shouldFlush = hasPendingStreamText && msg.state === 'idle'
          const tokenProgress =
            typeof msg.tokens === 'number' && msg.tokens > session.tokenUsage.output_tokens
          return {
            ...markConnectionActivity(),
            chatState: preserveStreamingTurn ? 'streaming' : msg.state,
            ...(msg.verb && msg.verb !== 'Thinking' ? { statusVerb: msg.verb } : {}),
            ...(msg.tokens ? { tokenUsage: { ...session.tokenUsage, output_tokens: msg.tokens } } : {}),
            ...(tokenProgress ? { lastModelActivityAt: receivedAt } : {}),
            ...(msg.state === 'idle' ? {
              activeThinkingId: null,
              statusVerb: '',
              turnStartedAt: null,
              lastModelActivityAt: null,
            } : {}),
            ...(shouldFlush ? {
              messages: appendAssistantTextMessage(session.messages, pendingText, Date.now()),
              streamingText: '',
            } : pendingText !== session.streamingText ? { streamingText: pendingText } : {}),
          }
        })
        if (msg.state === 'idle') {
          const session = get().sessions[sessionId]
          if (session?.elapsedTimer) {
            clearInterval(session.elapsedTimer)
            update(() => ({ elapsedTimer: null }))
          }
        }
        // Sync tab status
        useTabStore.getState().updateTabStatus(sessionId, msg.state === 'idle' ? 'idle' : 'running')
        break

      case 'content_start': {
        const session = get().sessions[sessionId]
        if (!session) break
        const pendingText = `${session.streamingText}${consumePendingDelta(sessionId)}`
        if (msg.blockType !== 'text' && pendingText.trim()) {
          update((s) => ({
            ...markModelActivity(),
            messages: appendAssistantTextMessage(s.messages, pendingText, Date.now()),
            streamingText: '',
          }))
        }
        if (msg.blockType === 'text') {
          update((s) => ({
            ...markModelActivity(),
            ...(pendingText !== s.streamingText ? { streamingText: pendingText } : {}),
            chatState: 'streaming',
            activeThinkingId: null,
          }))
        } else if (msg.blockType === 'tool_use') {
          update(() => ({
            ...markModelActivity(),
            activeToolUseId: msg.toolUseId ?? null,
            activeToolName: msg.toolName ?? null,
            streamingToolInput: '',
            chatState: 'tool_executing',
            activeThinkingId: null,
          }))
        }
        break
      }

      case 'content_delta':
        if (msg.text !== undefined) {
          pendingDeltas.set(sessionId, `${pendingDeltas.get(sessionId) ?? ''}${msg.text}`)
          if (!flushTimers.has(sessionId)) {
            const timer = setTimeout(() => {
              const text = pendingDeltas.get(sessionId) ?? ''
              pendingDeltas.delete(sessionId)
              flushTimers.delete(sessionId)
              const flushedAt = Date.now()
              update((s) => ({
                streamingText: s.streamingText + text,
                lastConnectionActivityAt: flushedAt,
                lastModelActivityAt: flushedAt,
              }))
            }, 50)
            flushTimers.set(sessionId, timer)
          }
        }
        if (msg.toolInput !== undefined) {
          update((s) => ({
            ...markModelActivity(),
            streamingToolInput: s.streamingToolInput + msg.toolInput,
          }))
        }
        break

      case 'thinking':
        // Debug: log thinking to window
        try { (window as any).__thinking_log = (window as any).__thinking_log || []; (window as any).__thinking_log.push({ ts: Date.now(), text: msg.text?.slice(0, 60) }); } catch {}
        update((s) => {
          const pendingText = `${s.streamingText}${consumePendingDelta(sessionId)}`
          const base = pendingText.trim()
            ? appendAssistantTextMessage(s.messages, pendingText, Date.now())
            : s.messages
          const last = base[base.length - 1]
          if (last && last.type === 'thinking') {
            const updated = [...base]
            updated[updated.length - 1] = { ...last, content: last.content + msg.text }
            return {
              ...markModelActivity(),
              messages: updated,
              chatState: 'thinking',
              activeThinkingId: last.id,
              streamingText: '',
            }
          }
          const id = nextId()
          return {
            ...markModelActivity(),
            messages: [...base, { id, type: 'thinking', content: msg.text, timestamp: Date.now() }],
            chatState: 'thinking',
            activeThinkingId: id,
            streamingText: '',
          }
        })
        break

      case 'tool_use_complete': {
        const session = get().sessions[sessionId]
        const toolName = msg.toolName || session?.activeToolName || 'unknown'
        update((s) => ({
          ...markModelActivity(),
          messages: [...s.messages, {
            id: nextId(), type: 'tool_use', toolName,
            toolUseId: msg.toolUseId || s.activeToolUseId || '',
            input: msg.input, timestamp: Date.now(), parentToolUseId: msg.parentToolUseId,
          }],
          activeToolUseId: null, activeToolName: null, activeThinkingId: null, streamingToolInput: '',
        }))
        if (toolName === 'TodoWrite' && Array.isArray((msg.input as any)?.todos)) {
          useCLITaskStore.getState().setTasksFromTodos((msg.input as any).todos)
        } else if (TASK_TOOL_NAMES.has(toolName)) {
          const useId = msg.toolUseId || session?.activeToolUseId
          if (useId) pendingTaskToolUseIds.add(useId)
        }
        break
      }

      case 'tool_result':
        update((s) => ({
          ...markModelActivity(),
          messages: [...s.messages, {
            id: nextId(), type: 'tool_result', toolUseId: msg.toolUseId,
            content: msg.content, isError: msg.isError, timestamp: Date.now(), parentToolUseId: msg.parentToolUseId,
          }],
          chatState: 'thinking', activeThinkingId: null,
        }))
        if (pendingTaskToolUseIds.has(msg.toolUseId)) {
          pendingTaskToolUseIds.delete(msg.toolUseId)
          useCLITaskStore.getState().refreshTasks()
        }
        break

      case 'permission_request':
        update((s) => ({
          ...markModelActivity(),
          pendingPermission: {
            requestId: msg.requestId,
            toolName: msg.toolName,
            toolUseId: msg.toolUseId,
            input: msg.input,
            description: msg.description,
          },
          pendingComputerUsePermission: null,
          chatState: 'permission_pending',
          activeThinkingId: null,
          messages:
            msg.toolName === 'AskUserQuestion'
              ? s.messages
              : [...s.messages, {
                  id: nextId(),
                  type: 'permission_request',
                  requestId: msg.requestId,
                  toolName: msg.toolName,
                  toolUseId: msg.toolUseId,
                  input: msg.input,
                  description: msg.description,
                  timestamp: Date.now(),
                }],
        }))
        break

      case 'computer_use_permission_request':
        update(() => ({
          ...markModelActivity(),
          pendingComputerUsePermission: {
            requestId: msg.requestId,
            request: msg.request,
          },
          pendingPermission: null,
          chatState: 'permission_pending',
          activeThinkingId: null,
        }))
        break

      case 'message_complete': {
        const session = get().sessions[sessionId]
        if (!session) break
        const shouldAutoSendPending = (session.pendingSteers ?? []).some(isPendingSteerAutoSendable)
        const text = `${session.streamingText}${consumePendingDelta(sessionId)}`
        if (text.trim()) {
          update((s) => ({
            ...markModelActivity(),
            messages: appendAssistantTextMessage(s.messages, text, Date.now()),
            streamingText: '',
          }))
        } else if (text !== session.streamingText) {
          update(() => ({ ...markConnectionActivity(), streamingText: text }))
        }
        if (session.elapsedTimer) clearInterval(session.elapsedTimer)
        update(() => ({
          ...markConnectionActivity(),
          tokenUsage: msg.usage,
          chatState: 'idle',
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          elapsedTimer: null,
          turnStartedAt: null,
          lastModelActivityAt: null,
          pendingSteers: (session.pendingSteers ?? []).filter(isPendingSteerActionable),
        }))
        if (shouldAutoSendPending) {
          get().autoSendPendingSteers(sessionId)
        }
        break
      }

      case 'steer_status':
        update((session) => {
          if (msg.status === 'cancelled' || msg.status === 'processed') {
            return {
              ...markConnectionActivity(),
              pendingSteers: (session.pendingSteers ?? []).filter((steer) => steer.id !== msg.steerId),
            }
          }
          return {
            ...markConnectionActivity(),
            pendingSteers: (session.pendingSteers ?? []).map((steer) =>
              steer.id === msg.steerId
                ? {
                    ...steer,
                    status: msg.status,
                    error: msg.status === 'failed' ? msg.message ?? 'Failed to queue input.' : undefined,
                  }
                : steer,
            ),
          }
        })
        break

      case 'error':
        update((s) => {
          const pendingText = `${s.streamingText}${consumePendingDelta(sessionId)}`
          let newMessages = s.messages
          if (pendingText.trim()) {
            newMessages = appendAssistantTextMessage(newMessages, pendingText, Date.now())
          }
          newMessages = [...newMessages, { id: nextId(), type: 'error', message: msg.message, code: msg.code, timestamp: Date.now() }]
          return {
            ...markConnectionActivity(),
            messages: newMessages,
            chatState: 'idle',
            activeThinkingId: null,
            streamingText: '',
            pendingPermission: null,
            pendingComputerUsePermission: null,
            turnStartedAt: null,
            lastModelActivityAt: null,
          }
        })
        useTabStore.getState().updateTabStatus(sessionId, 'error')
        {
          const session = get().sessions[sessionId]
          if (session?.elapsedTimer) {
            clearInterval(session.elapsedTimer)
            update(() => ({ elapsedTimer: null }))
          }
        }
        break

      case 'team_created':
        update(() => markConnectionActivity())
        useTeamStore.getState().handleTeamCreated(msg.teamName)
        break
      case 'team_update':
        update(() => markConnectionActivity())
        useTeamStore.getState().handleTeamUpdate(msg.teamName, msg.members)
        break
      case 'team_deleted':
        update(() => markConnectionActivity())
        useTeamStore.getState().handleTeamDeleted(msg.teamName)
        break
      case 'task_update':
        update(() => markConnectionActivity())
        break
      case 'session_title_updated':
        {
          update(() => markConnectionActivity())
          const title = resolveSessionTitleUpdate(msg.sessionId, msg.title)
          useSessionStore.getState().updateSessionTitle(msg.sessionId, title)
          useTabStore.getState().updateTabTitle(msg.sessionId, title)
        }
        break
      case 'system_notification':
        update(() => markConnectionActivity())
        if (msg.subtype === 'slash_commands' && Array.isArray(msg.data)) {
          update(() => ({ slashCommands: msg.data as Array<{ name: string; description: string }> }))
        }
        if (msg.subtype === 'session_cleared') {
          const session = get().sessions[sessionId]
          if (session?.elapsedTimer) clearInterval(session.elapsedTimer)
          update(() => ({
            messages: [],
            allMessagesLoaded: false,
            // Set to 'idle' (not 'loaded') so the next focus on this session
            // re-fetches from server and we don't trust a possibly-stale
            // local clear when server-side state could differ.
            historyLoadState: 'idle',
            streamingText: '',
            streamingToolInput: '',
            activeToolUseId: null,
            activeToolName: null,
            activeThinkingId: null,
            dismissedThinkingPanelIdentityKey: null,
            pendingPermission: null,
            pendingComputerUsePermission: null,
            chatState: 'idle',
            elapsedTimer: null,
            elapsedSeconds: 0,
            statusVerb: '',
            turnStartedAt: null,
            lastModelActivityAt: null,
            tokenUsage: { input_tokens: 0, output_tokens: 0 },
            slashCommands: [],
            pendingSteers: [],
          }))
          useCLITaskStore.getState().clearTasks()
          const defaultTitle = getDefaultSessionTitle(t)
          useSessionStore.getState().updateSessionTitle(sessionId, defaultTitle)
          useTabStore.getState().updateTabTitle(sessionId, defaultTitle)
          useTabStore.getState().updateTabStatus(sessionId, 'idle')
        }
        if (msg.subtype === 'compact_boundary') {
          update((session) => ({
            messages: [
              ...session.messages,
              {
                id: nextId(),
                type: 'system',
                content: typeof msg.message === 'string' && msg.message.trim()
                  ? msg.message
                  : 'Context compacted',
                timestamp: Date.now(),
              },
            ],
          }))
        }
        if (msg.subtype === 'prompt_memory_updated' && typeof msg.message === 'string') {
          const content = msg.message.trim()
          if (content) {
            update((session) => ({
              messages: [
                ...session.messages,
                {
                  id: nextId(),
                  type: 'system',
                  content,
                  timestamp: Date.now(),
                },
              ],
            }))
          }
        }
        if (msg.subtype === 'task_notification' && msg.data && typeof msg.data === 'object') {
          const data = msg.data as Record<string, unknown>
          const toolUseId =
            typeof data.tool_use_id === 'string' && data.tool_use_id.trim()
              ? data.tool_use_id
              : null
          const taskStatus = data.status
          if (
            toolUseId &&
            (taskStatus === 'completed' ||
              taskStatus === 'failed' ||
              taskStatus === 'stopped')
          ) {
            update((session) => ({
              agentTaskNotifications: {
                ...session.agentTaskNotifications,
                [toolUseId]: {
                  taskId:
                    typeof data.task_id === 'string' && data.task_id.trim()
                      ? data.task_id
                      : toolUseId,
                  toolUseId,
                  status: taskStatus,
                  summary:
                    typeof data.summary === 'string' && data.summary.trim()
                      ? data.summary
                      : undefined,
                  outputFile:
                    typeof data.output_file === 'string' && data.output_file.trim()
                      ? data.output_file
                      : undefined,
                },
              },
            }))
          }
        }
        break
      case 'pong':
        update(() => markConnectionActivity())
        break
    }
  },
}))

export function mapHistoryMessagesToUiMessages(
  messages: MessageEntry[],
  options?: HistoryMappingOptions,
): UIMessage[] {
  return mapHistoryMessagesImpl(messages, nextId, options)
}

export function reconstructAgentNotifications(
  messages: MessageEntry[],
): Record<string, AgentTaskNotification> {
  return reconstructAgentNotificationsImpl(messages)
}
