import { api } from './client'
import type { McpServerRecord, McpUpsertPayload } from '../types/mcp'

export const mcpApi = {
  list: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<{ servers: McpServerRecord[] }>(`/api/mcp${query}`)
  },

  status: (name: string, cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<{ server: McpServerRecord }>(`/api/mcp/${encodeURIComponent(name)}/status${query}`)
  },

  create: (name: string, payload: McpUpsertPayload, cwd?: string) => {
    return api.post<{ server: McpServerRecord }>('/api/mcp', {
      name,
      ...payload,
      ...(cwd ? { cwd } : {}),
    })
  },

  update: (name: string, payload: McpUpsertPayload, cwd?: string) => {
    return api.put<{ server: McpServerRecord }>(`/api/mcp/${encodeURIComponent(name)}`, {
      ...payload,
      ...(cwd ? { cwd } : {}),
    })
  },

  remove: (name: string, scope: string, cwd?: string) => {
    const query = new URLSearchParams({ scope })
    if (cwd) query.set('cwd', cwd)
    return api.delete<{ ok: true }>(`/api/mcp/${encodeURIComponent(name)}?${query.toString()}`)
  },

  toggle: (name: string, cwd?: string) => {
    return api.post<{ server: McpServerRecord }>(`/api/mcp/${encodeURIComponent(name)}/toggle`, cwd ? { cwd } : {})
  },

  reconnect: (name: string, cwd?: string) => {
    return api.post<{ server: McpServerRecord }>(`/api/mcp/${encodeURIComponent(name)}/reconnect`, cwd ? { cwd } : {})
  },
}
