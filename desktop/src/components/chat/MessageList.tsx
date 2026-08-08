import {
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  memo,
  useState,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { ApiError } from '../../api/client'
import { sessionsApi, type SessionRewindResponse } from '../../api/sessions'
import { useChatStore } from '../../stores/chatStore'
import { mapHistoryMessages } from '../../stores/historyParser'
import { useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useTeamStore } from '../../stores/teamStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n/locales/en'
import { UserMessage } from './UserMessage'
import { MessageAnchorRail, type MessageAnchor } from './MessageAnchorRail'
import { AssistantMessage } from './AssistantMessage'
import { FloatingThinkingPanel } from './FloatingThinkingPanel'
import { StreamingIndicator } from './StreamingIndicator'
import { ChatSelectionContextMenu } from './ChatSelectionContextMenu'

import { ToolCallGroup } from './ToolCallGroup'
import { ToolCallBlock } from './ToolCallBlock'
import { ToolResultBlock } from './ToolResultBlock'
import { PermissionDialog } from './PermissionDialog'
import { AskUserQuestion } from './AskUserQuestion'
import { InlineTaskSummary } from './InlineTaskSummary'
import type { AgentTaskNotification, UIMessage } from '../../types/chat'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { Icon } from '../shared/Icon'
import { getPendingToolUseIdsForLatestTurn } from '../../utils/toolCallState'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>

type MessageRenderItem = {
  kind: 'message'
  message: UIMessage
  /** UI-only assistant item used while the current reply is streaming/revealing. */
  isStreaming?: boolean
  /** Tool calls owned by this assistant message for branching/rewind semantics. */
  toolCalls?: ToolCall[]
  /** One UI-only aggregate for all tool activity in the current user turn. */
  activityToolCalls?: ToolCall[]
}

type RenderItem =
  | { kind: 'tool_group'; toolCalls: ToolCall[]; id: string }
  | MessageRenderItem

type ChatTurnRole = 'user' | 'assistant'

type RenderModel = {
  renderItems: RenderItem[]
  toolResultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
}

function getChatTurnRole(item: RenderItem | undefined): ChatTurnRole | null {
  if (!item) return null
  if (item.kind === 'message' && item.message.type === 'user_text') return 'user'
  return 'assistant'
}

type PendingAnchorJump = {
  id: string
  itemIndex: number | null
  requestId: number
  ready: boolean
}

function appendChildToolCall(
  childToolCallsByParent: Map<string, ToolCall[]>,
  parentToolUseId: string,
  toolCall: ToolCall,
) {
  const siblings = childToolCallsByParent.get(parentToolUseId)
  if (siblings) {
    siblings.push(toolCall)
  } else {
    childToolCallsByParent.set(parentToolUseId, [toolCall])
  }
}

function toolCallTreeHasPendingResult(
  toolCall: ToolCall,
  pendingToolUseIds: Set<string>,
  childToolCallsByParent: Map<string, ToolCall[]>,
): boolean {
  if (pendingToolUseIds.has(toolCall.toolUseId)) return true
  return (childToolCallsByParent.get(toolCall.toolUseId) ?? []).some((child) =>
    toolCallTreeHasPendingResult(
      child,
      pendingToolUseIds,
      childToolCallsByParent,
    ),
  )
}

function appendThinkingContent(current: string, next: string): string {
  if (!current) return next
  if (!next) return current
  if (current.endsWith('\n') || next.startsWith('\n')) return `${current}${next}`
  return `${current}\n\n${next}`
}

function getAnchorPreview(content: string): string {
  const firstLine = content
    .replace(/<system-reminder>[\s\S]*?(<\/system-reminder>|$)/g, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('<') && !line.startsWith('```')) ?? ''
  return firstLine
    .replace(/^(?:#{1,6}\s+|[-*>]\s+)/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildRenderModel(messages: UIMessage[]): RenderModel {
  const items: RenderItem[] = []
  const toolResultMap = new Map<string, ToolResult>()
  const childToolCallsByParent = new Map<string, ToolCall[]>()
  const toolUseIds = new Set<string>()
  let pendingToolCalls: ToolCall[] = []
  let turnActivityToolCalls: ToolCall[] | null = null
  let turnThinkingItem: MessageRenderItem | null = null

  const flushGroup = () => {
    if (pendingToolCalls.length > 0) {
      const lastItem = items[items.length - 1]

      // Preserve the immediate assistant-to-tool relationship used when
      // branching from a specific reply.
      if (lastItem && lastItem.kind === 'message' && lastItem.message.type === 'assistant_text') {
        lastItem.toolCalls = [...(lastItem.toolCalls ?? []), ...pendingToolCalls]
      }

      // The transcript UI gets exactly one stable activity group per user
      // turn. Later tool waves append to the first group's shared array even
      // when assistant commentary appears between them.
      if (turnActivityToolCalls) {
        turnActivityToolCalls.push(...pendingToolCalls)
      } else if (lastItem && lastItem.kind === 'message' && lastItem.message.type === 'assistant_text') {
        const activityToolCalls = [...pendingToolCalls]
        lastItem.activityToolCalls = activityToolCalls
        turnActivityToolCalls = activityToolCalls
      } else {
        const activityToolCalls = [...pendingToolCalls]
        items.push({
          kind: 'tool_group',
          toolCalls: activityToolCalls,
          id: `group-${pendingToolCalls[0]!.id}`,
        })
        turnActivityToolCalls = activityToolCalls
      }
      pendingToolCalls = []
    }
  }

  for (const msg of messages) {
    if (msg.type === 'tool_use') toolUseIds.add(msg.toolUseId)
    if (msg.type === 'tool_result') toolResultMap.set(msg.toolUseId, msg)
  }

  for (const msg of messages) {
    if (msg.type === 'tool_result' && toolUseIds.has(msg.toolUseId)) continue
    if (msg.type === 'tool_result' && msg.parentToolUseId && toolUseIds.has(msg.parentToolUseId)) continue

    if (msg.type === 'tool_use') {
      if (msg.parentToolUseId && toolUseIds.has(msg.parentToolUseId)) {
        flushGroup()
        appendChildToolCall(childToolCallsByParent, msg.parentToolUseId, msg)
        continue
      }
      if (msg.toolName === 'AskUserQuestion') {
        flushGroup()
        items.push({ kind: 'message', message: msg })
      } else {
        pendingToolCalls.push(msg)
      }
    } else {
      flushGroup()
      if (msg.type === 'user_text') {
        turnActivityToolCalls = null
        turnThinkingItem = null
      }
      if (msg.type === 'thinking') {
        if (turnThinkingItem && turnThinkingItem.message.type === 'thinking') {
          turnThinkingItem.message = {
            ...turnThinkingItem.message,
            content: appendThinkingContent(turnThinkingItem.message.content, msg.content),
          }
        } else {
          turnThinkingItem = {
            kind: 'message',
            message: { ...msg },
          }
          items.push(turnThinkingItem)
        }
      } else {
        items.push({ kind: 'message', message: msg })
      }
    }
  }

  flushGroup()
  return { renderItems: items, toolResultMap, childToolCallsByParent }
}

function placeTurnActivityAfterLatestAssistant(segment: RenderItem[]): RenderItem[] {
  let finalAssistant: MessageRenderItem | undefined
  for (let index = segment.length - 1; index >= 0; index -= 1) {
    const item = segment[index]
    if (item?.kind === 'message' && item.message.type === 'assistant_text') {
      finalAssistant = item
      break
    }
  }
  if (!finalAssistant) return segment

  const thinkingItem = segment.find(
    (item): item is MessageRenderItem =>
      item.kind === 'message' && item.message.type === 'thinking',
  )
  let activityToolCalls: ToolCall[] | undefined
  let activityId: string | undefined

  for (const item of segment) {
    if (item.kind === 'tool_group') {
      activityToolCalls ??= item.toolCalls
      activityId ??= item.id
    } else if (item.activityToolCalls?.length) {
      activityToolCalls ??= item.activityToolCalls
    }
  }

  if (!thinkingItem && !activityToolCalls) return segment

  const positioned: RenderItem[] = []
  for (const item of segment) {
    if (item === thinkingItem || item.kind === 'tool_group') continue

    let renderedItem = item
    if (item.kind === 'message' && item.activityToolCalls) {
      const messageItem = { ...item }
      delete messageItem.activityToolCalls
      renderedItem = messageItem
    }
    positioned.push(renderedItem)

    if (item === finalAssistant) {
      if (thinkingItem) positioned.push(thinkingItem)
      if (activityToolCalls?.length) {
        positioned.push({
          kind: 'tool_group',
          toolCalls: activityToolCalls,
          id: activityId ?? `turn-activity-${activityToolCalls[0]!.toolUseId}`,
        })
      }
    }
  }
  return positioned
}

export function positionTurnActivityAfterLatestAssistant(
  renderItems: RenderItem[],
): RenderItem[] {
  const segments: RenderItem[][] = []
  let currentSegment: RenderItem[] = []

  for (const item of renderItems) {
    const startsUserTurn = item.kind === 'message' && item.message.type === 'user_text'
    if (startsUserTurn && currentSegment.length > 0) {
      segments.push(currentSegment)
      currentSegment = []
    }
    currentSegment.push(item)
  }
  if (currentSegment.length > 0) segments.push(currentSegment)

  return segments.flatMap((segment) => {
    const containsUserTurn = segment.some(
      (item) => item.kind === 'message' && item.message.type === 'user_text',
    )
    if (!containsUserTurn) return segment
    return placeTurnActivityAfterLatestAssistant(segment)
  })
}

function getRenderItemId(item: RenderItem): string {
  return item.kind === 'tool_group' ? item.id : item.message.id
}

function renderItemMatchesAnchorId(item: RenderItem | undefined, anchorId: string): boolean {
  return Boolean(
    item?.kind === 'message'
    && item.message.type === 'user_text'
    && (
      item.message.id === anchorId
      || item.message.serverId === anchorId
    ),
  )
}

function isErrorLikeAssistantText(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false
  if (!/^(Error:|API Error:)/i.test(trimmed)) return false

  return (
    /API Error:/i.test(trimmed) ||
    /BadRequest|InvalidParameter|Request id:/i.test(trimmed) ||
    /处理过程中发生错误/.test(trimmed) ||
    /"error"\s*:/.test(trimmed)
  )
}

function ErrorMessageBubble({
  displayMessage,
  rawDetail,
}: {
  displayMessage: string
  rawDetail?: string
}) {
  const normalizedMessage = displayMessage.replace(/^Error:\s*/i, '')

  return (
    <div className="flex w-full justify-center px-[24px] py-[8px]">
      <div data-chat-content-column data-message-shell="error" className="flex w-full max-w-[878px] flex-col items-start">
        <div
          data-message-error
          className="chat-bubble-text w-fit max-w-full overflow-hidden rounded-[20px] rounded-bl-[8px] border border-[var(--color-error)]/20 bg-[var(--color-error-container)]/24 px-[20px] py-[14px] text-[14px] font-normal leading-relaxed tracking-normal [overflow-wrap:anywhere]"
          style={{ color: 'var(--color-error)' }}
        >
          <span className="font-medium">Error:</span> {normalizedMessage}
          {rawDetail && (
            <div
              data-message-error-detail
              className="mt-[8px] max-w-full whitespace-pre-wrap rounded-[12px] border border-[var(--color-error)]/15 bg-[var(--color-error-container)]/18 px-[10px] py-[8px] text-[12px] leading-relaxed [overflow-wrap:anywhere]"
              style={{ color: 'var(--color-error)' }}
            >
              {rawDetail}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

type MessageListProps = {
  sessionId?: string | null
  projectPath?: string
  isActive?: boolean
  bottomOverlayHeight?: number
}

export function syncChatScrollbarGutter(scroller: HTMLElement) {
  const chatLayout = scroller.closest<HTMLElement>('[data-chat-layout]')
  if (!chatLayout) return

  const gutter = Math.max(0, scroller.offsetWidth - scroller.clientWidth)
  chatLayout.style.setProperty('--chat-message-scrollbar-gutter', `${gutter}px`)
}

type RenderItemLayout = Pick<HTMLElement, 'offsetTop' | 'offsetHeight'>

export function findVisibleRenderItemRange(
  items: readonly RenderItemLayout[],
  viewportTop: number,
  viewportBottom: number,
): { start: number; end: number } | null {
  if (items.length === 0 || viewportBottom <= viewportTop) return null

  let low = 0
  let high = items.length - 1
  let start = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const item = items[middle]!
    if (item.offsetTop + item.offsetHeight > viewportTop) {
      start = middle
      high = middle - 1
    } else {
      low = middle + 1
    }
  }
  if (start === -1) return null

  low = start
  high = items.length - 1
  let end = start
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const item = items[middle]!
    if (item.offsetTop < viewportBottom) {
      end = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return { start, end }
}

const MIN_BOTTOM_SPACER_HEIGHT = 176
const BOTTOM_SPACER_CLEARANCE = 8
const HISTORY_LOADING_INDICATOR_DELAY_MS = 800

export function MessageList({ sessionId, projectPath, isActive = true, bottomOverlayHeight = 0 }: MessageListProps = {}) {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const resolvedSessionId = sessionId ?? activeTabId
  const sessionState = useChatStore((s) =>
    resolvedSessionId ? s.sessions[resolvedSessionId] : undefined,
  )
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const reloadHistory = useChatStore((s) => s.reloadHistory)
  const loadHistory = useChatStore((s) => s.loadHistory)
  const queueComposerPrefill = useChatStore((s) => s.queueComposerPrefill)
  const completeStreamingReveal = useChatStore((s) => s.completeStreamingReveal)
  const isMemberSession = useTeamStore((s) =>
    resolvedSessionId ? Boolean(s.getMemberBySessionId(resolvedSessionId)) : false,
  )
  const addToast = useUIStore((s) => s.addToast)

  const messages = sessionState?.messages ?? []
  const chatState = sessionState?.chatState ?? 'idle'
  const streamingText = sessionState?.streamingText ?? ''
  const settlingAssistant = sessionState?.settlingAssistant ?? null
  const visualStreamingText = streamingText || settlingAssistant?.content || ''
  const isAssistantTurnActive = chatState !== 'idle' || Boolean(visualStreamingText)
  const agentTaskNotifications = sessionState?.agentTaskNotifications ?? {}
  const historyLoadState = sessionState?.historyLoadState ?? 'idle'
  const allMessagesLoaded = sessionState?.allMessagesLoaded ?? false
  const loadMoreHistory = useChatStore((s) => s.loadMoreHistory)
  const loadMoreRecent = useChatStore((s) => s.loadMoreRecent)
  const recentBuffer = sessionState?.recentBuffer ?? []
  const listIdentity = `${resolvedSessionId ?? 'no-session'}:${projectPath ?? ''}`
  const bottomSpacerHeight = bottomOverlayHeight > 0
    ? Math.max(MIN_BOTTOM_SPACER_HEIGHT, Math.ceil(bottomOverlayHeight) + BOTTOM_SPACER_CLEARANCE)
    : MIN_BOTTOM_SPACER_HEIGHT

  const scrollerElementRef = useRef<HTMLDivElement | null>(null)
  const scrollContentElementRef = useRef<HTMLDivElement | null>(null)
  const renderItemElementsRef = useRef<HTMLElement[]>([])
  const scrollRafRef = useRef<number | null>(null)
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  // Track whether the user is near the bottom of the list. Used to decide whether
  // auto-scroll during streaming is appropriate. If the user has scrolled up to
  // read history, we must NOT force them back to the bottom.
  const isNearBottomRef = useRef(true)
  const activationBottomLockRef = useRef(true)
  const autoFollowCurrentTurnRef = useRef(false)
  const streamingFollowRafRef = useRef<number | null>(null)
  const wasActiveRef = useRef(isActive)

  const t = useTranslation()
  const [rewindTarget, setRewindTarget] = useState<{
    messageId: string
    userMessageIndex: number
    userMessageOffsetFromEnd: number
    content: string
    attachments?: Extract<UIMessage, { type: 'user_text' }>['attachments']
  } | null>(null)
  const [rewindPreview, setRewindPreview] = useState<SessionRewindResponse | null>(null)
  const [rewindError, setRewindError] = useState<string | null>(null)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [isExecutingRewind, setIsExecutingRewind] = useState(false)
  const [branchingMessageId, setBranchingMessageId] = useState<string | null>(null)

  // Auto-load history when the component mounts for a session that hasn't
  // been loaded yet. Prevents the blank-screen scenario when switching tabs
  // or on first render before AppShell's bootstrap loadHistory completes.
  useEffect(() => {
    if (isActive && resolvedSessionId && historyLoadState === 'idle') {
      void loadHistory(resolvedSessionId, projectPath)
    }
  }, [isActive, resolvedSessionId, projectPath, historyLoadState, loadHistory])

  const renderModel = useMemo(
    () => buildRenderModel(messages),
    [messages],
  )
  const { toolResultMap, childToolCallsByParent } = renderModel
  const pendingToolUseIds = useMemo(
    () => getPendingToolUseIdsForLatestTurn(messages),
    [messages],
  )
  const isToolExecutionActiveFor = useCallback(
    (toolCalls: ToolCall[]) =>
      isAssistantTurnActive &&
      toolCalls.some((toolCall) =>
        toolCallTreeHasPendingResult(
          toolCall,
          pendingToolUseIds,
          childToolCallsByParent,
        ),
      ),
    [isAssistantTurnActive, childToolCallsByParent, pendingToolUseIds],
  )
  const renderItems = useMemo(
    () => {
      const displayItems = [...renderModel.renderItems]

      // Keep the live reply inside the same turn model as thinking and tool
      // activity. Its stable key prevents remounting while tokens arrive, and
      // positioning can place the activity controls beneath it immediately.
      if (isAssistantTurnActive) {
        displayItems.push({
          kind: 'message',
          isStreaming: true,
          message: {
            id: `live-assistant:${resolvedSessionId ?? 'session'}`,
            type: 'assistant_text',
            content: visualStreamingText,
            timestamp: Number.MAX_SAFE_INTEGER,
          },
        })
      }

      return positionTurnActivityAfterLatestAssistant(displayItems).filter(
        (item) => !(
          item.kind === 'message'
          && item.message.id === settlingAssistant?.messageId
        ),
      )
    },
    [
      isAssistantTurnActive,
      renderModel.renderItems,
      resolvedSessionId,
      settlingAssistant?.messageId,
      visualStreamingText,
    ],
  )
  const chatTurnLayout = useMemo(() => {
    let previousRole: ChatTurnRole | null = null
    return renderItems.map((item) => {
      const role = getChatTurnRole(item)
      const startsNewRole = role !== null && previousRole !== null && role !== previousRole
      if (role !== null) previousRole = role
      return { role, startsNewRole }
    })
  }, [renderItems])
  const handleStreamingSettled = useCallback(() => {
    if (!resolvedSessionId || !settlingAssistant) return
    completeStreamingReveal(resolvedSessionId, settlingAssistant.messageId)
  }, [completeStreamingReveal, resolvedSessionId, settlingAssistant])
  const latestUserRenderItemIndex = useMemo(() => {
    for (let index = renderItems.length - 1; index >= 0; index -= 1) {
      const item = renderItems[index]
      if (item?.kind === 'message' && item.message.type === 'user_text') return index
    }
    return -1
  }, [renderItems])
  const renderItemsLengthRef = useRef(renderItems.length)
  renderItemsLengthRef.current = renderItems.length
  const renderItemsRef = useRef(renderItems)
  renderItemsRef.current = renderItems

  const sessionAnchors = sessionState?.anchors
  const loadHistoryUntil = useChatStore((s) => s.loadHistoryUntil)

  const messageAnchors = useMemo<MessageAnchor[]>(() => {
    // Locate every loaded user question inside renderItems.
    const indexById = new Map<string, number>()
    const answerPreviewById = new Map<string, string>()
    let currentUserIds: string[] = []
    renderItems.forEach((item, index) => {
      if (item.kind !== 'message') return
      if (item.message.type === 'user_text') {
        currentUserIds = [item.message.id]
        if (!indexById.has(item.message.id)) indexById.set(item.message.id, index)
        const serverId = item.message.serverId
        if (serverId) {
          currentUserIds.push(serverId)
          if (!indexById.has(serverId)) indexById.set(serverId, index)
        }
        return
      }
      if (item.message.type === 'assistant_text' && currentUserIds.length > 0) {
        const answerPreview = getAnchorPreview(item.message.content)
        if (answerPreview) {
          currentUserIds.forEach((id) => answerPreviewById.set(id, answerPreview))
        }
      }
    })
    const liveAnswerPreview = getAnchorPreview(visualStreamingText)
    if (liveAnswerPreview && currentUserIds.length > 0) {
      currentUserIds.forEach((id) => answerPreviewById.set(id, liveAnswerPreview))
    }

    if (sessionAnchors) {
      // Server-provided full-history anchors (source of truth, filtered on the
      // server). Anchors outside the loaded window get itemIndex null and
      // render dimmed; clicking them loads history first.
      return sessionAnchors.map((anchor) => {
        const itemIndex = indexById.get(anchor.messageId) ?? null
        return {
          seq: anchor.seq,
          id: anchor.messageId,
          preview: anchor.preview,
          answerPreview: answerPreviewById.get(anchor.messageId) ?? anchor.answerPreview,
          itemIndex,
          loaded: itemIndex !== null,
        }
      })
    }

    // Fallback until the server anchor list arrives: derive from the loaded
    // window only. Strip injected system-reminder blocks but keep the real
    // user text that follows them; skip turns that are pure system
    // notifications.
    const anchors: MessageAnchor[] = []
    renderItems.forEach((item, index) => {
      if (item.kind === 'message' && item.message.type === 'user_text') {
        const stripped = item.message.content
          .replace(/<system-reminder>[\s\S]*?(<\/system-reminder>|$)/g, '')
          .trim()
        if (!stripped) return
        if (/^<(task-notification|command-message|local-command)/.test(stripped)) return
        const firstLine = stripped
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line && !line.startsWith('<')) ?? ''
        if (!firstLine) return
        anchors.push({
          seq: anchors.length,
          itemIndex: index,
          // Prefer the stable serverId over a client-generated message.id so
          // that loadHistoryUntil can find the message via messageMatchesId
          // even after it is trimmed and re-fetched from the server.
          id: ('serverId' in item.message && item.message.serverId) || item.message.id,
          preview: firstLine,
          answerPreview: answerPreviewById.get(item.message.serverId || item.message.id),
          loaded: true,
        })
      }
    })
    return anchors
  }, [renderItems, sessionAnchors, visualStreamingText])

  const [anchorVisibleRange, setAnchorVisibleRange] = useState<{ start: number; end: number } | null>(null)
  const [anchorLoadingId, setAnchorLoadingId] = useState<string | null>(null)
  const [pendingAnchorJump, setPendingAnchorJump] = useState<PendingAnchorJump | null>(null)
  const [anchorBubbleHighlight, setAnchorBubbleHighlight] = useState<{
    messageId: string
    token: number
  } | null>(null)
  const anchorJumpRequestRef = useRef(0)
  const anchorVisibleRangeRef = useRef<{ start: number; end: number } | null>(null)
  // While an anchor jump is in flight, don't let loadMoreRecent slide the window.
  const anchorJumpSuppressFollowRef = useRef(false)

  // Position within the chat scroller directly. WebKit can ignore
  // scrollIntoView() for deep descendants while a large React commit is still
  // settling, so use deterministic container-relative coordinates instead.
  const scrollToAnchorItem = useCallback((
    anchorId: string,
    itemIndex: number,
    requestId: number,
  ) => {
    const scroller = scrollerElementRef.current
    if (!scroller) return false

    const findTargetElement = () => {
      const renderedItems = scroller.querySelectorAll<HTMLElement>('[data-render-index]')
      for (const element of renderedItems) {
        if (
          element.dataset.messageAnchorId === anchorId
          || element.dataset.messageAnchorServerId === anchorId
        ) {
          return element
        }
      }

      const fallback = scroller.querySelector<HTMLElement>(`[data-render-index="${itemIndex}"]`)
      return renderItemMatchesAnchorId(renderItemsRef.current[itemIndex], anchorId)
        ? fallback
        : null
    }

    const el = findTargetElement()
    if (!el) return false
    // Mark not-at-bottom BEFORE scrolling so the streaming-follow effect
    // doesn't yank the view back down.
    activationBottomLockRef.current = false
    isNearBottomRef.current = false
    autoFollowCurrentTurnRef.current = false
    // Keep loadMoreRecent suppressed AFTER the jump: scroll-anchoring
    // corrections following a large prepend+trim can transiently report
    // atBottom, which would cascade-restore newer pages and slide the window
    // away from the jump target. Only a deliberate user scroll re-enables it
    // (wheel / touch / scrollbar drag / keyboard all count).
    anchorJumpSuppressFollowRef.current = true
    const release = () => {
      anchorJumpSuppressFollowRef.current = false
    }
    scroller.addEventListener('wheel', release, { once: true })
    scroller.addEventListener('touchmove', release, { once: true })
    scroller.addEventListener('pointerdown', release, { once: true })
    scroller.addEventListener('keydown', release, { once: true })
    const applyPosition = () => {
      if (anchorJumpRequestRef.current !== requestId) return false
      const currentTarget = findTargetElement()
      if (!currentTarget) return false
      const scrollerRect = scroller.getBoundingClientRect()
      const targetRect = currentTarget.getBoundingClientRect()
      if (
        !Number.isFinite(scrollerRect.top)
        || !Number.isFinite(targetRect.top)
        || !Number.isFinite(targetRect.height)
      ) {
        return false
      }
      const targetTop = scroller.scrollTop + targetRect.top - scrollerRect.top
      const centeredTop = targetTop - Math.max(0, (scroller.clientHeight - targetRect.height) / 2)
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const nextScrollTop = Math.min(Math.max(0, centeredTop), maxScrollTop)
      scroller.scrollTop = nextScrollTop
      return true
    }

    if (!applyPosition()) return false

    // WKWebView can ignore the first scroll write while a large transcript is
    // committing. Re-resolve by stable message id on the next two frames so a
    // single click still lands after layout and scroll anchoring settle.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (!applyPosition()) return
        requestAnimationFrame(() => { applyPosition() })
      })
    }

    const target = renderItemsRef.current.find((item) => renderItemMatchesAnchorId(item, anchorId))
    if (target?.kind === 'message' && target.message.type === 'user_text') {
      setAnchorBubbleHighlight({ messageId: target.message.id, token: requestId })
    }
    return true
  }, [])

  const failAnchorJump = useCallback((requestId: number, anchorId: string) => {
    if (anchorJumpRequestRef.current !== requestId) return
    anchorJumpSuppressFollowRef.current = false
    setPendingAnchorJump((current) => current?.requestId === requestId ? null : current)
    setAnchorLoadingId((current) => current === anchorId ? null : current)
    addToast({ type: 'error', message: t('chat.anchorJumpFailed') })
  }, [addToast, t])

  const handleAnchorJump = useCallback((anchor: MessageAnchor) => {
    const requestId = anchorJumpRequestRef.current + 1
    anchorJumpRequestRef.current = requestId
    setPendingAnchorJump(null)
    setAnchorLoadingId(null)

    if (
      anchor.itemIndex !== null
      && scrollToAnchorItem(anchor.id, anchor.itemIndex, requestId)
    ) {
      return
    }

    // The target either sits outside the loaded history window or belongs to
    // the initial render chunk that has not committed yet. In both cases the
    // layout effect below completes the jump only after its DOM node exists.
    setAnchorLoadingId(anchor.id)
    anchorJumpSuppressFollowRef.current = true
    setPendingAnchorJump({
      id: anchor.id,
      itemIndex: anchor.itemIndex,
      requestId,
      ready: anchor.itemIndex !== null,
    })

    if (anchor.itemIndex !== null) return
    if (!resolvedSessionId) {
      failAnchorJump(requestId, anchor.id)
      return
    }

    void loadHistoryUntil(resolvedSessionId, anchor.id).then((found) => {
      if (anchorJumpRequestRef.current !== requestId) return
      if (!found) {
        failAnchorJump(requestId, anchor.id)
        return
      }
      setPendingAnchorJump((current) =>
        current?.requestId === requestId ? { ...current, ready: true } : current,
      )
    }).catch(() => {
      failAnchorJump(requestId, anchor.id)
    })
  }, [failAnchorJump, resolvedSessionId, loadHistoryUntil, scrollToAnchorItem])

  // The server anchor list is a transcript snapshot; refresh it (debounced)
  // when new local user questions appear that it does not cover yet.
  const localUserQuestionCount = useMemo(
    () => renderItems.filter((item) => item.kind === 'message' && item.message.type === 'user_text').length,
    [renderItems],
  )
  const anchorsRefreshTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (!resolvedSessionId || !sessionState?.anchorsLoaded) return
    if ((sessionState.anchors?.length ?? 0) >= localUserQuestionCount) return
    if (anchorsRefreshTimerRef.current !== null) window.clearTimeout(anchorsRefreshTimerRef.current)
    const sessionId = resolvedSessionId
    anchorsRefreshTimerRef.current = window.setTimeout(() => {
      anchorsRefreshTimerRef.current = null
      void useChatStore.getState().loadAnchors(sessionId, projectPath, { force: true })
    }, 800)
    return () => {
      if (anchorsRefreshTimerRef.current !== null) window.clearTimeout(anchorsRefreshTimerRef.current)
    }
  }, [localUserQuestionCount, resolvedSessionId, projectPath, sessionState?.anchorsLoaded, sessionState?.anchors])
  const latestRenderItem = renderItems[renderItems.length - 1]
  const latestRenderItemKey = latestRenderItem
    ? `${listIdentity}:${getRenderItemId(latestRenderItem)}`
    : `${listIdentity}:empty`
  const latestRenderItemIsUserMessage = latestRenderItem?.kind === 'message' && latestRenderItem.message.type === 'user_text'
  const latestRenderItemKeyRef = useRef(latestRenderItemKey)

  // Track session switches to reset scroll state. Native rendering means the
  // browser's built-in scroll anchoring keeps the viewport stable when history
  // is prepended — no firstItemIndex bookkeeping, no compensation loops.
  const listIdentityRef = useRef(listIdentity)
  const needsInitialBottomRef = useRef(true)
  // Chunked first frame: on a session switch, render only the newest screenful
  // of messages first (~16 items) so the first paint is near-instant even for
  // markdown-heavy sessions, then expand to the full list on the next frame.
  // Older items appear above the viewport (bottom-anchored), so the expansion
  // is invisible — the browser's scroll anchoring keeps the position.
  // Disabled in tests: jsdom assertions expect the full list synchronously.
  const isTestEnv = typeof process !== 'undefined' && (process.env?.VITEST === 'true' || process.env?.NODE_ENV === 'test')
  const INITIAL_RENDER_CHUNK = isTestEnv ? Number.POSITIVE_INFINITY : 16
  const [renderChunkStart, setRenderChunkStart] = useState(() => Math.max(0, renderItems.length - INITIAL_RENDER_CHUNK))

  if (listIdentityRef.current !== listIdentity) {
    listIdentityRef.current = listIdentity
    needsInitialBottomRef.current = true
    isNearBottomRef.current = true
    activationBottomLockRef.current = true
    autoFollowCurrentTurnRef.current = false
    setAnchorVisibleRange(null)
    anchorVisibleRangeRef.current = null
    setRenderChunkStart(Math.max(0, renderItems.length - INITIAL_RENDER_CHUNK))
    if (anchorsRefreshTimerRef.current !== null) {
      window.clearTimeout(anchorsRefreshTimerRef.current)
      anchorsRefreshTimerRef.current = null
    }
  }

  // Expand the chunk to the full list after the first frame has painted.
  useEffect(() => {
    if (renderChunkStart === 0) return
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setRenderChunkStart(0))
    })
    return () => cancelAnimationFrame(raf)
  }, [renderChunkStart, listIdentity])

  // Complete an anchor jump from the layout lifecycle that actually committed
  // the target node. This is reliable even when WKWebView needs substantially
  // more than two frames to render a history window.
  useLayoutEffect(() => {
    if (!pendingAnchorJump?.ready) return

    let itemIndex = pendingAnchorJump.itemIndex ?? -1
    if (!renderItemMatchesAnchorId(renderItems[itemIndex], pendingAnchorJump.id)) {
      itemIndex = renderItems.findIndex((item) => (
        renderItemMatchesAnchorId(item, pendingAnchorJump.id)
      ))
    }
    if (itemIndex < 0) return

    if (itemIndex < renderChunkStart) {
      setRenderChunkStart(0)
      return
    }
    if (!scrollToAnchorItem(
      pendingAnchorJump.id,
      itemIndex,
      pendingAnchorJump.requestId,
    )) return
    if (anchorJumpRequestRef.current !== pendingAnchorJump.requestId) return

    setPendingAnchorJump((current) =>
      current?.requestId === pendingAnchorJump.requestId ? null : current,
    )
    setAnchorLoadingId((current) => current === pendingAnchorJump.id ? null : current)
  }, [pendingAnchorJump, renderChunkStart, renderItems, scrollToAnchorItem])

  useEffect(() => {
    if (!pendingAnchorJump?.ready) return
    const { requestId, id } = pendingAnchorJump
    const timeout = window.setTimeout(() => {
      failAnchorJump(requestId, id)
    }, 8_000)
    return () => window.clearTimeout(timeout)
  }, [failAnchorJump, pendingAnchorJump])

  useEffect(() => {
    anchorJumpRequestRef.current += 1
    setPendingAnchorJump(null)
    setAnchorLoadingId(null)
    setAnchorBubbleHighlight(null)
    anchorJumpSuppressFollowRef.current = false
  }, [listIdentity])

  useLayoutEffect(() => {
    const scroller = scrollerElementRef.current
    renderItemElementsRef.current = scroller
      ? Array.from(scroller.querySelectorAll<HTMLElement>('[data-render-index]'))
      : []
  }, [listIdentity, renderChunkStart, renderItems])

  const scrollScrollerToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const scroller = scrollerElementRef.current
    if (!scroller) return
    const top = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    if (behavior === 'auto' || typeof scroller.scrollTo !== 'function') {
      scroller.scrollTop = top
      return
    }
    scroller.scrollTo({ top, behavior })
  }, [])

  const scrollToLatest = useCallback((behavior: 'auto' | 'smooth' = 'auto') => {
    if (renderItemsLengthRef.current === 0) return
    scrollScrollerToBottom(behavior)
    if (behavior === 'auto') {
      // Re-assert after paint to correct any content-visibility size estimates.
      requestAnimationFrame(() => scrollScrollerToBottom('auto'))
    }
  }, [scrollScrollerToBottom])

  // Initial scroll to bottom + reactivation handling. Session content can keep
  // growing after this layout pass (history hydration, chunk expansion, images),
  // so the activation lock below keeps the latest turn pinned until the user
  // deliberately scrolls away.
  useLayoutEffect(() => {
    const wasActive = wasActiveRef.current
    wasActiveRef.current = isActive
    if (!isActive) {
      autoFollowCurrentTurnRef.current = false
      return
    }
    const shouldPinForActivation = needsInitialBottomRef.current || !wasActive
    if (shouldPinForActivation) {
      activationBottomLockRef.current = true
      isNearBottomRef.current = true
      setIsAtBottom(true)
    }
    const scroller = scrollerElementRef.current
    if (!scroller) return
    if (renderItems.length === 0) return
    if (shouldPinForActivation) {
      // First activation (or reactivation after tab switch): land at the bottom.
      needsInitialBottomRef.current = false
      scrollScrollerToBottom('auto')
      // One re-assert after paint to correct content-visibility size estimates.
      requestAnimationFrame(() => {
        scrollScrollerToBottom('auto')
      })
      return
    }
    // Already active: if the user is near the bottom, keep them pinned there as
    // content grows (streaming growth, dataset replacement while at bottom).
    // When they scrolled up to read history, isNearBottomRef is false and the
    // browser's scroll anchoring preserves their position during prepends.
    // EXCEPTION: during an anchor history-load + jump, do NOT pin to bottom —
    // the jump target is elsewhere, and pinning here would cause a visible
    // detour to the bottom before scrollIntoView lands on the target.
    if (anchorJumpSuppressFollowRef.current) return
    if (isNearBottomRef.current) {
      scroller.scrollTop = scroller.scrollHeight
    }
    // Watch the renderItems reference (not just length): dataset replacements
    // can preserve length while changing content.
  }, [listIdentity, renderChunkStart, renderItems, isActive, scrollScrollerToBottom])

  useLayoutEffect(() => {
    if (!isActive || typeof ResizeObserver === 'undefined') return
    const content = scrollContentElementRef.current
    if (!content) return

    const observer = new ResizeObserver(() => {
      if (!activationBottomLockRef.current) return
      if (anchorJumpSuppressFollowRef.current) return
      scrollScrollerToBottom('auto')
      isNearBottomRef.current = true
      setIsAtBottom(true)
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [historyLoadState, isActive, listIdentity, renderItems.length, scrollScrollerToBottom])

  // When the bottom overlay grows (a notice bar mounts: task bar, steer bar,
  // long-running notice, etc.), the spacer grows too — re-pin to the bottom so
  // the newest message stays visible ABOVE the notice instead of being covered
  // by it. Only when the user is already near the bottom; if they're reading
  // history, their position is preserved by scroll anchoring.
  const prevSpacerHeightRef = useRef(bottomSpacerHeight)
  useLayoutEffect(() => {
    if (prevSpacerHeightRef.current === bottomSpacerHeight) return
    prevSpacerHeightRef.current = bottomSpacerHeight
    if (!isActive) return
    const scroller = scrollerElementRef.current
    if (!scroller) return
    if (anchorJumpSuppressFollowRef.current) return
    if (isNearBottomRef.current) {
      scroller.scrollTop = scroller.scrollHeight
    }
  }, [bottomSpacerHeight, isActive])

  // When a new user message appears, follow to the bottom.
  useEffect(() => {
    const previousLatestKey = latestRenderItemKeyRef.current
    latestRenderItemKeyRef.current = latestRenderItemKey
    if (!isActive) return
    if (previousLatestKey === latestRenderItemKey) return
    if (!latestRenderItemIsUserMessage) return

    isNearBottomRef.current = true
    autoFollowCurrentTurnRef.current = true
    requestAnimationFrame(() => scrollToLatest('smooth'))
  }, [
    latestRenderItemIsUserMessage,
    latestRenderItemKey,
    isActive,
    scrollToLatest,
  ])

  // Track previous chatState so we can detect the exact moment the AI starts
  // responding (idle -> streaming/thinking/tool_executing) and scroll immediately.
  const prevChatStateRef = useRef(chatState)
  useEffect(() => {
    const prevChatState = prevChatStateRef.current
    prevChatStateRef.current = chatState

    if (!isActive) {
      autoFollowCurrentTurnRef.current = false
      if (streamingFollowRafRef.current !== null) {
        cancelAnimationFrame(streamingFollowRafRef.current)
        streamingFollowRafRef.current = null
      }
      return
    }

    if (chatState === 'idle') {
      autoFollowCurrentTurnRef.current = false
      if (streamingFollowRafRef.current !== null) {
        cancelAnimationFrame(streamingFollowRafRef.current)
        streamingFollowRafRef.current = null
      }
    }

    // 1) AI just started responding — scroll to bottom only if the user was near
    //    the bottom. If the user was reading history (scrolled up), don't pull
    //    them back down — they can scroll down manually when ready.
    if (prevChatState === 'idle' && chatState !== 'idle') {
      if (isNearBottomRef.current) {
        requestAnimationFrame(() => {
          scrollToLatest('smooth')
        })
      }
      return
    }

    // 2) AI is actively streaming text — keep following ONLY if the user is near
    //    the bottom. If they scrolled up to read history, respect that.
    if (
      (chatState !== 'idle' || settlingAssistant)
      && visualStreamingText
      && (isNearBottomRef.current || autoFollowCurrentTurnRef.current)
    ) {
      if (streamingFollowRafRef.current !== null) return
      streamingFollowRafRef.current = requestAnimationFrame(() => {
        streamingFollowRafRef.current = null
        if (!isNearBottomRef.current && !autoFollowCurrentTurnRef.current) return
        scrollToLatest('auto')
      })
    }
  }, [chatState, isActive, scrollToLatest, settlingAssistant, visualStreamingText])

  useEffect(() => () => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current)
      scrollRafRef.current = null
    }
    if (streamingFollowRafRef.current !== null) {
      cancelAnimationFrame(streamingFollowRafRef.current)
      streamingFollowRafRef.current = null
    }
  }, [listIdentity])

  // Rewind preview fetch
  useEffect(() => {
    if (!resolvedSessionId || !rewindTarget) return
    let cancelled = false
    setIsLoadingPreview(true)
    setRewindPreview(null)
    setRewindError(null)
    void sessionsApi
      .rewind(resolvedSessionId, {
        targetUserMessageId: rewindTarget.messageId,
        userMessageIndex: rewindTarget.userMessageIndex,
        userMessageOffsetFromEnd: rewindTarget.userMessageOffsetFromEnd,
        expectedContent: rewindTarget.content,
        dryRun: true,
      }, { projectPath })
      .then((preview) => { if (!cancelled) setRewindPreview(preview) })
      .catch((error) => {
        if (cancelled) return
        const message =
          error instanceof ApiError
            ? typeof error.body === 'object' && error.body && 'message' in error.body
              ? String((error.body as { message: unknown }).message)
              : error.message
            : error instanceof Error ? error.message : String(error)
        setRewindError(message)
      })
      .finally(() => { if (!cancelled) setIsLoadingPreview(false) })
    return () => { cancelled = true }
  }, [resolvedSessionId, projectPath, rewindTarget])

  const closeRewindModal = useCallback(() => {
    if (isExecutingRewind) return
    setRewindTarget(null)
    setRewindPreview(null)
    setRewindError(null)
    setIsLoadingPreview(false)
  }, [isExecutingRewind])

  const handleConfirmRewind = useCallback(async () => {
    if (!resolvedSessionId || !rewindTarget || isExecutingRewind) return
    setIsExecutingRewind(true)
    setRewindError(null)
    try {
      if (chatState !== 'idle') stopGeneration(resolvedSessionId)
      const result = await sessionsApi.rewind(resolvedSessionId, {
        targetUserMessageId: rewindTarget.messageId,
        userMessageIndex: rewindTarget.userMessageIndex,
        userMessageOffsetFromEnd: rewindTarget.userMessageOffsetFromEnd,
        expectedContent: rewindTarget.content,
      }, { projectPath })
      await reloadHistory(resolvedSessionId, projectPath)
      queueComposerPrefill(resolvedSessionId, {
        text: rewindTarget.content,
        attachments: rewindTarget.attachments,
      })
      addToast({
        type: 'success',
        message: result.code.available
          ? t('chat.rewindSuccessWithCode', { count: result.conversation.messagesRemoved })
          : t('chat.rewindSuccessConversationOnly', { count: result.conversation.messagesRemoved }),
      })
      setRewindTarget(null)
      setRewindPreview(null)
    } catch (error) {
      const message =
        error instanceof ApiError
          ? typeof error.body === 'object' && error.body && 'message' in error.body
            ? String((error.body as { message: unknown }).message)
            : error.message
          : error instanceof Error ? error.message : String(error)
      setRewindError(message)
    } finally {
      setIsExecutingRewind(false)
    }
  }, [addToast, chatState, isExecutingRewind, projectPath, queueComposerPrefill, reloadHistory, resolvedSessionId, rewindTarget, stopGeneration, t])

  const handleCreateBranch = useCallback(async (
    message: Extract<UIMessage, { type: 'assistant_text' }>,
    attachedToolCalls: ToolCall[] = [],
  ) => {
    if (!resolvedSessionId || isMemberSession || chatState !== 'idle' || branchingMessageId) return

    setBranchingMessageId(message.id)
    try {
      let targetAssistantMessageId: string | undefined
      let expectedContent: string | undefined

      for (let index = attachedToolCalls.length - 1; index >= 0; index -= 1) {
        const serverId = attachedToolCalls[index]?.serverId
        if (serverId) {
          targetAssistantMessageId = serverId
          break
        }
      }

      if (!targetAssistantMessageId && attachedToolCalls.length === 0) {
        targetAssistantMessageId = message.branchServerId || message.serverId
        expectedContent = targetAssistantMessageId ? message.content : undefined
      }

      if (!targetAssistantMessageId) {
        const savedHistory = await sessionsApi.getMessages(resolvedSessionId, {
          limit: 200,
          projectPath,
        })
        let fallbackId = 0
        const savedMessages = mapHistoryMessages(
          savedHistory.messages,
          () => `branch-history-${fallbackId += 1}`,
        )

        const attachedToolUseIds = new Set(attachedToolCalls.map((toolCall) => toolCall.toolUseId))
        for (let index = savedMessages.length - 1; index >= 0; index -= 1) {
          const candidate = savedMessages[index]
          if (
            candidate?.type === 'tool_use' &&
            attachedToolUseIds.has(candidate.toolUseId) &&
            candidate.serverId
          ) {
            targetAssistantMessageId = candidate.serverId
            break
          }
        }

        if (!targetAssistantMessageId && attachedToolUseIds.size === 0) {
          const normalizedContent = message.content.replace(/\r\n/g, '\n').trim()
          const candidates = savedMessages.filter(
            (candidate): candidate is Extract<UIMessage, { type: 'assistant_text' }> =>
              candidate.type === 'assistant_text' &&
              candidate.content.replace(/\r\n/g, '\n').trim() === normalizedContent &&
              Boolean(candidate.branchServerId || candidate.serverId),
          )
          candidates.sort((left, right) =>
            Math.abs(left.timestamp - message.timestamp) - Math.abs(right.timestamp - message.timestamp),
          )
          const candidate = candidates[0]
          targetAssistantMessageId = candidate?.branchServerId || candidate?.serverId
          expectedContent = targetAssistantMessageId ? message.content : undefined
        }
      }

      if (!targetAssistantMessageId) {
        throw new Error(t('chat.branchResolveFailed'))
      }

      const result = await sessionsApi.branch(
        resolvedSessionId,
        {
          targetAssistantMessageId,
          ...(expectedContent ? { expectedContent } : {}),
        },
        { projectPath },
      )

      const sourceSelection = useSessionRuntimeStore.getState().selections[resolvedSessionId]
      if (sourceSelection) {
        useSessionRuntimeStore.getState().setSelection(result.sessionId, sourceSelection)
      }
      void useSessionStore.getState().fetchSessions()
      useTabStore.getState().openTab(
        result.sessionId,
        result.session.title,
        'session',
        result.session.projectPath,
      )
    } catch (error) {
      const messageText =
        error instanceof ApiError
          ? typeof error.body === 'object' && error.body && 'message' in error.body
            ? String((error.body as { message: unknown }).message)
            : error.message
          : error instanceof Error ? error.message : String(error)
      addToast({
        type: 'error',
        message:
          error instanceof ApiError && error.status === 405
            ? t('chat.branchServiceOutdated')
            : t('chat.branchCreateFailed', { message: messageText }),
      })
    } finally {
      setBranchingMessageId((current) => current === message.id ? null : current)
    }
  }, [addToast, branchingMessageId, chatState, isMemberSession, projectPath, resolvedSessionId, t])

  // Keep native scrolling on the compositor. React state, history pagination,
  // and anchor-rail measurements run at most once per painted frame.
  const processScrollPosition = useCallback(() => {
    const scroller = scrollerElementRef.current
    if (!scroller) return
    const { scrollTop, scrollHeight, clientHeight } = scroller
    const atBottom = scrollHeight - scrollTop - clientHeight < 10

    setIsAtBottom(atBottom)
    isNearBottomRef.current = autoFollowCurrentTurnRef.current ? true : atBottom

    // Load older history when near the top.
    if (scrollTop < 200 && resolvedSessionId && !isLoadingMoreHistory) {
      if (!(allMessagesLoaded && (sessionState?.historyBuffer?.length ?? 0) === 0)) {
        setIsLoadingMoreHistory(true)
        loadMoreHistory(resolvedSessionId).finally(() => setIsLoadingMoreHistory(false))
      }
    }

    // Restore newer messages when at the bottom.
    if (atBottom && resolvedSessionId && recentBuffer.length > 0) {
      if (!anchorJumpSuppressFollowRef.current) {
        loadMoreRecent(resolvedSessionId)
      }
    }

    const elements = renderItemElementsRef.current
    const visible = findVisibleRenderItemRange(
      elements,
      scrollTop,
      scrollTop + clientHeight,
    )
    if (visible) {
      const start = Number(elements[visible.start]?.dataset.renderIndex)
      const end = Number(elements[visible.end]?.dataset.renderIndex)
      if (Number.isFinite(start) && Number.isFinite(end)) {
        anchorVisibleRangeRef.current = { start, end }
        setAnchorVisibleRange((previous) =>
          previous && previous.start === start && previous.end === end
            ? previous
            : { start, end },
        )
      }
    }
  }, [resolvedSessionId, isLoadingMoreHistory, allMessagesLoaded, sessionState?.historyBuffer?.length, recentBuffer.length, loadMoreHistory, loadMoreRecent])

  const handleScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      processScrollPosition()
    })
  }, [processScrollPosition])

  const interruptAutoFollow = useCallback(() => {
    activationBottomLockRef.current = false
    autoFollowCurrentTurnRef.current = false
    if (streamingFollowRafRef.current !== null) {
      cancelAnimationFrame(streamingFollowRafRef.current)
      streamingFollowRafRef.current = null
    }
  }, [])

  const handleScrollerPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const scroller = event.currentTarget
    const scrollbarWidth = Math.max(0, scroller.offsetWidth - scroller.clientWidth)
    if (scrollbarWidth === 0) return
    const bounds = scroller.getBoundingClientRect()
    if (event.clientX >= bounds.right - scrollbarWidth) interruptAutoFollow()
  }, [interruptAutoFollow])

  const handleScrollerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
      interruptAutoFollow()
    }
  }, [interruptAutoFollow])

  const handleScrollJumpClick = useCallback(() => {
    const scroller = scrollerElementRef.current
    if (!scroller) return
    if (isAtBottom) {
      activationBottomLockRef.current = false
      autoFollowCurrentTurnRef.current = false
      isNearBottomRef.current = false
      setIsAtBottom(false)
      scroller.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    activationBottomLockRef.current = true
    autoFollowCurrentTurnRef.current = chatState !== 'idle'
    isNearBottomRef.current = true
    setIsAtBottom(true)
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
  }, [chatState, isAtBottom])

  const getItemContent = useCallback(
    (index: number, item: RenderItem | undefined) => {
      if (!item) return <div />
      // With native rendering, index IS the dataIndex (0-based into renderItems).
      const dataIndex = index
      const belongsToActiveTurn = isAssistantTurnActive && dataIndex > latestUserRenderItemIndex

      // Fallback: standalone tool_group that wasn't merged into an assistant message.
      if (item.kind === 'tool_group') {
        return (
          <div className="flex w-full justify-center px-[24px] py-[8px]">
              <div data-chat-content-column className="w-full max-w-[878px]">
              <ToolCallGroup
                toolCalls={item.toolCalls}
                resultMap={toolResultMap}
                childToolCallsByParent={childToolCallsByParent}
                agentTaskNotifications={agentTaskNotifications}
                isStreaming={isToolExecutionActiveFor(item.toolCalls)}
                isTurnActive={belongsToActiveTurn}
              />
            </div>
          </div>
        )
      }

      const msg = item.message
      const isLiveAssistant = item.isStreaming && msg.type === 'assistant_text'
      // Count user_text messages that appear before this one in chronological order.
      const userMsgCount = renderItems
        .slice(0, dataIndex)
        .filter((i) => i.kind === 'message' && i.message.type === 'user_text' && !i.message.pending)
        .length
      const rewindableUserIndex = msg.type === 'user_text' && !msg.pending ? userMsgCount : null
      const rewindableUserOffsetFromEnd = msg.type === 'user_text' && !msg.pending
        ? renderItems
            .slice(dataIndex + 1)
            .filter((i) => i.kind === 'message' && i.message.type === 'user_text' && !i.message.pending)
            .length
        : null

      return (
        <div className="px-0 py-0">
          {isLiveAssistant && <StreamingIndicator sessionId={resolvedSessionId ?? undefined} />}
          {(!isLiveAssistant || msg.content) && (
            <MessageBlock
              message={msg}
              isStreaming={item.isStreaming}
              onStreamingSettled={
                isLiveAssistant && settlingAssistant && !streamingText
                  ? handleStreamingSettled
                  : undefined
              }
              toolCalls={item.toolCalls}
              activityToolCalls={item.activityToolCalls}
              toolResultMap={toolResultMap}
              childToolCallsByParent={childToolCallsByParent}
              agentTaskNotifications={agentTaskNotifications}
              isToolExecutionActive={isToolExecutionActiveFor(
                item.activityToolCalls ?? item.toolCalls ?? (msg.type === 'tool_use' ? [msg] : []),
              )}
              keepToolActivityExpanded={belongsToActiveTurn}
              isThinkingActive={
                msg.type === 'thinking'
                && belongsToActiveTurn
              }
              toolResult={
                msg.type === 'tool_use'
                  ? (() => {
                      const r = toolResultMap.get(msg.toolUseId)
                      return r ? { content: r.content, isError: r.isError } : null
                    })()
                  : null
              }
              rewindableUserIndex={rewindableUserIndex}
              rewindableUserOffsetFromEnd={rewindableUserOffsetFromEnd}
              onRequestRewind={
                !isMemberSession
                  ? (message, userMessageIndex, userMessageOffsetFromEnd) => {
                      setRewindTarget({
                        messageId: message.serverId || message.id,
                        userMessageIndex,
                        userMessageOffsetFromEnd,
                        content: message.content,
                        attachments: message.attachments,
                      })
                    }
                  : undefined
              }
              onRequestBranch={!isMemberSession ? handleCreateBranch : undefined}
              isBranching={branchingMessageId === msg.id}
              branchDisabled={chatState !== 'idle'}
              anchorHighlightToken={
                msg.type === 'user_text' && anchorBubbleHighlight?.messageId === msg.id
                  ? anchorBubbleHighlight.token
                  : undefined
              }
            />
          )}
        </div>
      )
    },
    [
      renderItems,
      anchorBubbleHighlight,
      toolResultMap,
      childToolCallsByParent,
      agentTaskNotifications,
      chatState,
      isAssistantTurnActive,
      latestUserRenderItemIndex,
      isMemberSession,
      isToolExecutionActiveFor,
      handleCreateBranch,
      branchingMessageId,
      handleStreamingSettled,
      resolvedSessionId,
      settlingAssistant,
      streamingText,
    ],
  )

  // Error / loading states are shown outside Virtuoso when there are no messages
  const showEmptyOverlay = messages.length === 0 && historyLoadState !== 'loaded'
  const isHistoryPending = showEmptyOverlay && (
    historyLoadState === 'idle' || historyLoadState === 'loading'
  )
  const [showHistoryPendingIndicator, setShowHistoryPendingIndicator] = useState(false)
  useEffect(() => {
    setShowHistoryPendingIndicator(false)
    if (!isHistoryPending) return

    const timer = window.setTimeout(() => {
      setShowHistoryPendingIndicator(true)
    }, HISTORY_LOADING_INDICATOR_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [isHistoryPending, listIdentity])
  const showScrollJumpButton = !showEmptyOverlay && (renderItems.length > 1 || visualStreamingText.length > 0)
  const scrollJumpLabel = isAtBottom ? t('chat.scrollToTop') : t('chat.scrollToBottom')

  return (
    <div className="wechat-chat-bg scrollbar-no-track relative flex flex-1 flex-col overflow-hidden">
      <ChatSelectionContextMenu />

      {showEmptyOverlay && historyLoadState === 'error' && (
        <div className="mx-auto my-6 flex max-w-[420px] flex-col items-center gap-3 rounded-[10px] border-2 border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-5 py-5 text-center">
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('chat.historyLoadFailedTitle')}</div>
          <div className="text-[12px] text-[var(--color-text-tertiary)]">{t('chat.historyLoadFailedDetail')}</div>
          <button
            type="button"
            onClick={() => resolvedSessionId && void loadHistory(resolvedSessionId, projectPath)}
            className="px-4 py-1.5 text-[12px] font-bold tracking-tight text-white bg-[#FE2C55] rounded-[6px] shadow-[0_2px_8px_rgba(254,44,85,0.25)] hover:bg-[#E91E45] transition-colors"
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {showHistoryPendingIndicator && (
        <div
          role="status"
          aria-live="polite"
          aria-label={historyLoadState === 'idle' ? t('chat.historyPreparing') : t('chat.historyLoading')}
          data-testid="session-history-loading"
          className="pointer-events-none absolute left-0 right-0 top-0 z-10 grid place-items-center"
          style={{ bottom: Math.max(0, bottomOverlayHeight) }}
        >
          <div className="session-history-loading-brand" aria-hidden="true">
            <div className="session-history-loading-wordmark-frame">
              <img
                src="/brand/cybercode-wordmark-long-flat-v4.png"
                alt=""
                draggable={false}
                className="session-history-loading-wordmark session-history-loading-wordmark-light"
              />
              <img
                src="/brand/cybercode-wordmark-long-flat-v4-dark.png"
                alt=""
                draggable={false}
                className="session-history-loading-wordmark session-history-loading-wordmark-dark"
              />
              <span className="session-history-loading-shine session-history-loading-wordmark-shine">
                <span className="session-history-loading-shine-beam" />
              </span>
            </div>
          </div>
        </div>
      )}

      {!showEmptyOverlay && (
        <div
          ref={scrollerElementRef as React.RefObject<HTMLDivElement>}
          data-testid="virtuoso-scroller"
          className="message-scrollbar scrollbar-no-track"
          style={{ height: '100%', overflowY: 'scroll', scrollbarGutter: 'stable' }}
          onScroll={handleScroll}
          onWheelCapture={interruptAutoFollow}
          onTouchMoveCapture={interruptAutoFollow}
          onPointerDownCapture={handleScrollerPointerDown}
          onKeyDownCapture={handleScrollerKeyDown}
        >
          <div ref={scrollContentElementRef} data-testid="message-scroll-content">
            <ListHeader isLoadingMoreHistory={isLoadingMoreHistory} />
            {renderItems.map((item, index) => (
              index >= renderChunkStart && (
                <div
                  key={getRenderItemId(item)}
                  data-render-index={index}
                  data-chat-turn-role={chatTurnLayout[index]?.role ?? undefined}
                  data-chat-role-transition={chatTurnLayout[index]?.startsNewRole ? 'true' : undefined}
                  className={chatTurnLayout[index]?.startsNewRole ? 'mt-[16px]' : undefined}
                  data-message-anchor-id={
                    item.kind === 'message' && item.message.type === 'user_text'
                      ? item.message.id
                      : undefined
                  }
                  data-message-anchor-server-id={
                    item.kind === 'message' && item.message.type === 'user_text'
                      ? item.message.serverId
                      : undefined
                  }
                >
                  {getItemContent(index, item)}
                </div>
              )
            ))}
            <ListFooter
              bottomSpacerHeight={bottomSpacerHeight}
            />
          </div>
        </div>
      )}

      {!showEmptyOverlay && (
        <MessageAnchorRail
          anchors={messageAnchors}
          visibleRange={anchorVisibleRange}
          loadingAnchorId={anchorLoadingId}
          bottomInset={bottomOverlayHeight}
          onJump={handleAnchorJump}
        />
      )}

      {showScrollJumpButton && (
        <button
          type="button"
          aria-label={scrollJumpLabel}
          title={scrollJumpLabel}
          data-testid="chat-scroll-jump"
          onClick={handleScrollJumpClick}
          className="absolute right-[18px] z-10 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)]/55 bg-[var(--color-surface-container-high)]/55 text-[var(--color-text-tertiary)] opacity-75 shadow-[0_7px_15px_rgba(0,0,0,0.075)] backdrop-blur-md transition hover:-translate-y-px hover:border-[var(--color-text-tertiary)]/70 hover:bg-[var(--color-surface-container-high)]/78 hover:text-[var(--color-text-primary)] hover:opacity-95 active:translate-y-0"
          style={{ bottom: Math.max(18, Math.ceil(bottomOverlayHeight) + 18) }}
        >
          <span className="grid h-[15px] w-[15px] place-items-center">
            <Icon
              name={isAtBottom ? 'arrow_upward' : 'arrow_downward'}
              size={15}
              style={{ transform: isAtBottom ? 'translateY(0.5px)' : 'translateY(-0.5px)' }}
            />
          </span>
        </button>
      )}

      <Modal
        open={Boolean(rewindTarget)}
        onClose={closeRewindModal}
        title={t('chat.rewindModalTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={closeRewindModal} disabled={isExecutingRewind}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => { void handleConfirmRewind() }}
              loading={isExecutingRewind}
              disabled={isLoadingPreview || Boolean(rewindError)}
              icon={
                !isExecutingRewind ? (
                  <Icon name="undo" size={16} />
                ) : undefined
              }
            >
              {t('chat.rewindConfirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
              {t('chat.rewindPromptLabel')}
            </div>
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--color-text-primary)]">
              {rewindTarget?.content || t('chat.rewindAttachmentOnly')}
            </div>
          </div>

          {isLoadingPreview && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
              {t('chat.rewindLoading')}
            </div>
          )}

          {!isLoadingPreview && rewindPreview && (
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                  <Icon name="history" size={16} className="text-[var(--color-brand)]" />
                  {t('chat.rewindConversationCardTitle')}
                </div>
                <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  {t('chat.rewindConversationCardBody', { count: rewindPreview.conversation.messagesRemoved })}
                </p>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                  <Icon name="code" size={16} className="text-[var(--color-brand)]" />
                  {t('chat.rewindCodeCardTitle')}
                </div>
                {rewindPreview.code.available ? (
                  <div className="space-y-1 text-sm text-[var(--color-text-secondary)]">
                    <div>{t('chat.rewindCodeFiles', { count: rewindPreview.code.filesChanged.length })}</div>
                    <div>{t('chat.rewindCodeInsertions', { count: rewindPreview.code.insertions })}</div>
                    <div>{t('chat.rewindCodeDeletions', { count: rewindPreview.code.deletions })}</div>
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                    {rewindPreview.code.reason || t('chat.rewindCodeUnavailable')}
                  </p>
                )}
              </div>
            </div>
          )}

          {!isLoadingPreview && rewindPreview?.code.available && rewindPreview.code.filesChanged.length > 0 && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
                {t('chat.rewindFilesLabel')}
              </div>
              <div className="flex flex-wrap gap-2">
                {rewindPreview.code.filesChanged.slice(0, 8).map((filePath) => (
                  <span key={filePath} className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)]">
                    {filePath}
                  </span>
                ))}
                {rewindPreview.code.filesChanged.length > 8 && (
                  <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)]">
                    {t('chat.rewindFilesMore', { count: rewindPreview.code.filesChanged.length - 8 })}
                  </span>
                )}
              </div>
            </div>
          )}

          {rewindError && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-error)]/30 bg-[var(--color-error-container)]/22 px-4 py-3 text-sm text-[var(--color-error)]">
              {rewindError}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

/** Virtuoso Header: keeps the first bubble breathing below the top chrome. */
function ListHeader({ isLoadingMoreHistory }: { isLoadingMoreHistory: boolean }) {
  const t = useTranslation()
  return (
    <>
      <div className="h-[10px] shrink-0" />
      {isLoadingMoreHistory && (
        <div className="flex items-center justify-center py-3">
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-tertiary)]">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-text-secondary)]" />
            <span>{t('chat.historyLoadMore')}</span>
          </div>
        </div>
      )}
    </>
  )
}

/** Native list footer: keeps the final message clear of the composer. */
function ListFooter({
  bottomSpacerHeight,
}: {
  bottomSpacerHeight: number
}) {
  return (
    <div className="shrink-0" style={{ height: bottomSpacerHeight }} />
  )
}

export const MessageBlock = memo(function MessageBlock({
  message,
  toolCalls,
  activityToolCalls,
  toolResultMap,
  childToolCallsByParent,
  agentTaskNotifications,
  toolResult,
  isToolExecutionActive,
  keepToolActivityExpanded,
  isThinkingActive,
  isStreaming,
  onStreamingSettled,
  rewindableUserIndex,
  rewindableUserOffsetFromEnd,
  onRequestRewind,
  onRequestBranch,
  isBranching,
  branchDisabled,
  anchorHighlightToken,
}: {
  message: UIMessage
  toolCalls?: ToolCall[]
  activityToolCalls?: ToolCall[]
  toolResultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  agentTaskNotifications: Record<string, AgentTaskNotification>
  toolResult?: { content: unknown; isError: boolean } | null
  isToolExecutionActive?: boolean
  keepToolActivityExpanded?: boolean
  isThinkingActive?: boolean
  isStreaming?: boolean
  onStreamingSettled?: () => void
  rewindableUserIndex?: number | null
  rewindableUserOffsetFromEnd?: number | null
  onRequestRewind?: (
    message: Extract<UIMessage, { type: 'user_text' }>,
    userMessageIndex: number,
    userMessageOffsetFromEnd: number,
  ) => void
  onRequestBranch?: (
    message: Extract<UIMessage, { type: 'assistant_text' }>,
    attachedToolCalls?: ToolCall[],
  ) => void
  isBranching?: boolean
  branchDisabled?: boolean
  anchorHighlightToken?: number
}) {
  const t = useTranslation()

  const wrapInChatColumn = (content: React.ReactNode, className = '') => (
    <div className="flex w-full justify-center px-[24px] py-[8px]">
      <div data-chat-content-column className={`w-full max-w-[878px] ${className}`}>
        {content}
      </div>
    </div>
  )

  // Wrap non-user/assistant messages in iMessage-style assistant bubble
  const wrapInAssistantBubble = (content: React.ReactNode) => wrapInChatColumn(
    <div className="chat-bubble-text w-fit max-w-[85%] rounded-[24px] rounded-bl-[8px] border border-[var(--color-border)] bg-[var(--color-message-assistant-bg)] px-[18px] py-[12px] text-[14px] font-normal leading-relaxed tracking-normal text-[var(--color-text-primary)]">
      {content}
    </div>,
    'flex flex-col items-start',
  )

  switch (message.type) {
    case 'user_text':
      return (
        <UserMessage
          content={message.content}
          attachments={message.attachments}
          onRewind={
            typeof rewindableUserIndex === 'number' && onRequestRewind
              ? () => onRequestRewind(
                  message,
                  rewindableUserIndex,
                  rewindableUserOffsetFromEnd ?? 0,
                )
              : undefined
          }
          rewindLabel={t('chat.rewindAction')}
          anchorHighlightToken={anchorHighlightToken}
        />
      )
    case 'assistant_text':
      if (!isStreaming && isErrorLikeAssistantText(message.content)) {
        return <ErrorMessageBubble displayMessage={message.content} />
      }
      return (
        <AssistantMessage
          content={message.content}
          isStreaming={isStreaming}
          onStreamingSettled={onStreamingSettled}
          toolCalls={activityToolCalls}
          resultMap={toolResultMap}
          childToolCallsByParent={childToolCallsByParent}
          agentTaskNotifications={agentTaskNotifications}
          isToolExecutionActive={isToolExecutionActive}
          keepToolActivityExpanded={keepToolActivityExpanded}
          onBranch={onRequestBranch ? () => onRequestBranch(message, toolCalls) : undefined}
          branchLabel={t('chat.branchAction')}
          branchDisabledLabel={t('chat.branchWaitForReply')}
          isBranching={isBranching}
          branchDisabled={branchDisabled}
        />
      )
    case 'thinking':
      return (
        <FloatingThinkingPanel
          content={message.content}
          isActive={isThinkingActive}
          identityKey={message.id}
        />
      )
    case 'tool_use':
      if (message.toolName === 'AskUserQuestion') {
        return wrapInAssistantBubble(
          <AskUserQuestion
            toolUseId={message.toolUseId}
            input={message.input}
            result={toolResult?.content}
          />
        )
      }
      return wrapInAssistantBubble(
        <ToolCallBlock
          toolName={message.toolName}
          input={message.input}
          result={toolResult}
          running={Boolean(isToolExecutionActive) && !toolResult}
          agentTaskNotification={
            message.toolName === 'Agent'
              ? agentTaskNotifications[message.toolUseId]
              : undefined
          }
        />
      )
    case 'tool_result':
      return wrapInChatColumn(
        <ToolResultBlock content={message.content} isError={message.isError} standalone />,
      )
    case 'permission_request':
      return wrapInChatColumn(
        <PermissionDialog
          requestId={message.requestId}
          toolName={message.toolName}
          input={message.input}
          description={message.description}
        />,
      )
    case 'error': {
      const errorKey = message.code ? `error.${message.code}` as TranslationKey : null
      const errorText = errorKey ? t(errorKey) : null
      const displayMessage = (errorText && errorText !== errorKey) ? errorText : message.message
      const showRawDetail =
        message.code !== 'MODEL_NO_RESPONSE'
        && Boolean(message.message)
        && message.message.trim() !== ''
        && message.message !== displayMessage
      return (
        <ErrorMessageBubble
          displayMessage={displayMessage}
          rawDetail={showRawDetail ? message.message : undefined}
        />
      )
    }
    case 'task_summary':
      return wrapInChatColumn(<InlineTaskSummary tasks={message.tasks} />)
    case 'system':
      return wrapInChatColumn(
        <div className="mb-3 text-center text-xs text-[var(--color-text-tertiary)]">
          {message.content}
        </div>,
      )
  }
})
