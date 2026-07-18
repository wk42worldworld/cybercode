import { useEffect, useRef, useState } from 'react'
import { useTabStore } from '../stores/tabStore'
import { useSessionStore } from '../stores/sessionStore'
import { useChatStore } from '../stores/chatStore'
import { useCLITaskStore } from '../stores/cliTaskStore'
import { useTeamStore } from '../stores/teamStore'
import { useTranslation } from '../i18n'
import type { UIMessage } from '../types/chat'
import { MessageList } from '../components/chat/MessageList'
import { ChatInput } from '../components/chat/ChatInput'
import { ComputerUsePermissionModal } from '../components/chat/ComputerUsePermissionModal'
import { TeamStatusBar } from '../components/teams/TeamStatusBar'
import { SessionTaskBar } from '../components/chat/SessionTaskBar'
import { FloatingThinkingPanel } from '../components/chat/FloatingThinkingPanel'
import { LongRunningNotice } from '../components/chat/LongRunningNotice'
import { PendingSteerBar } from '../components/chat/PendingSteerBar'

const TASK_POLL_INTERVAL_MS = 1000
const THINKING_RECENT_GRACE_MS = 3200
const RUNTIME_TRANSITION_STATUS_VERBS = new Set([
  'Switching provider and model...',
  'Restarting session with new permissions...',
])

type ActiveSessionProps = {
  sessionId?: string
  projectPath?: string
  isActive?: boolean
}

export function ActiveSession({ sessionId: sessionIdProp, projectPath, isActive = true }: ActiveSessionProps = {}) {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const activeTab = tabs.find((tab) => tab.sessionId === activeTabId)
  const sessionId = sessionIdProp ?? activeTabId
  const resolvedProjectPath = projectPath ?? activeTab?.projectPath
  const sessions = useSessionStore((s) => s.sessions)
  const ensureSessionReady = useChatStore((s) => s.ensureSessionReady)
  const sessionState = useChatStore((s) => sessionId ? s.sessions[sessionId] : undefined)
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const pendingComputerUsePermission = sessionState?.pendingComputerUsePermission ?? null
  const fetchSessionTasks = useCLITaskStore((s) => s.fetchSessionTasks)
  const trackedTaskSessionId = useCLITaskStore((s) => s.sessionId)
  const hasIncompleteTasks = useCLITaskStore((s) => s.tasks.some((task) => task.status !== 'completed'))
  const chatState = sessionState?.chatState ?? 'idle'
  const bottomOverlayRef = useRef<HTMLDivElement>(null)
  const composerShellRef = useRef<HTMLDivElement>(null)
  const [bottomOverlayHeight, setBottomOverlayHeight] = useState(0)
  const [composerHeight, setComposerHeight] = useState(0)

  const session = sessions.find((s) =>
    s.id === sessionId && (!resolvedProjectPath || s.projectPath === resolvedProjectPath),
  )
  const memberInfo = useTeamStore((s) => sessionId ? s.getMemberBySessionId(sessionId) : null)
  const activeTeam = useTeamStore((s) => s.activeTeam)
  const isMemberSession = !!memberInfo
  const historyNeedsLoading =
    sessionState?.historyLoadState === undefined ||
    sessionState.historyLoadState === 'idle'
  const needsSessionReady =
    !sessionState ||
    sessionState.connectionState === 'disconnected' ||
    historyNeedsLoading

  useEffect(() => {
    if (sessionId && !isMemberSession && isActive && needsSessionReady) {
      void ensureSessionReady(sessionId, resolvedProjectPath)
    }
  }, [sessionId, resolvedProjectPath, isActive, isMemberSession, needsSessionReady, ensureSessionReady])

  useEffect(() => {
    if (!sessionId || isMemberSession || !isActive) return

    const shouldPollTasks =
      chatState !== 'idle' ||
      (trackedTaskSessionId === sessionId && hasIncompleteTasks)

    if (!shouldPollTasks) return

    void fetchSessionTasks(sessionId)

    const timer = setInterval(() => {
      void fetchSessionTasks(sessionId)
    }, TASK_POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [
    sessionId,
    isActive,
    isMemberSession,
    chatState,
    trackedTaskSessionId,
    hasIncompleteTasks,
    fetchSessionTasks,
  ])

  useEffect(() => {
    const element = composerShellRef.current
    if (!element) return

    const updateComposerHeight = () => {
      setComposerHeight(element.getBoundingClientRect().height)
    }

    updateComposerHeight()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateComposerHeight)
    observer.observe(element)
    return () => observer.disconnect()
  }, [sessionId])

  useEffect(() => {
    const element = bottomOverlayRef.current
    if (!element) return

    const updateBottomOverlayHeight = () => {
      setBottomOverlayHeight(element.getBoundingClientRect().height)
    }

    updateBottomOverlayHeight()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateBottomOverlayHeight)
    observer.observe(element)
    return () => observer.disconnect()
  }, [sessionId, isMemberSession])

  const t = useTranslation()
  const messages = sessionState?.messages ?? []
  const activeThinkingId = sessionState?.activeThinkingId ?? null
  const streamingText = sessionState?.streamingText ?? ''
  const statusVerb = sessionState?.statusVerb ?? ''
  const isRuntimeTransitionStatus = RUNTIME_TRANSITION_STATUS_VERBS.has(statusVerb)

  let latestUserMessageIndex = -1
  let latestThinkingIndex = -1
  let latestAssistantTextIndex = -1
  let latestVisibleProgressIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) continue
    if (latestUserMessageIndex === -1 && message.type === 'user_text') latestUserMessageIndex = index
    if (latestThinkingIndex === -1 && message.type === 'thinking') latestThinkingIndex = index
    if (latestAssistantTextIndex === -1 && message.type === 'assistant_text') latestAssistantTextIndex = index
    if (
      latestVisibleProgressIndex === -1 &&
      (message.type === 'tool_use' || message.type === 'tool_result' || message.type === 'permission_request')
    ) {
      latestVisibleProgressIndex = index
    }
    if (
      latestUserMessageIndex !== -1 &&
      latestThinkingIndex !== -1 &&
      latestAssistantTextIndex !== -1 &&
      latestVisibleProgressIndex !== -1
    ) break
  }

  const latestUserMessage = latestUserMessageIndex >= 0
    ? messages[latestUserMessageIndex] as Extract<UIMessage, { type: 'user_text' }>
    : null
  const latestThinking = latestThinkingIndex >= 0
    ? messages[latestThinkingIndex] as Extract<UIMessage, { type: 'thinking' }>
    : null
  const latestThinkingBelongsToCurrentTurn =
    latestThinkingIndex >= 0 && (latestUserMessageIndex === -1 || latestThinkingIndex >= latestUserMessageIndex)
  const assistantBodyStartedForCurrentTurn =
    streamingText.length > 0 ||
    (latestAssistantTextIndex >= 0 && (latestUserMessageIndex === -1 || latestAssistantTextIndex >= latestUserMessageIndex))
  const visibleProgressForCurrentTurn =
    latestVisibleProgressIndex >= 0 &&
    (latestUserMessageIndex === -1 || latestVisibleProgressIndex >= latestUserMessageIndex)
  const latestThinkingIsFresh = latestThinking
    ? Date.now() - latestThinking.timestamp <= THINKING_RECENT_GRACE_MS
    : false
  const fallbackThinking =
    latestThinkingBelongsToCurrentTurn && (chatState !== 'idle' || latestThinkingIsFresh)
      ? latestThinking
      : null

  // Active thinking content for the floating indicator. The id can be cleared
  // by later stream events before the UI has had a chance to render it.
  const activeThinkingCandidateIndex = activeThinkingId
    ? messages.findIndex((m) => m.type === 'thinking' && m.id === activeThinkingId)
    : -1
  const activeThinkingCandidate = activeThinkingCandidateIndex >= 0
    ? messages[activeThinkingCandidateIndex] as Extract<UIMessage, { type: 'thinking' }>
    : null
  const thinkingPanelIdentityKey = `${sessionId}:${latestUserMessage?.id ?? 'initial'}`
  const isThinkingPanelDismissed =
    sessionState?.dismissedThinkingPanelIdentityKey === thinkingPanelIdentityKey
  const activeThinking =
    !isRuntimeTransitionStatus &&
    !isThinkingPanelDismissed &&
    activeThinkingCandidate &&
    (latestUserMessageIndex === -1 || activeThinkingCandidateIndex >= latestUserMessageIndex)
      ? activeThinkingCandidate
      : !isRuntimeTransitionStatus && !isThinkingPanelDismissed
        ? fallbackThinking
        : null
  const thinkingPanelIsActive =
    !isRuntimeTransitionStatus &&
    !isThinkingPanelDismissed &&
    chatState !== 'idle' &&
    !assistantBodyStartedForCurrentTurn
  const measuredBottomOverlayHeight = Math.max(bottomOverlayHeight, composerHeight)

  if (!sessionId) return null

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[var(--color-background)] text-[var(--color-text-primary)] transition-colors duration-150">

      {isMemberSession && (
        <div className="shrink-0 border-b border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)]">
          <div className="w-full px-[24px]">
            <div data-chat-content-column className="mx-auto flex w-full max-w-[878px] items-center justify-between gap-4 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  {memberInfo?.status === 'running' && (
                    <span className="flex h-2 w-2 rounded-full bg-[var(--color-brand)] animate-pulse" />
                  )}
                  {memberInfo?.status === 'completed' && (
                    <span className="text-[14px] text-[var(--color-success)]">✓</span>
                  )}
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {memberInfo?.role}
                  </span>
                  {activeTeam && (
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">
                      @ {activeTeam.name}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                  {t('teams.memberSessionHint')}
                </p>
              </div>
              <button
                onClick={() => {
                  if (activeTeam?.leadSessionId) {
                    useTabStore.getState().openTab(
                      activeTeam.leadSessionId,
                      t('teams.leader'),
                      'session',
                    )
                  }
                }}
                disabled={!activeTeam?.leadSessionId}
                className="flex shrink-0 items-center gap-1 px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50"
              >
                ← {t('teams.backToLeader')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* MessageList is ALWAYS mounted — never conditionally unmounted.
              Unmounting + remounting it causes a burst of 500+ DOM nodes which
              crashes the WKWebView GPU compositor (white screen).
              EmptyState is a lightweight overlay on top; it appears/disappears
              without touching the MessageList DOM tree. */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {!isMemberSession && session?.workDirExists === false && (
              <div className="w-full shrink-0 px-[24px] py-2">
                <div data-chat-content-column className="mx-auto w-full max-w-[878px]">
                  <div className="inline-flex max-w-full items-center gap-2 rounded-[16px] border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-600">
                    <span>⚠</span>
                    <span className="truncate">
                      {t('session.workspaceUnavailable', { dir: session.workDir || 'directory no longer exists' })}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <MessageList
              sessionId={sessionId}
              projectPath={resolvedProjectPath}
              isActive={isActive}
              bottomOverlayHeight={measuredBottomOverlayHeight}
            />

            <FloatingThinkingPanel
              content={activeThinking?.content}
              isActive={thinkingPanelIsActive}
              identityKey={thinkingPanelIdentityKey}
            />

          </div>

          {composerHeight > 0 && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 left-0 right-[12px] z-10 bg-[var(--color-chat-bg)]"
              style={{ height: Math.ceil(composerHeight / 2) }}
            />
          )}

          <div
            ref={bottomOverlayRef}
            className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 flex flex-col"
          >
            <div className="pointer-events-auto">
              {!isMemberSession && (
                <LongRunningNotice
                  chatState={chatState}
                  elapsedSeconds={sessionState?.elapsedSeconds ?? 0}
                  hasVisibleResponse={
                    Boolean(activeThinking?.content?.trim()) ||
                    assistantBodyStartedForCurrentTurn ||
                    visibleProgressForCurrentTurn
                  }
                  lastConnectionActivityAt={sessionState?.lastConnectionActivityAt ?? null}
                  suppress={isRuntimeTransitionStatus}
                  onStop={() => stopGeneration(sessionId)}
                />
              )}
              {!isMemberSession && <SessionTaskBar sessionId={sessionId} />}
              {!isMemberSession && <PendingSteerBar sessionId={sessionId} />}
              <TeamStatusBar />
            </div>
            <div ref={composerShellRef} className="pointer-events-auto">
              <ChatInput
                sessionId={sessionId}
                projectPath={resolvedProjectPath}
                variant="default"
                runtimeKey={sessionId}
                isPanelActive={isActive}
              />
            </div>
          </div>

          {!isMemberSession && sessionId ? (
            <ComputerUsePermissionModal
              sessionId={sessionId}
              request={pendingComputerUsePermission?.request ?? null}
            />
          ) : null}
        </section>

      </div>
    </div>
  )
}
