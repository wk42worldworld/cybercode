import { api } from './client'
import type {
  PluginDetail,
  PluginListResponse,
  PluginMarketplaceCatalog,
  PluginMarketplaceItem,
  PluginReloadSummary,
  PluginScope,
} from '../types/plugin'

type PluginActionPayload = {
  id: string
  scope?: PluginScope
  keepData?: boolean
}

export const pluginsApi = {
  list: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<PluginListResponse>(`/api/plugins${query}`)
  },

  detail: (id: string, cwd?: string) => {
    const query = new URLSearchParams({ id })
    if (cwd) query.set('cwd', cwd)
    return api.get<{ detail: PluginDetail }>(`/api/plugins/detail?${query.toString()}`)
  },

  enable: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/enable', payload),

  disable: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/disable', payload),

  update: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/update', payload),

  uninstall: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/uninstall', payload),

  reload: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.post<{ ok: true; summary: PluginReloadSummary }>(
      `/api/plugins/reload${query}`,
      undefined,
      { timeout: 120_000 },
    )
  },

  marketplace: (refresh = false, signal?: AbortSignal) => {
    const query = refresh ? '?refresh=true' : ''
    return api.get<{ catalog: PluginMarketplaceCatalog }>(
      `/api/plugins/marketplace${query}`,
      { timeout: 240_000, signal },
    )
  },

  installMarketplaceItem: (id: string) =>
    api.post<{
      ok: true
      item: PluginMarketplaceItem
      updated: boolean
      message: string
    }>(
      '/api/plugins/marketplace/install',
      { id },
      { timeout: 240_000 },
    ),
}
