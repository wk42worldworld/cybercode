export type SkillLearningMode = 'off' | 'suggest' | 'auto'

export type SkillLearningConfig = {
  version: 1
  mode: SkillLearningMode
  minToolUses: number
  minConfidence: number
  autoApproveConfidence: number
  updatedAt?: string
}

export type SkillCandidateStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'failed'

export type SkillCandidateScope = 'project' | 'global'
export type SkillCandidateAction = 'create' | 'update'

export type SkillCandidateTarget = {
  skillName: string
  source: 'project' | 'user'
}

export type SkillCandidate = {
  version: 1
  id: string
  status: SkillCandidateStatus
  action: SkillCandidateAction
  scope: SkillCandidateScope
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
  target?: SkillCandidateTarget
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

export type SkillLearningEventKind =
  | 'review-started'
  | 'candidate-created'
  | 'candidate-auto-approved'
  | 'no-candidate'
  | 'candidate-reused'
  | 'review-failed'
  | 'candidate-approved'
  | 'candidate-rejected'

export type SkillLearningEvent = {
  id: string
  kind: SkillLearningEventKind
  createdAt: string
  projectRoot?: string
  sessionId?: string
  candidateId?: string
  skillName?: string
  message: string
  toolUseCount?: number
}

export type SkillLearningState = {
  version: 1
  candidates: SkillCandidate[]
  events: SkillLearningEvent[]
}

export type SkillMemoryOverview = {
  id: string
  skillName: string
  scope: SkillCandidateScope
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

export const DEFAULT_SKILL_LEARNING_CONFIG: SkillLearningConfig = {
  version: 1,
  mode: 'auto',
  minToolUses: 6,
  minConfidence: 0.78,
  autoApproveConfidence: 0.92,
}
