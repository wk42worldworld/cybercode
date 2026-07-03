import { create } from 'zustand'
import { sessionsApi } from '../api/sessions'
import { t } from '../i18n'
import { useSessionRuntimeStore } from './sessionRuntimeStore'
import type { CreateSessionInput, SessionListItem } from '../types/session'
import { getDefaultSessionTitle } from '../utils/sessionTitle'

function matchesSessionLocator(session: SessionListItem, id: string, projectPath?: string): boolean {
  if (session.id !== id) return false
  return !projectPath || session.projectPath === projectPath
}

type SessionStore = {
  sessions: SessionListItem[]
  activeSessionId: string | null
  isLoading: boolean
  error: string | null
  selectedProjects: string[]
  availableProjects: string[]

  fetchSessions: (project?: string) => Promise<void>
  createSession: (input?: CreateSessionInput) => Promise<string>
  deleteSession: (id: string, projectPath?: string) => Promise<void>
  renameSession: (id: string, title: string, projectPath?: string) => Promise<void>
  updateSessionTitle: (id: string, title: string) => void
  setActiveSession: (id: string | null) => void
  setSelectedProjects: (projects: string[]) => void
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isLoading: false,
  error: null,
  selectedProjects: [],
  availableProjects: [],

  fetchSessions: async (project?: string) => {
    set({ isLoading: true, error: null })
    try {
      const { sessions: raw } = await sessionsApi.list({ project, limit: 100 })
      const byLocator = new Map<string, SessionListItem>()
      for (const s of raw) {
        byLocator.set(`${s.id}:${s.projectPath}`, s)
      }
      const sessions = [...byLocator.values()]
      const availableProjects = [
        ...new Set(
          sessions
            .filter((s) => !s.isTemporary)
            .map((s) => s.projectPath)
            .filter(Boolean),
        ),
      ].sort()
      set({ sessions, availableProjects, isLoading: false })
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
      sessions: state.sessions.some((session) => session.id === id)
        ? state.sessions
        : [optimisticSession, ...state.sessions],
      activeSessionId: id,
    }))

    void get().fetchSessions()
    return id
  },

  deleteSession: async (id: string, projectPath?: string) => {
    await sessionsApi.delete(id, { projectPath })
    useSessionRuntimeStore.getState().clearSelection(id)
    set((s) => ({
      sessions: s.sessions.filter((session) => !matchesSessionLocator(session, id, projectPath)),
      activeSessionId: s.activeSessionId === id &&
        !s.sessions.some((session) => session.id === id && !matchesSessionLocator(session, id, projectPath))
        ? null
        : s.activeSessionId,
    }))
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
  setSelectedProjects: (projects) => set({ selectedProjects: projects }),
}))
