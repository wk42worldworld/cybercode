import { create } from 'zustand'
import { mcpApi } from '../api/mcp'
import type { McpServerRecord, McpUpsertPayload } from '../types/mcp'

type McpStore = {
  servers: McpServerRecord[]
  selectedServer: McpServerRecord | null
  isLoading: boolean
  error: string | null
  fetchServers: (projectPaths?: string[], fallbackCwd?: string) => Promise<void>
  createServer: (name: string, payload: McpUpsertPayload, cwd?: string) => Promise<McpServerRecord>
  updateServer: (server: McpServerRecord, payload: McpUpsertPayload, cwd?: string) => Promise<McpServerRecord>
  deleteServer: (server: McpServerRecord, cwd?: string) => Promise<void>
  toggleServer: (server: McpServerRecord, cwd?: string) => Promise<McpServerRecord>
  reconnectServer: (server: McpServerRecord, cwd?: string) => Promise<McpServerRecord>
  refreshServerStatus: (server: McpServerRecord, cwd?: string) => Promise<McpServerRecord>
  selectServer: (server: McpServerRecord | null) => void
}

function isProjectScoped(server: Pick<McpServerRecord, 'scope'>) {
  return server.scope === 'local' || server.scope === 'project'
}

function attachProjectPath(server: McpServerRecord, cwd?: string) {
  if (!isProjectScoped(server)) {
    return {
      ...server,
      projectPath: undefined,
    }
  }

  return {
    ...server,
    projectPath: cwd ?? server.projectPath,
  }
}

function isSameServer(a: Pick<McpServerRecord, 'name' | 'scope' | 'projectPath'>, b: Pick<McpServerRecord, 'name' | 'scope' | 'projectPath'>) {
  if (a.name !== b.name || a.scope !== b.scope) return false
  if (!isProjectScoped(a) && !isProjectScoped(b)) return true
  return (a.projectPath ?? '') === (b.projectPath ?? '')
}

function replaceServer(
  servers: McpServerRecord[],
  previous: Pick<McpServerRecord, 'name' | 'scope' | 'projectPath'>,
  next: McpServerRecord,
  cwd?: string,
) {
  const normalizedNext = attachProjectPath(next, cwd)
  const index = servers.findIndex((item) => isSameServer(item, previous))
  if (index === -1) return [...servers, normalizedNext]

  return servers.map((item, itemIndex) => (itemIndex === index ? normalizedNext : item))
}

export const useMcpStore = create<McpStore>((set) => ({
  servers: [],
  selectedServer: null,
  isLoading: false,
  error: null,

  fetchServers: async (projectPaths, fallbackCwd) => {
    set({ isLoading: true, error: null })
    try {
      const normalizedPaths = Array.from(new Set((projectPaths ?? []).filter(Boolean)))
      const contexts = normalizedPaths.length > 0 ? normalizedPaths : [fallbackCwd].filter(Boolean)

      const responses = await Promise.all(
        (contexts.length > 0 ? contexts : [undefined]).map(async (cwd) => {
          const response = await mcpApi.list(cwd)
          return response.servers.map((server) => ({
            ...server,
            projectPath: server.scope === 'local' || server.scope === 'project' ? cwd : undefined,
          }))
        }),
      )

      const deduped = new Map<string, McpServerRecord>()
      for (const group of responses) {
        for (const server of group) {
          const key =
            server.scope === 'local' || server.scope === 'project'
              ? `${server.scope}:${server.projectPath}:${server.name}`
              : `${server.scope}:${server.name}`
          if (!deduped.has(key)) {
            deduped.set(key, server)
          }
        }
      }

      set({ servers: [...deduped.values()], isLoading: false })
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load MCP servers',
      })
    }
  },

  createServer: async (name, payload, cwd) => {
    const response = await mcpApi.create(name, payload, cwd)
    const created = attachProjectPath(response.server, cwd)
    set((state) => ({
      servers: [...state.servers, created],
      selectedServer: created,
      error: null,
    }))
    return created
  },

  updateServer: async (server, payload, cwd) => {
    const response = await mcpApi.update(server.name, payload, cwd)
    const updated = attachProjectPath(response.server, cwd ?? server.projectPath)
    set((state) => ({
      servers: replaceServer(state.servers, server, updated, cwd ?? server.projectPath),
      selectedServer: state.selectedServer && isSameServer(state.selectedServer, server) ? updated : state.selectedServer,
      error: null,
    }))
    return updated
  },

  deleteServer: async (server, cwd) => {
    await mcpApi.remove(server.name, server.scope, cwd)
    set((state) => ({
      servers: state.servers.filter((item) => !isSameServer(item, server)),
      selectedServer:
        state.selectedServer && isSameServer(state.selectedServer, server)
          ? null
          : state.selectedServer,
      error: null,
    }))
  },

  toggleServer: async (server, cwd) => {
    const response = await mcpApi.toggle(server.name, cwd)
    const updated = attachProjectPath(response.server, cwd ?? server.projectPath)
    set((state) => ({
      servers: replaceServer(state.servers, server, updated, cwd ?? server.projectPath),
      selectedServer: state.selectedServer && isSameServer(state.selectedServer, server) ? updated : state.selectedServer,
      error: null,
    }))
    return updated
  },

  reconnectServer: async (server, cwd) => {
    const response = await mcpApi.reconnect(server.name, cwd)
    const updated = attachProjectPath(response.server, cwd ?? server.projectPath)
    set((state) => ({
      servers: replaceServer(state.servers, server, updated, cwd ?? server.projectPath),
      selectedServer: state.selectedServer && isSameServer(state.selectedServer, server) ? updated : state.selectedServer,
      error: null,
    }))
    return updated
  },

  refreshServerStatus: async (server, cwd) => {
    const response = await mcpApi.status(server.name, cwd)
    const updated = attachProjectPath(response.server, cwd ?? server.projectPath)
    set((state) => ({
      servers: replaceServer(state.servers, server, updated, cwd ?? server.projectPath),
      selectedServer: state.selectedServer && isSameServer(state.selectedServer, server) ? updated : state.selectedServer,
      error: null,
    }))
    return updated
  },

  selectServer: (server) => set({ selectedServer: server }),
}))
