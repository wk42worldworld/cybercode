import { api } from './client'
import type { SessionListItem, MessageEntry } from '../types/session'

type SessionsResponse = { sessions: SessionListItem[]; total: number }
type MessagesResponse = { messages: MessageEntry[] }
type CreateSessionResponse = { sessionId: string }
export type SessionRewindResponse = {
  target: {
    targetUserMessageId: string
    userMessageIndex: number
    userMessageCount: number
  }
  conversation: {
    messagesRemoved: number
    removedMessageIds?: string[]
  }
  code: {
    available: boolean
    reason?: string
    filesChanged: string[]
    insertions: number
    deletions: number
  }
}

export type RecentProject = {
  projectPath: string
  realPath: string
  projectName: string
  isGit: boolean
  repoName: string | null
  branch: string | null
  modifiedAt: string
  sessionCount: number
}

export type SessionUsageSnapshot = {
  source?: 'current_process' | 'transcript'
  totalCostUSD: number
  costDisplay: string
  hasUnknownModelCost: boolean
  totalAPIDuration: number
  totalDuration: number
  totalLinesAdded: number
  totalLinesRemoved: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadInputTokens: number
  totalCacheCreationInputTokens: number
  totalWebSearchRequests: number
  models: Array<{
    model: string
    displayName: string
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
    webSearchRequests: number
    costUSD: number
    costDisplay: string
    contextWindow: number
    maxOutputTokens: number
  }>
}

export type SessionContextSnapshot = {
  categories: Array<{
    name: string
    tokens: number
    color: string
    isDeferred?: boolean
  }>
  totalTokens: number
  maxTokens: number
  rawMaxTokens: number
  percentage: number
  gridRows: Array<Array<{
    color: string
    isFilled: boolean
    categoryName: string
    tokens: number
    percentage: number
    squareFullness: number
  }>>
  model: string
  memoryFiles: Array<{ path: string; type: string; tokens: number }>
  mcpTools: Array<{ name: string; serverName: string; tokens: number; isLoaded?: boolean }>
  deferredBuiltinTools?: Array<{ name: string; tokens: number; isLoaded: boolean }>
  systemTools?: Array<{ name: string; tokens: number }>
  systemPromptSections?: Array<{ name: string; tokens: number }>
  agents: Array<{ agentType: string; source: string; tokens: number }>
  slashCommands?: {
    totalCommands: number
    includedCommands: number
    tokens: number
  }
  skills?: {
    totalSkills: number
    includedSkills: number
    tokens: number
    skillFrontmatter: Array<{ name: string; source: string; tokens: number }>
  }
  messageBreakdown?: {
    toolCallTokens: number
    toolResultTokens: number
    attachmentTokens: number
    assistantMessageTokens: number
    userMessageTokens: number
    toolCallsByType: Array<{ name: string; callTokens: number; resultTokens: number }>
    attachmentsByType: Array<{ name: string; tokens: number }>
  }
  apiUsage?: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  } | null
}

export type SessionInspectionResponse = {
  active: boolean
  status: {
    sessionId: string
    workDir: string
    permissionMode: string
    version?: string
    cwd?: string
    model?: string
    apiKeySource?: string
    outputStyle?: string
    tools?: string[]
    mcpServers?: Array<{ name: string; status: string }>
    slashCommandCount?: number
    skillCount?: number
  }
  usage?: SessionUsageSnapshot
  context?: SessionContextSnapshot
  contextEstimate?: SessionContextSnapshot
  errors?: Record<string, string>
}

export const sessionsApi = {
  list(params?: { project?: string; limit?: number; offset?: number }) {
    const query = new URLSearchParams()
    if (params?.project) query.set('project', params.project)
    if (params?.limit) query.set('limit', String(params.limit))
    if (params?.offset) query.set('offset', String(params.offset))
    const qs = query.toString()
    return api.get<SessionsResponse>(`/api/sessions${qs ? `?${qs}` : ''}`)
  },

  getMessages(sessionId: string) {
    return api.get<MessagesResponse>(`/api/sessions/${sessionId}/messages`)
  },

  create(workDir?: string) {
    return api.post<CreateSessionResponse>('/api/sessions', workDir ? { workDir } : {})
  },

  delete(sessionId: string) {
    return api.delete<{ ok: true }>(`/api/sessions/${sessionId}`)
  },

  rename(sessionId: string, title: string) {
    return api.patch<{ ok: true }>(`/api/sessions/${sessionId}`, { title })
  },

  getRecentProjects(limit?: number) {
    const query = typeof limit === 'number' ? `?limit=${limit}` : ''
    return api.get<{ projects: RecentProject[] }>(`/api/sessions/recent-projects${query}`)
  },

  getGitInfo(sessionId: string) {
    return api.get<{ branch: string | null; repoName: string | null; workDir: string; changedFiles: number }>(`/api/sessions/${sessionId}/git-info`)
  },

  getSlashCommands(sessionId: string) {
    return api.get<{ commands: Array<{ name: string; description: string }> }>(`/api/sessions/${sessionId}/slash-commands`)
  },

  getInspection(sessionId: string, options?: { includeContext?: boolean; timeout?: number }) {
    const query = options?.includeContext === undefined
      ? ''
      : `?includeContext=${options.includeContext ? '1' : '0'}`
    return api.get<SessionInspectionResponse>(`/api/sessions/${sessionId}/inspection${query}`, {
      timeout: options?.timeout ?? (options?.includeContext ? 45_000 : 25_000),
    })
  },

  rewind(sessionId: string, body: {
    targetUserMessageId?: string
    userMessageIndex?: number
    expectedContent?: string
    dryRun?: boolean
  }) {
    return api.post<SessionRewindResponse>(`/api/sessions/${sessionId}/rewind`, body, {
      timeout: 60_000,
    })
  },
}
