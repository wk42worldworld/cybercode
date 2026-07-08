import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { ChevronDown, Folder, Plus, Search } from 'lucide-react'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { useTabStore } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { getSessionDisplayTitle } from '../../utils/sessionTitle'
import { NewSessionMenu } from './NewSessionMenu'
import { NewProjectDialog } from './NewProjectDialog'
import { resolveCurrentProject } from './NewSessionChooser'
import { ProjectFilter } from './ProjectFilter'
import { Icon } from '../shared/Icon'
import { useCreateAndOpenSession } from '../../hooks/useCreateAndOpenSession'
import type { SessionListItem } from '../../types/session'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const COLLAPSED_PROJECTS_KEY = 'cybercode.sidebar.collapsedProjects.v1'
const TEMPORARY_GROUP_KEY = '__temporary__'

type SessionRef = { id: string; projectPath?: string }
type SidebarContextMenu =
  | (SessionRef & { kind: 'session'; x: number; y: number })
  | { kind: 'project'; projectPath: string; title: string; x: number; y: number }

type SidebarSessionGroup = {
  key: string
  projectPath?: string
  title: string
  subtitle: string | null
  modifiedAt: string | null
  isTemporary: boolean
  sessions: SessionListItem[]
}

type SidebarSessionFilterScope = 'all' | 'project' | 'temporary'

function sessionKey(id: string, projectPath?: string): string {
  return `${id}:${projectPath ?? ''}`
}

function isTemporarySession(session: SessionListItem) {
  return session.isTemporary || (!session.workDir && !session.projectPath)
}

function readCollapsedGroupKeys(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COLLAPSED_PROJECTS_KEY) || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : []
  } catch {
    return []
  }
}

function writeCollapsedGroupKeys(keys: Set<string>) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(COLLAPSED_PROJECTS_KEY, JSON.stringify([...keys]))
}

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions)
  const selectedProjects = useSessionStore((s) => s.selectedProjects)
  const selectedSessionScope = useSessionStore((s) => s.selectedSessionScope)
  const hiddenProjectPaths = useSessionStore((s) => s.hiddenProjectPaths)
  const hideProject = useSessionStore((s) => s.hideProject)
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
  const [contextMenu, setContextMenu] = useState<SidebarContextMenu | null>(null)
  const [pendingDeleteSession, setPendingDeleteSession] = useState<SessionRef | null>(null)
  const [newSessionMenuOpen, setNewSessionMenuOpen] = useState(false)
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false)
  const [renamingSession, setRenamingSession] = useState<SessionRef | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(
    () => new Set(readCollapsedGroupKeys()),
  )
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

  const groupedSessions = useMemo(
    () => buildSidebarSessionGroups({
      sessions,
      sessionFilterScope: selectedSessionScope,
      selectedProjectPaths: selectedProjects,
      hiddenProjectPaths,
      searchQuery,
      fallbackProjectTitle: t('sidebar.other'),
      temporaryTitle: t('sidebar.temporarySessions'),
      getDisplayTitle: (session) => getSessionDisplayTitle(session, t),
    }),
    [hiddenProjectPaths, searchQuery, selectedProjects, selectedSessionScope, sessions, t],
  )

  const visibleSessionCount = useMemo(
    () =>
      groupedSessions.projectGroups.reduce((count, group) => count + group.sessions.length, 0) +
      (groupedSessions.temporaryGroup?.sessions.length ?? 0),
    [groupedSessions],
  )

  const currentProject = useMemo(() => {
    const selectedProject = resolveCurrentProject(selectedProjects, sessions)
    if (selectedProject) return selectedProject
    if (!activeTab?.projectPath) return undefined
    return resolveCurrentProject([activeTab.projectPath], sessions)
  }, [activeTab?.projectPath, selectedProjects, sessions])

  const activeKey = activeTab ? sessionKey(activeTab.sessionId, activeTab.projectPath) : activeTabId

  const handleSessionContextMenu = useCallback((e: React.MouseEvent, session: SessionRef) => {
    e.preventDefault()
    setNewSessionMenuOpen(false)
    setContextMenu({ kind: 'session', ...session, x: e.clientX, y: e.clientY })
  }, [])

  const handleProjectContextMenu = useCallback((e: React.MouseEvent, group: SidebarSessionGroup) => {
    if (!group.projectPath) return
    e.preventDefault()
    setNewSessionMenuOpen(false)
    setContextMenu({
      kind: 'project',
      projectPath: group.projectPath,
      title: group.title,
      x: e.clientX,
      y: e.clientY,
    })
  }, [])

  const handleDelete = useCallback((session: SessionRef) => {
    setContextMenu(null)
    setNewSessionMenuOpen(false)
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
    setNewSessionMenuOpen(false)
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

  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroupKeys((current) => {
      const next = new Set(current)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      writeCollapsedGroupKeys(next)
      return next
    })
  }, [])

  const removeProjectFromSidebar = useCallback((projectPath: string) => {
    hideProject(projectPath)
    setContextMenu(null)
    setCollapsedGroupKeys((current) => {
      if (!current.has(projectPath)) return current
      const next = new Set(current)
      next.delete(projectPath)
      writeCollapsedGroupKeys(next)
      return next
    })
  }, [hideProject])

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

  const createAndOpenSession = useCreateAndOpenSession()

  const handleNewSession = useCallback(() => {
    setContextMenu(null)
    setNewSessionMenuOpen((open) => !open)
  }, [])

  const openSession = useCallback((session: SessionListItem, displayTitle: string) => {
    const currentKey = sessionKey(session.id, session.projectPath)
    setNewSessionMenuOpen(false)
    setPendingSessionKey(currentKey)
    useTabStore.getState().switchToSession(session.id, displayTitle, session.projectPath)
    void useChatStore.getState().ensureSessionReady(session.id, session.projectPath)
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
        <div className="flex h-[92px] items-center justify-center px-[10px]">
          <img
            src="/brand/cybercode-wordmark-long-flat-v4.png"
            alt="CyberCode"
            className="cybercode-wordmark-image h-[50px] w-[240px] object-contain"
            draggable={false}
          />
        </div>

        <div className="px-[16px]">
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-[16px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              id="sidebar-search"
              type="text"
              placeholder={t('sidebar.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-[44px] w-full rounded-full border-2 border-[var(--color-sidebar-search-border)] bg-[var(--color-sidebar-search-bg)] pl-[40px] pr-[74px] text-[13px] font-medium text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)]"
            />
            <div className="absolute right-[40px] top-1/2 -translate-y-1/2">
              <ProjectFilter variant="embedded" />
            </div>
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
        </div>

        <div data-testid="sidebar-session-list-section" className="scrollbar-no-track flex-1 overflow-y-auto no-scrollbar scroll-smooth">
          <div className="mt-[16px] flex flex-col gap-[10px] px-[12px] pb-[16px]">
            {error && (
              <div className="rounded-[12px] border border-red-500/20 bg-red-500/5 px-4 py-3">
                <div className="text-[11px] font-medium text-red-500">{t('sidebar.sessionListFailed')}</div>
                <div className="mt-1 break-words text-[10px] text-[var(--color-text-tertiary)]">{error}</div>
                <button onClick={() => fetchSessions()} className="mt-2 text-[10px] font-bold uppercase text-[var(--color-brand)] hover:underline">{t('common.retry')}</button>
              </div>
            )}

            {visibleSessionCount === 0 && (
              <div className="py-6 text-center text-[11px] italic text-[var(--color-text-tertiary)]">
                {searchQuery ? t('sidebar.noMatching') : t('sidebar.noSessions')}
              </div>
            )}

            {groupedSessions.projectGroups.map((group) => (
              <SessionProjectGroup
                key={group.key}
                group={group}
                expanded={searchQuery.trim().length > 0 || !collapsedGroupKeys.has(group.key)}
                activeKey={pendingSessionKey ?? activeKey}
                renamingSession={renamingSession}
                renameValue={renameValue}
                renameInputRef={renameInputRef}
                onToggle={() => toggleGroup(group.key)}
                onOpenSession={openSession}
                onSessionContextMenu={handleSessionContextMenu}
                onProjectContextMenu={handleProjectContextMenu}
                onDelete={handleDelete}
                onRenameChange={setRenameValue}
                onFinishRename={handleFinishRename}
                onCancelRename={() => { setRenamingSession(null); setRenameValue('') }}
              />
            ))}

            {groupedSessions.temporaryGroup && (
              <SessionProjectGroup
                group={groupedSessions.temporaryGroup}
                expanded={searchQuery.trim().length > 0 || !collapsedGroupKeys.has(TEMPORARY_GROUP_KEY)}
                activeKey={pendingSessionKey ?? activeKey}
                renamingSession={renamingSession}
                renameValue={renameValue}
                renameInputRef={renameInputRef}
                onToggle={() => toggleGroup(TEMPORARY_GROUP_KEY)}
                onOpenSession={openSession}
                onSessionContextMenu={handleSessionContextMenu}
                onDelete={handleDelete}
                onRenameChange={setRenameValue}
                onFinishRename={handleFinishRename}
                onCancelRename={() => { setRenamingSession(null); setRenameValue('') }}
              />
            )}
          </div>
        </div>
      </div>

      {contextMenu?.kind === 'session' && (
        <div
          className="fixed z-50 min-w-[136px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-background)] p-[4px] shadow-[0_10px_28px_rgba(0,0,0,0.14)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              const session = sessions.find((s) => s.id === contextMenu.id && s.projectPath === contextMenu.projectPath)
              handleStartRename(contextMenu, session ? getSessionDisplayTitle(session, t) : '')
            }}
            className="flex h-[32px] w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)]"
          >
            <Icon name="edit" size={13} className="text-[var(--color-text-tertiary)]" />
            <span>{t('common.rename')}</span>
          </button>
        </div>
      )}

      {contextMenu?.kind === 'project' && (
        <div
          className="fixed z-50 min-w-[184px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-background)] p-[4px] shadow-[0_10px_28px_rgba(0,0,0,0.14)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => removeProjectFromSidebar(contextMenu.projectPath)}
            className="flex h-[32px] w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)]"
          >
            <Icon name="remove" size={13} className="text-[var(--color-text-tertiary)]" />
            <span>{t('sidebar.removeProject')}</span>
          </button>
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
        currentProject={currentProject}
        onClose={() => setNewSessionMenuOpen(false)}
        onCreate={createAndOpenSession}
        onCreateProject={() => {
          setNewSessionMenuOpen(false)
          setNewProjectDialogOpen(true)
        }}
      />

      <NewProjectDialog
        open={newProjectDialogOpen}
        onClose={() => setNewProjectDialogOpen(false)}
        onCreate={createAndOpenSession}
      />
    </aside>
  )
}

function SessionProjectGroup({
  group,
  expanded,
  activeKey,
  renamingSession,
  renameValue,
  renameInputRef,
  onToggle,
  onOpenSession,
  onSessionContextMenu,
  onProjectContextMenu,
  onDelete,
  onRenameChange,
  onFinishRename,
  onCancelRename,
}: {
  group: SidebarSessionGroup
  expanded: boolean
  activeKey: string | null
  renamingSession: SessionRef | null
  renameValue: string
  renameInputRef: React.RefObject<HTMLInputElement>
  onToggle: () => void
  onOpenSession: (session: SessionListItem, displayTitle: string) => void
  onSessionContextMenu: (event: React.MouseEvent, session: SessionRef) => void
  onProjectContextMenu?: (event: React.MouseEvent, group: SidebarSessionGroup) => void
  onDelete: (session: SessionRef) => void
  onRenameChange: (value: string) => void
  onFinishRename: () => void
  onCancelRename: () => void
}) {
  const t = useTranslation()

  return (
    <section className="flex flex-col gap-[6px]" aria-label={group.title}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        onContextMenu={group.isTemporary ? undefined : (event) => onProjectContextMenu?.(event, group)}
        className="group/project flex h-[40px] w-full items-center gap-[9px] rounded-[8px] px-[8px] text-left text-[var(--color-text-secondary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
      >
        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] bg-[var(--color-surface-container)] text-[var(--color-text-tertiary)] transition-colors group-hover/project:bg-[var(--color-surface-container-high)]">
          {group.isTemporary
            ? <Icon name="bolt" size={14} />
            : <Folder size={14} strokeWidth={1.85} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-bold leading-[16px] text-[var(--color-text-primary)]">
            {group.title}
          </span>
          {group.subtitle && (
            <span className="block truncate text-[10px] font-medium leading-[13px] text-[var(--color-text-tertiary)]">
              {group.subtitle}
            </span>
          )}
        </span>
        <span className="shrink-0 rounded-full bg-[var(--color-surface-container)] px-[6px] py-[2px] text-[10px] font-bold text-[var(--color-text-tertiary)]">
          {t('sidebar.projectSessionCount', { count: group.sessions.length })}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.85}
          className={`shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-100 ${expanded ? '' : '-rotate-90'}`}
        />
      </button>

      {expanded && (
        <div className="flex flex-col gap-2 pl-[6px]">
          {group.sessions.map((session) => (
            <SidebarSessionRow
              key={sessionKey(session.id, session.projectPath)}
              session={session}
              activeKey={activeKey}
              renamingSession={renamingSession}
              renameValue={renameValue}
              renameInputRef={renameInputRef}
              onOpen={onOpenSession}
              onContextMenu={onSessionContextMenu}
              onDelete={onDelete}
              onRenameChange={onRenameChange}
              onFinishRename={onFinishRename}
              onCancelRename={onCancelRename}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function SidebarSessionRow({
  session,
  activeKey,
  renamingSession,
  renameValue,
  renameInputRef,
  onOpen,
  onContextMenu,
  onDelete,
  onRenameChange,
  onFinishRename,
  onCancelRename,
}: {
  session: SessionListItem
  activeKey: string | null
  renamingSession: SessionRef | null
  renameValue: string
  renameInputRef: React.RefObject<HTMLInputElement>
  onOpen: (session: SessionListItem, displayTitle: string) => void
  onContextMenu: (event: React.MouseEvent, session: SessionRef) => void
  onDelete: (session: SessionRef) => void
  onRenameChange: (value: string) => void
  onFinishRename: () => void
  onCancelRename: () => void
}) {
  const t = useTranslation()
  const currentKey = sessionKey(session.id, session.projectPath)
  const isActive = currentKey === activeKey
  const displayTitle = getSessionDisplayTitle(session, t)
  const iconStr = (displayTitle || 'U').charAt(0).toUpperCase()

  return (
    <div className="group/session relative">
      {renamingSession?.id === session.id && renamingSession.projectPath === session.projectPath ? (
        <input
          ref={renameInputRef}
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onFinishRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onFinishRename()
            if (e.key === 'Escape') onCancelRename()
          }}
          className="h-[60px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-[14px] py-[10px] text-[13px] leading-normal text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
        />
      ) : (
        <>
          <button
            onClick={() => onOpen(session, displayTitle)}
            onContextMenu={(e) => onContextMenu(e, { id: session.id, projectPath: session.projectPath })}
            className={`relative flex min-h-[60px] w-full items-start justify-between overflow-hidden rounded-[8px] border p-[10px] text-left transition-colors duration-100 ${
              isActive
                ? 'border-[var(--color-border-focus)] bg-[var(--color-inverse-surface)] text-[var(--color-inverse-on-surface)] shadow-none'
                : 'border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] text-[var(--color-text-secondary)] group-hover/session:border-[var(--color-border)] group-hover/session:bg-[var(--color-surface-hover)]'
            }`}
          >
            <div className="flex w-full items-center gap-[9px]">
              <div className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] text-sm font-bold transition-colors duration-100 ${isActive ? 'bg-[var(--color-background)] text-[var(--color-text-primary)]' : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)] group-hover/session:bg-[var(--color-surface-container-highest)]'}`}>
                {iconStr}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-2">
                  <span className={`min-w-0 flex-1 truncate text-[13px] font-bold leading-normal ${isActive ? 'text-[var(--color-inverse-on-surface)]' : 'text-[var(--color-text-primary)]'}`}>
                    {session.lastMessage || displayTitle}
                  </span>
                  <span className={`mt-0.5 shrink-0 text-[10px] font-bold ${isActive ? 'text-[var(--color-inverse-on-surface)]/45' : 'text-[var(--color-text-tertiary)]'}`}>
                    {formatRelativeTime(session.modifiedAt)}
                  </span>
                </div>
                <p className={`mt-[2px] line-clamp-1 pr-[24px] text-left text-[11px] font-medium leading-normal ${isActive ? 'text-[var(--color-inverse-on-surface)]/65' : 'text-[var(--color-text-tertiary)]'}`}>
                  {session.workDir
                    ? (!session.workDirExists ? <span className="text-amber-500" title={session.workDir ?? ''}>{t('sidebar.missingDir')}</span> : compactPath(session.workDir))
                    : '\u00A0'}
                </p>
              </div>
            </div>
          </button>
          <button
            type="button"
            aria-label={`${t('common.delete')}: ${displayTitle}`}
            title={t('common.delete')}
            onClick={(e) => {
              e.stopPropagation()
              onDelete({ id: session.id, projectPath: session.projectPath })
            }}
            className={`absolute bottom-[8px] right-[9px] flex h-[17px] w-[17px] items-center justify-center rounded-full border opacity-0 shadow-none backdrop-blur-sm transition duration-100 group-hover/session:opacity-100 focus-visible:opacity-100 ${
              isActive
                ? 'border-white/10 bg-white/7 text-[var(--color-inverse-on-surface)]/45 hover:bg-white/12 hover:text-[var(--color-inverse-on-surface)]/72'
                : 'border-[var(--color-border)]/35 bg-[var(--color-surface-container-high)]/48 text-[var(--color-text-tertiary)] hover:border-[var(--color-border)]/55 hover:bg-[var(--color-surface-container-highest)]/72 hover:text-[var(--color-text-secondary)]'
            }`}
          >
            <Icon name="close_one" size={9} />
          </button>
        </>
      )}
    </div>
  )
}

function buildSidebarSessionGroups({
  sessions,
  sessionFilterScope,
  selectedProjectPaths,
  hiddenProjectPaths,
  searchQuery,
  fallbackProjectTitle,
  temporaryTitle,
  getDisplayTitle,
}: {
  sessions: SessionListItem[]
  sessionFilterScope: SidebarSessionFilterScope
  selectedProjectPaths: string[]
  hiddenProjectPaths: string[]
  searchQuery: string
  fallbackProjectTitle: string
  temporaryTitle: string
  getDisplayTitle: (session: SessionListItem) => string
}): { projectGroups: SidebarSessionGroup[]; temporaryGroup: SidebarSessionGroup | null } {
  const query = searchQuery.trim().toLowerCase()
  const hidden = new Set(hiddenProjectPaths)
  const selectedProjectPath = selectedProjectPaths[0]
  const isTemporaryScope = sessionFilterScope === 'temporary'
  const isProjectScope = sessionFilterScope === 'project' && !!selectedProjectPath
  const isAllProjectScope = !isTemporaryScope && !isProjectScope
  const projectGroups = new Map<string, SidebarSessionGroup>()
  const temporarySessions: SessionListItem[] = []

  const sortedSessions = [...sessions].sort((a, b) =>
    new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
  )

  for (const session of sortedSessions) {
    const displayTitle = getDisplayTitle(session)
    if (query && !sessionMatchesSearch(session, displayTitle, query)) continue

    if (isTemporarySession(session)) {
      if (isAllProjectScope || isTemporaryScope) temporarySessions.push(session)
      continue
    }
    if (!session.projectPath || hidden.has(session.projectPath)) continue
    if (isTemporaryScope) continue
    if (isProjectScope && session.projectPath !== selectedProjectPath) continue

    const previous = projectGroups.get(session.projectPath)
    const modifiedAt = session.modifiedAt || null
    const title = session.workDir
      ? basename(session.workDir)
      : fallbackProjectTitleFromPath(session.projectPath, fallbackProjectTitle)

    if (!previous) {
      projectGroups.set(session.projectPath, {
        key: session.projectPath,
        projectPath: session.projectPath,
        title,
        subtitle: session.workDir ? compactPath(session.workDir) : null,
        modifiedAt,
        isTemporary: false,
        sessions: [session],
      })
      continue
    }

    previous.sessions.push(session)
    if (modifiedAt && (!previous.modifiedAt || modifiedAt > previous.modifiedAt)) {
      previous.modifiedAt = modifiedAt
      previous.title = title
      previous.subtitle = session.workDir ? compactPath(session.workDir) : previous.subtitle
    }
  }

  const temporaryGroup = temporarySessions.length > 0
    ? {
        key: TEMPORARY_GROUP_KEY,
        title: temporaryTitle,
        subtitle: null,
        modifiedAt: temporarySessions[0]?.modifiedAt ?? null,
        isTemporary: true,
        sessions: temporarySessions,
      }
    : null

  return {
    projectGroups: [...projectGroups.values()].sort((a, b) => {
      if (a.modifiedAt && b.modifiedAt && a.modifiedAt !== b.modifiedAt) {
        return b.modifiedAt.localeCompare(a.modifiedAt)
      }
      if (a.modifiedAt && !b.modifiedAt) return -1
      if (!a.modifiedAt && b.modifiedAt) return 1
      return a.title.localeCompare(b.title)
    }),
    temporaryGroup,
  }
}

function sessionMatchesSearch(session: SessionListItem, displayTitle: string, query: string) {
  return [
    displayTitle,
    session.lastMessage ?? '',
    session.workDir ?? '',
  ].some((value) => value.toLowerCase().includes(query))
}

function compactPath(path: string) {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 2) return path
  return `.../${parts.slice(-2).join('/')}`
}

function basename(path: string) {
  return path.split('/').filter(Boolean).pop() || path
}

function fallbackProjectTitleFromPath(projectPath: string, fallback: string) {
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
