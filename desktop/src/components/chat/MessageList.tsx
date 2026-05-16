import { useRef, useEffect, useMemo, memo, useState, useCallback } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { ApiError } from '../../api/client'
import { sessionsApi, type SessionRewindResponse } from '../../api/sessions'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTeamStore } from '../../stores/teamStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n/locales/en'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'

import { ToolCallBlock } from './ToolCallBlock'
import { ToolResultBlock } from './ToolResultBlock'
import { PermissionDialog } from './PermissionDialog'
import { AskUserQuestion } from './AskUserQuestion'
import { InlineTaskSummary } from './InlineTaskSummary'
import type { AgentTaskNotification, UIMessage } from '../../types/chat'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { Icon } from '../shared/Icon'

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

type MessageListProps = {
  sessionId?: string | null
  projectPath?: string
  isActive?: boolean
  /** Forces Virtuoso to render this many items on the first render,
   * regardless of viewport size. Used for testing in jsdom. */
  __testInitialItemCount?: number
}

export function MessageList({ sessionId, projectPath, isActive: _isActive = true, __testInitialItemCount }: MessageListProps = {}) {
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

  const virtuosoRef = useRef<VirtuosoHandle>(null)
  // Tracks which session has already received its initial scroll-to-bottom.
  // Resets on every (re)mount because the component is destroyed on session switch.
  const sessionScrolledRef = useRef<string | null>(null)
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false)
  // Track whether the user is near the bottom of the list. Used to decide whether
  // auto-scroll during streaming is appropriate. If the user has scrolled up to
  // read history, we must NOT force them back to the bottom.
  const isNearBottomRef = useRef(true)

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

  // Auto-load history when the component mounts for a session that hasn't
  // been loaded yet. Prevents the blank-screen scenario when switching tabs
  // or on first render before AppShell's bootstrap loadHistory completes.
  useEffect(() => {
    if (resolvedSessionId && historyLoadState === 'idle') {
      void loadHistory(resolvedSessionId, projectPath)
    }
  }, [resolvedSessionId, projectPath, historyLoadState, loadHistory])

  const { toolResultMap, childToolCallsByParent, renderItems } = useMemo(
    () => buildRenderModel(messages),
    [messages],
  )

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
  const initialScrollTarget = useRef<number | { index: number; align: 'end' }>(
    renderItems.length > 0
      ? { index: firstItemIndex + renderItems.length - 1, align: 'end' as const }
      : 0,
  )

  // Scroll to bottom (newest message) the first time data is available for this session.
  // Uses a per-mount ref so it fires exactly once per session instance — not on every
  // render, not when loadMoreHistory grows the list, not when streaming appends messages.
  // followOutput keeps the list at bottom for subsequent streaming messages.
  useEffect(() => {
    if (renderItems.length === 0) return
    if (sessionScrolledRef.current === resolvedSessionId) return
    sessionScrolledRef.current = resolvedSessionId
    const lastIndex = firstItemIndex + renderItems.length - 1
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index: lastIndex, align: 'end', behavior: 'auto' })
    })
  }, [resolvedSessionId, renderItems.length, firstItemIndex])

  // Track previous chatState so we can detect the exact moment the AI starts
  // responding (idle -> streaming/thinking/tool_executing) and scroll immediately.
  const prevChatStateRef = useRef(chatState)
  useEffect(() => {
    const prevChatState = prevChatStateRef.current
    prevChatStateRef.current = chatState

    // 1) AI just started responding — scroll to bottom only if the user was near
    //    the bottom. If the user was reading history (scrolled up), don't pull
    //    them back down — they can scroll down manually when ready.
    if (prevChatState === 'idle' && chatState !== 'idle') {
      if (isNearBottomRef.current) {
        requestAnimationFrame(() => {
          virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'smooth' })
        })
      }
      return
    }

    // 2) AI is actively streaming text — keep following ONLY if the user is near
    //    the bottom. If they scrolled up to read history, respect that.
    if (chatState !== 'idle' && streamingText && isNearBottomRef.current) {
      const timer = setTimeout(() => {
        virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'smooth' })
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [streamingText, chatState])


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

  // Load older history when user scrolls to the TOP (startReached).
  const handleStartReached = useCallback(() => {
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

  const getItemContent = useCallback(
    (index: number, item: RenderItem | undefined) => {
      if (!item) return <div />
      // dataIndex is 0-based into the renderItems array (chronological order).
      const dataIndex = index - firstItemIndex

      // Fallback: standalone tool_group that wasn't merged into an assistant message.
      if (item.kind === 'tool_group') {
        return <div className="px-4 py-2" />
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
            agentTaskNotifications={agentTaskNotifications}
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
    ],
  )

  // Error / loading states are shown outside Virtuoso when there are no messages
  const showEmptyOverlay = messages.length === 0 && historyLoadState !== 'loaded'

  return (
    <div className="flex-1 flex flex-col overflow-hidden wechat-chat-bg wechat-scrollbar">
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
          ref={virtuosoRef}
          data={renderItems}
          firstItemIndex={firstItemIndex}
          itemContent={getItemContent}
          initialTopMostItemIndex={initialScrollTarget.current}
          startReached={handleStartReached}
          endReached={handleEndReached}
          followOutput={(isAtBottom) => {
            // Track whether the user is near the bottom for other scroll effects.
            isNearBottomRef.current = isAtBottom
            // Always respect the user's scroll position. If they scrolled up to
            // read history, don't force them back to the bottom — even during
            // streaming. When they're at the bottom, follow output smoothly.
            return isAtBottom ? 'smooth' : false
          }}
          increaseViewportBy={{ top: 400, bottom: 400 }}
          initialItemCount={__testInitialItemCount}
          style={{ height: '100%' }}
          components={{
            Header: isLoadingMoreHistory ? LoadingMoreHistoryHeader : undefined,
            Footer: () => (
              <ListFooter
                streamingText={streamingText}
                chatState={chatState}
              />
            ),
          }}
        />
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

/** Virtuoso Header component: spinner shown while loading more history. */
function LoadingMoreHistoryHeader() {
  return (
    <div className="flex items-center justify-center py-3">
      <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-tertiary)]">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-text-secondary)]" />
        <span>加载更多记录…</span>
      </div>
    </div>
  )
}

/** Virtuoso Footer: streaming text and composer spacer. */
function ListFooter({
  streamingText,
  chatState,
}: {
  streamingText: string
  chatState: string
}) {
  return (
    <div>
      {streamingText && (
        <AssistantMessage content={streamingText} isStreaming={chatState === 'streaming'} />
      )}
      {/* Small spacer for visual breathing room */}
      <div className="h-4" />
    </div>
  )
}

export const MessageBlock = memo(function MessageBlock({
  message,
  toolCalls,
  toolResultMap,
  agentTaskNotifications,
  toolResult,
  rewindableUserIndex,
  onRequestRewind,
}: {
  message: UIMessage
  toolCalls?: ToolCall[]
  toolResultMap: Map<string, ToolResult>
  agentTaskNotifications: Record<string, AgentTaskNotification>
  toolResult?: { content: unknown; isError: boolean } | null
  rewindableUserIndex?: number | null
  onRequestRewind?: (
    message: Extract<UIMessage, { type: 'user_text' }>,
    userMessageIndex: number,
  ) => void
}) {
  const t = useTranslation()

  // Wrap non-user/assistant messages in iMessage-style assistant bubble
  const wrapInAssistantBubble = (content: React.ReactNode) => (
    <div className="flex justify-start w-full px-8 py-1">
      <div className="flex flex-col w-fit max-w-[75%]">
        <div className="bg-[var(--color-message-assistant-bg)] text-[var(--color-text-primary)] rounded-[20px] rounded-bl-[6px] px-4 py-2.5 border border-[var(--color-border-separator)] shadow-sm shadow-black/[0.03] dark:shadow-black/20">
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
      return (
        <AssistantMessage
          content={message.content}
          toolCalls={toolCalls}
          resultMap={toolResultMap}
        />
      )
    case 'thinking':
      // Thinking is shown exclusively in the floating ThinkingIndicator above ChatInput.
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
        <div className="mb-3 px-4 py-2.5 rounded-lg border border-[var(--color-error)]/20 bg-[var(--color-error-container)]/28 text-sm text-[var(--color-error)]">
          <strong>Error:</strong> {displayMessage}
          {showRawDetail && (
            <div className="mt-1 whitespace-pre-wrap text-xs text-[var(--color-on-error-container)]/85">
              {message.message}
            </div>
          )}
        </div>
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
