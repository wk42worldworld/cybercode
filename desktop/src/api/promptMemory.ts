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

export type PromptMemoryConfig = {
  version: 1
  injectEvolutionMemory: boolean
  updatedAt?: string
}

export type PromptMemoryStatus = {
  files: Record<PromptMemoryTarget, PromptMemoryFile>
  config: PromptMemoryConfig
}

type PromptMemoryStatusResponse = Omit<PromptMemoryStatus, 'config'> & {
  config?: PromptMemoryConfig
}

const DEFAULT_PROMPT_MEMORY_CONFIG: PromptMemoryConfig = {
  version: 1,
  injectEvolutionMemory: true,
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

export type PromptMemoryInsightCategory =
  | 'identity'
  | 'communication'
  | 'collaboration'
  | 'workflow'
  | 'quality'
  | 'boundaries'
  | 'expertise'
  | 'meta-method'
  | 'environment'
  | 'lesson'
  | 'other'

export type PromptMemoryInsight = {
  id: string
  target: 'user' | 'brief'
  category: PromptMemoryInsightCategory
  content: string
  raw: string
  source: 'explicit' | 'observed' | 'manual'
  updatedAt?: string
}

export type PromptMemoryInsights = {
  insights: PromptMemoryInsight[]
  stats: {
    total: number
    user: number
    methods: number
    dimensions: number
    automaticUpdates: number
  }
}

export const promptMemoryApi = {
  status: async (): Promise<PromptMemoryStatus> => {
    const status = await api.get<PromptMemoryStatusResponse>('/api/prompt-memory')
    return {
      ...status,
      config: status.config ?? DEFAULT_PROMPT_MEMORY_CONFIG,
    }
  },

  logs: (limit = 20) =>
    api.get<PromptMemoryAutoReviewLogEntry[]>(`/api/prompt-memory/logs?limit=${limit}`),

  insights: () =>
    api.get<PromptMemoryInsights>('/api/prompt-memory/insights'),

  updateConfig: (injectEvolutionMemory: boolean) =>
    api.patch<PromptMemoryConfig>('/api/prompt-memory/config', {
      injectEvolutionMemory,
    }),

  read: (target: PromptMemoryTarget) =>
    api.get<PromptMemoryFile>(`/api/prompt-memory/${target}`),

  write: (target: PromptMemoryTarget, content: string) =>
    api.put<PromptMemoryFile>(`/api/prompt-memory/${target}`, { content }),

  removeEntry: (target: Exclude<PromptMemoryTarget, 'soul'>, oldText: string) =>
    api.post(`/api/prompt-memory/${target}/entries`, {
      action: 'remove',
      oldText,
    }),
}
