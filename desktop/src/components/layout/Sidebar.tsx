import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { Check, ChevronDown, Folder, Inbox, Plus, Search, Zap } from 'lucide-react'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { useTabStore } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { getDefaultSessionTitle, getSessionDisplayTitle } from '../../utils/sessionTitle'
import { NewSessionMenu } from './NewSessionMenu'
import type { SessionListItem } from '../../types/session'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
type SessionRef = { id: string; projectPath?: string }
type SidebarProjectOption = {
  projectPath: string
  title: string
  subtitle: string | null
  count: number
  modifiedAt: string | null
}

function sessionKey(id: string, projectPath?: string): string {
  return `${id}:${projectPath ?? ''}`
}

function isTemporarySession(session: SessionListItem) {
  return !session.workDir || !session.projectPath
}

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions)
  const selectedProjects = useSessionStore((s) => s.selectedProjects)
  const availableProjects = useSessionStore((s) => s.availableProjects)
  const setSelectedProjects = useSessionStore((s) => s.setSelectedProjects)
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
  const [showTemporaryOnly, setShowTemporaryOnly] = useState(false)
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
    if (showTemporaryOnly) {
      result = result.filter(isTemporarySession)
    } else if (selectedProjects.length > 0) {
      result = result.filter((s) => selectedProjects.includes(s.projectPath))
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter((s) => getSessionDisplayTitle(s, t).toLowerCase().includes(q))
    }
    return result
  }, [sessions, selectedProjects, showTemporaryOnly, searchQuery, t])

  const temporarySessionCount = useMemo(
    () => sessions.filter(isTemporarySession).length,
    [sessions],
  )

  const projectOptions = useMemo(
    () => buildSidebarProjectOptions(sessions, availableProjects, t('sidebar.other')),
    [availableProjects, sessions, t],
  )

  useEffect(() => {
    if (showTemporaryOnly && selectedProjects.length > 0) setShowTemporaryOnly(false)
  }, [selectedProjects, showTemporaryOnly])

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
      className="sidebar-panel native-ui-text relative flex h-full w-full select-none flex-col bg-[var(--color-surface-sidebar)] text-[var(--color-text-primary)]"
      data-state="open"
      aria-label="Sidebar"
    >
      <div className="flex flex-1 flex-col overflow-hidden pt-[8px]">

        {/* ── Top Profile Area ── */}
        <div className="flex h-[92px] items-center justify-center px-[10px]">
          <img
            src="/brand/cybercode-wordmark-long-flat-v4.png"
            alt="CyberCode"
            className="cybercode-wordmark-image h-[50px] w-[240px] object-contain"
            draggable={false}
          />
        </div>

        {/* ── Search + New Session ── */}
        <div className="px-[16px]">
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-[16px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              id="sidebar-search"
              type="text"
              placeholder={t('sidebar.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-[44px] w-full rounded-full border-2 border-[var(--color-sidebar-search-border)] bg-[var(--color-sidebar-search-bg)] pl-[40px] pr-[44px] text-[13px] font-medium text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)]"
            />
            <button
              ref={newSessionButtonRef}
              type="button"
              onClick={handleNewSession}
              title={t('sidebar.newSession')}
              aria-label={t('sidebar.newSession')}
              className="absolute right-[8px] top-1/2 flex h-[28px] w-[28px] -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              <Plus size={16} strokeWidth={1.75} />
            </button>
          </div>
          <SessionScopeSelector
            projectOptions={projectOptions}
            selectedProjects={selectedProjects}
            showTemporaryOnly={showTemporaryOnly}
            totalCount={sessions.length}
            temporaryCount={temporarySessionCount}
            onSelectAll={() => {
              setShowTemporaryOnly(false)
              setSelectedProjects([])
            }}
            onSelectTemporary={() => {
              setShowTemporaryOnly(true)
              setSelectedProjects([])
            }}
            onSelectProject={(projectPath) => {
              setShowTemporaryOnly(false)
              setSelectedProjects([projectPath])
            }}
          />
        </div>

        {/* ── Sessions List ── */}
        <div data-testid="sidebar-session-list-section" className="scrollbar-no-track flex-1 overflow-y-auto no-scrollbar scroll-smooth">
          <div className="mt-[20px] flex flex-col gap-[8px] px-[12px] pb-[16px]">
          {error && (
            <div className="rounded-[16px] border border-red-500/20 bg-red-500/5 px-4 py-3">
              <div className="text-[11px] font-medium text-red-500">{t('sidebar.sessionListFailed')}</div>
              <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)] break-words">{error}</div>
              <button onClick={() => fetchSessions()} className="mt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-brand)] hover:underline">{t('common.retry')}</button>
            </div>
          )}
          {filteredSessions.length === 0 && (
            <div className="py-6 text-center text-[11px] italic text-[var(--color-text-tertiary)]">{searchQuery ? t('sidebar.noMatching') : t('sidebar.noSessions')}</div>
          )}
          <div className="flex flex-col gap-2">
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
                      className="h-[64px] w-full rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-[16px] py-[12px] text-[13px] leading-normal text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setPendingSessionKey(currentKey)
                        useTabStore.getState().switchToSession(session.id, displayTitle, session.projectPath)
                        void useChatStore.getState().ensureSessionReady(session.id, session.projectPath)
                      }}
                      onContextMenu={(e) => handleContextMenu(e, { id: session.id, projectPath: session.projectPath })}
                      className={`group relative flex min-h-[64px] w-full items-start justify-between overflow-hidden rounded-[12px] border p-[12px] text-left transition-colors duration-100 ${
                        isActive
                          ? 'border-[var(--color-border-focus)] bg-[var(--color-inverse-surface)] text-[var(--color-inverse-on-surface)] shadow-none'
                          : 'border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                      }`}
                    >
                      <div className="flex w-full items-center gap-[10px]">
                        <div className={`flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[12px] text-sm font-bold transition-colors duration-100 ${isActive ? 'bg-[var(--color-background)] text-[var(--color-text-primary)]' : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)] group-hover:bg-[var(--color-surface-container-highest)]'}`}>
                          {iconStr}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="flex items-start justify-between gap-2">
                            <span className={`w-[130px] truncate text-[13px] font-bold leading-normal ${isActive ? 'text-[var(--color-inverse-on-surface)]' : 'text-[var(--color-text-primary)]'}`}>
                              {session.lastMessage || displayTitle}
                            </span>
                            <span className={`mt-0.5 shrink-0 text-[10px] font-bold ${isActive ? 'text-[var(--color-inverse-on-surface)]/45' : 'text-[var(--color-text-tertiary)]'}`}>
                              {formatRelativeTime(session.modifiedAt)}
                            </span>
                          </div>
                          <p className={`mt-[2px] line-clamp-1 text-left text-[11px] font-medium leading-normal ${isActive ? 'text-[var(--color-inverse-on-surface)]/65' : 'text-[var(--color-text-tertiary)]'}`}>
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
          className="fixed z-50 min-w-[160px] rounded-[16px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1 shadow-[var(--shadow-dropdown)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { const session = sessions.find((s) => s.id === contextMenu.id && s.projectPath === contextMenu.projectPath); handleStartRename(contextMenu, session ? getSessionDisplayTitle(session, t) : '') }} className="w-full px-4 py-2.5 text-left text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] rounded-[8px]">{t('common.rename')}</button>
          <button onClick={() => handleDelete(contextMenu)} className="w-full px-4 py-2.5 text-left text-[13px] text-red-500 transition-colors hover:bg-[var(--color-surface-hover)] rounded-[8px]">{t('common.delete')}</button>
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

function SessionScopeSelector({
  projectOptions,
  selectedProjects,
  showTemporaryOnly,
  totalCount,
  temporaryCount,
  onSelectAll,
  onSelectTemporary,
  onSelectProject,
}: {
  projectOptions: SidebarProjectOption[]
  selectedProjects: string[]
  showTemporaryOnly: boolean
  totalCount: number
  temporaryCount: number
  onSelectAll: () => void
  onSelectTemporary: () => void
  onSelectProject: (projectPath: string) => void
}) {
  const t = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selectedProject = selectedProjects.length === 1
    ? projectOptions.find((option) => option.projectPath === selectedProjects[0])
    : null
  const label = showTemporaryOnly
    ? t('sidebar.temporarySessions')
    : selectedProject
      ? selectedProject.title
      : t('sidebar.allSessions')
  useEffect(() => {
    if (!open) return

    const handleClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handleClick, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const choose = (action: () => void) => {
    action()
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative mt-[8px]">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="relative h-[44px] w-full rounded-full border-2 border-[var(--color-sidebar-filter-border)] bg-[var(--color-sidebar-filter-bg)] pl-[40px] pr-[44px] text-left text-[13px] font-medium text-[var(--color-text-primary)] outline-none transition-colors duration-100 hover:border-[var(--color-border)] focus:border-[var(--color-border-focus)]"
      >
        {showTemporaryOnly ? (
          <Zap size={16} strokeWidth={1.75} className="absolute left-[16px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
        ) : selectedProject ? (
          <Folder size={16} strokeWidth={1.75} className="absolute left-[16px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
        ) : (
          <Inbox size={16} strokeWidth={1.75} className="absolute left-[16px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
        )}
        <span className="block min-w-0 truncate text-[var(--color-text-primary)]">
          {label}
        </span>
        <span className="absolute right-[8px] top-1/2 flex h-[28px] w-[28px] -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]">
          <ChevronDown size={16} strokeWidth={1.75} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('sidebar.sessionScope')}
          className="absolute left-0 right-0 top-[50px] z-50 overflow-hidden rounded-[16px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-[6px] shadow-[var(--shadow-dropdown)]"
        >
          <SessionScopeMenuItem
            icon={<Inbox size={15} strokeWidth={1.8} />}
            label={t('sidebar.allSessions')}
            count={totalCount}
            checked={!showTemporaryOnly && selectedProjects.length === 0}
            onClick={() => choose(onSelectAll)}
          />
          <SessionScopeMenuItem
            icon={<Zap size={15} strokeWidth={1.8} />}
            label={t('sidebar.temporarySessions')}
            count={temporaryCount}
            checked={showTemporaryOnly}
            onClick={() => choose(onSelectTemporary)}
          />
          {projectOptions.length > 0 && (
            <div className="my-[4px] h-px bg-[var(--color-border-separator)]" />
          )}
          {projectOptions.map((option) => (
            <SessionScopeMenuItem
              key={option.projectPath}
              icon={<Folder size={15} strokeWidth={1.8} />}
              label={option.title}
              detail={option.subtitle}
              count={option.count}
              checked={!showTemporaryOnly && selectedProjects.length === 1 && selectedProjects[0] === option.projectPath}
              onClick={() => choose(() => onSelectProject(option.projectPath))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SessionScopeMenuItem({
  icon,
  label,
  detail,
  count,
  checked,
  onClick,
}: {
  icon: ReactNode
  label: string
  detail?: string | null
  count: number
  checked: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onClick}
      className={`flex w-full items-center gap-[9px] rounded-[11px] px-[9px] py-[8px] text-left transition-colors duration-100 ${
        checked ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      <span className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-surface-container)] text-[var(--color-text-tertiary)] shadow-none">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold">{label}</span>
        {detail && (
          <span className="mt-[1px] block truncate text-[10px] font-medium text-[var(--color-text-tertiary)]">
            {detail}
          </span>
        )}
      </span>
      <span className="shrink-0 rounded-full bg-[var(--color-surface-container)] px-[6px] py-[2px] text-[10px] font-bold text-[var(--color-text-tertiary)] shadow-none">
        {count}
      </span>
      <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center text-[var(--color-text-primary)]">
        {checked && <Check size={14} strokeWidth={2} />}
      </span>
    </button>
  )
}

function buildSidebarProjectOptions(
  sessions: SessionListItem[],
  availableProjects: string[],
  fallbackLabel: string,
): SidebarProjectOption[] {
  const availableSet = new Set(availableProjects)
  const optionsByPath = new Map<string, SidebarProjectOption>()

  for (const session of sessions) {
    if (!session.projectPath || !availableSet.has(session.projectPath)) continue

    const previous = optionsByPath.get(session.projectPath)
    const title = session.workDir
      ? basename(session.workDir)
      : fallbackProjectTitle(session.projectPath, fallbackLabel)
    const modifiedAt = session.modifiedAt || null
    const isNewer = modifiedAt && (!previous?.modifiedAt || modifiedAt > previous.modifiedAt)

    optionsByPath.set(session.projectPath, {
      projectPath: session.projectPath,
      title: previous && !isNewer ? previous.title : title,
      subtitle: previous && !isNewer ? previous.subtitle : session.workDir,
      count: (previous?.count ?? 0) + 1,
      modifiedAt: previous && !isNewer ? previous.modifiedAt : modifiedAt,
    })
  }

  for (const projectPath of availableProjects) {
    if (optionsByPath.has(projectPath)) continue
    optionsByPath.set(projectPath, {
      projectPath,
      title: fallbackProjectTitle(projectPath, fallbackLabel),
      subtitle: null,
      count: 0,
      modifiedAt: null,
    })
  }

  return [...optionsByPath.values()].sort((a, b) => {
    if (a.modifiedAt && b.modifiedAt && a.modifiedAt !== b.modifiedAt) {
      return b.modifiedAt.localeCompare(a.modifiedAt)
    }
    if (a.modifiedAt && !b.modifiedAt) return -1
    if (!a.modifiedAt && b.modifiedAt) return 1
    return a.title.localeCompare(b.title)
  })
}

function basename(path: string) {
  return path.split('/').filter(Boolean).pop() || path
}

function fallbackProjectTitle(projectPath: string, fallback: string) {
  if (!projectPath || projectPath === '_unknown') return fallback
  if (projectPath.includes('/')) return basename(projectPath) || fallback
  const segments = projectPath.split('-').filter(Boolean)
  return segments[segments.length - 1] || projectPath || fallback
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
