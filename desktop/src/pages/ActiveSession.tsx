import { useEffect } from 'react'
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

const TASK_POLL_INTERVAL_MS = 1000
const THINKING_RECENT_GRACE_MS = 3200

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
  const pendingComputerUsePermission = sessionState?.pendingComputerUsePermission ?? null
  const fetchSessionTasks = useCLITaskStore((s) => s.fetchSessionTasks)
  const trackedTaskSessionId = useCLITaskStore((s) => s.sessionId)
  const hasIncompleteTasks = useCLITaskStore((s) => s.tasks.some((task) => task.status !== 'completed'))
  const chatState = sessionState?.chatState ?? 'idle'

  const session = sessions.find((s) =>
    s.id === sessionId && (!resolvedProjectPath || s.projectPath === resolvedProjectPath),
  )
  const memberInfo = useTeamStore((s) => sessionId ? s.getMemberBySessionId(sessionId) : null)
  const activeTeam = useTeamStore((s) => s.activeTeam)
  const isMemberSession = !!memberInfo

  useEffect(() => {
    if (sessionId && !isMemberSession) {
      void ensureSessionReady(sessionId, resolvedProjectPath)
    }
  }, [sessionId, resolvedProjectPath, isMemberSession, ensureSessionReady])

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

  const t = useTranslation()
  const messages = sessionState?.messages ?? []
  const activeThinkingId = sessionState?.activeThinkingId ?? null

  const latestThinking = [...messages].reverse().find((m): m is Extract<UIMessage, { type: 'thinking' }> => m.type === 'thinking') ?? null
  const latestThinkingIsFresh = latestThinking
    ? Date.now() - latestThinking.timestamp <= THINKING_RECENT_GRACE_MS
    : false
  const fallbackThinking = chatState !== 'idle' || latestThinkingIsFresh ? latestThinking : null

  // Active thinking content for the floating indicator. The id can be cleared
  // by later stream events before the UI has had a chance to render it.
  const activeThinking = activeThinkingId
    ? messages.find((m): m is Extract<UIMessage, { type: 'thinking' }> => m.type === 'thinking' && m.id === activeThinkingId) ?? fallbackThinking
    : fallbackThinking

  if (!sessionId) return null

  return (
    <div className="flex-1 flex flex-col relative overflow-hidden bg-[var(--color-background)] text-on-surface transition-colors duration-300">

      {isMemberSession && (
        <div className="shrink-0 border-b border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)]">
          <div className="mx-auto max-w-[860px] flex items-center justify-between gap-4 px-8 py-2">
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
      )}

      {/* MessageList is ALWAYS mounted — never conditionally unmounted.
          Unmounting + remounting it causes a burst of 500+ DOM nodes which
          crashes the WKWebView GPU compositor (white screen).
          EmptyState is a lightweight overlay on top; it appears/disappears
          without touching the MessageList DOM tree. */}
      <div className="flex-1 relative flex flex-col overflow-hidden min-h-0">
        {!isMemberSession && session?.workDirExists === false && (
          <div className="mx-auto w-full max-w-[860px] px-8 py-2 shrink-0">
            <div className="inline-flex max-w-full items-center gap-2 rounded-[16px] border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-600">
              <span>⚠</span>
              <span className="truncate">
                {t('session.workspaceUnavailable', { dir: session.workDir || 'directory no longer exists' })}
              </span>
            </div>
          </div>
        )}

        <MessageList sessionId={sessionId} projectPath={resolvedProjectPath} isActive={isActive} />

      </div>

      {!isMemberSession && <SessionTaskBar sessionId={sessionId} />}

      <TeamStatusBar />

      <div className="shrink-0 z-20">
        <ChatInput sessionId={sessionId} projectPath={resolvedProjectPath} variant="default" thinkingContent={activeThinking?.content} />
      </div>

      {!isMemberSession && sessionId ? (
        <ComputerUsePermissionModal
          sessionId={sessionId}
          request={pendingComputerUsePermission?.request ?? null}
        />
      ) : null}
    </div>
  )
}
