import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { ProjectFilter } from './ProjectFilter'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import type { SessionListItem } from '../../types/session'
import { useTabStore } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)

type TimeGroup = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'older'

const TIME_GROUP_ORDER: TimeGroup[] = ['today', 'yesterday', 'last7days', 'last30days', 'older']

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions)
  const selectedProjects = useSessionStore((s) => s.selectedProjects)
  const error = useSessionStore((s) => s.error)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const addToast = useUIStore((s) => s.addToast)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)

  const activeTabId = useTabStore((s) => s.activeTabId)
  const closeTab = useTabStore((s) => s.closeTab)
  const disconnectSession = useChatStore((s) => s.disconnectSession)
  const [searchQuery, setSearchQuery] = useState('')
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [scrollAreaHover, setScrollAreaHover] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  useEffect(() => {
    if (pendingSessionId && pendingSessionId === activeTabId) {
      setPendingSessionId(null)
    }
  }, [activeTabId, pendingSessionId])

  useEffect(() => {
    if (!contextMenu || sidebarOpen) return
    setContextMenu(null)
  }, [contextMenu, sidebarOpen])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [contextMenu])

  const filteredSessions = useMemo(() => {
    let result = sessions
    if (selectedProjects.length > 0) {
      result = result.filter((s) => selectedProjects.includes(s.projectPath))
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter((s) => s.title.toLowerCase().includes(q))
    }
    return result
  }, [sessions, selectedProjects, searchQuery])

  const timeGroups = useMemo(() => groupByTime(filteredSessions), [filteredSessions])

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setContextMenu({ id, x: e.clientX, y: e.clientY })
  }, [])

  const handleDelete = useCallback((id: string) => {
    setContextMenu(null)
    setPendingDeleteSessionId(id)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteSessionId) return
    await deleteSession(pendingDeleteSessionId)
    disconnectSession(pendingDeleteSessionId)
    closeTab(pendingDeleteSessionId)
    setPendingDeleteSessionId(null)
  }, [closeTab, deleteSession, disconnectSession, pendingDeleteSessionId])

  const handleStartRename = useCallback((id: string, currentTitle: string) => {
    setContextMenu(null)
    setRenamingId(id)
    setRenameValue(currentTitle)
  }, [])

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus()
    }
  }, [renamingId])

  const handleFinishRename = useCallback(async () => {
    if (renamingId && renameValue.trim()) {
      await renameSession(renamingId, renameValue.trim())
    }
    setRenamingId(null)
    setRenameValue('')
  }, [renamingId, renameValue, renameSession])

  const startDraggingRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    if (!isTauri) return
    import(/* @vite-ignore */ '@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        startDraggingRef.current = () => win.startDragging()
      })
      .catch(() => {})
  }, [])

  const handleSidebarDrag = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, select, a, [role="button"]')) return
    startDraggingRef.current?.()
  }, [])

  const t = useTranslation()

  const handleNewSession = useCallback(async () => {
    try {
      const currentTabId = useTabStore.getState().activeTabId
      const currentSession = currentTabId
        ? useSessionStore.getState().sessions.find((s) => s.id === currentTabId)
        : null
      const workDir = currentSession?.workDir || undefined
      const sessionId = await useSessionStore.getState().createSession(workDir)
      useTabStore.getState().openTab(sessionId, t('sidebar.newSession'))
      useChatStore.getState().connectToSession(sessionId)
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('sidebar.sessionListFailed'),
      })
    }
  }, [addToast, t])

  const timeGroupLabels: Record<TimeGroup, string> = {
    today: t('sidebar.timeGroup.today'),
    yesterday: t('sidebar.timeGroup.yesterday'),
    last7days: t('sidebar.timeGroup.last7days'),
    last30days: t('sidebar.timeGroup.last30days'),
    older: t('sidebar.timeGroup.older'),
  }

  return (
    <aside
      onMouseDown={handleSidebarDrag}
      className="sidebar-panel relative h-full flex flex-col select-none"
      data-state={sidebarOpen ? 'open' : 'closed'}
      aria-label="Sidebar"
    >
      {/* macOS traffic light spacer */}
      <div
        className={isTauri && !isWindows ? 'h-[52px] w-full shrink-0' : 'h-3 w-full shrink-0'}
        data-tauri-drag-region
      />

      {sidebarOpen ? (
        <>
          <div
            data-testid="sidebar-project-filter-section"
            className="sidebar-section sidebar-section--visible relative z-20 flex-none px-4 pb-4"
            style={{ overflow: 'visible' }}
          >
            <div className="flex items-center gap-2" style={{ overflow: 'visible' }}>
              <div className="group relative flex min-w-0 flex-1 items-center rounded-[8px] bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.12] py-2 pl-2 pr-3 transition-all focus-within:border-black/30 dark:focus-within:border-white/50">
                <ProjectFilter variant="embedded" />
                <span className="mx-2 h-4 w-px bg-black/15 dark:bg-white/25" aria-hidden="true" />
                <span className="pointer-events-none flex shrink-0 items-center text-black/70 dark:text-white/70 group-focus-within:text-black/80 dark:group-focus-within:text-white/80 transition-colors">
                  <SearchIcon />
                </span>
                <input
                  id="sidebar-search"
                  type="text"
                  placeholder={t('sidebar.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent pl-2 pr-0 text-[13px] text-black/90 dark:text-white/90 placeholder:text-black/45 dark:placeholder:text-white/60 outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleNewSession}
                title={t('sidebar.newSession')}
                aria-label={t('sidebar.newSession')}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-black/65 dark:text-white/65 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] hover:text-black/80 dark:hover:text-white/80 transition-colors"
              >
                <PlusIcon />
              </button>
            </div>
          </div>

          <div
            data-testid="sidebar-session-list-section"
            className="sidebar-section sidebar-section--visible flex flex-1 min-h-0 flex-col"
          >
            <div
              onMouseEnter={() => setScrollAreaHover(true)}
              onMouseLeave={() => setScrollAreaHover(false)}
              style={{ ['--sidebar-thumb-alpha' as string]: scrollAreaHover ? '1' : '0' }}
              className="sidebar-scroll-area min-h-0 flex-1 pl-3 pr-1.5 py-2 space-y-1"
            >
              {error && (
                <div className="mx-1 mt-2 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2">
                  <div className="text-[11px] font-medium text-red-500">{t('sidebar.sessionListFailed')}</div>
                  <div className="mt-1 text-[10px] text-black/60 dark:text-white/60 break-words">{error}</div>
                  <button
                    onClick={() => fetchSessions()}
                    className="mt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-brand)] hover:underline"
                  >
                    {t('common.retry')}
                  </button>
                </div>
              )}
              {filteredSessions.length === 0 && (
                <div className="px-3 py-6 text-center text-[11px] italic text-black/60 dark:text-white/60">
                  {searchQuery ? t('sidebar.noMatching') : t('sidebar.noSessions')}
                </div>
              )}
              {TIME_GROUP_ORDER.map((group) => {
                const items = timeGroups.get(group)
                if (!items || items.length === 0) return null
                return (
                  <div key={group}>
                    <div className="px-3 mt-2 mb-2.5 text-[10px] font-semibold tracking-[0.09em] uppercase text-black/70 dark:text-white/70">
                      {timeGroupLabels[group]}
                    </div>
                    <div className="space-y-[4px]">
                    {items.map((session) => {
                      const isActive = session.id === (pendingSessionId ?? activeTabId)
                      return (
                        <div key={session.id} className="relative">
                          {renamingId === session.id ? (
                            <input
                              ref={renameInputRef}
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={handleFinishRename}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleFinishRename()
                                if (e.key === 'Escape') {
                                  setRenamingId(null)
                                  setRenameValue('')
                                }
                              }}
                              className="ml-1 w-[calc(100%-0.5rem)] rounded-md border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-[13px] text-black/90 dark:text-white/90 outline-none focus:ring-1 focus:ring-black/20 focus:dark:ring-white/20"
                            />
                          ) : (
                            <button
                              onClick={() => {
                                setPendingSessionId(session.id)
                                useTabStore.getState().switchToSession(session.id, session.title)
                                useChatStore.getState().connectToSession(session.id)
                              }}
                              onContextMenu={(e) => handleContextMenu(e, session.id)}
                              className={`
                                w-full text-left flex flex-col px-3 py-2.5 rounded-[5px] transition-all duration-200 group relative
                                ${isActive
                                  ? 'bg-white/75 dark:bg-white/[0.10] shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.2)] text-black dark:text-white'
                                  : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05] text-black/70 dark:text-white/70'
                                }
                              `}
                            >
                              <div className="flex items-baseline w-full gap-2">
                                <span className={`text-[13px] font-medium leading-snug truncate flex-1 min-w-0 tracking-[-0.01em] ${isActive ? 'text-black dark:text-white' : ''}`}>
                                  {session.title || 'Untitled'}
                                </span>
                                <span className={`text-[10px] font-mono shrink-0 tabular-nums ${isActive ? 'text-black/60 dark:text-white/60' : 'text-black/70 dark:text-white/70'}`}>
                                  {formatRelativeTime(session.modifiedAt)}
                                </span>
                              </div>

                              {session.workDir && (
                                <p className={`text-[11px] leading-none truncate mt-1 ${isActive ? 'text-black/65 dark:text-white/65' : 'text-black/70 dark:text-white/70'}`}>
                                  {!session.workDirExists ? (
                                    <span className="text-amber-500" title={session.workDir ?? ''}>
                                      {t('sidebar.missingDir')}
                                    </span>
                                  ) : (
                                    session.workDir.split('/').slice(-2).join('/')
                                  )}
                                </p>
                              )}
                            </button>
                          )}
                        </div>
                      )
                    })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1" aria-hidden="true" />
      )}


      {contextMenu && sidebarOpen && (
        <div
          className="fixed z-50 min-w-[160px] rounded-md border border-black/[0.12] dark:border-white/[0.12] bg-white dark:bg-[#0A0A0A] py-1 backdrop-blur"
          style={{ left: contextMenu.x, top: contextMenu.y, boxShadow: 'var(--shadow-dropdown)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const session = sessions.find((s) => s.id === contextMenu.id)
              handleStartRename(contextMenu.id, session?.title || '')
            }}
            className="w-full px-3 py-2 text-left text-[12px] text-black/90 dark:text-white/90 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          >
            {t('common.rename')}
          </button>
          <button
            onClick={() => handleDelete(contextMenu.id)}
            className="w-full px-3 py-2 text-left text-[12px] text-red-500 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          >
            {t('common.delete')}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteSessionId !== null}
        onClose={() => setPendingDeleteSessionId(null)}
        onConfirm={confirmDelete}
        title={t('common.delete')}
        body={pendingDeleteSessionId ? t('sidebar.confirmDelete') : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
      />
    </aside>
  )
}

function groupByTime(sessions: SessionListItem[]): Map<TimeGroup, SessionListItem[]> {
  const groups = new Map<TimeGroup, SessionListItem[]>()
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86400000
  const sevenDaysAgo = startOfToday - 7 * 86400000
  const thirtyDaysAgo = startOfToday - 30 * 86400000

  for (const session of sessions) {
    const ts = new Date(session.modifiedAt).getTime()
    let group: TimeGroup
    if (ts >= startOfToday) group = 'today'
    else if (ts >= startOfYesterday) group = 'yesterday'
    else if (ts >= sevenDaysAgo) group = 'last7days'
    else if (ts >= thirtyDaysAgo) group = 'last30days'
    else group = 'older'

    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(session)
  }

  return groups
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d`
  return `${Math.floor(day / 30)}mo`
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

