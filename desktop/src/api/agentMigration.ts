import { api } from './client'

export type ExternalAgentId =
  | 'cybercode'
  | 'openclaw'
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'hermes-agent'
  | 'deepseek-tui'

export type AgentMigrationItemKind = 'skill' | 'memory' | 'instruction'
export type AgentMigrationItemScope = 'global' | 'project'

export type AgentMigrationItem = {
  id: string
  agentId: ExternalAgentId
  kind: AgentMigrationItemKind
  scope: AgentMigrationItemScope
  name: string
  sourcePath: string
  destinationPath: string
  destinationRoot: string
  projectPath: string | null
  sizeBytes: number
  modifiedAt: string
  previewable: boolean
  recommended: boolean
  selectable: boolean
  selectionIssue?: 'size-limit' | 'destination-conflict'
  destinationState: 'ready' | 'merge' | 'exists' | 'conflict'
  adaptation: 'native' | 'converted'
  destinationFormat: string
  writeMode:
    | 'skill-copy'
    | 'markdown-file'
    | 'markdown-merge'
    | 'agent-skill'
    | 'cursor-mdc'
    | 'hermes-memory'
    | 'codewhale-memory'
  compatibilityNote?: string
}

export type AgentMigrationProject = {
  id: string
  agentId: ExternalAgentId
  name: string
  path: string
  exists: boolean
  itemIds: string[]
  lastSeenAt: string | null
}

export type DetectedExternalAgent = {
  id: ExternalAgentId
  name: string
  installed: boolean
  executablePath: string | null
  dataRoots: string[]
  counts: {
    skills: number
    memories: number
    instructions: number
    projects: number
  }
  items: AgentMigrationItem[]
  projects: AgentMigrationProject[]
}

export type AgentMigrationScan = {
  scannedAt: string
  targetAgentId: ExternalAgentId
  agents: DetectedExternalAgent[]
}

export type AgentMigrationResult = {
  imported: number
  skipped: number
  failed: number
  registeredProjects: string[]
  items: Array<{
    id: string
    status: 'imported' | 'skipped' | 'failed'
    destinationPath?: string
    message?: string
  }>
}

export const agentMigrationApi = {
  scan: (targetAgentId: ExternalAgentId = 'cybercode') =>
    api.get<AgentMigrationScan>(
      `/api/agent-migration?targetAgentId=${encodeURIComponent(targetAgentId)}`,
      { timeout: 120_000 },
    ),

  preview: (agentId: ExternalAgentId, itemId: string, targetAgentId: ExternalAgentId = 'cybercode') =>
    api.get<{ item: AgentMigrationItem; content: string; truncated: boolean }>(
      `/api/agent-migration/items/${encodeURIComponent(itemId)}?agentId=${encodeURIComponent(agentId)}&targetAgentId=${encodeURIComponent(targetAgentId)}`,
      { timeout: 120_000 },
    ),

  migrate: (input: {
    agentId: ExternalAgentId
    targetAgentId?: ExternalAgentId
    itemIds?: string[]
    projectIds?: string[]
    allRecommended?: boolean
  }) => api.post<AgentMigrationResult>('/api/agent-migration/migrate', input, { timeout: 120_000 }),
}
