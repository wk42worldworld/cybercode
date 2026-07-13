import { create } from 'zustand'
import { sessionsApi } from '../api/sessions'
import { t } from '../i18n'
import { useUIStore } from './uiStore'
import { getDefaultSessionTitle, getSessionDisplayTitle, getSessionTitleText } from '../utils/sessionTitle'

const TAB_STORAGE_KEY = 'cybercode-open-tabs'

export const SCHEDULED_TAB_ID = '__scheduled__'
export const TERMINAL_TAB_ID = '__terminal__'
export const TERMINAL_TAB_PREFIX = '__terminal__'

export type TabType = 'session' | 'scheduled' | 'terminal'

export type Tab = {
  sessionId: string
  projectPath?: string
  title: string
  type: TabType
  status: 'idle' | 'running' | 'error'
}

type TabPersistence = {
  openTabs: Array<{ sessionId: string; projectPath?: string; title: string; type?: TabType; status?: Tab['status'] }>
  activeTabId: string | null
}

type TabStore = {
  tabs: Tab[]
  activeTabId: string | null
  /** Last N session-type tab IDs visited — kept mounted for instant switching */
  recentSessionIds: string[]

  openTab: (sessionId: string, title: string, type?: TabType, projectPath?: string) => void
  openTerminalTab: () => string
  switchToSession: (sessionId: string, title: string, projectPath?: string) => void
  closeTab: (sessionId: string, projectPath?: string) => void
  setActiveTab: (sessionId: string) => void
  updateTabTitle: (sessionId: string, title: string, projectPath?: string) => void
  updateTabStatus: (sessionId: string, status: Tab['status']) => void
  replaceTabSession: (oldSessionId: string, newSessionId: string, projectPath?: string) => void
  moveTab: (fromIndex: number, toIndex: number) => void

  saveTabs: () => void
  restoreTabs: () => Promise<void>
}

const RECENT_MAX = 5

function addToRecent(ids: string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, RECENT_MAX)
}

function nextTerminalNumber(tabs: Tab[]): number {
  const used = tabs
    .filter((tab) => tab.type === 'terminal')
    .map((tab) => {
      const match = tab.title.match(/^Terminal\s+(\d+)$/)
      return match ? Number(match[1]) : 0
    })
  return Math.max(0, ...used) + 1
}

function matchesSessionLocator(tab: Tab, sessionId: string, projectPath?: string): boolean {
  if (tab.sessionId !== sessionId) return false
  if (!projectPath) return true
  return !tab.projectPath || tab.projectPath === projectPath
}

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  recentSessionIds: [],

  openTab: (sessionId, title, type = 'session', projectPath) => {
    const { tabs, recentSessionIds } = get()
    const existing = tabs.find((tab) => tab.sessionId === sessionId)
    const newRecent = type === 'session' ? addToRecent(recentSessionIds, sessionId) : recentSessionIds

    if (existing) {
      set({
        tabs: tabs.map((tab) =>
          tab.sessionId === sessionId ? { ...tab, title, type, projectPath } : tab,
        ),
        activeTabId: sessionId,
        recentSessionIds: newRecent,
      })
    } else {
      set({
        tabs: [...tabs, { sessionId, projectPath, title, type, status: 'idle' }],
        activeTabId: sessionId,
        recentSessionIds: newRecent,
      })
    }

    useUIStore.getState().setRailSettingsView(null)
    get().saveTabs()
  },

  openTerminalTab: () => {
    const tabs = get().tabs
    const nextNumber = nextTerminalNumber(tabs)
    let terminalId = `${TERMINAL_TAB_PREFIX}${nextNumber}`
    let suffix = nextNumber
    while (tabs.some((tab) => tab.sessionId === terminalId)) {
      suffix += 1
      terminalId = `${TERMINAL_TAB_PREFIX}${suffix}`
    }
    get().openTab(terminalId, `Terminal ${nextNumber}`, 'terminal')
    return terminalId
  },

  switchToSession: (sessionId, title, projectPath) => {
    get().openTab(sessionId, title, 'session', projectPath)
  },

  closeTab: (sessionId, projectPath) => {
    const { tabs, activeTabId, recentSessionIds } = get()
    const index = tabs.findIndex((tab) => matchesSessionLocator(tab, sessionId, projectPath))
    if (index < 0) return

    const newTabs = tabs.filter((tab) => !matchesSessionLocator(tab, sessionId, projectPath))
    let newActiveId = activeTabId
    let newRecent = recentSessionIds.filter((id) => id !== sessionId)

    if (activeTabId === sessionId) {
      if (newTabs.length === 0) {
        newActiveId = null
      } else if (index >= newTabs.length) {
        newActiveId = newTabs[newTabs.length - 1]!.sessionId
      } else {
        newActiveId = newTabs[index]!.sessionId
      }

      const newActiveTab = newTabs.find((tab) => tab.sessionId === newActiveId)
      if (newActiveTab?.type === 'session' && newActiveId) {
        newRecent = addToRecent(newRecent, newActiveId)
      }
    }

    set({ tabs: newTabs, activeTabId: newActiveId, recentSessionIds: newRecent })
    get().saveTabs()
  },

  setActiveTab: (sessionId) => {
    const { tabs, recentSessionIds } = get()
    const tab = tabs.find((candidate) => candidate.sessionId === sessionId)
    if (!tab) return
    set({
      activeTabId: sessionId,
      recentSessionIds: tab.type === 'session' ? addToRecent(recentSessionIds, sessionId) : recentSessionIds,
    })
    get().saveTabs()
  },

  updateTabTitle: (sessionId, title, projectPath) => {
    set((s) => ({
      tabs: s.tabs.map((tab) =>
        matchesSessionLocator(tab, sessionId, projectPath) ? { ...tab, title } : tab,
      ),
    }))
    get().saveTabs()
  },

  updateTabStatus: (sessionId, status) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.sessionId === sessionId ? { ...t, status } : t)),
    }))
  },

  replaceTabSession: (oldSessionId, newSessionId, projectPath) => {
    const { activeTabId, recentSessionIds, tabs } = get()
    const oldTab = tabs.find((tab) => tab.sessionId === oldSessionId)
    if (!oldTab || oldTab.type !== 'session') {
      get().openTab(newSessionId, getDefaultSessionTitle(t), 'session', projectPath)
      return
    }

    set((s) => ({
      tabs: s.tabs.map((tab) =>
        tab.sessionId === oldSessionId
          ? { ...tab, sessionId: newSessionId, projectPath, title: getDefaultSessionTitle(t), status: 'idle' }
          : tab,
      ),
      activeTabId: activeTabId === oldSessionId ? newSessionId : activeTabId,
      recentSessionIds: addToRecent(
        recentSessionIds.map((id) => (id === oldSessionId ? newSessionId : id)),
        newSessionId,
      ),
    }))
    get().saveTabs()
  },

  moveTab: (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return
    const { tabs } = get()
    if (fromIndex < 0 || fromIndex >= tabs.length || toIndex < 0 || toIndex >= tabs.length) return
    const newTabs = [...tabs]
    const [moved] = newTabs.splice(fromIndex, 1)
    if (!moved) return
    newTabs.splice(toIndex, 0, moved)
    set({ tabs: newTabs })
    get().saveTabs()
  },

  saveTabs: () => {
    const { tabs, activeTabId } = get()
    if (tabs.length === 0) {
      try { localStorage.removeItem(TAB_STORAGE_KEY) } catch { /* noop */ }
      return
    }

    const data: TabPersistence = {
      openTabs: tabs.map((tab) => ({
        sessionId: tab.sessionId,
        projectPath: tab.projectPath,
        title: tab.title,
        type: tab.type,
        status: tab.status,
      })),
      activeTabId: activeTabId && tabs.some((tab) => tab.sessionId === activeTabId)
        ? activeTabId
        : tabs[0]!.sessionId,
    }
    try {
      localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(data))
    } catch { /* noop */ }
  },

  restoreTabs: async () => {
    try {
      const raw = localStorage.getItem(TAB_STORAGE_KEY)
      if (!raw) return

      const parsed = JSON.parse(raw) as Partial<TabPersistence> & {
        activeTitle?: string
        activeType?: TabType
      }
      const persistedTabs = parsed.openTabs && parsed.openTabs.length > 0
        ? parsed.openTabs
        : parsed.activeTabId
          ? [{
              sessionId: parsed.activeTabId,
              title: parsed.activeTitle || getDefaultSessionTitle(t),
              type: parsed.activeType || 'session',
            }]
          : []
      if (persistedTabs.length === 0) return

      // Session tab — verify session still exists
      const { sessions } = await sessionsApi.list({ limit: 200 })
      const restoredTabs: Tab[] = persistedTabs
        .filter((tab) => {
          if (tab.type === 'scheduled') return true
          if (tab.type === 'terminal') return true
          return sessions.some((session) =>
            session.id === tab.sessionId && (!tab.projectPath || session.projectPath === tab.projectPath),
          )
        })
        .map((tab) => {
          if (tab.type === 'scheduled') {
            return { sessionId: SCHEDULED_TAB_ID, title: tab.title || 'Scheduled', type: 'scheduled', status: 'idle' }
          }
          if (tab.type === 'terminal') {
            return { sessionId: tab.sessionId, title: tab.title || 'Terminal', type: 'terminal', status: 'idle' }
          }
          const session = sessions.find((candidate) =>
            candidate.id === tab.sessionId && (!tab.projectPath || candidate.projectPath === tab.projectPath),
          )
          return {
            sessionId: tab.sessionId,
            projectPath: session?.projectPath ?? tab.projectPath,
            title: session ? getSessionDisplayTitle(session, t) : getSessionTitleText(tab.title, t),
            type: 'session',
            status: tab.status || 'idle',
          }
        })

      if (restoredTabs.length === 0) return

      const activeId =
        parsed.activeTabId && restoredTabs.some((tab) => tab.sessionId === parsed.activeTabId)
          ? parsed.activeTabId
          : restoredTabs[0]!.sessionId

      const activeTab = restoredTabs.find((tab) => tab.sessionId === activeId)
      const recentSessionIds = [
        ...(activeTab?.type === 'session' ? [activeId] : []),
        ...restoredTabs
          .filter((tab) => tab.type === 'session' && tab.sessionId !== activeId)
          .map((tab) => tab.sessionId),
      ].slice(0, RECENT_MAX)

      set({ tabs: restoredTabs, activeTabId: activeId, recentSessionIds })
    } catch { /* noop */ }
  },
}))
