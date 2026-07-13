import { create } from 'zustand'
import { sessionsApi } from '../api/sessions'
import { t } from '../i18n'
import { useSessionRuntimeStore } from './sessionRuntimeStore'
import type { CreateSessionInput, SessionListItem } from '../types/session'
import { getDefaultSessionTitle } from '../utils/sessionTitle'

const HIDDEN_SIDEBAR_PROJECTS_KEY = 'cybercode.sidebar.hiddenProjects.v1'
const PROJECT_DISPLAY_NAMES_KEY = 'cybercode.sidebar.projectDisplayNames.v1'

type SessionFilterScope = 'all' | 'project' | 'temporary'

function matchesSessionLocator(session: SessionListItem, id: string, projectPath?: string): boolean {
  if (session.id !== id) return false
  return !projectPath || session.projectPath === projectPath
}

function readHiddenProjectPaths(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HIDDEN_SIDEBAR_PROJECTS_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((item): item is string => typeof item === 'string' && item.length > 0))]
  } catch {
    return []
  }
}

function writeHiddenProjectPaths(projectPaths: string[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(HIDDEN_SIDEBAR_PROJECTS_KEY, JSON.stringify(projectPaths))
}

function readProjectDisplayNames(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROJECT_DISPLAY_NAMES_KEY) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] =>
          entry[0].length > 0 && typeof entry[1] === 'string' && entry[1].trim().length > 0,
        )
        .map(([projectPath, title]) => [projectPath, title.trim().slice(0, 80)]),
    )
  } catch {
    return {}
  }
}

function writeProjectDisplayNames(names: Record<string, string>) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PROJECT_DISPLAY_NAMES_KEY, JSON.stringify(names))
}

function deriveAvailableProjects(
  sessions: SessionListItem[],
  hiddenProjectPaths: string[],
): string[] {
  const hidden = new Set(hiddenProjectPaths)
  return [
    ...new Set(
      sessions
        .filter((s) => !s.isTemporary && !hidden.has(s.projectPath))
        .map((s) => s.projectPath)
        .filter(Boolean),
    ),
  ].sort()
}

function normalizeSelectedProjects(projects: string[], availableProjects?: string[]): string[] {
  const available = availableProjects ? new Set(availableProjects) : null
  return projects.filter((projectPath) => !available || available.has(projectPath)).slice(0, 1)
}

function resolveSessionScope(
  scope: SessionFilterScope | undefined,
  selectedProjects: string[],
): SessionFilterScope {
  if (scope === 'temporary') return 'temporary'
  if (selectedProjects.length > 0) return 'project'
  return 'all'
}

type SessionStore = {
  sessions: SessionListItem[]
  activeSessionId: string | null
  isLoading: boolean
  error: string | null
  selectedProjects: string[]
  selectedSessionScope: SessionFilterScope
  availableProjects: string[]
  hiddenProjectPaths: string[]
  projectDisplayNames: Record<string, string>

  fetchSessions: (project?: string) => Promise<void>
  createSession: (input?: CreateSessionInput) => Promise<string>
  deleteSession: (id: string, projectPath?: string) => Promise<void>
  renameSession: (id: string, title: string, projectPath?: string) => Promise<void>
  updateSessionTitle: (id: string, title: string) => void
  setActiveSession: (id: string | null) => void
  setSelectedProjects: (projects: string[]) => void
  setSessionFilterScope: (scope: SessionFilterScope, projectPath?: string) => void
  renameProject: (projectPath: string, title: string) => void
  hideProject: (projectPath: string) => void
  restoreProject: (projectPath: string) => void
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isLoading: false,
  error: null,
  selectedProjects: [],
  selectedSessionScope: 'all',
  availableProjects: [],
  hiddenProjectPaths: readHiddenProjectPaths(),
  projectDisplayNames: readProjectDisplayNames(),

  fetchSessions: async (project?: string) => {
    set({ isLoading: true, error: null })
    try {
      const { sessions: raw } = await sessionsApi.list({ project, limit: 100 })
      const byLocator = new Map<string, SessionListItem>()
      for (const s of raw) {
        byLocator.set(`${s.id}:${s.projectPath}`, s)
      }
      const sessions = [...byLocator.values()]
      const hiddenProjectPaths = get().hiddenProjectPaths
      const availableProjects = deriveAvailableProjects(sessions, hiddenProjectPaths)
      set((state) => ({
        sessions,
        availableProjects,
        selectedProjects: normalizeSelectedProjects(state.selectedProjects, availableProjects),
        selectedSessionScope: resolveSessionScope(
          state.selectedSessionScope,
          normalizeSelectedProjects(state.selectedProjects, availableProjects),
        ),
        isLoading: false,
      }))
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  createSession: async (input?: CreateSessionInput) => {
    const requestedWorkDir = typeof input === 'string' ? input : input?.workDir
    const isTemporary = typeof input === 'object' && input.temporary === true
    const { sessionId: id, session } = await sessionsApi.create(input)
    const now = new Date().toISOString()
    // Compute projectPath the same way the server does (sanitizePath)
    const resolvedWorkDir = requestedWorkDir || ''
    const projectPath = resolvedWorkDir
      .replace(/[^a-zA-Z0-9]/g, '-')
      .slice(0, 200)
    const optimisticSession: SessionListItem = session ?? {
      id,
      title: getDefaultSessionTitle(t),
      lastMessage: '',
      createdAt: now,
      modifiedAt: now,
      messageCount: 0,
      projectPath,
      workDir: requestedWorkDir ?? null,
      workDirExists: true,
      isTemporary,
    }

    set((state) => ({
      sessions: state.sessions.some((session) =>
        matchesSessionLocator(session, id, optimisticSession.projectPath)
      )
        ? state.sessions
        : [optimisticSession, ...state.sessions],
      hiddenProjectPaths: !isTemporary
        ? state.hiddenProjectPaths.filter((projectPath) => projectPath !== optimisticSession.projectPath)
        : state.hiddenProjectPaths,
      availableProjects: deriveAvailableProjects(
        state.sessions.some((session) => matchesSessionLocator(session, id, optimisticSession.projectPath))
          ? state.sessions
          : [optimisticSession, ...state.sessions],
        !isTemporary
          ? state.hiddenProjectPaths.filter((projectPath) => projectPath !== optimisticSession.projectPath)
          : state.hiddenProjectPaths,
      ),
      activeSessionId: id,
    }))
    if (!isTemporary) {
      writeHiddenProjectPaths(get().hiddenProjectPaths)
    }

    void get().fetchSessions()
    return id
  },

  deleteSession: async (id: string, projectPath?: string) => {
    await sessionsApi.delete(id, { projectPath })
    useSessionRuntimeStore.getState().clearSelection(id)
    set((s) => {
      const sessions = s.sessions.filter((session) => !matchesSessionLocator(session, id, projectPath))
      const availableProjects = deriveAvailableProjects(sessions, s.hiddenProjectPaths)
      const selectedProjects = normalizeSelectedProjects(s.selectedProjects, availableProjects)
      return {
        sessions,
        availableProjects,
        selectedProjects,
        selectedSessionScope: resolveSessionScope(s.selectedSessionScope, selectedProjects),
        activeSessionId: s.activeSessionId === id &&
          !s.sessions.some((session) => session.id === id && !matchesSessionLocator(session, id, projectPath))
          ? null
          : s.activeSessionId,
      }
    })
  },

  renameSession: async (id: string, title: string, projectPath?: string) => {
    await sessionsApi.rename(id, title, { projectPath })
    set((s) => ({
      sessions: s.sessions.map((session) =>
        matchesSessionLocator(session, id, projectPath) ? { ...session, title } : session,
      ),
    }))
  },

  updateSessionTitle: (id, title) => {
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id ? { ...session, title } : session,
      ),
    }))
  },

  setActiveSession: (id) => set({ activeSessionId: id }),
  setSelectedProjects: (projects) => {
    const selectedProjects = normalizeSelectedProjects(projects)
    set({
      selectedProjects,
      selectedSessionScope: selectedProjects.length > 0 ? 'project' : 'all',
    })
  },
  setSessionFilterScope: (scope, projectPath) => {
    if (scope === 'project' && projectPath) {
      set({
        selectedProjects: [projectPath],
        selectedSessionScope: 'project',
      })
      return
    }

    set({
      selectedProjects: [],
      selectedSessionScope: scope === 'temporary' ? 'temporary' : 'all',
    })
  },
  renameProject: (projectPath, title) => {
    const normalizedTitle = title.trim().slice(0, 80)
    set((state) => {
      const projectDisplayNames = { ...state.projectDisplayNames }
      if (normalizedTitle) {
        projectDisplayNames[projectPath] = normalizedTitle
      } else {
        delete projectDisplayNames[projectPath]
      }
      writeProjectDisplayNames(projectDisplayNames)
      return { projectDisplayNames }
    })
  },
  hideProject: (projectPath) => {
    set((state) => {
      if (state.hiddenProjectPaths.includes(projectPath)) return {}
      const hiddenProjectPaths = [...state.hiddenProjectPaths, projectPath].sort()
      writeHiddenProjectPaths(hiddenProjectPaths)
      const availableProjects = deriveAvailableProjects(state.sessions, hiddenProjectPaths)
      const selectedProjects = normalizeSelectedProjects(
        state.selectedProjects.filter((selected) => selected !== projectPath),
        availableProjects,
      )
      return {
        hiddenProjectPaths,
        availableProjects,
        selectedProjects,
        selectedSessionScope: resolveSessionScope(state.selectedSessionScope, selectedProjects),
      }
    })
  },
  restoreProject: (projectPath) => {
    set((state) => {
      if (!state.hiddenProjectPaths.includes(projectPath)) return {}
      const hiddenProjectPaths = state.hiddenProjectPaths.filter((hidden) => hidden !== projectPath)
      writeHiddenProjectPaths(hiddenProjectPaths)
      return {
        hiddenProjectPaths,
        availableProjects: deriveAvailableProjects(state.sessions, hiddenProjectPaths),
      }
    })
  },
}))
