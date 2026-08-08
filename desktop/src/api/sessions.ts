import { api } from './client'
import type { CreateSessionInput, SessionListItem, MessageEntry, SessionMessageAnchor } from '../types/session'

type SessionsResponse = { sessions: SessionListItem[]; total: number }
type MessagesResponse = {
  messages: MessageEntry[]
  hasMore: boolean
  hasMoreAfter?: boolean
  seekFound?: boolean
}
type CreateSessionResponse = { sessionId: string; session?: SessionListItem }
type CreateProjectFolderResponse = { path: string; existed: boolean }
type SessionLocatorParams = { projectPath?: string }
const pendingSessionListRequests = new Map<string, Promise<SessionsResponse>>()

function listSessions(params?: { project?: string; limit?: number; offset?: number }) {
  const query = new URLSearchParams()
  if (params?.project) query.set('project', params.project)
  if (params?.limit) query.set('limit', String(params.limit))
  if (params?.offset) query.set('offset', String(params.offset))
  const qs = query.toString()
  const path = `/api/sessions${qs ? `?${qs}` : ''}`
  const pending = pendingSessionListRequests.get(path)
  if (pending) return pending

  const request = api.get<SessionsResponse>(path)
  pendingSessionListRequests.set(path, request)
  void request.then(
    () => pendingSessionListRequests.delete(path),
    () => pendingSessionListRequests.delete(path),
  )
  return request
}

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

export type SessionBranchResponse = {
  sessionId: string
  sourceSessionId: string
  targetAssistantMessageId: string
  session: SessionListItem
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

export type SessionUsageResponse = {
  usage: SessionUsageSnapshot | null
  context?: {
    model: string
    usedTokens: number
    contextWindow: number
    percentage: number
    latestTurn?: {
      inputTokens: number
      outputTokens: number
      cacheReadInputTokens: number
      cacheCreationInputTokens: number
    }
  } | null
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

export type GitDiffScope = 'staged' | 'unstaged'

export type GitFileChange = {
  path: string
  previousPath?: string
  indexStatus: string
  worktreeStatus: string
  kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted' | 'type-changed' | 'unknown'
  staged: boolean
  unstaged: boolean
  conflicted: boolean
}

export type GitWorkspaceStatus = {
  gitAvailable: boolean
  isRepository: boolean
  workDir: string
  repoRoot: string | null
  repoName: string | null
  branch: string | null
  detached: boolean
  headCommit: string | null
  upstream: string | null
  ahead: number
  behind: number
  stagedCount: number
  unstagedCount: number
  conflictedCount: number
  changes: GitFileChange[]
}

export type GitFileDiff = {
  path: string
  previousPath?: string
  scope: GitDiffScope
  oldText: string
  newText: string
  additions: number
  deletions: number
  binary: boolean
  truncated: boolean
}

export type GitCommitResponse = {
  status: GitWorkspaceStatus
  commit: string
  output: string
}

export type GitBranchInfo = {
  name: string
  commit: string | null
  upstream: string | null
  current: boolean
  ahead: number
  behind: number
  upstreamGone: boolean
}

export type GitCommitInfo = {
  hash: string
  shortHash: string
  subject: string
  authorName: string
  authoredAt: string
  refs: string[]
}

function sessionGitPath(
  sessionId: string,
  action?: string,
  params?: SessionLocatorParams & { scope?: GitDiffScope; path?: string; limit?: number },
) {
  const query = new URLSearchParams()
  if (params?.projectPath) query.set('projectPath', params.projectPath)
  if (params?.scope) query.set('scope', params.scope)
  if (params?.path) query.set('path', params.path)
  if (params?.limit) query.set('limit', String(params.limit))
  const qs = query.toString()
  return `/api/sessions/${sessionId}/git${action ? `/${action}` : ''}${qs ? `?${qs}` : ''}`
}

export const sessionsApi = {
  list: listSessions,

  getMessages(
    sessionId: string,
    params?: { limit?: number; before?: string; after?: string; seek?: string } & SessionLocatorParams,
    requestOptions?: { timeout?: number; recoverConnection?: boolean },
  ) {
    const query = new URLSearchParams()
    if (params?.limit) query.set('limit', String(params.limit))
    if (params?.before) query.set('before', params.before)
    if (params?.after) query.set('after', params.after)
    if (params?.seek) query.set('seek', params.seek)
    if (params?.projectPath) query.set('projectPath', params.projectPath)
    const qs = query.toString()
    return api.get<MessagesResponse>(
      `/api/sessions/${sessionId}/messages${qs ? `?${qs}` : ''}`,
      {
        timeout: requestOptions?.timeout ?? 12_000,
        recoverConnection: requestOptions?.recoverConnection,
      },
    )
  },

  create(input?: CreateSessionInput) {
    const workDir = typeof input === 'string' ? input : input?.workDir
    const temporary = typeof input === 'object' && input.temporary === true
    return api.post<CreateSessionResponse>('/api/sessions', {
      ...(workDir ? { workDir } : {}),
      ...(temporary ? { temporary: true } : {}),
    })
  },

  delete(sessionId: string, params?: SessionLocatorParams) {
    const query = params?.projectPath ? `?projectPath=${encodeURIComponent(params.projectPath)}` : ''
    return api.delete<{ ok: true }>(`/api/sessions/${sessionId}${query}`)
  },

  rename(sessionId: string, title: string, params?: SessionLocatorParams) {
    const query = params?.projectPath ? `?projectPath=${encodeURIComponent(params.projectPath)}` : ''
    return api.patch<{ ok: true }>(`/api/sessions/${sessionId}${query}`, { title })
  },

  getRecentProjects(limit?: number) {
    const query = typeof limit === 'number' ? `?limit=${limit}` : ''
    return api.get<{ projects: RecentProject[] }>(`/api/sessions/recent-projects${query}`)
  },

  createProjectFolder(input: { parentDir: string; name: string }) {
    return api.post<CreateProjectFolderResponse>('/api/sessions/project-folders', input)
  },

  getGitInfo(sessionId: string, params?: SessionLocatorParams) {
    const query = params?.projectPath ? `?projectPath=${encodeURIComponent(params.projectPath)}` : ''
    return api.get<{ branch: string | null; repoName: string | null; workDir: string; changedFiles: number }>(`/api/sessions/${sessionId}/git-info${query}`)
  },

  getGitStatus(sessionId: string, params?: SessionLocatorParams) {
    return api.get<GitWorkspaceStatus>(sessionGitPath(sessionId, undefined, params))
  },

  getGitDiff(
    sessionId: string,
    scope: GitDiffScope,
    path: string,
    params?: SessionLocatorParams,
  ) {
    return api.get<GitFileDiff>(sessionGitPath(sessionId, 'diff', {
      ...params,
      scope,
      path,
    }))
  },

  getGitBranches(sessionId: string, params?: SessionLocatorParams) {
    return api.get<{ branches: GitBranchInfo[] }>(
      sessionGitPath(sessionId, 'branches', params),
    )
  },

  getGitHistory(sessionId: string, limit = 40, params?: SessionLocatorParams) {
    return api.get<{ commits: GitCommitInfo[] }>(
      sessionGitPath(sessionId, 'history', { ...params, limit }),
    )
  },

  initializeGit(sessionId: string, params?: SessionLocatorParams) {
    return api.post<GitWorkspaceStatus>(sessionGitPath(sessionId, 'init', params))
  },

  stageGitFiles(sessionId: string, paths: string[], params?: SessionLocatorParams) {
    return api.post<GitWorkspaceStatus>(sessionGitPath(sessionId, 'stage', params), { paths })
  },

  unstageGitFiles(sessionId: string, paths: string[], params?: SessionLocatorParams) {
    return api.post<GitWorkspaceStatus>(sessionGitPath(sessionId, 'unstage', params), { paths })
  },

  discardGitFiles(sessionId: string, paths: string[], params?: SessionLocatorParams) {
    return api.post<GitWorkspaceStatus>(sessionGitPath(sessionId, 'discard', params), { paths })
  },

  commitGit(
    sessionId: string,
    message: string,
    params?: SessionLocatorParams,
  ) {
    return api.post<GitCommitResponse>(sessionGitPath(sessionId, 'commit', params), { message })
  },

  switchGitBranch(sessionId: string, name: string, params?: SessionLocatorParams) {
    return api.post<GitWorkspaceStatus>(
      sessionGitPath(sessionId, 'switch-branch', params),
      { name },
    )
  },

  createGitBranch(sessionId: string, name: string, params?: SessionLocatorParams) {
    return api.post<GitWorkspaceStatus>(
      sessionGitPath(sessionId, 'create-branch', params),
      { name },
    )
  },

  getSlashCommands(sessionId: string, params?: SessionLocatorParams) {
    const query = params?.projectPath ? `?projectPath=${encodeURIComponent(params.projectPath)}` : ''
    return api.get<{ commands: Array<{ name: string; description: string }> }>(`/api/sessions/${sessionId}/slash-commands${query}`)
  },

  getAnchors(sessionId: string, params?: SessionLocatorParams) {
    const query = params?.projectPath ? `?projectPath=${encodeURIComponent(params.projectPath)}` : ''
    return api.get<{ anchors: SessionMessageAnchor[] }>(`/api/sessions/${sessionId}/anchors${query}`)
  },

  getInspection(sessionId: string, options?: { includeContext?: boolean; timeout?: number } & SessionLocatorParams) {
    const query = new URLSearchParams()
    if (options?.includeContext !== undefined) query.set('includeContext', options.includeContext ? '1' : '0')
    if (options?.projectPath) query.set('projectPath', options.projectPath)
    const qs = query.toString()
    return api.get<SessionInspectionResponse>(`/api/sessions/${sessionId}/inspection${qs ? `?${qs}` : ''}`, {
      timeout: options?.timeout ?? (options?.includeContext ? 45_000 : 25_000),
    })
  },

  getUsage(sessionId: string, params?: SessionLocatorParams) {
    const query = params?.projectPath ? `?projectPath=${encodeURIComponent(params.projectPath)}` : ''
    return api.get<SessionUsageResponse>(`/api/sessions/${sessionId}/usage${query}`)
  },

  rewind(sessionId: string, body: {
    targetUserMessageId?: string
    userMessageIndex?: number
    userMessageOffsetFromEnd?: number
    expectedContent?: string
    dryRun?: boolean
  }, params?: SessionLocatorParams) {
    const query = params?.projectPath ? `?projectPath=${encodeURIComponent(params.projectPath)}` : ''
    return api.post<SessionRewindResponse>(`/api/sessions/${sessionId}/rewind${query}`, body, {
      timeout: 60_000,
    })
  },

  branch(sessionId: string, body: {
    targetAssistantMessageId: string
    expectedContent?: string
  }, params?: SessionLocatorParams) {
    const query = params?.projectPath ? `?projectPath=${encodeURIComponent(params.projectPath)}` : ''
    return api.post<SessionBranchResponse>(`/api/sessions/${sessionId}/branch${query}`, body, {
      timeout: 60_000,
    })
  },
}
