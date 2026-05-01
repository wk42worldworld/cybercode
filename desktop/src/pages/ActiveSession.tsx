import { useEffect } from 'react'
import { useTabStore } from '../stores/tabStore'
import { useSessionStore } from '../stores/sessionStore'
import { useChatStore } from '../stores/chatStore'
import { useCLITaskStore } from '../stores/cliTaskStore'
import { useTeamStore } from '../stores/teamStore'
import { useTranslation } from '../i18n'
import { MessageList } from '../components/chat/MessageList'
import { ChatInput } from '../components/chat/ChatInput'
import { ComputerUsePermissionModal } from '../components/chat/ComputerUsePermissionModal'
import { TeamStatusBar } from '../components/teams/TeamStatusBar'
import { SessionTaskBar } from '../components/chat/SessionTaskBar'

const TASK_POLL_INTERVAL_MS = 1000

export function ActiveSession() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessions = useSessionStore((s) => s.sessions)
  const connectToSession = useChatStore((s) => s.connectToSession)
  const sessionState = useChatStore((s) => activeTabId ? s.sessions[activeTabId] : undefined)
  const pendingComputerUsePermission = sessionState?.pendingComputerUsePermission ?? null
  const fetchSessionTasks = useCLITaskStore((s) => s.fetchSessionTasks)
  const trackedTaskSessionId = useCLITaskStore((s) => s.sessionId)
  const hasIncompleteTasks = useCLITaskStore((s) => s.tasks.some((task) => task.status !== 'completed'))
  const chatState = sessionState?.chatState ?? 'idle'

  const session = sessions.find((s) => s.id === activeTabId)
  const memberInfo = useTeamStore((s) => activeTabId ? s.getMemberBySessionId(activeTabId) : null)
  const activeTeam = useTeamStore((s) => s.activeTeam)
  const isMemberSession = !!memberInfo
  const isReconnecting = !isMemberSession &&
    sessionState !== undefined &&
    sessionState.connectionState !== 'connected'

  useEffect(() => {
    if (activeTabId && !isMemberSession) {
      connectToSession(activeTabId)
    }
  }, [activeTabId, isMemberSession, connectToSession])

  useEffect(() => {
    if (!activeTabId || isMemberSession) return

    const shouldPollTasks =
      chatState !== 'idle' ||
      (trackedTaskSessionId === activeTabId && hasIncompleteTasks)

    if (!shouldPollTasks) return

    void fetchSessionTasks(activeTabId)

    const timer = setInterval(() => {
      void fetchSessionTasks(activeTabId)
    }, TASK_POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [
    activeTabId,
    isMemberSession,
    chatState,
    trackedTaskSessionId,
    hasIncompleteTasks,
    fetchSessionTasks,
  ])

  const t = useTranslation()
  const messages = sessionState?.messages ?? []
  const streamingText = sessionState?.streamingText ?? ''
  const isEmpty = messages.length === 0 && !streamingText

  if (!activeTabId) return null

  return (
    <div className="flex-1 flex flex-col relative overflow-hidden bg-background text-on-surface">
      {/* Persistent drag strip so the top of the chat area can move the window */}
      <div className="h-8 shrink-0" data-tauri-drag-region />

      {/* Indeterminate top loading bar — visible whenever the session is
          (re)connecting, so users see "something is loading" instead of a frozen UI */}
      {isReconnecting && <div className="session-loading-bar" aria-hidden="true" />}

      {isMemberSession && (
        <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-container)]">
          <div className="mx-auto max-w-[860px] flex items-center justify-between gap-4 px-8 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                {memberInfo?.status === 'running' && (
                  <span className="flex h-2 w-2 rounded-full bg-[var(--color-warning)] animate-pulse-dot" />
                )}
                {memberInfo?.status === 'completed' && (
                  <span className="material-symbols-outlined text-[14px] text-[var(--color-success)]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                )}
                <span className="material-symbols-outlined text-[14px] text-[var(--color-text-tertiary)]">smart_toy</span>
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
              className="flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50 disabled:hover:text-[var(--color-text-secondary)]"
            >
              <span className="material-symbols-outlined text-[14px]">arrow_back</span>
              {t('teams.backToLeader')}
            </button>
          </div>
        </div>
      )}

      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 pb-32">
          <div className="flex max-w-md flex-col items-center text-center">
            {isMemberSession ? (
              <>
                <span className="material-symbols-outlined text-[48px] mb-4 text-[var(--color-text-tertiary)]">smart_toy</span>
                <p className="text-[var(--color-text-secondary)]">
                  {memberInfo?.status === 'running'
                    ? `${memberInfo.role} ${t('teams.working')}`
                    : t('teams.noMessages')}
                </p>
              </>
            ) : (
              <>
                <img src="/app-icon.png" alt="CyberCode" className="mb-6 h-24 w-24" />
                <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>
                  {t('empty.title')}
                </h1>
                <p className="mx-auto max-w-xs text-[var(--color-text-secondary)]" style={{ fontFamily: 'var(--font-body)' }}>
                  {t('empty.subtitle')}
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          {!isMemberSession && session?.workDirExists === false && (
            <div className="mx-auto w-full max-w-[860px] px-8 py-2" data-tauri-drag-region>
              <div className="inline-flex max-w-full items-center gap-2 rounded-lg border border-[var(--color-error)]/20 bg-[var(--color-error)]/8 px-3 py-1.5 text-[11px] text-[var(--color-error)]">
                <span className="material-symbols-outlined text-[14px]">warning</span>
                <span className="truncate">
                  {t('session.workspaceUnavailable', { dir: session.workDir || 'directory no longer exists' })}
                </span>
              </div>
            </div>
          )}

          <MessageList />
        </>
      )}

      {!isMemberSession && <SessionTaskBar />}

      <TeamStatusBar />

      <ChatInput variant={isEmpty && !isMemberSession ? 'hero' : 'default'} />

      {!isMemberSession && activeTabId ? (
        <ComputerUsePermissionModal
          sessionId={activeTabId}
          request={pendingComputerUsePermission?.request ?? null}
        />
      ) : null}
    </div>
  )
}
