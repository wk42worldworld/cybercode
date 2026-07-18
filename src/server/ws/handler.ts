/**
 * WebSocket connection handler
 *
 * 管理 WebSocket 连接生命周期，处理消息路由。
 * 用户消息通过 CLI 子进程（stream-json 模式）处理，
 * CLI stdout 消息被转换为 ServerMessage 并转发到 WebSocket。
 */

import type { ServerWebSocket } from 'bun'
import type { AttachmentRef, ClientMessage, ServerMessage } from './events.js'
import * as os from 'node:os'
import {
  ConversationStartupError,
  conversationService,
} from '../services/conversationService.js'
import { computerUseApprovalService } from '../services/computerUseApprovalService.js'
import { sessionService } from '../services/sessionService.js'
import { SettingsService } from '../services/settingsService.js'
import { ProviderService } from '../services/providerService.js'
import { deriveTitle, saveAiTitle } from '../services/titleService.js'
import { parseSlashCommand } from '../../utils/slashCommandParsing.js'
import {
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
} from '../../constants/xml.js'
import {
  buildPathRequiredAttachmentMessage,
  getInlineFileAttachmentsWithoutPath,
} from './attachmentPolicy.js'
import { openSessionSearchDb } from '../../sessionSearch/db.js'
import { ensureSessionSearchIndexFresh } from '../../sessionSearch/indexer.js'
import { buildPastSessionPromptContext } from '../../sessionSearch/promptContext.js'
import { buildProjectMemoryPromptContext } from '../../sessionSearch/projectMemory.js'
import { appendProjectMemoryContext } from '../../sessionSearch/projectMemoryContext.js'
import { readPromptMemoryConfig } from '../../promptMemory/config.js'
import {
  isImageInputUnsupportedError,
  resolveProviderImageSupportDynamically,
} from '../services/modelImageCapabilityProbe.js'
import { recordLearnedImageSupport } from '../../utils/model/imageCapabilityRegistry.js'
import type { SavedProvider } from '../types/provider.js'

const settingsService = new SettingsService()
const providerService = new ProviderService()

/**
 * Cache slash commands from CLI init messages, keyed by sessionId.
 */
const sessionSlashCommands = new Map<string, Array<{ name: string; description: string }>>()

/**
 * Timers for delayed session cleanup after client disconnect.
 * If a client reconnects within 5 minutes, the timer is cancelled.
 */
const sessionCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Track sessions where user requested stop — suppress the CLI_ERROR that
 * follows an interrupt so the frontend doesn't show "处理过程中发生错误".
 */
const sessionStopRequested = new Set<string>()

/**
 * Track user message count and title state per session for auto-title generation.
 */
const sessionTitleState = new Map<string, {
  userMessageCount: number
  hasCustomTitle: boolean
  firstUserMessage: string
}>()

const runtimeOverrides = new Map<string, {
  providerId: string | null
  modelId: string
  contextWindow?: number
}>()

const runtimeTransitionPromises = new Map<string, Promise<void>>()
const sessionStartupPromises = new Map<string, Promise<void>>()
const mediaRecoveryPromises = new Map<string, Promise<void>>()
const pendingImageTurns = new Map<string, PendingImageTurn[]>()
const imageFallbackSessions = new Set<string>()
const prewarmPendingSessions = new Set<string>()
const prewarmedSessions = new Set<string>()
const prewarmIdleTimers = new Map<string, ReturnType<typeof setTimeout>>()
const DEFAULT_PREWARM_IDLE_TIMEOUT_MS = 5 * 60_000
const PROMPT_MEMORY_AUTO_REVIEW_TOOL_USE_ID = 'prompt_memory_auto_review'
const IMAGE_ATTACHMENT_EXT_RE = /\.(?:png|jpe?g|webp|gif|bmp|heic|heif|tiff?)(?:"|\s|$)/i
type ImageAttachmentMode = 'vision' | 'file-reference'
type ImageAttachmentRoute = {
  mode: ImageAttachmentMode
  provider: SavedProvider | null
  modelId?: string
}
type PendingImageTurn = {
  content: string
  attachments: AttachmentRef[]
  route: ImageAttachmentRoute
  retryCount: number
}

export function getSlashCommands(sessionId: string): Array<{ name: string; description: string }> {
  return sessionSlashCommands.get(sessionId) || []
}

export type WebSocketData = {
  sessionId: string
  connectedAt: number
  channel: 'client' | 'sdk'
  sdkToken: string | null
  serverPort: number
  serverHost: string
}

// Active WebSocket sessions
const activeSessions = new Map<string, ServerWebSocket<WebSocketData>>()

export const handleWebSocket = {
  open(ws: ServerWebSocket<WebSocketData>) {
    const { sessionId, channel, sdkToken } = ws.data

    if (channel === 'sdk') {
      if (!conversationService.authorizeSdkConnection(sessionId, sdkToken)) {
        console.warn(`[WS] Rejected SDK connection for session: ${sessionId}`)
        ws.close(1008, 'Invalid SDK token')
        return
      }

      conversationService.attachSdkConnection(sessionId, ws)
      console.log(`[WS] SDK connected for session: ${sessionId}`)
      return
    }

    console.log(`[WS] Client connected for session: ${sessionId}`)

    // Cancel pending cleanup timer if client reconnects
    const pendingTimer = sessionCleanupTimers.get(sessionId)
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      sessionCleanupTimers.delete(sessionId)
    }

    activeSessions.set(sessionId, ws)
    // Force-reset any stale stream state from a previous connection so the
    // new session doesn't inherit stale hasReceivedStreamEvents / tool_use flags.
    cleanupStreamState(sessionId)
    if (prewarmedSessions.has(sessionId)) {
      bindPrewarmMetadataCapture(sessionId)
    } else {
      rebindSessionOutput(sessionId, ws)
    }

    const msg: ServerMessage = { type: 'connected', sessionId }
    ws.send(JSON.stringify(msg))
  },

  message(ws: ServerWebSocket<WebSocketData>, rawMessage: string | Buffer) {
    if (ws.data.channel === 'sdk') {
      const payload = typeof rawMessage === 'string' ? rawMessage : rawMessage.toString()
      conversationService.handleSdkPayload(ws.data.sessionId, payload)
      return
    }

    try {
      const message = JSON.parse(
        typeof rawMessage === 'string' ? rawMessage : rawMessage.toString()
      ) as ClientMessage

      switch (message.type) {
        case 'user_message':
          handleUserMessage(ws, message).catch((err) => {
            console.error(`[WS] Unhandled error in handleUserMessage:`, err)
          })
          break

        case 'user_steer':
          handleUserSteer(ws, message).catch((err) => {
            console.error(`[WS] Unhandled error in handleUserSteer:`, err)
          })
          break

        case 'cancel_steer':
          handleCancelSteer(ws, message).catch((err) => {
            console.error(`[WS] Unhandled error in handleCancelSteer:`, err)
          })
          break

        case 'permission_response':
          handlePermissionResponse(ws, message)
          break

        case 'computer_use_permission_response':
          handleComputerUsePermissionResponse(ws, message)
          break

        case 'set_permission_mode':
          handleSetPermissionMode(ws, message)
          break

        case 'set_runtime_config':
          void handleSetRuntimeConfig(ws, message)
          break

        case 'prewarm_session':
          handlePrewarmSession(ws)
          break

        case 'stop_generation':
          handleStopGeneration(ws)
          break

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' } satisfies ServerMessage))
          break

        default:
          sendError(ws, `Unknown message type: ${(message as any).type}`, 'UNKNOWN_TYPE')
      }
    } catch (error) {
      sendError(ws, `Invalid message format: ${error}`, 'PARSE_ERROR')
    }
  },

  close(ws: ServerWebSocket<WebSocketData>, code: number, reason: string) {
    const { sessionId, channel } = ws.data

    if (channel === 'sdk') {
      console.log(`[WS] SDK disconnected from session: ${sessionId} (${code}: ${reason})`)
      conversationService.detachSdkConnection(sessionId)
      return
    }

    console.log(`[WS] Client disconnected from session: ${sessionId} (${code}: ${reason})`)
    computerUseApprovalService.cancelSession(sessionId)
    // Only clean up if this ws is still the active one for the session.
    // Prevents a stale close from wiping a newer reconnection.
    if (activeSessions.get(sessionId) === ws) {
      activeSessions.delete(sessionId)
      conversationService.clearOutputCallbacks(sessionId)
    }

    // Schedule delayed cleanup: if the client doesn't reconnect within 30 seconds,
    // stop the CLI subprocess to avoid leaking resources.
    const cleanupTimer = setTimeout(() => {
      sessionCleanupTimers.delete(sessionId)
      if (!activeSessions.has(sessionId)) {
        console.log(`[WS] Session ${sessionId} not reconnected after 30s, stopping CLI subprocess`)
        conversationService.stopSession(sessionId)
        cleanupSessionRuntimeState(sessionId)
      }
    }, 30_000)
    sessionCleanupTimers.set(sessionId, cleanupTimer)
  },

  drain(ws: ServerWebSocket<WebSocketData>) {
    // Backpressure handling - called when the socket is ready to receive more data
  },
}

// ============================================================================
// Message handlers
// ============================================================================

async function handleUserMessage(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'user_message' }>
) {
  const { sessionId } = ws.data

  // Clear any stale stop flag from a previous turn
  sessionStopRequested.delete(sessionId)
  clearPrewarmState(sessionId)
  await waitForMediaRecovery(sessionId)

  const desktopSlashCommand = getDesktopSlashCommand(message.content)
  if (desktopSlashCommand?.commandName === 'clear' && desktopSlashCommand.args.trim()) {
    sendMessage(ws, {
      type: 'error',
      message: 'The /clear command does not accept arguments.',
      code: 'INVALID_SLASH_COMMAND_ARGS',
    })
    sendMessage(ws, { type: 'status', state: 'idle' })
    return
  }

  if (desktopSlashCommand?.commandName === 'clear') {
    await handleDesktopClearCommand(ws)
    return
  }

  const inlineFileAttachments = getInlineFileAttachmentsWithoutPath(message.attachments)
  if (inlineFileAttachments.length > 0) {
    sendMessage(ws, {
      type: 'error',
      message: buildPathRequiredAttachmentMessage(inlineFileAttachments),
      code: 'ATTACHMENT_PATH_REQUIRED',
      retryable: false,
    })
    sendMessage(ws, { type: 'status', state: 'idle' })
    return
  }

  const pendingRuntimeTransition = runtimeTransitionPromises.get(sessionId)
  if (pendingRuntimeTransition) {
    try {
      await pendingRuntimeTransition
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[WS] Runtime transition failed before handling user message for ${sessionId}: ${errMsg}`)
      sendMessage(ws, {
        type: 'error',
        message: `Failed to switch provider/model: ${errMsg}`,
        code: 'CLI_RESTART_FAILED',
      })
      sendMessage(ws, { type: 'status', state: 'idle' })
      return
    }
  }

  const imageAttachmentRoute = await resolveImageAttachmentRoute(ws, message.attachments)

  // Send thinking status
  sendMessage(ws, { type: 'status', state: 'thinking', verb: 'Thinking' })

  // 启动 CLI 子进程（如果还没有）
  try {
    await ensureCliSessionStarted(ws, sessionId, 'user_message')
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const code =
      err instanceof ConversationStartupError ? err.code : 'CLI_START_FAILED'
    console.error(`[WS] CLI start failed for ${sessionId}: ${errMsg}`)
    sendMessage(ws, {
      type: 'error',
      message: errMsg,
      code,
      retryable:
        err instanceof ConversationStartupError ? err.retryable : false,
    })
    sendMessage(ws, { type: 'status', state: 'idle' })
    return
  }

  // Track user message for title generation
  let titleState = sessionTitleState.get(sessionId)
  if (!titleState) {
    titleState = { userMessageCount: 0, hasCustomTitle: false, firstUserMessage: '' }
    sessionTitleState.set(sessionId, titleState)
  }
  titleState.userMessageCount++
  if (titleState.userMessageCount === 1) {
    titleState.firstUserMessage = message.content
  }

  // Register the callback before sending the turn so startup errors are not lost.
  // Keep output muted until the current user turn is enqueued to avoid forwarding
  // any pre-turn SDK chatter as fresh chat history.
  let userMessageSent = false

  rebindSessionOutput(sessionId, ws, {
    shouldForward: (cliMsg) => userMessageSent || (cliMsg.type === 'result' && cliMsg.is_error),
  })

  const contentForModel = await buildContentWithInitialProjectMemory(
    sessionId,
    message.content,
    message.attachments,
  )

  registerPendingImageTurn(
    sessionId,
    contentForModel,
    message.attachments,
    imageAttachmentRoute,
  )
  let sent = conversationService.sendMessage(
    sessionId,
    contentForModel,
    message.attachments,
    { imageAttachmentMode: imageAttachmentRoute.mode },
  )

  // A rewind or late process exit can land between the initial startup check
  // and this write. Recover that narrow race once instead of replacing the
  // real turn failure with a misleading CLI_NOT_RUNNING error.
  if (!sent) {
    console.warn(
      `[WS] CLI disappeared before user message delivery for ${sessionId}; restarting once`,
    )
    try {
      await ensureCliSessionStarted(ws, sessionId, 'user_message')
      rebindSessionOutput(sessionId, ws, {
        shouldForward: (cliMsg) =>
          userMessageSent || (cliMsg.type === 'result' && cliMsg.is_error),
      })
      sent = conversationService.sendMessage(
        sessionId,
        contentForModel,
        message.attachments,
        { imageAttachmentMode: imageAttachmentRoute.mode },
      )
    } catch (err) {
      unregisterLastPendingImageTurn(sessionId)
      const errMsg = err instanceof Error ? err.message : String(err)
      const code =
        err instanceof ConversationStartupError ? err.code : 'CLI_RESTART_FAILED'
      sendMessage(ws, {
        type: 'error',
        message: errMsg,
        code,
        retryable:
          err instanceof ConversationStartupError ? err.retryable : false,
      })
      sendMessage(ws, { type: 'status', state: 'idle' })
      return
    }
  }

  if (!sent) {
    unregisterLastPendingImageTurn(sessionId)
    sendMessage(ws, {
      type: 'error',
      message: 'CLI stopped before the message could be delivered, including after one automatic restart.',
      code: 'CLI_NOT_RUNNING',
      retryable: true,
    })
    sendMessage(ws, { type: 'status', state: 'idle' })
    return
  }

  userMessageSent = true
}

async function buildContentWithInitialProjectMemory(
  sessionId: string,
  content: string,
  attachments?: Extract<ClientMessage, { type: 'user_message' }>['attachments'],
): Promise<string> {
  try {
    const launchInfo = await sessionService.getSessionLaunchInfo(sessionId)
    if (!launchInfo || launchInfo.transcriptMessageCount > 0) {
      return content
    }

    const query = [
      content,
      ...(attachments ?? []).flatMap((attachment) =>
        [attachment.name, attachment.path].filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0,
        ),
      ),
    ].join('\n')

    const db = openSessionSearchDb()
    try {
      await ensureSessionSearchIndexFresh({ db })
      const promptMemoryConfig = await readPromptMemoryConfig()
      const contexts: string[] = []
      const memoryContext = buildProjectMemoryPromptContext({
        db,
        query,
        currentSessionId: sessionId,
        limit: 4,
        includePromptMemory: promptMemoryConfig.injectEvolutionMemory,
      })
      if (memoryContext) contexts.push(memoryContext)
      const pastSessionContext = await buildPastSessionPromptContext({
        db,
        query,
        currentSessionId: sessionId,
        limit: 4,
      })
      if (pastSessionContext) contexts.push(pastSessionContext)
      return contexts.length > 0
        ? appendProjectMemoryContext(content, contexts.join('\n\n'))
        : content
    } finally {
      db.close()
    }
  } catch (error) {
    console.warn(
      `[WS] Failed to attach project memory context for ${sessionId}:`,
      error,
    )
    return content
  }
}

async function handleUserSteer(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'user_steer' }>
) {
  const { sessionId } = ws.data
  const steerId = message.steerId.trim()
  const priority = message.priority === 'later' ? 'later' : 'next'

  await waitForMediaRecovery(sessionId)

  if (!steerId) {
    sendMessage(ws, {
      type: 'steer_status',
      steerId: message.steerId,
      status: 'failed',
      message: 'Missing steer id.',
    })
    return
  }

  const content = message.content.trim()
  if (!content && (!message.attachments || message.attachments.length === 0)) {
    sendMessage(ws, {
      type: 'steer_status',
      steerId,
      status: 'failed',
      message: 'Cannot queue an empty message.',
    })
    return
  }

  const inlineFileAttachments = getInlineFileAttachmentsWithoutPath(message.attachments)
  if (inlineFileAttachments.length > 0) {
    sendMessage(ws, {
      type: 'steer_status',
      steerId,
      status: 'failed',
      message: buildPathRequiredAttachmentMessage(inlineFileAttachments),
    })
    return
  }

  const pendingRuntimeTransition = runtimeTransitionPromises.get(sessionId)
  if (pendingRuntimeTransition) {
    try {
      await pendingRuntimeTransition
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      sendMessage(ws, {
        type: 'steer_status',
        steerId,
        status: 'failed',
        message: `Failed to switch provider/model: ${errMsg}`,
      })
      return
    }
  }

  const imageAttachmentRoute = await resolveImageAttachmentRoute(ws, message.attachments)

  try {
    await ensureCliSessionStarted(ws, sessionId, 'user_message')
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    sendMessage(ws, {
      type: 'steer_status',
      steerId,
      status: 'failed',
      message: errMsg,
    })
    return
  }

  registerPendingImageTurn(
    sessionId,
    content,
    message.attachments,
    imageAttachmentRoute,
  )
  const sent = conversationService.sendMessage(
    sessionId,
    content,
    message.attachments,
    { uuid: steerId, priority, imageAttachmentMode: imageAttachmentRoute.mode },
  )

  if (!sent) unregisterLastPendingImageTurn(sessionId)

  sendMessage(ws, {
    type: 'steer_status',
    steerId,
    status: sent ? 'queued' : 'failed',
    ...(sent
      ? { message: priority === 'next' ? 'Queued for the current task.' : 'Queued for the next turn.' }
      : { message: 'CLI process is not running. The session may have ended or the process crashed.' }),
  })
}

async function handleCancelSteer(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'cancel_steer' }>
) {
  const { sessionId } = ws.data
  const steerId = message.steerId.trim()

  if (!steerId) {
    sendMessage(ws, {
      type: 'steer_status',
      steerId: message.steerId,
      status: 'failed',
      message: 'Missing steer id.',
    })
    return
  }

  try {
    const cancelled = await conversationService.cancelAsyncMessage(sessionId, steerId)
    sendMessage(ws, {
      type: 'steer_status',
      steerId,
      status: cancelled ? 'cancelled' : 'failed',
      message: cancelled
        ? 'Queued input cancelled.'
        : 'This queued input was already being processed or was not found.',
    })
  } catch (err) {
    sendMessage(ws, {
      type: 'steer_status',
      steerId,
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

async function handleDesktopClearCommand(
  ws: ServerWebSocket<WebSocketData>,
) {
  const { sessionId } = ws.data

  const workDir = conversationService.getSessionWorkDir(sessionId)
  conversationService.stopSession(sessionId)
  conversationService.clearOutputCallbacks(sessionId)
  sessionSlashCommands.delete(sessionId)
  sessionTitleState.delete(sessionId)
  cleanupStreamState(sessionId)

  try {
    await sessionService.clearSessionTranscript(sessionId, workDir || undefined)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    sendMessage(ws, {
      type: 'error',
      message: errMsg,
      code: 'SESSION_CLEAR_FAILED',
    })
    sendMessage(ws, { type: 'status', state: 'idle' })
    return
  }

  sendMessage(ws, {
    type: 'system_notification',
    subtype: 'session_cleared',
    message: 'Conversation cleared',
  })
  sendMessage(ws, {
    type: 'message_complete',
    usage: { input_tokens: 0, output_tokens: 0 },
  })
}

function handlePrewarmSession(ws: ServerWebSocket<WebSocketData>) {
  const { sessionId } = ws.data
  if (conversationService.hasSession(sessionId) || sessionStartupPromises.has(sessionId)) {
    return
  }

  prewarmPendingSessions.add(sessionId)
  void ensureCliSessionStarted(ws, sessionId, 'prewarm_session')
    .then(() => {
      if (!prewarmPendingSessions.delete(sessionId)) return
      bindPrewarmMetadataCapture(sessionId)
      markPrewarmed(sessionId)
    })
    .catch((err) => {
      prewarmPendingSessions.delete(sessionId)
      console.warn(
        `[WS] Prewarm failed for ${sessionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    })
}

function handlePermissionResponse(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'permission_response' }>
) {
  const { sessionId } = ws.data
  conversationService.respondToPermission(
    sessionId,
    message.requestId,
    message.allowed,
    message.rule,
    message.updatedInput,
  )
  console.log(`[WS] Permission response for ${message.requestId}: ${message.allowed}`)
}

function handleComputerUsePermissionResponse(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'computer_use_permission_response' }>
) {
  const { sessionId } = ws.data
  const ok = computerUseApprovalService.resolveApproval(
    message.requestId,
    message.response,
  )
  if (!ok) {
    console.warn(
      `[WS] Ignored Computer Use permission response for unknown request ${message.requestId} from ${sessionId}`
    )
  }
}

function hasImageAttachments(attachments: AttachmentRef[] | undefined): boolean {
  return (attachments ?? []).some((attachment) => attachment.type === 'image')
}

async function resolveCurrentImageSupport(sessionId: string) {
  const runtimeOverride = runtimeOverrides.get(sessionId)
  if (runtimeOverride?.providerId) {
    const provider = await providerService.getProvider(runtimeOverride.providerId)
    return {
      provider,
      support: await resolveProviderImageSupportDynamically(provider, runtimeOverride.modelId),
    }
  }

  if (runtimeOverride && runtimeOverride.providerId === null) {
    return {
      provider: null,
      support: await resolveProviderImageSupportDynamically(null, runtimeOverride.modelId),
    }
  }

  const { activeId, providers } = await providerService.listProviders()
  const provider = activeId
    ? providers.find((item) => item.id === activeId) ?? null
    : null

  return {
    provider,
    support: await resolveProviderImageSupportDynamically(provider),
  }
}

async function resolveImageAttachmentRoute(
  ws: ServerWebSocket<WebSocketData>,
  attachments: AttachmentRef[] | undefined,
): Promise<ImageAttachmentRoute> {
  if (!hasImageAttachments(attachments)) {
    return { mode: 'vision', provider: null }
  }

  try {
    const { provider, support } = await resolveCurrentImageSupport(ws.data.sessionId)
    return {
      mode: support.status === 'supported' ? 'vision' : 'file-reference',
      provider,
      modelId: support.modelId,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      `[WS] Failed to inspect image support for ${ws.data.sessionId}; falling back to file references: ${message}`,
    )
    return { mode: 'file-reference', provider: null }
  }
}

function registerPendingImageTurn(
  sessionId: string,
  content: string,
  attachments: AttachmentRef[] | undefined,
  route: ImageAttachmentRoute,
): void {
  if (!hasImageAttachments(attachments)) return
  const turns = pendingImageTurns.get(sessionId) ?? []
  turns.push({
    content,
    attachments: attachments ?? [],
    route,
    retryCount: 0,
  })
  pendingImageTurns.set(sessionId, turns)
}

function unregisterLastPendingImageTurn(sessionId: string): void {
  const turns = pendingImageTurns.get(sessionId)
  if (!turns?.length) return
  turns.pop()
  if (turns.length === 0) pendingImageTurns.delete(sessionId)
}

function handleSetPermissionMode(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'set_permission_mode' }>
) {
  const { sessionId } = ws.data

  // Switching to/from bypassPermissions requires the CLI to be (re)started with
  // --dangerously-skip-permissions. The CLI rejects a runtime set_permission_mode
  // to bypassPermissions if it wasn't launched with that flag.  Rather than just
  // sending the SDK message (which would silently fail), restart the CLI subprocess
  // with the correct arguments so the new permission mode takes effect.
  const needsRestart =
    conversationService.hasSession(sessionId) &&
    (message.mode === 'bypassPermissions' || conversationService.getSessionPermissionMode(sessionId) === 'bypassPermissions')

  if (needsRestart) {
    void restartSessionWithPermissionMode(ws, sessionId, message.mode)
    return
  }

  const ok = conversationService.setPermissionMode(sessionId, message.mode)
  if (!ok) {
    console.warn(`[WS] Ignored permission mode update for inactive session ${sessionId}`)
  }
}

async function handleSetRuntimeConfig(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'set_runtime_config' }>
) {
  const { sessionId } = ws.data
  const modelId = typeof message.modelId === 'string' ? message.modelId.trim() : ''
  if (!modelId) {
    sendMessage(ws, {
      type: 'error',
      message: 'Runtime model selection is invalid.',
      code: 'RUNTIME_CONFIG_INVALID',
    })
    return
  }

  const nextOverride = {
    providerId: message.providerId ?? null,
    modelId,
    ...(typeof message.contextWindow === 'number' &&
    Number.isFinite(message.contextWindow) &&
    message.contextWindow > 0
      ? { contextWindow: Math.round(message.contextWindow) }
      : {}),
  }
  const prevOverride = runtimeOverrides.get(sessionId)
  runtimeOverrides.set(sessionId, nextOverride)

  if (
    prevOverride &&
    prevOverride.providerId === nextOverride.providerId &&
    prevOverride.modelId === nextOverride.modelId &&
    prevOverride.contextWindow === nextOverride.contextWindow
  ) {
    return
  }

  pendingImageTurns.delete(sessionId)
  imageFallbackSessions.delete(sessionId)

  if (!conversationService.hasSession(sessionId)) {
    const pendingStartup = sessionStartupPromises.get(sessionId)
    if (pendingStartup) {
      await enqueueRuntimeTransition(sessionId, async () => {
        await pendingStartup.catch(() => undefined)
        const currentOverride = runtimeOverrides.get(sessionId)
        if (
          currentOverride?.providerId !== nextOverride.providerId ||
          currentOverride.modelId !== nextOverride.modelId ||
          currentOverride.contextWindow !== nextOverride.contextWindow ||
          !conversationService.hasSession(sessionId)
        ) {
          return
        }
        await restartSessionWithRuntimeConfig(ws, sessionId)
      })
    }
    return
  }

  await enqueueRuntimeTransition(sessionId, () =>
    restartSessionWithRuntimeConfig(ws, sessionId),
  )
}

async function restartSessionWithPermissionMode(
  ws: ServerWebSocket<WebSocketData>,
  sessionId: string,
  mode: string,
): Promise<void> {
  try {
    sendMessage(ws, { type: 'status', state: 'thinking', verb: 'Restarting session with new permissions...' })

    // Persist the new mode first so it's read on restart
    await settingsService.setPermissionMode(mode)

    const workDir = conversationService.getSessionWorkDir(sessionId)
    conversationService.stopSession(sessionId)

    // Rebuild runtime settings (will pick up the persisted mode)
    const runtimeSettings = await getRuntimeSettings(sessionId)
    const sdkUrl =
      `ws://${ws.data.serverHost}:${ws.data.serverPort}/sdk/${sessionId}` +
      `?token=${encodeURIComponent(crypto.randomUUID())}`
    await conversationService.startSession(sessionId, workDir, sdkUrl, runtimeSettings)

    sendMessage(ws, { type: 'status', state: 'idle' })
    console.log(`[WS] Restarted CLI for ${sessionId} with permission mode: ${mode}`)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[WS] Failed to restart CLI for ${sessionId}: ${errMsg}`)
    sendMessage(ws, {
      type: 'error',
      message: `Failed to restart session with new permission mode: ${errMsg}`,
      code: 'CLI_RESTART_FAILED',
    })
    sendMessage(ws, { type: 'status', state: 'idle' })
  }
}

async function restartSessionWithRuntimeConfig(
  ws: ServerWebSocket<WebSocketData>,
  sessionId: string,
): Promise<void> {
  try {
    sendMessage(ws, {
      type: 'status',
      state: 'thinking',
      verb: 'Switching provider and model...',
    })

    const workDir = conversationService.getSessionWorkDir(sessionId)
    conversationService.stopSession(sessionId)

    const runtimeSettings = await getRuntimeSettings(sessionId)
    const sdkUrl =
      `ws://${ws.data.serverHost}:${ws.data.serverPort}/sdk/${sessionId}` +
      `?token=${encodeURIComponent(crypto.randomUUID())}`
    await conversationService.startSession(sessionId, workDir, sdkUrl, runtimeSettings)

    sendMessage(ws, { type: 'status', state: 'idle' })
    console.log(`[WS] Restarted CLI for ${sessionId} with runtime override`)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[WS] Failed to restart CLI for ${sessionId} after runtime override: ${errMsg}`)
    sendMessage(ws, {
      type: 'error',
      message: `Failed to switch provider/model: ${errMsg}`,
      code: 'CLI_RESTART_FAILED',
    })
    sendMessage(ws, { type: 'status', state: 'idle' })
  }
}

function handleStopGeneration(ws: ServerWebSocket<WebSocketData>) {
  const { sessionId } = ws.data
  console.log(`[WS] Stop generation requested for session: ${sessionId}`)

  sessionStopRequested.add(sessionId)

  if (conversationService.hasSession(sessionId)) {
    // First try graceful interrupt via SDK control message
    conversationService.sendInterrupt(sessionId)

    // Force-kill if still running after 3 seconds
    setTimeout(() => {
      if (conversationService.hasSession(sessionId)) {
        console.log(`[WS] Force-killing CLI subprocess for session: ${sessionId}`)
        conversationService.stopSession(sessionId)
      }
    }, 3_000)
  }

  sendMessage(ws, { type: 'status', state: 'idle' })
}

// ============================================================================
// Title generation
// ============================================================================

function triggerTitleGeneration(ws: ServerWebSocket<WebSocketData>, sessionId: string): void {
  const state = sessionTitleState.get(sessionId)
  if (!state || state.hasCustomTitle) return

  const count = state.userMessageCount

  // Keep session titles tied to the first user message. Do not later replace
  // them with an AI summary title.
  if (count !== 1) return

  const text = state.firstUserMessage

  // Fire-and-forget: derive a quick title from the first message.
  void (async () => {
    try {
      const placeholder = deriveTitle(text)
      if (placeholder) {
        await saveAiTitle(sessionId, placeholder)
        sendMessage(ws, { type: 'session_title_updated', sessionId, title: placeholder })
      }
    } catch (err) {
      console.error(`[Title] Failed to generate title for ${sessionId}:`, err)
    }
  })()
}

// ============================================================================
// CLI message translation
// ============================================================================

/**
 * Per-session streaming state to avoid cross-session interference.
 * Each session tracks its own dedup flag, active block types, and tool blocks.
 */
type SessionStreamState = {
  hasReceivedStreamEvents: boolean
  activeBlockTypes: Map<number, 'text' | 'tool_use'>
  activeToolBlocks: Map<number, { toolName: string; toolUseId: string; inputJson: string }>
  /** Tool blocks whose input JSON failed to parse in content_block_stop.
   *  The assistant message carries the complete input — defer to that. */
  pendingToolBlocks: Map<string, { toolName: string; toolUseId: string; parentToolUseId?: string }>
}

const sessionStreamStates = new Map<string, SessionStreamState>()

function getStreamState(sessionId: string): SessionStreamState {
  let state = sessionStreamStates.get(sessionId)
  if (!state) {
    state = {
      hasReceivedStreamEvents: false,
      activeBlockTypes: new Map(),
      activeToolBlocks: new Map(),
      pendingToolBlocks: new Map(),
    }
    sessionStreamStates.set(sessionId, state)
  }
  return state
}

/** Clean up stream state when session disconnects */
function cleanupStreamState(sessionId: string) {
  sessionStreamStates.delete(sessionId)
}

function cleanupSessionRuntimeState(sessionId: string) {
  cleanupStreamState(sessionId)
  sessionSlashCommands.delete(sessionId)
  sessionTitleState.delete(sessionId)
  runtimeOverrides.delete(sessionId)
  runtimeTransitionPromises.delete(sessionId)
  sessionStartupPromises.delete(sessionId)
  mediaRecoveryPromises.delete(sessionId)
  pendingImageTurns.delete(sessionId)
  imageFallbackSessions.delete(sessionId)
  clearPrewarmState(sessionId)
}

function getPrewarmIdleTimeoutMs(): number {
  const raw = process.env.CYBERCODE_PREWARM_IDLE_TIMEOUT_MS
  if (!raw) return DEFAULT_PREWARM_IDLE_TIMEOUT_MS
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_PREWARM_IDLE_TIMEOUT_MS
}

function clearPrewarmState(sessionId: string) {
  prewarmPendingSessions.delete(sessionId)
  prewarmedSessions.delete(sessionId)
  const timer = prewarmIdleTimers.get(sessionId)
  if (timer) {
    clearTimeout(timer)
    prewarmIdleTimers.delete(sessionId)
  }
}

function markPrewarmed(sessionId: string) {
  prewarmedSessions.add(sessionId)
  const timeoutMs = getPrewarmIdleTimeoutMs()
  if (timeoutMs === 0) return

  const existingTimer = prewarmIdleTimers.get(sessionId)
  if (existingTimer) clearTimeout(existingTimer)

  const timer = setTimeout(() => {
    prewarmIdleTimers.delete(sessionId)
    if (!prewarmedSessions.has(sessionId)) return
    console.log(`[WS] Prewarmed session ${sessionId} idle for ${timeoutMs}ms, stopping CLI subprocess`)
    conversationService.stopSession(sessionId)
    prewarmedSessions.delete(sessionId)
  }, timeoutMs)
  prewarmIdleTimers.set(sessionId, timer)
}

function cacheSessionInitMetadata(sessionId: string, cliMsg: any) {
  if (cliMsg?.type !== 'system' || cliMsg.subtype !== 'init') return
  if (cliMsg.slash_commands && Array.isArray(cliMsg.slash_commands)) {
    sessionSlashCommands.set(sessionId, cliMsg.slash_commands.map((cmd: any) => ({
      name: typeof cmd === 'string' ? cmd : (cmd.name || cmd.command || ''),
      description: typeof cmd === 'string' ? '' : (cmd.description || ''),
    })))
  }
}

function bindPrewarmMetadataCapture(sessionId: string) {
  for (const msg of conversationService.getRecentSdkMessages(sessionId)) {
    cacheSessionInitMetadata(sessionId, msg)
  }
  if (!conversationService.hasSession(sessionId)) return

  conversationService.clearOutputCallbacks(sessionId)
  conversationService.onOutput(sessionId, (cliMsg) => {
    cacheSessionInitMetadata(sessionId, cliMsg)
  })
}

async function resolveSessionWorkDir(sessionId: string, fallback = os.homedir()): Promise<string> {
  let workDir = fallback
  try {
    const resolved = await sessionService.getSessionWorkDir(sessionId)
    if (resolved) workDir = resolved
    console.log(
      `[WS] resolveSessionWorkDir: sessionId=${sessionId}, resolved workDir=${JSON.stringify(
        resolved,
      )}, will spawn CLI with workDir=${workDir}`,
    )
  } catch (resolveErr) {
    console.warn(
      `[WS] resolveSessionWorkDir: failed to resolve workDir for ${sessionId}, using fallback=${workDir}: ${
        resolveErr instanceof Error ? resolveErr.message : String(resolveErr)
      }`,
    )
  }
  return workDir
}

async function ensureCliSessionStarted(
  ws: ServerWebSocket<WebSocketData>,
  sessionId: string,
  reason: 'user_message' | 'prewarm_session',
): Promise<void> {
  const pendingStartup = sessionStartupPromises.get(sessionId)
  if (pendingStartup) {
    await pendingStartup
    return
  }

  if (conversationService.hasSession(sessionId)) return

  const startup = (async () => {
    const workDir = await resolveSessionWorkDir(sessionId)
    const runtimeSettings = await getRuntimeSettings(sessionId)
    const sdkUrl =
      `ws://${ws.data.serverHost}:${ws.data.serverPort}/sdk/${sessionId}` +
      `?token=${encodeURIComponent(crypto.randomUUID())}`
    console.log(`[WS] Starting CLI for ${sessionId} due to ${reason}`)
    await conversationService.startSession(sessionId, workDir, sdkUrl, runtimeSettings)
  })()

  sessionStartupPromises.set(sessionId, startup)
  try {
    await startup
  } finally {
    if (sessionStartupPromises.get(sessionId) === startup) {
      sessionStartupPromises.delete(sessionId)
    }
  }
}

function isMediaRequestError(message: string): boolean {
  return (
    /request too large|payload too large|body too large|413|max\s*\d+\s*mb/i.test(message) ||
    /image (?:was )?too large|image.*exceeds|unable to resize image/i.test(message)
  )
}

function textMentionsImageAttachment(text: string, sessionId: string): boolean {
  return (
    text.includes(`/uploads/${sessionId}/`) ||
    (/@"[^"]+"/.test(text) && IMAGE_ATTACHMENT_EXT_RE.test(text))
  )
}

function contentHasMediaAttachment(content: unknown, sessionId: string): boolean {
  if (typeof content === 'string') {
    return textMentionsImageAttachment(content, sessionId)
  }

  if (!Array.isArray(content)) return false

  return content.some((block) => {
    if (!block || typeof block !== 'object') return false
    const record = block as Record<string, unknown>
    if (record.type === 'image') return true
    return (
      record.type === 'text' &&
      typeof record.text === 'string' &&
      textMentionsImageAttachment(record.text, sessionId)
    )
  })
}

async function trimLatestMediaUserMessage(sessionId: string): Promise<void> {
  let messages: Awaited<ReturnType<typeof sessionService.getSessionMessages>>['messages']
  try {
    const result = await sessionService.getSessionMessages(sessionId, { limit: 200 })
    messages = result.messages
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 404) return
    throw error
  }
  const mediaUserMessage = [...messages]
    .reverse()
    .find((message) =>
      message.type === 'user' &&
      contentHasMediaAttachment(message.content, sessionId)
    )

  if (!mediaUserMessage) return

  const result = await sessionService.trimSessionMessagesFrom(sessionId, mediaUserMessage.id)
  console.log(
    `[WS] Trimmed ${result.removedCount} media-tainted transcript messages from ${sessionId} after API media error`,
  )
}

async function waitForMediaRecovery(sessionId: string): Promise<void> {
  const pendingRecovery = mediaRecoveryPromises.get(sessionId)
  if (!pendingRecovery) return

  try {
    await pendingRecovery
  } catch (error) {
    console.warn(
      `[WS] Pending media-error recovery failed before handling input for ${sessionId}:`,
      error,
    )
  }
}

function recoverSessionAfterMediaRequestError(sessionId: string, message: string): void {
  if (!isMediaRequestError(message)) return

  conversationService.stopSession(sessionId)
  cleanupStreamState(sessionId)
  sessionStartupPromises.delete(sessionId)
  clearPrewarmState(sessionId)

  const recovery = trimLatestMediaUserMessage(sessionId).catch((error) => {
    console.warn(
      `[WS] Failed to trim media-tainted transcript turn for ${sessionId}:`,
      error,
    )
  })

  mediaRecoveryPromises.set(sessionId, recovery)
  recovery.finally(() => {
    if (mediaRecoveryPromises.get(sessionId) === recovery) {
      mediaRecoveryPromises.delete(sessionId)
    }
  })
}

function extractCliErrorMessage(cliMsg: any): string | undefined {
  if (cliMsg?.type === 'assistant' && cliMsg.error) {
    return cliMsg.message?.content?.[0]?.text || String(cliMsg.error)
  }
  if (cliMsg?.type !== 'result' || !cliMsg.is_error) return undefined
  if (typeof cliMsg.result === 'string' && cliMsg.result.trim()) return cliMsg.result
  if (Array.isArray(cliMsg.errors) && cliMsg.errors.length > 0) {
    return cliMsg.errors.join('\n')
  }
  return 'Unknown image request error'
}

function recordImageCapabilityForTurns(
  turns: PendingImageTurn[],
  status: 'supported' | 'unsupported',
  source: 'runtime-success' | 'runtime-rejection',
): void {
  for (const turn of turns) {
    const provider = turn.route.provider
    const modelId = turn.route.modelId
    if (!provider?.baseUrl || !modelId) continue
    recordLearnedImageSupport({
      baseUrl: provider.baseUrl,
      modelId,
      status,
      source,
    })
  }
}

function combinePendingImageTurns(turns: PendingImageTurn[]): PendingImageTurn {
  const last = turns[turns.length - 1]!
  return {
    content: turns
      .map((turn) => turn.content.trim())
      .filter(Boolean)
      .join('\n\n'),
    attachments: turns.flatMap((turn) => turn.attachments),
    route: { ...last.route, mode: 'file-reference' },
    retryCount: Math.max(...turns.map((turn) => turn.retryCount), 0) + 1,
  }
}

function imageFallbackUnavailableText(turns: PendingImageTurn[]): string {
  const content = turns.map((turn) => turn.content).join('\n')
  if (/\p{Script=Han}/u.test(content)) {
    return '图片已经成功保留为本地附件，但当前模型不能直接读取图片，而且现有图片处理工具没有返回可用的文字结果。你仍然可以继续当前会话；请配置一个能接收文件路径并返回文字描述的图片/OCR MCP 工具，或切换到本地视觉模型后再次发送。'
  }
  return 'The image remains available as a local attachment, but the current model cannot read it directly and no image-processing tool returned usable text. This conversation is still active. Configure an image/OCR MCP tool that accepts a file path and returns text, or select a local vision model and send again.'
}

function completeImageRecoveryWithoutError(
  ws: ServerWebSocket<WebSocketData>,
  sessionId: string,
  turns: PendingImageTurn[],
): void {
  pendingImageTurns.delete(sessionId)
  cleanupStreamState(sessionId)
  sendMessage(ws, { type: 'content_start', blockType: 'text' })
  sendMessage(ws, { type: 'content_delta', text: imageFallbackUnavailableText(turns) })
  sendMessage(ws, {
    type: 'message_complete',
    usage: { input_tokens: 0, output_tokens: 0 },
  })
  sendMessage(ws, { type: 'status', state: 'idle' })
}

async function startImageFallbackSession(
  ws: ServerWebSocket<WebSocketData>,
  sessionId: string,
): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ensureCliSessionStarted(ws, sessionId, 'user_message')
      return
    } catch (error) {
      lastError = error
      conversationService.stopSession(sessionId)
      sessionStartupPromises.delete(sessionId)
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
    }
  }
  throw lastError
}

async function retryImageTurnsAsFileReferences(
  ws: ServerWebSocket<WebSocketData>,
  sessionId: string,
  turns: PendingImageTurn[],
): Promise<void> {
  conversationService.stopSession(sessionId)
  cleanupStreamState(sessionId)
  sessionStartupPromises.delete(sessionId)
  clearPrewarmState(sessionId)
  imageFallbackSessions.add(sessionId)

  await trimLatestMediaUserMessage(sessionId).catch((error) => {
    console.warn(`[WS] Failed to trim the rejected image turn for ${sessionId}:`, error)
  })

  const fallbackTurn = combinePendingImageTurns(turns)
  pendingImageTurns.set(sessionId, [fallbackTurn])
  await startImageFallbackSession(ws, sessionId)
  rebindSessionOutput(sessionId, ws)

  const sent = conversationService.sendMessage(
    sessionId,
    fallbackTurn.content,
    fallbackTurn.attachments,
    { imageAttachmentMode: 'file-reference' },
  )
  if (!sent) throw new Error('CLI process was unavailable after image fallback restart')
}

function scheduleImageRecovery(
  ws: ServerWebSocket<WebSocketData>,
  sessionId: string,
  turns: PendingImageTurn[],
  shouldRetry: boolean,
): void {
  if (mediaRecoveryPromises.has(sessionId)) return

  const recovery = (async () => {
    if (shouldRetry) {
      try {
        await retryImageTurnsAsFileReferences(ws, sessionId, turns)
        return
      } catch (error) {
        console.warn(`[WS] Automatic image-tool fallback failed for ${sessionId}:`, error)
      }
    } else {
      conversationService.stopSession(sessionId)
      cleanupStreamState(sessionId)
      sessionStartupPromises.delete(sessionId)
      clearPrewarmState(sessionId)
      imageFallbackSessions.add(sessionId)
      await trimLatestMediaUserMessage(sessionId).catch((error) => {
        console.warn(`[WS] Failed to trim the unusable image turn for ${sessionId}:`, error)
      })
    }

    completeImageRecoveryWithoutError(ws, sessionId, turns)
  })()

  mediaRecoveryPromises.set(sessionId, recovery)
  recovery.finally(() => {
    if (mediaRecoveryPromises.get(sessionId) === recovery) {
      mediaRecoveryPromises.delete(sessionId)
    }
  })
}

function handleRecoverableImageFailure(
  ws: ServerWebSocket<WebSocketData>,
  sessionId: string,
  cliMsg: any,
): boolean {
  const errorMessage = extractCliErrorMessage(cliMsg)
  if (!errorMessage) return false

  const turns = pendingImageTurns.get(sessionId) ?? []
  const unsupported = isImageInputUnsupportedError(errorMessage)
  const mediaFailure = turns.length > 0 && isMediaRequestError(errorMessage)
  if (!unsupported && !mediaFailure) return false

  if (turns.length > 0) {
    recordImageCapabilityForTurns(turns, 'unsupported', 'runtime-rejection')
  }
  const shouldRetry = turns.some((turn) =>
    turn.route.mode === 'vision' && turn.retryCount === 0,
  )
  scheduleImageRecovery(ws, sessionId, turns, shouldRetry)
  return true
}

function finalizeSuccessfulImageTurns(sessionId: string): void {
  const turns = pendingImageTurns.get(sessionId)
  if (!turns?.length) return

  const visionTurns = turns.filter((turn) => turn.route.mode === 'vision')
  if (visionTurns.length > 0) {
    recordImageCapabilityForTurns(visionTurns, 'supported', 'runtime-success')
    imageFallbackSessions.delete(sessionId)
  }
  pendingImageTurns.delete(sessionId)
}

function translateCliMessage(cliMsg: any, sessionId: string): ServerMessage[] {
  const streamState = getStreamState(sessionId)
  switch (cliMsg.type) {
    case 'assistant': {
      if (cliMsg.error) {
        return [{
          type: 'error',
          message: cliMsg.message?.content?.[0]?.text || cliMsg.error,
          code: cliMsg.error,
        }]
      }

      // If we already received stream_events, text/thinking were already sent.
      // Only extract tool_use blocks (stream_event's content_block_stop lacks complete tool info).
      if (cliMsg.message?.content && Array.isArray(cliMsg.message.content)) {
        const messages: ServerMessage[] = []

        for (const block of cliMsg.message.content) {
          if (streamState.hasReceivedStreamEvents) {
            // Stream events handled most blocks — but any tool_use whose
            // input JSON failed to parse in content_block_stop was deferred.
            // Emit those now with the complete input from the assistant message.
            if (block.type === 'tool_use' && streamState.pendingToolBlocks.has(block.id)) {
              const pending = streamState.pendingToolBlocks.get(block.id)!
              streamState.pendingToolBlocks.delete(block.id)
              messages.push({
                type: 'tool_use_complete',
                toolName: pending.toolName || block.name,
                toolUseId: block.id,
                input: block.input,
                parentToolUseId: pending.parentToolUseId,
              })
            }
          } else {
            // No stream events received — this is the only source, process everything
            if (block.type === 'thinking' && block.thinking) {
              messages.push({ type: 'thinking', text: block.thinking })
            } else if (block.type === 'text' && block.text) {
              messages.push({ type: 'content_start', blockType: 'text' })
              messages.push({ type: 'content_delta', text: block.text })
            } else if (block.type === 'tool_use') {
              messages.push({
                type: 'tool_use_complete',
                toolName: block.name,
                toolUseId: block.id,
                input: block.input,
                parentToolUseId:
                  typeof cliMsg.parent_tool_use_id === 'string'
                    ? cliMsg.parent_tool_use_id
                    : undefined,
              })
            }
          }
        }

        // Reset flags for next turn
        streamState.hasReceivedStreamEvents = false
        streamState.pendingToolBlocks.clear()
        return messages
      }
      return []
    }

    case 'user': {
      // Bug #1: 处理 tool_result 消息
      // CLI 发送 type:'user' 消息，其中 content 包含 tool_result 块
      const messages: ServerMessage[] = []

      const localCommandOutput = extractLocalCommandOutput(
        cliMsg.message?.content,
      )
      if (localCommandOutput) {
        messages.push({ type: 'content_start', blockType: 'text' })
        messages.push({ type: 'content_delta', text: localCommandOutput })
      }

      if (cliMsg.message?.content && Array.isArray(cliMsg.message.content)) {
        for (const block of cliMsg.message.content) {
          if (block.type === 'tool_result') {
            messages.push({
              type: 'tool_result',
              toolUseId: block.tool_use_id,
              content: block.content,
              isError: !!block.is_error,
              parentToolUseId:
                typeof cliMsg.parent_tool_use_id === 'string'
                  ? cliMsg.parent_tool_use_id
                  : undefined,
            })
          }
        }
      }

      return messages
    }

    case 'stream_event': {
      streamState.hasReceivedStreamEvents = true
      const event = cliMsg.event
      if (!event) return []

      switch (event.type) {
        case 'message_start': {
          return [{ type: 'status', state: 'streaming' }]
        }

        case 'content_block_start': {
          const contentBlock = event.content_block
          if (!contentBlock) return []

          const index = event.index ?? 0
          streamState.activeBlockTypes.set(index, contentBlock.type === 'tool_use' ? 'tool_use' : 'text')

          if (contentBlock.type === 'tool_use') {
            // Track tool info so content_block_stop can emit complete data
            streamState.activeToolBlocks.set(index, {
              toolName: contentBlock.name || '',
              toolUseId: contentBlock.id || '',
              inputJson: '',
            })
            return [{
              type: 'content_start',
              blockType: 'tool_use',
              toolName: contentBlock.name,
              toolUseId: contentBlock.id,
              parentToolUseId:
                typeof cliMsg.parent_tool_use_id === 'string'
                  ? cliMsg.parent_tool_use_id
                  : undefined,
            }]
          }
          return [{ type: 'content_start', blockType: 'text' }]
        }

        case 'content_block_delta': {
          const delta = event.delta
          if (!delta) return []

          if (delta.type === 'text_delta' && delta.text) {
            return [{ type: 'content_delta', text: delta.text }]
          }
          if (delta.type === 'input_json_delta' && delta.partial_json) {
            // Accumulate tool input JSON
            const index = event.index ?? 0
            const toolBlock = streamState.activeToolBlocks.get(index)
            if (toolBlock) toolBlock.inputJson += delta.partial_json
            return [{ type: 'content_delta', toolInput: delta.partial_json }]
          }
          if (delta.type === 'thinking_delta' && delta.thinking) {
            return [{ type: 'thinking', text: delta.thinking }]
          }
          return []
        }

        case 'content_block_stop': {
          const index = event.index ?? 0
          const blockType = streamState.activeBlockTypes.get(index)
          streamState.activeBlockTypes.delete(index)

          if (blockType === 'tool_use') {
            const toolBlock = streamState.activeToolBlocks.get(index)
            streamState.activeToolBlocks.delete(index)
            if (toolBlock) {
              const parentToolUseId =
                typeof cliMsg.parent_tool_use_id === 'string'
                  ? cliMsg.parent_tool_use_id
                  : undefined
              let parsedInput = null
              try { parsedInput = JSON.parse(toolBlock.inputJson) } catch {}

              if (parsedInput !== null) {
                return [{
                  type: 'tool_use_complete',
                  toolName: toolBlock.toolName,
                  toolUseId: toolBlock.toolUseId,
                  input: parsedInput,
                  parentToolUseId,
                }]
              }

              // JSON parse failed — defer to the assistant message which
              // carries the complete, already-parsed tool input.
              console.warn(
                `[WS] Tool input JSON parse failed for ${toolBlock.toolName} (${toolBlock.toolUseId}), deferring to assistant message`,
              )
              streamState.pendingToolBlocks.set(toolBlock.toolUseId, {
                toolName: toolBlock.toolName,
                toolUseId: toolBlock.toolUseId,
                parentToolUseId,
              })
            }
          }
          return []
        }

        case 'message_stop': {
          // message_stop is handled by the 'result' message
          return []
        }

        case 'message_delta': {
          // message_delta may contain stop_reason or usage updates
          return []
        }

        default:
          return []
      }
    }

    case 'control_request': {
      // 权限请求 — CLI 需要用户授权才能执行工具
      if (cliMsg.request?.subtype === 'can_use_tool') {
        return [{
          type: 'permission_request',
          requestId: cliMsg.request_id,
          toolName: cliMsg.request.tool_name || 'Unknown',
          toolUseId:
            typeof cliMsg.request.tool_use_id === 'string'
              ? cliMsg.request.tool_use_id
              : undefined,
          input: cliMsg.request.input || {},
          description: cliMsg.request.description,
        }]
      }
      return []
    }

    case 'control_response':
      return []

    case 'result': {
      // 对话结果（成功或错误）
      const usage = {
        input_tokens: cliMsg.usage?.input_tokens || 0,
        output_tokens: cliMsg.usage?.output_tokens || 0,
        cache_read_input_tokens:
          cliMsg.usage?.cache_read_input_tokens || cliMsg.usage?.cache_read_tokens || 0,
        cache_creation_input_tokens:
          cliMsg.usage?.cache_creation_input_tokens || cliMsg.usage?.cache_creation_tokens || 0,
      }

      if (cliMsg.is_error) {
        // If the user requested stop, this "error" is just the interrupt
        // result — don't show it as an error in the chat UI.
        if (sessionStopRequested.has(sessionId)) {
          sessionStopRequested.delete(sessionId)
          return [{ type: 'message_complete', usage }]
        }

        const resultMessage =
          (typeof cliMsg.result === 'string' && cliMsg.result) ||
          (Array.isArray(cliMsg.errors) && cliMsg.errors.length > 0
            ? cliMsg.errors.join('\n')
            : 'Unknown error')
        recoverSessionAfterMediaRequestError(sessionId, resultMessage)
        // 错误和完成消息都发送
        return [
          {
            type: 'error',
            message: resultMessage,
            code: 'CLI_ERROR',
          },
          { type: 'message_complete', usage },
        ]
      }

      // Clear stop flag on successful completion too
      sessionStopRequested.delete(sessionId)
      return [{ type: 'message_complete', usage }]
    }

    case 'system': {
      // 区分不同的 system 子类型
      const subtype = cliMsg.subtype
      if (subtype === 'init') {
        // CLI 初始化完成 — 缓存 slash commands 并发送模型信息
        // NOTE: Do NOT send status:idle here — the CLI init fires while
        // processing the first user message, and sending idle would reset
        // the frontend's streaming state prematurely.
        cacheSessionInitMetadata(sessionId, cliMsg)
        const messages: ServerMessage[] = [
          // Send model info as a system notification, not a status change
          { type: 'system_notification', subtype: 'init', message: `Model: ${cliMsg.model || 'unknown'}`, data: { model: cliMsg.model } },
        ]
        // Send slash commands to frontend
        const cmds = sessionSlashCommands.get(sessionId)
        if (cmds && cmds.length > 0) {
          messages.push({
            type: 'system_notification',
            subtype: 'slash_commands',
            data: cmds,
          })
        }
        return messages
      }
      if (subtype === 'hook_started' || subtype === 'hook_response') {
        // Hook 执行中 — 不转发给前端
        return []
      }
      if (
        subtype === 'informational' &&
        (cliMsg.toolUseID === PROMPT_MEMORY_AUTO_REVIEW_TOOL_USE_ID ||
          cliMsg.tool_use_id === PROMPT_MEMORY_AUTO_REVIEW_TOOL_USE_ID) &&
        typeof cliMsg.content === 'string' &&
        cliMsg.content.trim()
      ) {
        return [{
          type: 'system_notification',
          subtype: 'prompt_memory_updated',
          message: cliMsg.content.trim(),
          data: cliMsg,
        }]
      }
      if (subtype === 'local_command' || subtype === 'local_command_output') {
        const localCommandOutput = extractLocalCommandOutput(
          cliMsg.content ?? cliMsg.message,
          { allowUntagged: subtype === 'local_command_output' },
        )
        if (!localCommandOutput) return []
        return [
          { type: 'content_start', blockType: 'text' },
          { type: 'content_delta', text: localCommandOutput },
        ]
      }
      // Bug #7: 处理 task/team system 消息
      if (subtype === 'task_notification') {
        return [{
          type: 'system_notification',
          subtype: 'task_notification',
          message: cliMsg.message || cliMsg.title,
          data: cliMsg,
        }]
      }
      if (subtype === 'task_started') {
        return [{
          type: 'status',
          state: 'tool_executing',
          verb: cliMsg.message || 'Task started',
        }]
      }
      if (subtype === 'task_progress') {
        return [{
          type: 'status',
          state: 'tool_executing',
          verb: cliMsg.message || 'Task in progress',
        }]
      }
      if (subtype === 'session_state_changed') {
        return [{
          type: 'system_notification',
          subtype: 'session_state_changed',
          message: cliMsg.message,
          data: cliMsg,
        }]
      }
      if (subtype === 'compact_boundary') {
        return [{
          type: 'system_notification',
          subtype: 'compact_boundary',
          message: getCompactBoundaryMessage(cliMsg),
          data: cliMsg.compact_metadata ?? cliMsg,
        }]
      }
      // 其他 system 消息
      return []
    }

    default:
      // 未知类型 — 调试输出但不转发
      console.log(`[WS] Unknown CLI message type: ${cliMsg.type}`, JSON.stringify(cliMsg).substring(0, 200))
      return []
  }
}

// ============================================================================
// Helpers
// ============================================================================

function sendMessage(ws: ServerWebSocket<WebSocketData>, message: ServerMessage) {
  ws.send(JSON.stringify(message))
}

function sendError(ws: ServerWebSocket<WebSocketData>, message: string, code: string) {
  sendMessage(ws, { type: 'error', message, code })
}

function getDesktopSlashCommand(content: string): ReturnType<typeof parseSlashCommand> {
  const parsed = parseSlashCommand(content.trim())
  if (!parsed || parsed.isMcp) return null
  return parsed
}

function extractLocalCommandOutput(
  content: unknown,
  options: { allowUntagged?: boolean } = {},
): string | null {
  const raw = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
        .flatMap((block) => {
          if (!block || typeof block !== 'object') return []
          const text = (block as { text?: unknown }).text
          return typeof text === 'string' ? [text] : []
        })
        .join('\n')
      : ''

  if (!raw) return null

  const stdout = extractTaggedContent(raw, LOCAL_COMMAND_STDOUT_TAG)
  if (stdout !== null) return stdout

  const stderr = extractTaggedContent(raw, LOCAL_COMMAND_STDERR_TAG)
  if (stderr !== null) return stderr

  if (options.allowUntagged) {
    const normalized = raw.trim()
    return normalized || null
  }

  return null
}

function extractTaggedContent(raw: string, tag: string): string | null {
  const match = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return match?.[1]?.trim() ?? null
}

function getCompactBoundaryMessage(cliMsg: any): string {
  const message = typeof cliMsg?.message === 'string' ? cliMsg.message.trim() : ''
  if (message) return message

  const content = typeof cliMsg?.content === 'string' ? cliMsg.content.trim() : ''
  if (content) return content

  return 'Context compacted'
}

function rebindSessionOutput(
  sessionId: string,
  ws: ServerWebSocket<WebSocketData>,
  options?: {
    shouldForward?: (cliMsg: any) => boolean
  },
) {
  if (!conversationService.hasSession(sessionId)) return

  conversationService.clearOutputCallbacks(sessionId)
  conversationService.onOutput(sessionId, (cliMsg) => {
    if (options?.shouldForward && !options.shouldForward(cliMsg)) {
      return
    }

    if (handleRecoverableImageFailure(ws, sessionId, cliMsg)) {
      return
    }

    const serverMsgs = translateCliMessage(cliMsg, sessionId)
    for (const msg of serverMsgs) {
      sendMessage(ws, msg)
    }

    if (cliMsg.type === 'result') {
      if (cliMsg.is_error) {
        pendingImageTurns.delete(sessionId)
      } else {
        finalizeSuccessfulImageTurns(sessionId)
      }
      triggerTitleGeneration(ws, sessionId)
    }
  })
}

async function getRuntimeSettings(sessionId?: string): Promise<{
  permissionMode?: string
  model?: string
  effort?: string
  providerId?: string | null
  contextWindow?: number
  imageSupportOverride?: boolean
}> {
  const runtimeOverride = sessionId ? runtimeOverrides.get(sessionId) : undefined
  if (runtimeOverride) {
    const userSettings = await settingsService.getUserSettings()
    const effort =
      typeof userSettings.effort === 'string' && userSettings.effort.trim()
        ? userSettings.effort
        : undefined

    return {
      permissionMode: await settingsService.getPermissionMode().catch(() => undefined),
      model: runtimeOverride.modelId,
      effort,
      providerId: runtimeOverride.providerId,
      contextWindow: runtimeOverride.contextWindow,
      ...(sessionId && imageFallbackSessions.has(sessionId)
        ? { imageSupportOverride: false }
        : {}),
    }
  }

  // Check if a custom provider is active
  const { activeId } = await providerService.listProviders()
  const userSettings = await settingsService.getUserSettings()
  const providerSettings = activeId
    ? await providerService.getManagedSettings()
    : undefined
  const modelSettings = providerSettings ?? userSettings
  const modelContext =
    typeof modelSettings.modelContext === 'string' && modelSettings.modelContext.trim()
      ? modelSettings.modelContext
      : undefined
  const effort =
    typeof userSettings.effort === 'string' && userSettings.effort.trim()
      ? userSettings.effort
      : undefined

  let model: string | undefined
  if (activeId) {
    // Provider is active — only consult provider-managed cybercode settings.
    // Global ~/.cyber/settings.json model values must not bleed into provider mode.
    const baseModel =
      typeof modelSettings.model === 'string' && modelSettings.model.trim()
        ? modelSettings.model
        : ''
    if (baseModel) {
      model = baseModel
      if (modelContext) model += `:${modelContext}`
    }
  } else {
    // No provider — pass model normally
    const baseModel =
      typeof userSettings.model === 'string' && userSettings.model.trim()
        ? userSettings.model
        : undefined
    model = baseModel ? (modelContext ? `${baseModel}:${modelContext}` : baseModel) : undefined
  }

  return {
    permissionMode: await settingsService.getPermissionMode().catch(() => undefined),
    model,
    effort,
    providerId: activeId,
    ...(sessionId && imageFallbackSessions.has(sessionId)
      ? { imageSupportOverride: false }
      : {}),
  }
}

function enqueueRuntimeTransition(
  sessionId: string,
  transition: () => Promise<void>,
): Promise<void> {
  const previous = runtimeTransitionPromises.get(sessionId) ?? Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(transition)
    .finally(() => {
      if (runtimeTransitionPromises.get(sessionId) === next) {
        runtimeTransitionPromises.delete(sessionId)
      }
    })
  runtimeTransitionPromises.set(sessionId, next)
  return next
}

/**
 * Send a message to a specific session's WebSocket (for use by services)
 */
export function sendToSession(sessionId: string, message: ServerMessage): boolean {
  const ws = activeSessions.get(sessionId)
  if (!ws) return false
  ws.send(JSON.stringify(message))
  return true
}

export function getActiveSessionIds(): string[] {
  return Array.from(activeSessions.keys())
}
