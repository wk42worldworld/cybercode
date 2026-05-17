import { api } from './client'

export type StatusHealthResponse = {
  status: string
  version: string
  uptime: number
}

export type StatusDiagnosticsResponse = {
  nodeVersion: string
  bunVersion: string
  platform: string
  arch: string
  configDir: string
  memory: {
    rss: number
    heapUsed: number
    heapTotal: number
  }
}

export const statusApi = {
  health() {
    return api.get<StatusHealthResponse>('/api/status')
  },

  diagnostics() {
    return api.get<StatusDiagnosticsResponse>('/api/status/diagnostics')
  },
}
