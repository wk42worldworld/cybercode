import type { Command } from '../types/command.js'
import { getProjectRoot } from '../bootstrap/state.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { isEnvDefinedFalsy } from '../utils/envUtils.js'
import type { REPLHookContext } from '../utils/hooks/postSamplingHooks.js'
import {
  rankSkillGateMatches,
  SKILL_GATE_MERGE_THRESHOLD,
  SKILL_GATE_REUSE_THRESHOLD,
  type SkillGateCandidate,
} from './gate.js'
import type { SkillMemoryRef, SkillMemoryScope } from './paths.js'
import {
  getSkillMemoryRefForCommand,
  getSkillMemoryScopeForCommand,
  readSkillMemoryStats,
  readSkillMemorySummary,
  setSkillLifecycleStatus,
  writeSkillMemorySummary,
  type SkillLifecycleStatus,
  type SkillMemoryStats,
} from './store.js'

export const SKILL_STALE_AFTER_DAYS = 30
export const SKILL_ARCHIVE_AFTER_DAYS = 90
export const SKILL_LOW_USE_COUNT = 3
export const SKILL_HIGH_USE_COUNT = 10
const SKILL_GOVERNANCE_AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000

const lastAutoGovernanceAtByProject = new Map<string, number>()

export type GovernedSkill = {
  command: Command
  ref: SkillMemoryRef
  scope: SkillMemoryScope
  stats: SkillMemoryStats
}

export type SkillDuplicateCluster = {
  primarySkillName: string
  skillNames: string[]
  score: number
  action: 'reuse' | 'merge-memory' | 'review'
}

export type SkillGovernanceReport = {
  totalSkills: number
  activeCount: number
  staleCount: number
  archivedCount: number
  pinnedCount: number
  staleSkills: string[]
  archivedSkills: string[]
  duplicateClusters: SkillDuplicateCluster[]
  missingWhenToUse: string[]
  statusChanges: Array<{
    skillName: string
    from: SkillLifecycleStatus
    to: SkillLifecycleStatus
  }>
  mergedMemory: Array<{
    targetSkillName: string
    sourceSkillNames: string[]
    changed: boolean
  }>
}

function isComparableSkill(command: Command): boolean {
  return (
    command.type === 'prompt' &&
    command.source !== 'builtin' &&
    (command.loadedFrom === 'bundled' ||
      command.loadedFrom === 'skills' ||
      command.loadedFrom === 'commands_DEPRECATED' ||
      command.loadedFrom === 'plugin' ||
      command.loadedFrom === 'mcp' ||
      command.hasUserSpecifiedDescription ||
      Boolean(command.whenToUse))
  )
}

function toCandidate(skill: GovernedSkill): SkillGateCandidate {
  return {
    name: skill.command.name,
    description: skill.command.description,
    whenToUse: skill.command.whenToUse,
  }
}

function daysSince(value: string | undefined, now: Date): number | null {
  if (!value) return null
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return null
  return Math.max(0, (now.getTime() - time) / 86_400_000)
}

export function evaluateSkillLifecycleStatus(
  stats: SkillMemoryStats,
  now: Date = new Date(),
): SkillLifecycleStatus {
  if (stats.status === 'pinned') return 'pinned'

  const lastUsedDays = daysSince(stats.lastUsedAt, now)
  if (lastUsedDays === null) return stats.status === 'archived' ? 'archived' : 'active'
  if (stats.useCount >= SKILL_HIGH_USE_COUNT) return 'active'

  const summaryUpdatedDays = daysSince(stats.summaryUpdatedAt, now)
  const hasRecentSummary =
    summaryUpdatedDays !== null && summaryUpdatedDays < SKILL_ARCHIVE_AFTER_DAYS

  if (
    lastUsedDays >= SKILL_ARCHIVE_AFTER_DAYS &&
    stats.useCount <= SKILL_LOW_USE_COUNT &&
    !hasRecentSummary
  ) {
    return 'archived'
  }

  if (
    lastUsedDays >= SKILL_STALE_AFTER_DAYS &&
    stats.useCount <= SKILL_LOW_USE_COUNT
  ) {
    return 'stale'
  }

  return 'active'
}

export async function loadGovernedSkills(params: {
  commands: readonly Command[]
  projectRoot?: string
}): Promise<GovernedSkill[]> {
  const skills = params.commands.filter(isComparableSkill)
  const skillsWithMemory = skills
    .map(command => ({
      command,
      scope: getSkillMemoryScopeForCommand(command),
    }))
    .filter(item => item.scope !== 'project' || Boolean(params.projectRoot))

  return Promise.all(
    skillsWithMemory.map(async ({ command, scope }) => {
      const ref = getSkillMemoryRefForCommand({
        skillName: command.name,
        command,
        projectRoot: params.projectRoot,
      })
      return {
        command,
        ref,
        scope,
        stats: await readSkillMemoryStats(ref, scope),
      }
    }),
  )
}

function clusterSkills(skills: GovernedSkill[]): SkillDuplicateCluster[] {
  const parent = skills.map((_, index) => index)
  const maxScore = new Map<string, number>()

  function find(index: number): number {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!
      index = parent[index]!
    }
    return index
  }

  function union(a: number, b: number, score: number): void {
    const rootA = find(a)
    const rootB = find(b)
    const nextScore = Math.max(
      score,
      maxScore.get(String(rootA)) ?? 0,
      maxScore.get(String(rootB)) ?? 0,
    )
    if (rootA === rootB) {
      maxScore.set(String(rootA), nextScore)
      return
    }
    parent[rootB] = rootA
    maxScore.delete(String(rootB))
    maxScore.set(String(rootA), nextScore)
  }

  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const match = rankSkillGateMatches({
        candidate: toCandidate(skills[i]!),
        existingSkills: [skills[j]!.command],
        limit: 1,
      })[0]
      if (!match || match.score < SKILL_GATE_MERGE_THRESHOLD) continue
      union(i, j, match.score)
    }
  }

  const grouped = new Map<number, GovernedSkill[]>()
  for (let i = 0; i < skills.length; i++) {
    const root = find(i)
    grouped.set(root, [...(grouped.get(root) ?? []), skills[i]!])
  }

  return Array.from(grouped.entries())
    .filter(([, group]) => group.length > 1)
    .map(([root, group]) => {
      const primary = choosePrimarySkill(group)
      const score = maxScore.get(String(root)) ?? SKILL_GATE_MERGE_THRESHOLD
      return {
        primarySkillName: primary.command.name,
        skillNames: group.map(skill => skill.command.name).sort(),
        score: Math.round(score * 1000) / 1000,
        action:
          score >= SKILL_GATE_REUSE_THRESHOLD ? 'reuse' : 'merge-memory',
      }
    })
}

function sourcePriority(command: Command): number {
  if (command.source === 'projectSettings') return 3
  if (command.source === 'userSettings') return 2
  if (command.loadedFrom === 'bundled') return 1
  return 0
}

function statusPriority(status: SkillLifecycleStatus): number {
  switch (status) {
    case 'pinned':
      return 4
    case 'active':
      return 3
    case 'stale':
      return 2
    case 'archived':
      return 1
  }
}

function choosePrimarySkill(skills: GovernedSkill[]): GovernedSkill {
  return [...skills].sort((a, b) => {
    const statusDelta =
      statusPriority(b.stats.status) - statusPriority(a.stats.status)
    if (statusDelta !== 0) return statusDelta
    if (b.stats.useCount !== a.stats.useCount) {
      return b.stats.useCount - a.stats.useCount
    }
    return sourcePriority(b.command) - sourcePriority(a.command)
  })[0]!
}

function uniqueSummaryLines(content: string): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const line of content.split('\n')) {
    const key = line.trim().toLowerCase()
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    lines.push(line)
  }
  return lines.join('\n').trim()
}

export async function mergeSkillMemorySummaries(params: {
  target: GovernedSkill
  sources: GovernedSkill[]
}): Promise<boolean> {
  const targetSummary =
    (await readSkillMemorySummary(params.target.ref, params.target.scope, {
      includeArchived: true,
    }))
      ?.content ?? ''
  const sourceSummaries: string[] = []

  for (const source of params.sources) {
    const summary = await readSkillMemorySummary(source.ref, source.scope, {
      includeArchived: true,
    })
    if (!summary?.content.trim()) continue
    sourceSummaries.push(`From /${source.command.name}:\n${summary.content.trim()}`)
  }

  if (sourceSummaries.length === 0) return false

  const merged = uniqueSummaryLines(
    [targetSummary.trim(), ...sourceSummaries].filter(Boolean).join('\n\n'),
  )
  if (merged === targetSummary.trim()) return false

  await writeSkillMemorySummary(params.target.ref, params.target.scope, merged)
  for (const source of params.sources) {
    if (source.stats.status === 'active') {
      await setSkillLifecycleStatus({
        ref: source.ref,
        scope: source.scope,
        status: 'stale',
      })
    }
  }
  return true
}

export async function runSkillMemoryGovernance(params: {
  commands: readonly Command[]
  projectRoot?: string
  now?: Date
  applyStatus?: boolean
  mergeMemory?: boolean
}): Promise<SkillGovernanceReport> {
  const now = params.now ?? new Date()
  const governedSkills = await loadGovernedSkills({
    commands: params.commands,
    projectRoot: params.projectRoot,
  })
  const statusChanges: SkillGovernanceReport['statusChanges'] = []

  for (const skill of governedSkills) {
    const nextStatus = evaluateSkillLifecycleStatus(skill.stats, now)
    if (nextStatus !== skill.stats.status) {
      statusChanges.push({
        skillName: skill.command.name,
        from: skill.stats.status,
        to: nextStatus,
      })
      if (params.applyStatus) {
        skill.stats = await setSkillLifecycleStatus({
          ref: skill.ref,
          scope: skill.scope,
          status: nextStatus,
        })
      }
    }
  }

  const duplicateClusters = clusterSkills(governedSkills)
  const mergedMemory: SkillGovernanceReport['mergedMemory'] = []

  if (params.mergeMemory) {
    for (const cluster of duplicateClusters.filter(
      item => item.action === 'merge-memory',
    )) {
      const members = governedSkills.filter(skill =>
        cluster.skillNames.includes(skill.command.name),
      )
      const target =
        members.find(skill => skill.command.name === cluster.primarySkillName) ??
        choosePrimarySkill(members)
      const sources = members.filter(skill => skill !== target)
      const changed = await mergeSkillMemorySummaries({ target, sources })
      if (changed) {
        for (const source of sources) {
          if (source.stats.status === 'active') {
            source.stats = {
              ...source.stats,
              status: 'stale',
            }
          }
        }
      }
      mergedMemory.push({
        targetSkillName: target.command.name,
        sourceSkillNames: sources.map(skill => skill.command.name).sort(),
        changed,
      })
    }
  }

  const currentStatuses = governedSkills.map(skill => ({
    name: skill.command.name,
    status:
      params.applyStatus || params.mergeMemory
        ? skill.stats.status
        : evaluateSkillLifecycleStatus(skill.stats, now),
  }))

  return {
    totalSkills: governedSkills.length,
    activeCount: currentStatuses.filter(skill => skill.status === 'active').length,
    staleCount: currentStatuses.filter(skill => skill.status === 'stale').length,
    archivedCount: currentStatuses.filter(skill => skill.status === 'archived').length,
    pinnedCount: currentStatuses.filter(skill => skill.status === 'pinned').length,
    staleSkills: currentStatuses
      .filter(skill => skill.status === 'stale')
      .map(skill => skill.name)
      .sort(),
    archivedSkills: currentStatuses
      .filter(skill => skill.status === 'archived')
      .map(skill => skill.name)
      .sort(),
    duplicateClusters,
    missingWhenToUse: governedSkills
      .filter(skill => !skill.command.whenToUse?.trim())
      .map(skill => skill.command.name)
      .sort(),
    statusChanges,
    mergedMemory,
  }
}

export async function executeSkillMemoryGovernanceRefresh(
  context: REPLHookContext,
): Promise<void> {
  if (
    context.querySource !== 'repl_main_thread' &&
    context.querySource !== 'sdk'
  ) {
    return
  }
  if (context.toolUseContext.agentId) return
  if (isEnvDefinedFalsy(process.env.CYBER_SKILL_MEMORY_GOVERNANCE_AUTO)) return

  const projectRoot = getProjectRoot()
  const now = Date.now()
  const lastAutoGovernanceAt =
    lastAutoGovernanceAtByProject.get(projectRoot) ?? 0
  if (now - lastAutoGovernanceAt < SKILL_GOVERNANCE_AUTO_INTERVAL_MS) return
  lastAutoGovernanceAtByProject.set(projectRoot, now)

  await runSkillMemoryGovernance({
    commands: context.toolUseContext.options.commands,
    projectRoot,
    applyStatus: true,
    mergeMemory: false,
  }).catch(error => {
    logForDebugging(
      `[skill-memory] governance refresh failed: ${errorMessage(error)}`,
      { level: 'debug' },
    )
  })
}

export function resetSkillMemoryGovernanceForTesting(): void {
  lastAutoGovernanceAtByProject.clear()
}
