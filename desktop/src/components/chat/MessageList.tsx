import { useRef, useEffect, useMemo, memo, useState, useCallback, forwardRef, type CSSProperties } from 'react'
import { Virtuoso, type ScrollerProps, type VirtuosoHandle } from 'react-virtuoso'
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
import { AssistantMessage } from './AssistantMessage'
import { StreamingIndicator } from './StreamingIndicator'

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

type RenderItem =
  | { kind: 'tool_group'; toolCalls: ToolCall[]; id: string }
  | { kind: 'message'; message: UIMessage; toolCalls?: ToolCall[] }

type RenderModel = {
  renderItems: RenderItem[]
  toolResultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
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

export function buildRenderModel(messages: UIMessage[]): RenderModel {
  const items: RenderItem[] = []
  const toolResultMap = new Map<string, ToolResult>()
  const childToolCallsByParent = new Map<string, ToolCall[]>()
  const toolUseIds = new Set<string>()
  let pendingToolCalls: ToolCall[] = []

  const flushGroup = () => {
    if (pendingToolCalls.length > 0) {
      // Merge tool calls into the previous assistant_text item (attach to its bottom)
      const lastItem = items[items.length - 1]
      if (lastItem && lastItem.kind === 'message' && lastItem.message.type === 'assistant_text') {
        lastItem.toolCalls = [...(lastItem.toolCalls ?? []), ...pendingToolCalls]
      } else {
        items.push({
          kind: 'tool_group',
          toolCalls: [...pendingToolCalls],
          id: `group-${pendingToolCalls[0]!.id}`,
        })
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
      items.push({ kind: 'message', message: msg })
    }
  }

  flushGroup()
  return { renderItems: items, toolResultMap, childToolCallsByParent }
}

function getRenderItemId(item: RenderItem): string {
  return item.kind === 'tool_group' ? item.id : item.message.id
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
      <div data-message-shell="error" className="flex w-full max-w-[878px] flex-col items-start">
        <div
          data-message-error
          className="chat-bubble-text w-fit max-w-full overflow-hidden rounded-[20px] rounded-tl-[8px] border border-[var(--color-error)]/20 bg-[var(--color-error-container)]/24 px-[20px] py-[14px] text-[14px] font-normal leading-relaxed tracking-normal [overflow-wrap:anywhere]"
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
  /** Forces Virtuoso to render this many items on the first render,
   * regardless of viewport size. Used for testing in jsdom. */
  __testInitialItemCount?: number
}

const MessageScroller = forwardRef<HTMLDivElement, ScrollerProps>(function MessageScroller({ style, ...props }, ref) {
  const safeStyle = sanitizeScrollerStyle(style)

  return (
    <div
      {...props}
      ref={ref}
      className="message-scrollbar scrollbar-no-track"
      style={{
        ...safeStyle,
        overflowY: 'scroll',
        scrollbarGutter: 'stable',
      }}
    />
  )
})

const MIN_BOTTOM_SPACER_HEIGHT = 176
const BOTTOM_SPACER_CLEARANCE = 8

function sanitizeScrollerStyle(style: CSSProperties | undefined): CSSProperties | undefined {
  if (!style) return undefined

  let hasInvalidValue = false
  const sanitized = { ...style }
  for (const key of Object.keys(sanitized) as Array<keyof CSSProperties>) {
    const value = sanitized[key]
    if (typeof value === 'number' && !Number.isFinite(value)) {
      delete sanitized[key]
      hasInvalidValue = true
    }
  }

  return hasInvalidValue ? sanitized : style
}

export function MessageList({ sessionId, projectPath, isActive: _isActive = true, bottomOverlayHeight = 0, __testInitialItemCount }: MessageListProps = {}) {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const resolvedSessionId = sessionId ?? activeTabId
  const sessionState = useChatStore((s) =>
    resolvedSessionId ? s.sessions[resolvedSessionId] : undefined,
  )
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const reloadHistory = useChatStore((s) => s.reloadHistory)
  const loadHistory = useChatStore((s) => s.loadHistory)
  const queueComposerPrefill = useChatStore((s) => s.queueComposerPrefill)
  const isMemberSession = useTeamStore((s) =>
    resolvedSessionId ? Boolean(s.getMemberBySessionId(resolvedSessionId)) : false,
  )
  const addToast = useUIStore((s) => s.addToast)

  const messages = sessionState?.messages ?? []
  const chatState = sessionState?.chatState ?? 'idle'
  const streamingText = sessionState?.streamingText ?? ''
  const activeThinkingId = sessionState?.activeThinkingId ?? null
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

  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const scrollerElementRef = useRef<HTMLElement | null>(null)
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  // Track whether the user is near the bottom of the list. Used to decide whether
  // auto-scroll during streaming is appropriate. If the user has scrolled up to
  // read history, we must NOT force them back to the bottom.
  const isNearBottomRef = useRef(true)
  const autoFollowCurrentTurnRef = useRef(false)
  const initialBottomKeyRef = useRef(listIdentity)
  const pendingInitialBottomRef = useRef(!__testInitialItemCount)
  const initialBottomRangeIncludesLastRef = useRef(false)
  const initialBottomLayoutVersionRef = useRef(0)
  const initialBottomScrollRafRef = useRef<number | null>(null)
  const initialBottomCompleteFirstRafRef = useRef<number | null>(null)
  const initialBottomCompleteSecondRafRef = useRef<number | null>(null)
  const initialBottomCompleteThirdRafRef = useRef<number | null>(null)
  const streamingFollowRafRef = useRef<number | null>(null)

  const t = useTranslation()
  const [rewindTarget, setRewindTarget] = useState<{
    messageId: string
    userMessageIndex: number
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
    if (resolvedSessionId && historyLoadState === 'idle') {
      void loadHistory(resolvedSessionId, projectPath)
    }
  }, [resolvedSessionId, projectPath, historyLoadState, loadHistory])

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
      chatState === 'tool_executing' &&
      toolCalls.some((toolCall) =>
        toolCallTreeHasPendingResult(
          toolCall,
          pendingToolUseIds,
          childToolCallsByParent,
        ),
      ),
    [chatState, childToolCallsByParent, pendingToolUseIds],
  )
  const renderItems = useMemo(
    () => renderModel.renderItems.filter(
      (item) => !(item.kind === 'message' && item.message.type === 'thinking'),
    ),
    [renderModel.renderItems],
  )
  const renderItemsLengthRef = useRef(renderItems.length)
  renderItemsLengthRef.current = renderItems.length
  const latestRenderItem = renderItems[renderItems.length - 1]
  const latestRenderItemKey = latestRenderItem
    ? `${listIdentity}:${getRenderItemId(latestRenderItem)}`
    : `${listIdentity}:empty`
  const latestRenderItemIsUserMessage = latestRenderItem?.kind === 'message' && latestRenderItem.message.type === 'user_text'
  const latestRenderItemKeyRef = useRef(latestRenderItemKey)

  // Standard order: oldest at top, newest at bottom.
  // firstItemIndex starts at 0 and DECREASES when older history is prepended at the
  // top (or INCREASES when the head is trimmed by loadMoreRecent), so Virtuoso can
  // keep the viewport anchored without any visible jump.
  //
  // IMPORTANT: firstItemIndex must be computed SYNCHRONOUSLY during render (not in a
  // useEffect). Updating it in an effect creates a one-frame gap where Virtuoso sees
  // the new data with the old index, causing a scroll jump that can pull the viewport
  // back to the bottom.
  const firstItemIndexRef = useRef(0)
  const prevRenderItemsRef = useRef<RenderItem[]>([])
  const listIdentityRef = useRef(listIdentity)

  if (listIdentityRef.current !== listIdentity) {
    listIdentityRef.current = listIdentity
    initialBottomKeyRef.current = listIdentity
    firstItemIndexRef.current = 0
    prevRenderItemsRef.current = []
    pendingInitialBottomRef.current = !__testInitialItemCount
    initialBottomRangeIncludesLastRef.current = false
    initialBottomLayoutVersionRef.current = 0
    isNearBottomRef.current = true
    autoFollowCurrentTurnRef.current = false
  }

  // Compute firstItemIndex synchronously during render.
  // firstItemIndex must reflect the actual change in renderItems (the data Virtuoso sees),
  // not the raw messages array, because buildRenderModel collapses tool_use items.
  const prevRenderItems = prevRenderItemsRef.current
  if (
    renderItems.length > 0 &&
    prevRenderItems.length > 0 &&
    getRenderItemId(renderItems[0]!) !== getRenderItemId(prevRenderItems[0]!)
  ) {
    const oldFirstId = getRenderItemId(prevRenderItems[0]!)
    let oldFirstIndex = -1
    for (let i = 0; i < renderItems.length; i++) {
      if (getRenderItemId(renderItems[i]!) === oldFirstId) {
        oldFirstIndex = i
        break
      }
    }
    if (oldFirstIndex > 0) {
      // Older render items were prepended — shift firstItemIndex down.
      firstItemIndexRef.current -= oldFirstIndex
    } else if (oldFirstIndex === -1) {
      // The previous first item disappeared (head trimmed by loadMoreRecent).
      // Find where the new first item was in the old array and shift up.
      const newFirstId = getRenderItemId(renderItems[0]!)
      let newFirstIndex = -1
      for (let i = 0; i < prevRenderItems.length; i++) {
        if (getRenderItemId(prevRenderItems[i]!) === newFirstId) {
          newFirstIndex = i
          break
        }
      }
      if (newFirstIndex > 0) {
        firstItemIndexRef.current += newFirstIndex
      }
    }
  }

  prevRenderItemsRef.current = renderItems

  const firstItemIndex = firstItemIndexRef.current

  // Capture the initial scroll target at mount time. Virtuoso renders at this
  // position on the FIRST frame — no scroll animation, no flash. For sessions
  // where data is pre-loaded (cached switch or AppShell bootstrap), this lands
  // at the last (newest) message immediately. For async-loaded sessions
  // (renderItems.length === 0 at mount), fall back to 0 (default top); then
  // followOutput handles scrolling to bottom once messages arrive.
  const initialScrollTarget = useMemo<number | { index: 'LAST'; align: 'end' }>(
    () => (
      __testInitialItemCount
        ? 0
        : renderItems.length > 0
          ? { index: 'LAST' as const, align: 'end' as const }
          : 0
    ),
    [__testInitialItemCount, listIdentity, renderItems.length],
  )

  const cancelInitialBottomFrames = useCallback(() => {
    if (initialBottomScrollRafRef.current !== null) {
      cancelAnimationFrame(initialBottomScrollRafRef.current)
      initialBottomScrollRafRef.current = null
    }
    if (initialBottomCompleteFirstRafRef.current !== null) {
      cancelAnimationFrame(initialBottomCompleteFirstRafRef.current)
      initialBottomCompleteFirstRafRef.current = null
    }
    if (initialBottomCompleteSecondRafRef.current !== null) {
      cancelAnimationFrame(initialBottomCompleteSecondRafRef.current)
      initialBottomCompleteSecondRafRef.current = null
    }
    if (initialBottomCompleteThirdRafRef.current !== null) {
      cancelAnimationFrame(initialBottomCompleteThirdRafRef.current)
      initialBottomCompleteThirdRafRef.current = null
    }
  }, [])

  const setScrollerRef = useCallback((ref: HTMLElement | Window | null) => {
    scrollerElementRef.current = ref && 'scrollTop' in ref ? ref : null
  }, [])

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

  const scrollScrollerToTop = useCallback((behavior: ScrollBehavior = 'auto') => {
    const scroller = scrollerElementRef.current
    if (!scroller) return

    if (behavior === 'auto' || typeof scroller.scrollTo !== 'function') {
      scroller.scrollTop = 0
      return
    }

    scroller.scrollTo({ top: 0, behavior })
  }, [])

  const scrollToLatest = useCallback((behavior: 'auto' | 'smooth' = 'auto', key = initialBottomKeyRef.current) => {
    if (key !== initialBottomKeyRef.current) return
    if (renderItemsLengthRef.current === 0) return
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior })
    if (behavior === 'auto') {
      virtuosoRef.current?.autoscrollToBottom()
    }
    requestAnimationFrame(() => {
      if (key !== initialBottomKeyRef.current) return
      scrollScrollerToBottom(behavior)
      if (behavior === 'auto') {
        requestAnimationFrame(() => {
          if (key !== initialBottomKeyRef.current) return
          scrollScrollerToBottom('auto')
        })
      }
    })
  }, [scrollScrollerToBottom])

  const scrollToEarliest = useCallback((behavior: 'auto' | 'smooth' = 'smooth') => {
    if (renderItemsLengthRef.current === 0) return
    virtuosoRef.current?.scrollToIndex({
      index: firstItemIndexRef.current,
      align: 'start',
      behavior,
    })
    requestAnimationFrame(() => scrollScrollerToTop(behavior))
  }, [scrollScrollerToTop])

  const completeInitialBottom = useCallback((key = initialBottomKeyRef.current) => {
    if (key !== initialBottomKeyRef.current) return
    if (!pendingInitialBottomRef.current) return
    pendingInitialBottomRef.current = false
    initialBottomRangeIncludesLastRef.current = false
    isNearBottomRef.current = true
    cancelInitialBottomFrames()
  }, [cancelInitialBottomFrames])

  const scheduleInitialBottomCompletion = useCallback((key = initialBottomKeyRef.current) => {
    if (key !== initialBottomKeyRef.current) return
    if (!pendingInitialBottomRef.current) return
    if (renderItemsLengthRef.current === 0) return
    if (!initialBottomRangeIncludesLastRef.current) return

    const layoutVersion = initialBottomLayoutVersionRef.current

    if (initialBottomCompleteFirstRafRef.current !== null) {
      cancelAnimationFrame(initialBottomCompleteFirstRafRef.current)
      initialBottomCompleteFirstRafRef.current = null
    }
    if (initialBottomCompleteSecondRafRef.current !== null) {
      cancelAnimationFrame(initialBottomCompleteSecondRafRef.current)
      initialBottomCompleteSecondRafRef.current = null
    }
    if (initialBottomCompleteThirdRafRef.current !== null) {
      cancelAnimationFrame(initialBottomCompleteThirdRafRef.current)
      initialBottomCompleteThirdRafRef.current = null
    }

    initialBottomCompleteFirstRafRef.current = requestAnimationFrame(() => {
      initialBottomCompleteFirstRafRef.current = null
      if (key !== initialBottomKeyRef.current || !pendingInitialBottomRef.current) return
      if (layoutVersion !== initialBottomLayoutVersionRef.current) return

      initialBottomCompleteSecondRafRef.current = requestAnimationFrame(() => {
        initialBottomCompleteSecondRafRef.current = null
        if (key !== initialBottomKeyRef.current || !pendingInitialBottomRef.current) return
        if (layoutVersion !== initialBottomLayoutVersionRef.current) return

        scrollToLatest('auto', key)

        initialBottomCompleteThirdRafRef.current = requestAnimationFrame(() => {
          initialBottomCompleteThirdRafRef.current = null
          if (key !== initialBottomKeyRef.current) return
          if (layoutVersion !== initialBottomLayoutVersionRef.current) return
          completeInitialBottom(key)
        })
      })
    })
  }, [completeInitialBottom, scrollToLatest])

  const scheduleInitialBottomScroll = useCallback((key = initialBottomKeyRef.current) => {
    if (key !== initialBottomKeyRef.current) return
    if (!pendingInitialBottomRef.current) return
    if (renderItemsLengthRef.current === 0) return

    if (initialBottomScrollRafRef.current !== null) {
      cancelAnimationFrame(initialBottomScrollRafRef.current)
      initialBottomScrollRafRef.current = null
    }

    initialBottomScrollRafRef.current = requestAnimationFrame(() => {
      initialBottomScrollRafRef.current = null
      if (key !== initialBottomKeyRef.current || !pendingInitialBottomRef.current) return
      scrollToLatest('auto', key)

      initialBottomScrollRafRef.current = requestAnimationFrame(() => {
        initialBottomScrollRafRef.current = null
        if (key !== initialBottomKeyRef.current || !pendingInitialBottomRef.current) return
        scrollToLatest('auto', key)
        scheduleInitialBottomCompletion(key)
      })
    })
  }, [scheduleInitialBottomCompletion, scrollToLatest])

  useEffect(() => {
    return () => cancelInitialBottomFrames()
  }, [listIdentity, cancelInitialBottomFrames])

  // On a session switch, keep the list locked to the newest message until
  // Virtuoso has data, has rendered the last row, and its measured height has
  // settled. This prevents cached sessions, async-loaded sessions, and tall
  // markdown/tool-result sessions from landing at different scroll positions.
  useEffect(() => {
    if (__testInitialItemCount) return
    const key = listIdentity
    if (renderItems.length === 0) {
      if (historyLoadState === 'loaded') {
        completeInitialBottom(key)
      }
      return
    }

    if (!pendingInitialBottomRef.current) return
    isNearBottomRef.current = true
    initialBottomLayoutVersionRef.current += 1
    scheduleInitialBottomScroll(key)
  }, [
    listIdentity,
    renderItems.length,
    historyLoadState,
    __testInitialItemCount,
    completeInitialBottom,
    scheduleInitialBottomScroll,
  ])

  useEffect(() => {
    if (__testInitialItemCount) return
    if (renderItems.length === 0) return
    if (!pendingInitialBottomRef.current && !isNearBottomRef.current && !autoFollowCurrentTurnRef.current) return

    initialBottomLayoutVersionRef.current += 1
    if (pendingInitialBottomRef.current) {
      scheduleInitialBottomScroll(listIdentity)
      return
    }

    requestAnimationFrame(() => scrollToLatest('auto', listIdentity))
  }, [
    __testInitialItemCount,
    bottomSpacerHeight,
    listIdentity,
    renderItems.length,
    scheduleInitialBottomScroll,
    scrollToLatest,
  ])

  useEffect(() => {
    const previousLatestKey = latestRenderItemKeyRef.current
    latestRenderItemKeyRef.current = latestRenderItemKey
    if (previousLatestKey === latestRenderItemKey) return
    if (!latestRenderItemIsUserMessage) return

    isNearBottomRef.current = true
    autoFollowCurrentTurnRef.current = true
    requestAnimationFrame(() => scrollToLatest('smooth', listIdentity))
  }, [
    latestRenderItemIsUserMessage,
    latestRenderItemKey,
    listIdentity,
    scrollToLatest,
  ])

  // Track previous chatState so we can detect the exact moment the AI starts
  // responding (idle -> streaming/thinking/tool_executing) and scroll immediately.
  const prevChatStateRef = useRef(chatState)
  useEffect(() => {
    const prevChatState = prevChatStateRef.current
    prevChatStateRef.current = chatState

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
    if (chatState !== 'idle' && streamingText && (isNearBottomRef.current || autoFollowCurrentTurnRef.current)) {
      if (streamingFollowRafRef.current !== null) return
      const key = initialBottomKeyRef.current
      streamingFollowRafRef.current = requestAnimationFrame(() => {
        streamingFollowRafRef.current = null
        if (!isNearBottomRef.current && !autoFollowCurrentTurnRef.current) return
        scrollToLatest('auto', key)
      })
    }
  }, [streamingText, chatState, scrollToLatest])

  useEffect(() => () => {
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

  // Load older history when user scrolls to the TOP (startReached).
  const handleStartReached = useCallback(() => {
    if (pendingInitialBottomRef.current) return
    if (!resolvedSessionId || isLoadingMoreHistory) return
    if (allMessagesLoaded && (sessionState?.historyBuffer?.length ?? 0) === 0) return
    setIsLoadingMoreHistory(true)
    loadMoreHistory(resolvedSessionId).finally(() => setIsLoadingMoreHistory(false))
  }, [resolvedSessionId, allMessagesLoaded, sessionState?.historyBuffer?.length, isLoadingMoreHistory, loadMoreHistory])

  // Restore newer messages when user scrolls to the BOTTOM (endReached).
  const handleEndReached = useCallback(() => {
    if (!resolvedSessionId || recentBuffer.length === 0) return
    loadMoreRecent(resolvedSessionId)
  }, [resolvedSessionId, recentBuffer.length, loadMoreRecent])

  const handleRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    if (!pendingInitialBottomRef.current) return
    const lastItemIndex = firstItemIndexRef.current + renderItemsLengthRef.current - 1
    if (renderItemsLengthRef.current > 0 && range.endIndex >= lastItemIndex) {
      initialBottomRangeIncludesLastRef.current = true
      scheduleInitialBottomScroll()
    }
  }, [scheduleInitialBottomScroll])

  const handleItemsRendered = useCallback((items: Array<{ index: number }>) => {
    if (!pendingInitialBottomRef.current) return
    const lastItemIndex = firstItemIndexRef.current + renderItemsLengthRef.current - 1
    if (renderItemsLengthRef.current > 0 && items.some((item) => item.index >= lastItemIndex)) {
      initialBottomRangeIncludesLastRef.current = true
      scheduleInitialBottomScroll()
    }
  }, [scheduleInitialBottomScroll])

  const handleAtBottomStateChange = useCallback((isAtBottom: boolean) => {
    setIsAtBottom(isAtBottom)
    if (pendingInitialBottomRef.current) {
      isNearBottomRef.current = true
      if (isAtBottom) {
        scheduleInitialBottomCompletion()
      } else {
        scheduleInitialBottomScroll()
      }
      return
    }
    isNearBottomRef.current = autoFollowCurrentTurnRef.current ? true : isAtBottom
  }, [scheduleInitialBottomCompletion, scheduleInitialBottomScroll])

  const handleScrollJumpClick = useCallback(() => {
    if (isAtBottom) {
      pendingInitialBottomRef.current = false
      cancelInitialBottomFrames()
      autoFollowCurrentTurnRef.current = false
      isNearBottomRef.current = false
      setIsAtBottom(false)
      scrollToEarliest('smooth')
      return
    }

    autoFollowCurrentTurnRef.current = chatState !== 'idle'
    isNearBottomRef.current = true
    setIsAtBottom(true)
    scrollToLatest('smooth')
  }, [cancelInitialBottomFrames, chatState, isAtBottom, scrollToEarliest, scrollToLatest])

  const handleTotalListHeightChanged = useCallback(() => {
    if (!pendingInitialBottomRef.current) return
    initialBottomLayoutVersionRef.current += 1
    scheduleInitialBottomScroll()
  }, [scheduleInitialBottomScroll])

  const getItemContent = useCallback(
    (index: number, item: RenderItem | undefined) => {
      if (!item) return <div />
      // dataIndex is 0-based into the renderItems array (chronological order).
      const dataIndex = index - firstItemIndex

      // Fallback: standalone tool_group that wasn't merged into an assistant message.
      if (item.kind === 'tool_group') {
        return (
          <div className="flex w-full justify-center px-[24px] py-[8px]">
            <div className="w-full max-w-[878px]">
              <ToolCallGroup
                toolCalls={item.toolCalls}
                resultMap={toolResultMap}
                childToolCallsByParent={childToolCallsByParent}
                agentTaskNotifications={agentTaskNotifications}
                isStreaming={isToolExecutionActiveFor(item.toolCalls)}
              />
            </div>
          </div>
        )
      }

      const msg = item.message
      // Count user_text messages that appear before this one in chronological order.
      const userMsgCount = renderItems
        .slice(0, dataIndex)
        .filter((i) => i.kind === 'message' && i.message.type === 'user_text' && !i.message.pending)
        .length
      const rewindableUserIndex = msg.type === 'user_text' && !msg.pending ? userMsgCount : null

      return (
        <div className="px-0 py-0">
          <MessageBlock
            message={msg}
            toolCalls={item.toolCalls}
            toolResultMap={toolResultMap}
            childToolCallsByParent={childToolCallsByParent}
            agentTaskNotifications={agentTaskNotifications}
            isToolExecutionActive={isToolExecutionActiveFor(
              item.toolCalls ?? (msg.type === 'tool_use' ? [msg] : []),
            )}
            toolResult={
              msg.type === 'tool_use'
                ? (() => {
                    const r = toolResultMap.get(msg.toolUseId)
                    return r ? { content: r.content, isError: r.isError } : null
                  })()
                : null
            }
            rewindableUserIndex={rewindableUserIndex}
            onRequestRewind={
              !isMemberSession
                ? (message, userMessageIndex) => {
                    setRewindTarget({
                      messageId: message.id,
                      userMessageIndex,
                      content: message.content,
                      attachments: message.attachments,
                    })
                  }
                : undefined
            }
            onRequestBranch={!isMemberSession ? handleCreateBranch : undefined}
            isBranching={branchingMessageId === msg.id}
            branchDisabled={chatState !== 'idle'}
          />
        </div>
      )
    },
    [
      renderItems,
      firstItemIndex,
      toolResultMap,
      childToolCallsByParent,
      agentTaskNotifications,
      chatState,
      activeThinkingId,
      isMemberSession,
      isToolExecutionActiveFor,
      handleCreateBranch,
      branchingMessageId,
    ],
  )

  // Error / loading states are shown outside Virtuoso when there are no messages
  const showEmptyOverlay = messages.length === 0 && historyLoadState !== 'loaded'
  const showScrollJumpButton = !showEmptyOverlay && (renderItems.length > 1 || streamingText.length > 0)
  const scrollJumpLabel = isAtBottom ? t('chat.scrollToTop') : t('chat.scrollToBottom')
  const footerComponent = useMemo(() => function StableListFooter() {
    return (
      <ListFooter
        sessionId={resolvedSessionId}
        bottomSpacerHeight={bottomSpacerHeight}
      />
    )
  }, [bottomSpacerHeight, resolvedSessionId])

  return (
    <div className="wechat-chat-bg scrollbar-no-track relative flex flex-1 flex-col overflow-hidden">
      {showEmptyOverlay && historyLoadState === 'error' && (
        <div className="mx-auto my-6 flex max-w-[420px] flex-col items-center gap-3 rounded-[10px] border-2 border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-5 py-5 text-center">
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">聊天记录加载失败</div>
          <div className="text-[12px] text-[var(--color-text-tertiary)]">网络或服务可能短暂不可用，可以重试。</div>
          <button
            type="button"
            onClick={() => resolvedSessionId && void loadHistory(resolvedSessionId, projectPath)}
            className="px-4 py-1.5 text-[12px] font-bold tracking-tight text-white bg-[#FE2C55] rounded-[6px] shadow-[0_2px_8px_rgba(254,44,85,0.25)] hover:bg-[#E91E45] transition-colors"
          >
            重新加载
          </button>
        </div>
      )}

      {showEmptyOverlay && historyLoadState === 'idle' && (
        <div className="mx-auto my-6 flex max-w-[420px] flex-col items-center gap-2 text-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-text-secondary)]" />
          <div className="text-[12px] text-[var(--color-text-tertiary)]">准备加载聊天记录…</div>
        </div>
      )}

      {showEmptyOverlay && historyLoadState === 'loading' && (
        <div className="mx-auto my-6 flex max-w-[420px] flex-col items-center gap-2 text-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-text-secondary)]" />
          <div className="text-[12px] text-[var(--color-text-tertiary)]">加载会话历史…</div>
        </div>
      )}

      {!showEmptyOverlay && (
        <Virtuoso
          key={listIdentity}
          ref={virtuosoRef}
          data={renderItems}
          firstItemIndex={firstItemIndex}
          itemContent={getItemContent}
          initialTopMostItemIndex={initialScrollTarget}
          startReached={handleStartReached}
          endReached={handleEndReached}
          rangeChanged={handleRangeChanged}
          itemsRendered={handleItemsRendered}
          atBottomStateChange={handleAtBottomStateChange}
          totalListHeightChanged={handleTotalListHeightChanged}
          scrollerRef={setScrollerRef}
          followOutput={(isAtBottom) => {
            // Track whether the user is near the bottom for other scroll effects.
            isNearBottomRef.current = pendingInitialBottomRef.current || autoFollowCurrentTurnRef.current ? true : isAtBottom
            if (pendingInitialBottomRef.current) return 'auto'
            // Always respect the user's scroll position. If they scrolled up to
            // read history, don't force them back to the bottom — even during
            // streaming. When they're at the bottom, follow output smoothly.
            return isAtBottom || autoFollowCurrentTurnRef.current ? 'smooth' : false
          }}
          increaseViewportBy={{ top: 400, bottom: 400 }}
          initialItemCount={__testInitialItemCount}
          style={{ height: '100%' }}
          components={{
            Scroller: MessageScroller,
            Header: () => <ListHeader isLoadingMoreHistory={isLoadingMoreHistory} />,
            Footer: footerComponent,
          }}
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
  return (
    <>
      <div className="h-[10px] shrink-0" />
      {isLoadingMoreHistory && (
        <div className="flex items-center justify-center py-3">
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-tertiary)]">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-text-secondary)]" />
            <span>加载更多记录…</span>
          </div>
        </div>
      )}
    </>
  )
}

/** Virtuoso Footer: streaming text and composer spacer. */
function ListFooter({
  sessionId,
  bottomSpacerHeight,
}: {
  sessionId?: string | null
  bottomSpacerHeight: number
}) {
  const sessionState = useChatStore((state) => sessionId ? state.sessions[sessionId] : undefined)
  const streamingText = sessionState?.streamingText ?? ''
  const chatState = sessionState?.chatState ?? 'idle'

  return (
    <div>
      <StreamingIndicator sessionId={sessionId ?? undefined} />
      {streamingText && (
        <AssistantMessage content={streamingText} isStreaming={chatState === 'streaming'} />
      )}
      <div className="shrink-0" style={{ height: bottomSpacerHeight }} />
    </div>
  )
}

export const MessageBlock = memo(function MessageBlock({
  message,
  toolCalls,
  toolResultMap,
  childToolCallsByParent,
  agentTaskNotifications,
  toolResult,
  isToolExecutionActive,
  rewindableUserIndex,
  onRequestRewind,
  onRequestBranch,
  isBranching,
  branchDisabled,
}: {
  message: UIMessage
  toolCalls?: ToolCall[]
  toolResultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  agentTaskNotifications: Record<string, AgentTaskNotification>
  toolResult?: { content: unknown; isError: boolean } | null
  isToolExecutionActive?: boolean
  rewindableUserIndex?: number | null
  onRequestRewind?: (
    message: Extract<UIMessage, { type: 'user_text' }>,
    userMessageIndex: number,
  ) => void
  onRequestBranch?: (
    message: Extract<UIMessage, { type: 'assistant_text' }>,
    attachedToolCalls?: ToolCall[],
  ) => void
  isBranching?: boolean
  branchDisabled?: boolean
}) {
  const t = useTranslation()

  // Wrap non-user/assistant messages in iMessage-style assistant bubble
  const wrapInAssistantBubble = (content: React.ReactNode) => (
    <div className="flex w-full justify-center px-[24px] py-[8px]">
      <div className="flex w-full max-w-[878px] flex-col items-start">
        <div className="chat-bubble-text w-fit max-w-[85%] rounded-[24px] rounded-tl-[8px] border border-[var(--color-border)] bg-[var(--color-message-assistant-bg)] px-[24px] py-[16px] text-[15px] font-normal leading-relaxed tracking-normal text-[var(--color-text-primary)]">
          {content}
        </div>
      </div>
    </div>
  )

  switch (message.type) {
    case 'user_text':
      return (
        <UserMessage
          content={message.content}
          attachments={message.attachments}
          onRewind={
            typeof rewindableUserIndex === 'number' && onRequestRewind
              ? () => onRequestRewind(message, rewindableUserIndex)
              : undefined
          }
          rewindLabel={t('chat.rewindAction')}
        />
      )
    case 'assistant_text':
      if (isErrorLikeAssistantText(message.content)) {
        return <ErrorMessageBubble displayMessage={message.content} />
      }
      return (
        <AssistantMessage
          content={message.content}
          toolCalls={toolCalls}
          resultMap={toolResultMap}
          childToolCallsByParent={childToolCallsByParent}
          isToolExecutionActive={isToolExecutionActive}
          onBranch={onRequestBranch ? () => onRequestBranch(message, toolCalls) : undefined}
          branchLabel={t('chat.branchAction')}
          branchDisabledLabel={t('chat.branchWaitForReply')}
          isBranching={isBranching}
          branchDisabled={branchDisabled}
        />
      )
    case 'thinking':
      // Thinking is shown exclusively in the floating panel above the message list.
      // Never render it as a chat bubble in the message list.
      return null
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
      return <ToolResultBlock content={message.content} isError={message.isError} standalone />
    case 'permission_request':
      return (
        <PermissionDialog
          requestId={message.requestId}
          toolName={message.toolName}
          input={message.input}
          description={message.description}
        />
      )
    case 'error': {
      const errorKey = message.code ? `error.${message.code}` as TranslationKey : null
      const errorText = errorKey ? t(errorKey) : null
      const displayMessage = (errorText && errorText !== errorKey) ? errorText : message.message
      const showRawDetail =
        Boolean(message.message) && message.message.trim() !== '' && message.message !== displayMessage
      return (
        <ErrorMessageBubble
          displayMessage={displayMessage}
          rawDetail={showRawDetail ? message.message : undefined}
        />
      )
    }
    case 'task_summary':
      return <InlineTaskSummary tasks={message.tasks} />
    case 'system':
      return (
        <div className="mb-3 text-center text-xs text-[var(--color-text-tertiary)]">
          {message.content}
        </div>
      )
  }
})
