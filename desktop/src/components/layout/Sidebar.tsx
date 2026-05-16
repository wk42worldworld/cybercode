import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { ProjectFilter } from './ProjectFilter'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { useTabStore } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { getDefaultSessionTitle, getSessionDisplayTitle } from '../../utils/sessionTitle'
import { Icon } from '../shared/Icon'
import { NewSessionMenu } from './NewSessionMenu'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
type SessionRef = { id: string; projectPath?: string }

function sessionKey(id: string, projectPath?: string): string {
  return `${id}:${projectPath ?? ''}`
}

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions)
  const selectedProjects = useSessionStore((s) => s.selectedProjects)
  const availableProjects = useSessionStore((s) => s.availableProjects)
  const error = useSessionStore((s) => s.error)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)

  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTab = useTabStore((s) => s.tabs.find((tab) => tab.sessionId === s.activeTabId))
  const closeTab = useTabStore((s) => s.closeTab)
  const disconnectSession = useChatStore((s) => s.disconnectSession)
  const t = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [pendingSessionKey, setPendingSessionKey] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<(SessionRef & { x: number; y: number }) | null>(null)
  const [pendingDeleteSession, setPendingDeleteSession] = useState<SessionRef | null>(null)
  const [newSessionMenuOpen, setNewSessionMenuOpen] = useState(false)
  const [renamingSession, setRenamingSession] = useState<SessionRef | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const newSessionButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { fetchSessions() }, [fetchSessions])

  useEffect(() => {
    const activeKey = activeTab ? sessionKey(activeTab.sessionId, activeTab.projectPath) : activeTabId
    if (pendingSessionKey && pendingSessionKey === activeKey) setPendingSessionKey(null)
  }, [activeTab, activeTabId, pendingSessionKey])

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
      result = result.filter((s) => getSessionDisplayTitle(s, t).toLowerCase().includes(q))
    }
    return result
  }, [sessions, selectedProjects, searchQuery, t])

  const selectedProject = useMemo(() => {
    if (selectedProjects.length !== 1) return undefined
    const projectPath = selectedProjects[0]!
    const latestSession = sessions
      .filter((session) =>
        session.projectPath === projectPath &&
        session.workDir &&
        session.workDirExists,
      )
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())[0]
    if (!latestSession?.workDir) return undefined
    const title = latestSession.workDir.split('/').filter(Boolean).pop() || latestSession.workDir
    return { projectPath, workDir: latestSession.workDir, title }
  }, [selectedProjects, sessions])

  const handleContextMenu = useCallback((e: React.MouseEvent, session: SessionRef) => {
    e.preventDefault()
    setContextMenu({ ...session, x: e.clientX, y: e.clientY })
  }, [])

  const handleDelete = useCallback((session: SessionRef) => {
    setContextMenu(null)
    setPendingDeleteSession(session)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteSession) return
    await deleteSession(pendingDeleteSession.id, pendingDeleteSession.projectPath)
    disconnectSession(pendingDeleteSession.id)
    closeTab(pendingDeleteSession.id, pendingDeleteSession.projectPath)
    setPendingDeleteSession(null)
  }, [closeTab, deleteSession, disconnectSession, pendingDeleteSession])

  const handleStartRename = useCallback((session: SessionRef, currentTitle: string) => {
    setContextMenu(null)
    setRenamingSession(session)
    setRenameValue(currentTitle)
  }, [])

  useEffect(() => {
    if (renamingSession) renameInputRef.current?.focus()
  }, [renamingSession])

  const handleFinishRename = useCallback(async () => {
    if (renamingSession && renameValue.trim()) {
      await renameSession(renamingSession.id, renameValue.trim(), renamingSession.projectPath)
    }
    setRenamingSession(null)
    setRenameValue('')
  }, [renamingSession, renameValue, renameSession])

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

  const createSession = useSessionStore((state) => state.createSession)

  const createAndOpenSession = useCallback(async (workDir?: string): Promise<boolean> => {
    try {
      const newSessionId = await createSession(workDir)
      const createdSession = useSessionStore.getState().sessions.find((session) => session.id === newSessionId)
      useTabStore.getState().openTab(newSessionId, getDefaultSessionTitle(t), 'session', createdSession?.projectPath)
      void useChatStore.getState().ensureSessionReady(newSessionId, createdSession?.projectPath)
      useUIStore.getState().setRailSettingsView(null)
      return true
    } catch (error) {
      useUIStore.getState().addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('empty.failedToCreate'),
      })
      return false
    }
  }, [createSession, t])

  const handleNewSession = useCallback(() => {
    setContextMenu(null)
    setNewSessionMenuOpen((open) => !open)
  }, [])


  if (!sidebarOpen) {
    return null
  }

  return (
    <aside
      onMouseDown={handleSidebarDrag}
      className="sidebar-panel relative h-full w-full flex flex-col select-none bg-transparent"
      data-state="open"
      aria-label="Sidebar"
    >
      <div className="flex-1 flex flex-col overflow-hidden pt-4">

        {/* ── Top Profile Area ── */}
        <div className="flex items-center px-6 pb-4">
          <div className="group/logo flex items-center gap-3 p-2 -ml-2 text-black/90 dark:text-white/90 cursor-default"
               style={{ perspective: '200px' }}>
            <div className="relative w-9 h-9 rounded-[14px] flex items-center justify-center shrink-0 transition-transform duration-75 ease-out group-hover/logo:scale-[0.92]"
                 style={{ willChange: 'transform' }}>
              <div className="absolute inset-0 bg-white/60 dark:bg-white/10 border border-white/40 dark:border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.05)] rounded-[14px]" />
              <div className="relative w-4 h-4 border-[3px] border-black dark:border-white rounded-md opacity-80 transition-all duration-75 ease-out group-hover/logo:opacity-100 group-hover/logo:scale-110"
                   style={{ willChange: 'transform, opacity' }} />
            </div>
            <span className="text-[15px] font-semibold tracking-tight transition-transform duration-75 ease-out group-hover/logo:translate-x-[1px]"
                  style={{ willChange: 'transform' }}>CyberCode</span>
          </div>
        </div>

        {/* ── Search + New Session ── */}
        <div className="px-5 pb-4">
          <div className="relative group flex items-center gap-2">
            <div className="relative flex-1">
              <input
                id="sidebar-search"
                type="text"
                placeholder={t('sidebar.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/40 dark:bg-black/20 border border-white/50 dark:border-white/10 shadow-[0_2px_10px_rgba(0,0,0,0.02)] rounded-[20px] px-4 py-2.5 pl-10 pr-10 text-[14px] focus:outline-none focus:ring-4 focus:ring-black/5 dark:focus:ring-white/5 transition-all placeholder:text-black/40 dark:placeholder:text-white/40 text-black dark:text-white font-medium"
              />
              <Icon name="search" size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/30" />
              {availableProjects.length > 1 && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2">
                  <ProjectFilter variant="embedded" />
                </span>
              )}
            </div>
            <button
              ref={newSessionButtonRef}
              type="button"
              onClick={handleNewSession}
              title={t('sidebar.newSession')}
              aria-label={t('sidebar.newSession')}
              className="shrink-0 flex h-[42px] w-[42px] items-center justify-center rounded-[20px] bg-white/40 dark:bg-black/20 border border-white/50 dark:border-white/10 shadow-[0_2px_10px_rgba(0,0,0,0.02)] text-black/60 dark:text-white/60 hover:bg-black/[0.08] dark:hover:bg-white/[0.12] hover:text-black dark:hover:text-white transition-all"
            >
              <Icon name="add" size={18} className="opacity-70" />
            </button>
          </div>
        </div>

        {/* ── Sessions List ── */}
        <div data-testid="sidebar-session-list-section" className="flex-1 overflow-y-auto no-scrollbar scroll-smooth">
          <div className="pb-6">
          {error && (
            <div className="mx-4 mt-2 rounded-[16px] border border-red-500/20 bg-red-500/5 px-4 py-3">
              <div className="text-[11px] font-medium text-red-500">{t('sidebar.sessionListFailed')}</div>
              <div className="mt-1 text-[10px] text-black/40 dark:text-white/40 break-words">{error}</div>
              <button onClick={() => fetchSessions()} className="mt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-brand)] hover:underline">{t('common.retry')}</button>
            </div>
          )}
          {filteredSessions.length === 0 && (
            <div className="px-4 py-6 text-center text-[11px] italic text-black/40 dark:text-white/40">{searchQuery ? t('sidebar.noMatching') : t('sidebar.noSessions')}</div>
          )}
          <div>
            {filteredSessions.map((session) => {
              const currentKey = sessionKey(session.id, session.projectPath)
              const activeKey = activeTab ? sessionKey(activeTab.sessionId, activeTab.projectPath) : activeTabId
              const isActive = currentKey === (pendingSessionKey ?? activeKey)
              const displayTitle = getSessionDisplayTitle(session, t)
              const iconStr = (displayTitle || 'U').charAt(0).toUpperCase()
              return (
                <div key={currentKey} className="relative">
                  {renamingSession?.id === session.id && renamingSession.projectPath === session.projectPath ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={handleFinishRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleFinishRename()
                        if (e.key === 'Escape') { setRenamingSession(null); setRenameValue('') }
                      }}
                      className="ml-1 w-[calc(100%-0.5rem)] rounded-[16px] border border-white/50 dark:border-white/10 bg-white/60 dark:bg-black/40 px-4 py-2 text-[14px] text-black dark:text-white outline-none focus:ring-2 focus:ring-black/5"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setPendingSessionKey(currentKey)
                        useTabStore.getState().switchToSession(session.id, displayTitle, session.projectPath)
                        void useChatStore.getState().ensureSessionReady(session.id, session.projectPath)
                      }}
                      onContextMenu={(e) => handleContextMenu(e, { id: session.id, projectPath: session.projectPath })}
                      className={`w-full flex px-5 py-4 rounded-none transition-colors duration-100 group relative ${
                        isActive
                          ? 'bg-white/80 dark:bg-white/10 text-black dark:text-white'
                          : 'bg-transparent hover:bg-white/90 dark:hover:bg-white/20 text-black/70 dark:text-white/70'
                      }`}
                    >
                      <div className="flex items-center gap-3 w-full">
                        <div className={`w-10 h-10 rounded-[4px] flex items-center justify-center shrink-0 text-[13px] font-semibold transition-colors ${isActive ? 'bg-black text-white dark:bg-white dark:text-black shadow-md' : 'bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50'}`}>
                          {iconStr}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col">
                          <div className="flex items-center justify-between gap-1">
                            <span className={`text-[11px] font-medium leading-none truncate ${isActive ? 'text-black dark:text-white opacity-90' : ''}`}>
                              {session.lastMessage || displayTitle}
                            </span>
                            <span className={`text-[10px] shrink-0 font-medium ${isActive ? 'text-black/40 dark:text-white/50' : 'text-black/30 dark:text-white/30'}`}>
                              {formatRelativeTime(session.modifiedAt)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[12px] leading-[1.4] text-black/50 dark:text-white/60 line-clamp-1 text-left">
                            {session.workDir
                              ? (!session.workDirExists ? <span className="text-amber-500" title={session.workDir ?? ''}>{t('sidebar.missingDir')}</span> : session.workDir.split('/').slice(-2).join('/'))
                              : '\u00A0'}
                          </p>
                        </div>
                      </div>
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          </div>
        </div>
      </div>


      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-[16px] border border-white/50 dark:border-white/10 bg-white/80 dark:bg-black/80 py-1 shadow-[0_8px_30px_rgba(0,0,0,0.1)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { const session = sessions.find((s) => s.id === contextMenu.id && s.projectPath === contextMenu.projectPath); handleStartRename(contextMenu, session ? getSessionDisplayTitle(session, t) : '') }} className="w-full px-4 py-2.5 text-left text-[13px] text-black/80 dark:text-white/80 transition-colors hover:bg-black/5 dark:hover:bg-white/5 rounded-[8px]">{t('common.rename')}</button>
          <button onClick={() => handleDelete(contextMenu)} className="w-full px-4 py-2.5 text-left text-[13px] text-red-500 transition-colors hover:bg-black/5 dark:hover:bg-white/5 rounded-[8px]">{t('common.delete')}</button>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteSession !== null}
        onClose={() => setPendingDeleteSession(null)}
        onConfirm={confirmDelete}
        title={t('common.delete')}
        body={pendingDeleteSession ? t('sidebar.confirmDelete') : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
      />

      <NewSessionMenu
        open={newSessionMenuOpen}
        anchorRef={newSessionButtonRef}
        currentProject={selectedProject}
        onClose={() => setNewSessionMenuOpen(false)}
        onCreate={createAndOpenSession}
      />
    </aside>
  )
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
