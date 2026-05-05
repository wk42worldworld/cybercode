import { create } from 'zustand'
import { sessionsApi } from '../api/sessions'

const TAB_STORAGE_KEY = 'cybercode-open-tabs'

export const SCHEDULED_TAB_ID = '__scheduled__'
export const TERMINAL_TAB_ID = '__terminal__'
export const TERMINAL_TAB_PREFIX = '__terminal__'

export type TabType = 'session' | 'scheduled' | 'terminal'

export type Tab = {
  sessionId: string
  title: string
  type: TabType
  status: 'idle' | 'running' | 'error'
}

type TabPersistence = {
  openTabs: Array<{ sessionId: string; title: string; type?: TabType }>
  activeTabId: string | null
}

type TabStore = {
  tabs: Tab[]
  activeTabId: string | null
  /** Last N session-type tab IDs visited — kept mounted for instant switching */
  recentSessionIds: string[]

  openTab: (sessionId: string, title: string, type?: TabType) => void
  openTerminalTab: () => string
  switchToSession: (sessionId: string, title: string) => void
  closeTab: (sessionId: string) => void
  setActiveTab: (sessionId: string) => void
  updateTabTitle: (sessionId: string, title: string) => void
  updateTabStatus: (sessionId: string, status: Tab['status']) => void
  replaceTabSession: (oldSessionId: string, newSessionId: string) => void
  moveTab: (fromIndex: number, toIndex: number) => void

  saveTabs: () => void
  restoreTabs: () => Promise<void>
}

const RECENT_MAX = 1

function addToRecent(ids: string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, RECENT_MAX)
}

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  recentSessionIds: [],

  openTab: (sessionId, title, type = 'session') => {
    const { tabs, recentSessionIds } = get()
    const existing = tabs.find((t) => t.sessionId === sessionId)
    const newRecent = type === 'session' ? addToRecent(recentSessionIds, sessionId) : recentSessionIds
    if (existing) {
      set({ activeTabId: sessionId, recentSessionIds: newRecent })
    } else {
      set({
        tabs: [...tabs, { sessionId, title, type, status: 'idle' }],
        activeTabId: sessionId,
        recentSessionIds: newRecent,
      })
    }
    get().saveTabs()
  },

  openTerminalTab: () => {
    get().openTab(TERMINAL_TAB_ID, 'Terminal', 'terminal')
    return TERMINAL_TAB_ID
  },

  switchToSession: (sessionId, title) => {
    const { tabs, activeTabId, recentSessionIds } = get()
    const newRecent = addToRecent(recentSessionIds, sessionId)

    // Already open as a tab — just activate it
    if (tabs.some((tab) => tab.sessionId === sessionId)) {
      set({ activeTabId: sessionId, recentSessionIds: newRecent })
      get().saveTabs()
      return
    }

    const activeTab = tabs.find((tab) => tab.sessionId === activeTabId)
    // Replace in place when active tab is a session tab; otherwise open a new tab
    if (activeTab && activeTab.type === 'session') {
      set({
        tabs: tabs.map((tab) =>
          tab.sessionId === activeTabId
            ? { sessionId, title, type: 'session', status: 'idle' }
            : tab,
        ),
        activeTabId: sessionId,
        recentSessionIds: newRecent,
      })
      get().saveTabs()
      return
    }

    get().openTab(sessionId, title, 'session')
  },

  closeTab: (sessionId) => {
    const { tabs, activeTabId, recentSessionIds } = get()
    const index = tabs.findIndex((t) => t.sessionId === sessionId)
    if (index < 0) return

    const newTabs = tabs.filter((t) => t.sessionId !== sessionId)
    let newActiveId = activeTabId

    if (activeTabId === sessionId) {
      if (newTabs.length === 0) {
        newActiveId = null
      } else if (index >= newTabs.length) {
        newActiveId = newTabs[newTabs.length - 1]!.sessionId
      } else {
        newActiveId = newTabs[index]!.sessionId
      }
    }

    set({
      tabs: newTabs,
      activeTabId: newActiveId,
      recentSessionIds: recentSessionIds.filter((id) => id !== sessionId),
    })
    get().saveTabs()
  },

  setActiveTab: (sessionId) => {
    const { tabs, recentSessionIds } = get()
    const tab = tabs.find((t) => t.sessionId === sessionId)
    const newRecent = tab?.type === 'session' ? addToRecent(recentSessionIds, sessionId) : recentSessionIds
    set({ activeTabId: sessionId, recentSessionIds: newRecent })
    get().saveTabs()
  },

  updateTabTitle: (sessionId, title) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.sessionId === sessionId ? { ...t, title } : t)),
    }))
    get().saveTabs()
  },

  updateTabStatus: (sessionId, status) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.sessionId === sessionId ? { ...t, status } : t)),
    }))
  },

  replaceTabSession: (oldSessionId, newSessionId) => {
    const { activeTabId, recentSessionIds } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.sessionId === oldSessionId ? { ...t, sessionId: newSessionId } : t,
      ),
      activeTabId: activeTabId === oldSessionId ? newSessionId : activeTabId,
      recentSessionIds: recentSessionIds.map((id) => (id === oldSessionId ? newSessionId : id)),
    }))
    get().saveTabs()
  },

  moveTab: (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return
    const { tabs } = get()
    if (fromIndex < 0 || fromIndex >= tabs.length || toIndex < 0 || toIndex >= tabs.length) return
    const newTabs = [...tabs]
    const [moved] = newTabs.splice(fromIndex, 1)
    newTabs.splice(toIndex, 0, moved!)
    set({ tabs: newTabs })
    get().saveTabs()
  },

  saveTabs: () => {
    const { tabs, activeTabId } = get()
    const persistableTabs = tabs.filter((tab) => tab.type !== 'terminal')
    const data: TabPersistence = {
      openTabs: persistableTabs.map((t) => ({ sessionId: t.sessionId, title: t.title, type: t.type })),
      activeTabId: activeTabId && persistableTabs.some((tab) => tab.sessionId === activeTabId)
        ? activeTabId
        : (persistableTabs[0]?.sessionId ?? null),
    }
    try {
      localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(data))
    } catch { /* noop */ }
  },

  restoreTabs: async () => {
    try {
      const raw = localStorage.getItem(TAB_STORAGE_KEY)
      if (!raw) return

      const data = JSON.parse(raw) as TabPersistence
      if (!data.openTabs || data.openTabs.length === 0) return

      const { sessions } = await sessionsApi.list({ limit: 200 })
      const existingIds = new Set(sessions.map((s) => s.id))

      const validTabs: Tab[] = data.openTabs
        .filter((t) => {
          if (t.type === 'scheduled') return true
          if (t.type === 'terminal') return false
          return existingIds.has(t.sessionId)
        })
        .map((t) => {
          if (t.type === 'scheduled') {
            return { sessionId: t.sessionId, title: t.title, type: t.type, status: 'idle' as const }
          }
          return {
            sessionId: t.sessionId,
            title: sessions.find((s) => s.id === t.sessionId)?.title || t.title,
            type: 'session' as const,
            status: 'idle' as const,
          }
        })

      if (validTabs.length === 0) return

      const activeId = data.activeTabId && validTabs.some((t) => t.sessionId === data.activeTabId)
        ? data.activeTabId
        : validTabs[0]!.sessionId

      // Seed recentSessionIds: active session first, then other session tabs (up to RECENT_MAX)
      const recentSessionIds = [
        activeId,
        ...validTabs
          .filter((t) => t.type === 'session' && t.sessionId !== activeId)
          .map((t) => t.sessionId),
      ].slice(0, RECENT_MAX)

      set({ tabs: validTabs, activeTabId: activeId, recentSessionIds })
    } catch { /* noop */ }
  },
}))
