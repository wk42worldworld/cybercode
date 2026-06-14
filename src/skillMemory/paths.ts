import { createHash } from 'crypto'
import { join } from 'path'
import {
  getClaudeConfigHomeDir,
  getProjectConfigPath,
} from '../utils/envUtils.js'

export const SKILL_MEMORY_DIRNAME = 'skill-memory'
export const SKILL_USAGE_FILENAME = '.usage.json'
export const SKILL_MEMORY_SUMMARY_FILENAME = 'SUMMARY.md'
export const SKILL_MEMORY_PENDING_FILENAME = 'PENDING.jsonl'
export const SKILL_MEMORY_EVIDENCE_FILENAME = 'EVIDENCE.jsonl'
export const SKILL_MEMORY_STATS_FILENAME = 'STATS.json'

export type SkillMemoryScope = 'global' | 'project'

export type SkillMemoryRef = {
  skillName: string
  source?: string
  loadedFrom?: string
  projectRoot?: string
}

export function getSkillMemoryRawKey(ref: SkillMemoryRef): string {
  const source = ref.source || ref.loadedFrom || 'unknown'
  return `${source}:${ref.skillName}`
}

export function getSkillMemoryId(refOrKey: SkillMemoryRef | string): string {
  const rawKey =
    typeof refOrKey === 'string' ? refOrKey : getSkillMemoryRawKey(refOrKey)
  const slug = rawKey
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  const hash = createHash('sha1').update(rawKey).digest('hex').slice(0, 8)
  return slug ? `${slug}-${hash}` : hash
}

export function getGlobalSkillMemoryRoot(): string {
  return join(getClaudeConfigHomeDir(), SKILL_MEMORY_DIRNAME).normalize('NFC')
}

export function getProjectSkillMemoryRoot(projectRoot: string): string {
  return getProjectConfigPath(projectRoot, SKILL_MEMORY_DIRNAME)
}

export function getSkillMemoryRoot(
  scope: SkillMemoryScope,
  projectRoot?: string,
): string {
  if (scope === 'project') {
    if (!projectRoot) {
      throw new Error('Project skill memory requires a project root.')
    }
    return getProjectSkillMemoryRoot(projectRoot)
  }
  return getGlobalSkillMemoryRoot()
}

export function getSkillMemoryDir(
  ref: SkillMemoryRef,
  scope: SkillMemoryScope,
): string {
  return join(getSkillMemoryRoot(scope, ref.projectRoot), getSkillMemoryId(ref))
}

export function getSkillUsageSidecarPath(
  ref: SkillMemoryRef,
  scope: SkillMemoryScope,
): string {
  if (scope === 'project' && !ref.projectRoot) {
    throw new Error('Project skill usage sidecar requires a project root.')
  }
  const skillsDir =
    scope === 'project'
      ? getProjectConfigPath(ref.projectRoot!, 'skills')
      : join(getClaudeConfigHomeDir(), 'skills')
  return join(skillsDir, SKILL_USAGE_FILENAME).normalize('NFC')
}
