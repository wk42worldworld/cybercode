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
  unviewedCompleted?: boolean
}

type TabPersistence = {
  openTabs: Array<{ sessionId: string; projectPath?: string; title: string; type?: TabType; status?: Tab['status']; unviewedCompleted?: boolean }>
  activeTabId: string | null
  activeTabKey?: string | null
}

type TabStore = {
  tabs: Tab[]
  activeTabId: string | null
  activeTabKey: string | null
  /** Last N session-type tab IDs visited — kept mounted for instant switching */
  recentSessionIds: string[]
  recentSessionKeys: string[]

  openTab: (sessionId: string, title: string, type?: TabType, projectPath?: string) => void
  openTerminalTab: () => string
  switchToSession: (sessionId: string, title: string, projectPath?: string) => void
  closeTab: (sessionId: string, projectPath?: string) => void
  setActiveTab: (sessionId: string, projectPath?: string) => void
  updateTabTitle: (sessionId: string, title: string, projectPath?: string) => void
  updateTabStatus: (sessionId: string, status: Tab['status']) => void
  replaceTabSession: (oldSessionId: string, newSessionId: string, projectPath?: string) => void
  moveTab: (fromIndex: number, toIndex: number) => void

  saveTabs: () => void
  restoreTabs: () => Promise<void>
}

const RECENT_MAX = 5
const TAB_LOCATOR_SEPARATOR = '\u0000'

function addToRecent(ids: string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, RECENT_MAX)
}

export function tabLocatorKey(sessionId: string, projectPath?: string): string {
  return projectPath ? `${sessionId}${TAB_LOCATOR_SEPARATOR}${projectPath}` : sessionId
}

export function getTabKey(tab: Pick<Tab, 'sessionId' | 'projectPath'>): string {
  return tabLocatorKey(tab.sessionId, tab.projectPath)
}

function findLastTabBySessionId(tabs: Tab[], sessionId: string): Tab | undefined {
  for (let index = tabs.length - 1; index >= 0; index -= 1) {
    const tab = tabs[index]
    if (tab?.sessionId === sessionId) return tab
  }
  return undefined
}

export function findActiveTab(
  tabs: Tab[],
  activeTabKey: string | null | undefined,
  activeTabId: string | null | undefined,
): Tab | undefined {
  if (activeTabKey) {
    const keyed = tabs.find((tab) => getTabKey(tab) === activeTabKey)
    if (keyed) return keyed
  }
  return activeTabId ? findLastTabBySessionId(tabs, activeTabId) : undefined
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

function findTabIndexByLocator(tabs: Tab[], sessionId: string, projectPath?: string): number {
  return tabs.findIndex((tab) => matchesSessionLocator(tab, sessionId, projectPath))
}

function deriveRecentSessionKeys(tabs: Tab[], recentSessionIds: string[], recentSessionKeys: string[]): string[] {
  if (recentSessionKeys.length > 0) return recentSessionKeys
  return recentSessionIds
    .map((sessionId) => tabs.find((tab) => tab.type === 'session' && tab.sessionId === sessionId))
    .filter((tab): tab is Tab => Boolean(tab))
    .map(getTabKey)
}

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  activeTabKey: null,
  recentSessionIds: [],
  recentSessionKeys: [],

  openTab: (sessionId, title, type = 'session', projectPath) => {
    const { tabs, recentSessionIds, recentSessionKeys } = get()
    const seededRecentKeys = deriveRecentSessionKeys(tabs, recentSessionIds, recentSessionKeys)
    const existingIndex = findTabIndexByLocator(tabs, sessionId, projectPath)
    const existing = existingIndex >= 0 ? tabs[existingIndex] : undefined
    const activeKey = tabLocatorKey(sessionId, projectPath ?? existing?.projectPath)
    const newRecent = type === 'session' ? addToRecent(recentSessionIds, sessionId) : recentSessionIds
    const newRecentKeys = type === 'session' ? addToRecent(seededRecentKeys, activeKey) : seededRecentKeys

    if (existing) {
      set({
        tabs: tabs.map((tab) =>
          tab === existing ? { ...tab, title, type, projectPath: projectPath ?? tab.projectPath, unviewedCompleted: false } : tab,
        ),
        activeTabId: sessionId,
        activeTabKey: activeKey,
        recentSessionIds: newRecent,
        recentSessionKeys: newRecentKeys,
      })
    } else {
      set({
        tabs: [...tabs, { sessionId, projectPath, title, type, status: 'idle' }],
        activeTabId: sessionId,
        activeTabKey: activeKey,
        recentSessionIds: newRecent,
        recentSessionKeys: newRecentKeys,
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
    const { tabs, activeTabId, activeTabKey, recentSessionIds, recentSessionKeys } = get()
    const seededRecentKeys = deriveRecentSessionKeys(tabs, recentSessionIds, recentSessionKeys)
    const index = findTabIndexByLocator(tabs, sessionId, projectPath)
    if (index < 0) return
    const closedTab = tabs[index]!
    const closedKey = getTabKey(closedTab)

    const newTabs = tabs.filter((tab) => tab !== closedTab)
    let newActiveId = activeTabId
    let newActiveKey = activeTabKey
    let newRecent = recentSessionIds.filter((id) =>
      id !== sessionId || newTabs.some((tab) => tab.type === 'session' && tab.sessionId === id)
    )
    let newRecentKeys = seededRecentKeys.filter((key) => key !== closedKey)
    const isClosingActive = activeTabKey
      ? activeTabKey === closedKey
      : activeTabId === sessionId

    if (isClosingActive) {
      if (newTabs.length === 0) {
        newActiveId = null
        newActiveKey = null
      } else if (index >= newTabs.length) {
        const nextTab = newTabs[newTabs.length - 1]!
        newActiveId = nextTab.sessionId
        newActiveKey = getTabKey(nextTab)
      } else {
        const nextTab = newTabs[index]!
        newActiveId = nextTab.sessionId
        newActiveKey = getTabKey(nextTab)
      }

      const newActiveTab = findActiveTab(newTabs, newActiveKey, newActiveId)
      if (newActiveTab?.type === 'session' && newActiveId) {
        newRecent = addToRecent(newRecent, newActiveId)
        newRecentKeys = addToRecent(newRecentKeys, getTabKey(newActiveTab))
      }
    }

    set({ tabs: newTabs, activeTabId: newActiveId, activeTabKey: newActiveKey, recentSessionIds: newRecent, recentSessionKeys: newRecentKeys })
    get().saveTabs()
  },

  setActiveTab: (sessionId, projectPath) => {
    const { tabs, recentSessionIds, recentSessionKeys } = get()
    const seededRecentKeys = deriveRecentSessionKeys(tabs, recentSessionIds, recentSessionKeys)
    const index = findTabIndexByLocator(tabs, sessionId, projectPath)
    const tab = index >= 0 ? tabs[index] : undefined
    if (!tab) return
    const activeKey = getTabKey(tab)
    set({
      activeTabId: sessionId,
      recentSessionIds: tab.type === 'session' ? addToRecent(recentSessionIds, sessionId) : recentSessionIds,
      activeTabKey: activeKey,
      recentSessionKeys: tab.type === 'session' ? addToRecent(seededRecentKeys, activeKey) : seededRecentKeys,
      tabs: tabs.map((t) => t.sessionId === sessionId ? { ...t, unviewedCompleted: false } : t),
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
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.sessionId !== sessionId) return t
        const unviewedCompleted = status === 'idle' && t.status === 'running' && t.sessionId !== activeTabId
          ? true
          : status === 'running'
            ? false
            : t.unviewedCompleted
        return { ...t, status, unviewedCompleted }
      }),
    }))
  },

  replaceTabSession: (oldSessionId, newSessionId, projectPath) => {
    const { activeTabId, activeTabKey, recentSessionIds, recentSessionKeys, tabs } = get()
    const oldTab = tabs.find((tab) => matchesSessionLocator(tab, oldSessionId, projectPath))
    if (!oldTab || oldTab.type !== 'session') {
      get().openTab(newSessionId, getDefaultSessionTitle(t), 'session', projectPath)
      return
    }
    const oldKey = getTabKey(oldTab)
    const nextKey = tabLocatorKey(newSessionId, projectPath ?? oldTab.projectPath)

    set((s) => ({
      tabs: s.tabs.map((tab) =>
        tab === oldTab
          ? { ...tab, sessionId: newSessionId, projectPath: projectPath ?? tab.projectPath, title: getDefaultSessionTitle(t), status: 'idle' }
          : tab,
      ),
      activeTabId: activeTabId === oldSessionId ? newSessionId : activeTabId,
      activeTabKey: activeTabKey === oldKey ? nextKey : activeTabKey,
      recentSessionIds: addToRecent(
        recentSessionIds.map((id) => (id === oldSessionId ? newSessionId : id)),
        newSessionId,
      ),
      recentSessionKeys: addToRecent(
        recentSessionKeys.map((key) => (key === oldKey ? nextKey : key)),
        nextKey,
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
    const { tabs, activeTabId, activeTabKey } = get()
    if (tabs.length === 0) {
      try { localStorage.removeItem(TAB_STORAGE_KEY) } catch { /* noop */ }
      return
    }
    const activeTab = findActiveTab(tabs, activeTabKey, activeTabId) ?? tabs[0]!

    const data: TabPersistence = {
      openTabs: tabs.map((tab) => ({
        sessionId: tab.sessionId,
        projectPath: tab.projectPath,
        title: tab.title,
        type: tab.type,
        status: tab.status,
        unviewedCompleted: tab.unviewedCompleted,
      })),
      activeTabId: activeTab.sessionId,
      activeTabKey: getTabKey(activeTab),
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
            status: 'idle',
            unviewedCompleted: tab.unviewedCompleted,
          }
        })

      if (restoredTabs.length === 0) return

      const restoredActiveTab = findActiveTab(restoredTabs, parsed.activeTabKey, parsed.activeTabId) ?? restoredTabs[0]!
      const activeId = restoredActiveTab.sessionId
      const activeKey = getTabKey(restoredActiveTab)
      const recentSessionIds = [
        ...(restoredActiveTab.type === 'session' ? [activeId] : []),
        ...restoredTabs
          .filter((tab) => tab.type === 'session' && getTabKey(tab) !== activeKey)
          .map((tab) => tab.sessionId),
      ].slice(0, RECENT_MAX)
      const recentSessionKeys = [
        ...(restoredActiveTab.type === 'session' ? [activeKey] : []),
        ...restoredTabs
          .filter((tab) => tab.type === 'session' && getTabKey(tab) !== activeKey)
          .map(getTabKey),
      ].slice(0, RECENT_MAX)

      set({ tabs: restoredTabs, activeTabId: activeId, activeTabKey: activeKey, recentSessionIds, recentSessionKeys })
    } catch { /* noop */ }
  },
}))
