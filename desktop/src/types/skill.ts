export type SkillSource = 'user' | 'project' | 'plugin' | 'mcp' | 'bundled'

export type SkillMeta = {
  name: string
  displayName?: string
  description: string
  source: SkillSource
  userInvocable: boolean
  version?: string
  contentLength: number
  hasDirectory: boolean
  enabled?: boolean
  pluginName?: string
}

export type FileTreeNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
}

export type SkillFrontmatter = Record<string, unknown>

export type SkillFile = {
  path: string
  content: string
  language: string
  frontmatter?: SkillFrontmatter
  body?: string
  isEntry?: boolean
}

export type SkillDetail = {
  meta: SkillMeta
  tree: FileTreeNode[]
  files: SkillFile[]
  skillRoot: string
}

export type SkillLearningMode = 'off' | 'suggest' | 'auto'

export type SkillLearningConfig = {
  version: 1
  mode: SkillLearningMode
  minToolUses: number
  minConfidence: number
  autoApproveConfidence: number
  updatedAt?: string
}

export type SkillCandidate = {
  version: 1
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'failed'
  action: 'create' | 'update'
  scope: 'project' | 'global'
  projectRoot?: string
  name: string
  description: string
  whenToUse: string
  reason: string
  evidence: string[]
  confidence: number
  markdown: string
  sourceSessionId?: string
  sourceFingerprint: string
  sourceToolUses: number
  target?: {
    skillName: string
    source: 'project' | 'user'
  }
  duplicate?: {
    skillName: string
    score: number
    decision: 'reuse' | 'merge'
  }
  createdAt: string
  updatedAt: string
  reviewedAt?: string
  outputPath?: string
  error?: string
}

export type SkillLearningEvent = {
  id: string
  kind:
    | 'review-skipped'
    | 'review-started'
    | 'candidate-created'
    | 'candidate-auto-approved'
    | 'no-candidate'
    | 'candidate-reused'
    | 'review-failed'
    | 'candidate-approved'
    | 'candidate-rejected'
  createdAt: string
  projectRoot?: string
  sessionId?: string
  candidateId?: string
  skillName?: string
  message: string
  toolUseCount?: number
}

export type SkillMemoryOverview = {
  id: string
  skillName: string
  scope: 'project' | 'global'
  status: 'active' | 'stale' | 'archived' | 'pinned'
  useCount: number
  pendingCount: number
  evidenceCount: number
  lastUsedAt?: string
  summaryUpdatedAt?: string
  summary?: string
}

export type SkillLearningOverview = {
  config: SkillLearningConfig
  pendingCandidates: SkillCandidate[]
  recentCandidates: SkillCandidate[]
  events: SkillLearningEvent[]
  memories: SkillMemoryOverview[]
}
