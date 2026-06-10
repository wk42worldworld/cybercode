import { api } from './client'

export type PromptMemoryTarget = 'soul' | 'brief' | 'user'
export type PromptMemoryFormat = 'empty' | 'plain' | 'entries'

export type PromptMemoryFile = {
  target: PromptMemoryTarget
  filename: string
  path: string
  exists: boolean
  content: string
  entries: string[]
  format: PromptMemoryFormat
  charCount: number
  limit: number
  overLimit: boolean
}

export type PromptMemoryStatus = {
  files: Record<PromptMemoryTarget, PromptMemoryFile>
}

export type PromptMemoryAutoReviewLogEntry = {
  id: string
  timestamp: string
  sessionId: string
  trigger: 'explicit' | 'interval'
  target: Exclude<PromptMemoryTarget, 'soul'>
  action: 'add' | 'replace' | 'remove'
  changed: boolean
  content?: string
  oldText?: string
  message: string
}

export const promptMemoryApi = {
  status: () => api.get<PromptMemoryStatus>('/api/prompt-memory'),

  logs: (limit = 20) =>
    api.get<PromptMemoryAutoReviewLogEntry[]>(`/api/prompt-memory/logs?limit=${limit}`),

  read: (target: PromptMemoryTarget) =>
    api.get<PromptMemoryFile>(`/api/prompt-memory/${target}`),

  write: (target: PromptMemoryTarget, content: string) =>
    api.put<PromptMemoryFile>(`/api/prompt-memory/${target}`, { content }),
}
