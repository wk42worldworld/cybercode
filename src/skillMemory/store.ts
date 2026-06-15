import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { randomBytes } from 'crypto'
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import { dirname, join } from 'path'
import type { Command } from '../types/command.js'
import { getErrnoCode, isFsInaccessible } from '../utils/errors.js'
import { logForDebugging } from '../utils/debug.js'
import {
  SKILL_MEMORY_EVIDENCE_FILENAME,
  SKILL_MEMORY_PENDING_FILENAME,
  SKILL_MEMORY_STATS_FILENAME,
  SKILL_MEMORY_SUMMARY_FILENAME,
  getSkillMemoryDir,
  getSkillMemoryId,
  getSkillMemoryRawKey,
  getSkillUsageSidecarPath,
  type SkillMemoryRef,
  type SkillMemoryScope,
} from './paths.js'

export const SKILL_MEMORY_SUMMARY_CHAR_LIMIT = 2_500
export const SKILL_MEMORY_PENDING_LINE_LIMIT = 80
export const SKILL_MEMORY_EVIDENCE_LINE_LIMIT = 400

const LOCK_STALE_MS = 30_000
const LOCK_RETRY_COUNT = 50
const LOCK_RETRY_DELAY_MS = 20

export type SkillLifecycleStatus = 'active' | 'stale' | 'archived' | 'pinned'

export type SkillUsageRecord = {
  skillId: string
  rawKey: string
  skillName: string
  source?: string
  loadedFrom?: string
  status: SkillLifecycleStatus
  useCount: number
  firstUsedAt: string
  lastUsedAt: string
}

export type SkillUsageSidecar = {
  version: 1
  skills: Record<string, SkillUsageRecord>
}

export type SkillMemoryStats = {
  version: 1
  skillId: string
  rawKey: string
  skillName: string
  source?: string
  loadedFrom?: string
  status: SkillLifecycleStatus
  useCount: number
  firstUsedAt?: string
  lastUsedAt?: string
  pendingCount: number
  evidenceCount: number
  summaryUpdatedAt?: string
}

export type SkillMemoryPendingEntry = {
  version: 1
  id: string
  skillId: string
  rawKey: string
  skillName: string
  skillPath?: string
  source?: string
  loadedFrom?: string
  sessionId?: string
  observedAt: string
  trigger: 'invoked' | 'manual' | 'review'
  excerpt?: string
}

export type SkillMemorySummary = {
  scope: SkillMemoryScope
  path: string
  content: string
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`
  await writeFile(tmpPath, content, 'utf-8')
  try {
    await rename(tmpPath, filePath)
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}

async function acquireLock(lockPath: string): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true })

  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt++) {
    try {
      await writeFile(lockPath, `${process.pid}\n`, {
        encoding: 'utf-8',
        flag: 'wx',
      })
      return
    } catch (error) {
      if (getErrnoCode(error) !== 'EEXIST') throw error
      try {
        const info = await stat(lockPath)
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await rm(lockPath, { force: true })
          continue
        }
      } catch (statError) {
        if (!isFsInaccessible(statError)) throw statError
      }
      await delay(LOCK_RETRY_DELAY_MS)
    }
  }

  throw new Error(`Could not acquire skill memory lock: ${lockPath}`)
}

async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = `${filePath}.lock`
  await acquireLock(lockPath)
  try {
    return await fn()
  } finally {
    await rm(lockPath, { force: true }).catch(() => {})
  }
}

async function readTextFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch (error) {
    if (isFsInaccessible(error)) return ''
    throw error
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  const raw = await readTextFile(filePath)
  if (!raw.trim()) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function trimSummary(content: string): string {
  const trimmed = content.trim()
  if (trimmed.length <= SKILL_MEMORY_SUMMARY_CHAR_LIMIT) return trimmed
  return `${trimmed.slice(0, SKILL_MEMORY_SUMMARY_CHAR_LIMIT - 1).trimEnd()}\n`
}

function getMemoryPath(
  ref: SkillMemoryRef,
  scope: SkillMemoryScope,
  filename: string,
): string {
  return join(getSkillMemoryDir(ref, scope), filename).normalize('NFC')
}

export function getSkillMemoryScopeForCommand(command?: Command): SkillMemoryScope {
  return command?.source === 'projectSettings' ? 'project' : 'global'
}

export function getSkillMemoryRefForCommand(params: {
  skillName: string
  command?: Command
  projectRoot?: string
}): SkillMemoryRef {
  return {
    skillName: params.skillName,
    source: params.command?.type === 'prompt' ? params.command.source : undefined,
    loadedFrom: params.command?.loadedFrom,
    projectRoot: params.projectRoot,
  }
}

export function parseInvokedSkillMemoryRef(params: {
  skillName: string
  skillPath?: string
  projectRoot?: string
}): SkillMemoryRef {
  const match = params.skillPath?.match(
    /^(builtin|bundled|managed|mcp|plugin|projectSettings|userSettings):(.*)$/,
  )
  return {
    skillName: match?.[2] || params.skillName,
    source: match?.[1],
    loadedFrom: match?.[1] === 'projectSettings' ? 'skills' : undefined,
    projectRoot: params.projectRoot,
  }
}

export async function recordSkillLifecycleUsage(params: {
  ref: SkillMemoryRef
  scope: SkillMemoryScope
  status?: SkillLifecycleStatus
}): Promise<void> {
  const { ref, scope } = params
  const now = new Date().toISOString()
  const skillId = getSkillMemoryId(ref)
  const rawKey = getSkillMemoryRawKey(ref)
  const sidecarPath = getSkillUsageSidecarPath(ref, scope)

  await withFileLock(sidecarPath, async () => {
    const usage = await readJsonFile<SkillUsageSidecar>(sidecarPath, {
      version: 1,
      skills: {},
    })
    const existing = usage.skills[skillId]
    usage.skills[skillId] = {
      skillId,
      rawKey,
      skillName: ref.skillName,
      source: ref.source,
      loadedFrom: ref.loadedFrom,
      status:
        existing?.status === 'archived'
          ? 'active'
          : existing?.status ?? params.status ?? 'active',
      useCount: (existing?.useCount ?? 0) + 1,
      firstUsedAt: existing?.firstUsedAt ?? now,
      lastUsedAt: now,
    }
    await atomicWrite(sidecarPath, `${JSON.stringify(usage, null, 2)}\n`)
  })

  await updateSkillMemoryStats(ref, scope, stats => ({
    ...stats,
    useCount: stats.useCount + 1,
    firstUsedAt: stats.firstUsedAt ?? now,
    lastUsedAt: now,
    status: stats.status === 'archived' ? 'active' : stats.status,
  })).catch(error => {
    logForDebugging(`[skill-memory] failed to update stats: ${String(error)}`)
  })
}

export function recordSkillLifecycleUsageSafe(params: {
  ref: SkillMemoryRef
  scope: SkillMemoryScope
}): void {
  void recordSkillLifecycleUsage(params).catch(error => {
    logForDebugging(`[skill-memory] usage write failed: ${String(error)}`)
  })
}

export async function setSkillLifecycleStatus(params: {
  ref: SkillMemoryRef
  scope: SkillMemoryScope
  status: SkillLifecycleStatus
}): Promise<SkillMemoryStats> {
  const { ref, scope, status } = params
  const sidecarPath = getSkillUsageSidecarPath(ref, scope)
  const skillId = getSkillMemoryId(ref)

  await withFileLock(sidecarPath, async () => {
    const usage = await readJsonFile<SkillUsageSidecar>(sidecarPath, {
      version: 1,
      skills: {},
    })
    const existing = usage.skills[skillId]
    if (existing) {
      usage.skills[skillId] = {
        ...existing,
        status,
      }
      await atomicWrite(sidecarPath, `${JSON.stringify(usage, null, 2)}\n`)
    }
  }).catch(error => {
    logForDebugging(
      `[skill-memory] failed to update usage status: ${String(error)}`,
    )
  })

  return updateSkillMemoryStats(ref, scope, stats => ({
    ...stats,
    status,
  }))
}

export async function readSkillMemoryStats(
  ref: SkillMemoryRef,
  scope: SkillMemoryScope,
): Promise<SkillMemoryStats> {
  const skillId = getSkillMemoryId(ref)
  const rawKey = getSkillMemoryRawKey(ref)
  const statsPath = getMemoryPath(ref, scope, SKILL_MEMORY_STATS_FILENAME)
  const fallback: SkillMemoryStats = {
    version: 1,
    skillId,
    rawKey,
    skillName: ref.skillName,
    source: ref.source,
    loadedFrom: ref.loadedFrom,
    status: 'active',
    useCount: 0,
    pendingCount: 0,
    evidenceCount: 0,
  }
  return readJsonFile(statsPath, fallback)
}

export async function updateSkillMemoryStats(
  ref: SkillMemoryRef,
  scope: SkillMemoryScope,
  updater: (stats: SkillMemoryStats) => SkillMemoryStats,
): Promise<SkillMemoryStats> {
  const statsPath = getMemoryPath(ref, scope, SKILL_MEMORY_STATS_FILENAME)
  return withFileLock(statsPath, async () => {
    const current = await readSkillMemoryStats(ref, scope)
    const next = updater(current)
    await atomicWrite(statsPath, `${JSON.stringify(next, null, 2)}\n`)
    return next
  })
}

export async function readSkillMemorySummary(
  ref: SkillMemoryRef,
  scope: SkillMemoryScope,
  options: { includeArchived?: boolean } = {},
): Promise<SkillMemorySummary | null> {
  const stats = await readSkillMemoryStats(ref, scope)
  if (stats.status === 'archived' && !options.includeArchived) return null

  const path = getMemoryPath(ref, scope, SKILL_MEMORY_SUMMARY_FILENAME)
  const content = (await readTextFile(path)).trim()
  if (!content) return null
  return { scope, path, content }
}

export async function readSkillMemorySummaries(
  ref: SkillMemoryRef,
): Promise<SkillMemorySummary[]> {
  const summaries: SkillMemorySummary[] = []
  const globalSummary = await readSkillMemorySummary(ref, 'global')
  if (globalSummary) summaries.push(globalSummary)
  if (ref.projectRoot) {
    const projectSummary = await readSkillMemorySummary(ref, 'project')
    if (projectSummary) summaries.push(projectSummary)
  }
  return summaries
}

export async function writeSkillMemorySummary(
  ref: SkillMemoryRef,
  scope: SkillMemoryScope,
  content: string,
): Promise<void> {
  const summaryPath = getMemoryPath(ref, scope, SKILL_MEMORY_SUMMARY_FILENAME)
  const summary = trimSummary(content)
  await withFileLock(summaryPath, async () => {
    await atomicWrite(summaryPath, summary ? `${summary}\n` : '')
  })
  await updateSkillMemoryStats(ref, scope, stats => ({
    ...stats,
    summaryUpdatedAt: new Date().toISOString(),
  }))
}

export function formatSkillMemoryForPrompt(
  summaries: SkillMemorySummary[],
): string {
  if (summaries.length === 0) return ''
  const sections = summaries.map(summary => {
    const label = summary.scope === 'project' ? 'Project learned notes' : 'Global learned notes'
    return `### ${label}\n\n${summary.content.trim()}`
  })
  return [
    '## Learned Skill Notes',
    '',
    'These notes were learned from previous CyberCode usage. Treat them as secondary guidance behind the skill file, system instructions, and the current user request.',
    '',
    ...sections,
  ].join('\n')
}

export async function applySkillMemoryToPromptBlocks(params: {
  blocks: ContentBlockParam[]
  ref: SkillMemoryRef
}): Promise<ContentBlockParam[]> {
  const summaries = await readSkillMemorySummaries(params.ref)
  const learnedNotes = formatSkillMemoryForPrompt(summaries)
  if (!learnedNotes) return params.blocks
  return [
    ...params.blocks,
    {
      type: 'text',
      text: `\n\n${learnedNotes}`,
    },
  ]
}

function jsonlLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  const raw = await readTextFile(filePath)
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line) as T
      } catch {
        return null
      }
    })
    .filter((entry): entry is T => entry !== null)
}

export async function appendSkillMemoryPending(
  ref: SkillMemoryRef,
  scope: SkillMemoryScope,
  entry: Omit<SkillMemoryPendingEntry, 'version' | 'skillId' | 'rawKey' | 'skillName'>,
): Promise<SkillMemoryPendingEntry> {
  const pendingPath = getMemoryPath(ref, scope, SKILL_MEMORY_PENDING_FILENAME)
  const skillId = getSkillMemoryId(ref)
  const rawKey = getSkillMemoryRawKey(ref)
  const fullEntry: SkillMemoryPendingEntry = {
    version: 1,
    skillId,
    rawKey,
    skillName: ref.skillName,
    source: ref.source,
    loadedFrom: ref.loadedFrom,
    ...entry,
  }
  await mkdir(dirname(pendingPath), { recursive: true })
  await appendFile(pendingPath, jsonlLine(fullEntry), 'utf-8')

  const pending = await readSkillMemoryPending(ref, scope, {
    newestFirst: false,
    limit: SKILL_MEMORY_PENDING_LINE_LIMIT + 1,
  })
  if (pending.length > SKILL_MEMORY_PENDING_LINE_LIMIT) {
    const trimmed = pending.slice(-SKILL_MEMORY_PENDING_LINE_LIMIT)
    await atomicWrite(pendingPath, trimmed.map(jsonlLine).join(''))
  }

  await updateSkillMemoryStats(ref, scope, stats => ({
    ...stats,
    pendingCount: Math.min(pending.length, SKILL_MEMORY_PENDING_LINE_LIMIT),
  })).catch(() => {})

  return fullEntry
}

export async function readSkillMemoryPending(
  ref: SkillMemoryRef,
  scope: SkillMemoryScope,
  options: { limit?: number; newestFirst?: boolean } = {},
): Promise<SkillMemoryPendingEntry[]> {
  const pendingPath = getMemoryPath(ref, scope, SKILL_MEMORY_PENDING_FILENAME)
  const entries = await readJsonl<SkillMemoryPendingEntry>(pendingPath)
  const ordered = options.newestFirst ? entries.reverse() : entries
  return typeof options.limit === 'number'
    ? ordered.slice(0, options.limit)
    : ordered
}

export async function movePendingToEvidence(params: {
  ref: SkillMemoryRef
  scope: SkillMemoryScope
  consumedCount: number
}): Promise<void> {
  const { ref, scope, consumedCount } = params
  if (consumedCount <= 0) return

  const pendingPath = getMemoryPath(ref, scope, SKILL_MEMORY_PENDING_FILENAME)
  const evidencePath = getMemoryPath(ref, scope, SKILL_MEMORY_EVIDENCE_FILENAME)

  await withFileLock(pendingPath, async () => {
    const pending = await readJsonl<SkillMemoryPendingEntry>(pendingPath)
    const consumed = pending.slice(0, consumedCount)
    const remaining = pending.slice(consumedCount)
    const evidence = await readJsonl<SkillMemoryPendingEntry>(evidencePath)
    const nextEvidence = [...evidence, ...consumed].slice(
      -SKILL_MEMORY_EVIDENCE_LINE_LIMIT,
    )

    await mkdir(dirname(evidencePath), { recursive: true })
    await atomicWrite(evidencePath, nextEvidence.map(jsonlLine).join(''))
    await atomicWrite(pendingPath, remaining.map(jsonlLine).join(''))

    await updateSkillMemoryStats(ref, scope, stats => ({
      ...stats,
      pendingCount: remaining.length,
      evidenceCount: nextEvidence.length,
    })).catch(() => {})
  })
}
