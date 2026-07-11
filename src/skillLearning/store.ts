import { randomBytes, randomUUID } from 'crypto'
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import { dirname, isAbsolute, resolve, sep } from 'path'
import {
  getSkillLearningConfigPath,
  getSkillLearningRoot,
  getSkillLearningStatePath,
} from './paths.js'
import {
  DEFAULT_SKILL_LEARNING_CONFIG,
  type SkillCandidate,
  type SkillLearningConfig,
  type SkillLearningEvent,
  type SkillLearningEventKind,
  type SkillLearningState,
  type SkillMemoryOverview,
} from './types.js'

const LOCK_STALE_MS = 30_000
const LOCK_RETRIES = 50
const LOCK_DELAY_MS = 20
const MAX_CANDIDATES = 200
const MAX_EVENTS = 120

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}

async function ensurePrivateDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true, mode: 0o700 })
  await import('fs/promises').then(fs => fs.chmod(dirPath, 0o700)).catch(() => {})
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await ensurePrivateDir(dirname(filePath))
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 })
  try {
    await rename(tmpPath, filePath)
    await import('fs/promises').then(fs => fs.chmod(filePath, 0o600)).catch(() => {})
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}

async function acquireLock(filePath: string): Promise<() => Promise<void>> {
  const lockPath = `${filePath}.lock`
  await ensurePrivateDir(dirname(lockPath))

  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      await handle.writeFile(`${process.pid}\n`)
      await handle.close()
      return () => rm(lockPath, { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const info = await stat(lockPath)
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await rm(lockPath, { force: true })
          continue
        }
      } catch {
        // The lock disappeared between open and stat; retry immediately.
      }
      await delay(LOCK_DELAY_MS)
    }
  }

  throw new Error(`Could not acquire Skill Learning lock: ${lockPath}`)
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

async function mutateState<T>(
  mutate: (state: SkillLearningState) => T | Promise<T>,
): Promise<T> {
  const statePath = getSkillLearningStatePath()
  const release = await acquireLock(statePath)
  try {
    const state = await readSkillLearningState()
    const result = await mutate(state)
    state.candidates = state.candidates.slice(-MAX_CANDIDATES)
    state.events = state.events.slice(-MAX_EVENTS)
    await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`)
    return result
  } finally {
    await release()
  }
}

export async function readSkillLearningState(): Promise<SkillLearningState> {
  return readJson<SkillLearningState>(getSkillLearningStatePath(), {
    version: 1,
    candidates: [],
    events: [],
  })
}

export async function readSkillLearningConfig(): Promise<SkillLearningConfig> {
  const stored = await readJson<Partial<SkillLearningConfig>>(
    getSkillLearningConfigPath(),
    {},
  )
  return {
    ...DEFAULT_SKILL_LEARNING_CONFIG,
    ...stored,
    version: 1,
  }
}

export async function updateSkillLearningConfig(
  input: Partial<Omit<SkillLearningConfig, 'version'>>,
): Promise<SkillLearningConfig> {
  const current = await readSkillLearningConfig()
  const next: SkillLearningConfig = {
    ...current,
    ...input,
    version: 1,
    updatedAt: new Date().toISOString(),
  }
  await atomicWrite(
    getSkillLearningConfigPath(),
    `${JSON.stringify(next, null, 2)}\n`,
  )
  return next
}

export async function saveSkillCandidate(
  candidate: Omit<SkillCandidate, 'version' | 'id' | 'status' | 'createdAt' | 'updatedAt'>,
): Promise<{ candidate: SkillCandidate; created: boolean }> {
  return mutateState(state => {
    const existing = state.candidates.find(item =>
      item.sourceFingerprint === candidate.sourceFingerprint &&
      item.status !== 'rejected' &&
      item.status !== 'failed'
    )
    if (existing) return { candidate: existing, created: false }

    const now = new Date().toISOString()
    const saved: SkillCandidate = {
      ...candidate,
      version: 1,
      id: randomUUID(),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    state.candidates.push(saved)
    return { candidate: saved, created: true }
  })
}

export async function getSkillCandidate(id: string): Promise<SkillCandidate | null> {
  const state = await readSkillLearningState()
  return state.candidates.find(candidate => candidate.id === id) ?? null
}

export async function updateSkillCandidate(
  id: string,
  update: Partial<SkillCandidate>,
): Promise<SkillCandidate> {
  return mutateState(state => {
    const index = state.candidates.findIndex(candidate => candidate.id === id)
    if (index < 0) throw new Error(`Skill candidate not found: ${id}`)
    const current = state.candidates[index]!
    const next: SkillCandidate = {
      ...current,
      ...update,
      id: current.id,
      version: 1,
      updatedAt: new Date().toISOString(),
    }
    state.candidates[index] = next
    return next
  })
}

export async function recordSkillLearningEvent(params: {
  kind: SkillLearningEventKind
  message: string
  projectRoot?: string
  sessionId?: string
  candidateId?: string
  skillName?: string
  toolUseCount?: number
}): Promise<SkillLearningEvent> {
  return mutateState(state => {
    const event: SkillLearningEvent = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...params,
    }
    state.events.push(event)
    return event
  })
}

export function isCandidateVisibleFromCwd(
  candidate: SkillCandidate,
  cwd: string,
): boolean {
  if (candidate.scope === 'global') return true
  if (!candidate.projectRoot || !isAbsolute(candidate.projectRoot)) return false
  const projectRoot = resolve(candidate.projectRoot)
  const requested = resolve(cwd)
  return requested === projectRoot || requested.startsWith(`${projectRoot}${sep}`)
}

export function isEventVisibleFromCwd(
  event: SkillLearningEvent,
  cwd: string,
): boolean {
  if (!event.projectRoot) return true
  const projectRoot = resolve(event.projectRoot)
  const requested = resolve(cwd)
  return requested === projectRoot || requested.startsWith(`${projectRoot}${sep}`)
}

async function collectMemoryRoot(
  root: string,
  scope: 'project' | 'global',
): Promise<SkillMemoryOverview[]> {
  let entries: import('fs').Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const records: SkillMemoryOverview[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = resolve(root, entry.name)
    const stats = await readJson<Record<string, unknown> | null>(
      resolve(dir, 'STATS.json'),
      null,
    )
    if (!stats || typeof stats.skillName !== 'string') continue
    let summary: string | undefined
    try {
      const content = (await readFile(resolve(dir, 'SUMMARY.md'), 'utf-8')).trim()
      if (content) summary = content
    } catch {
      // A skill can be learning without having produced a summary yet.
    }
    records.push({
      id: `${scope}:${entry.name}`,
      skillName: stats.skillName,
      scope,
      status:
        stats.status === 'stale' ||
        stats.status === 'archived' ||
        stats.status === 'pinned'
          ? stats.status
          : 'active',
      useCount: typeof stats.useCount === 'number' ? stats.useCount : 0,
      pendingCount: typeof stats.pendingCount === 'number' ? stats.pendingCount : 0,
      evidenceCount: typeof stats.evidenceCount === 'number' ? stats.evidenceCount : 0,
      lastUsedAt: typeof stats.lastUsedAt === 'string' ? stats.lastUsedAt : undefined,
      summaryUpdatedAt:
        typeof stats.summaryUpdatedAt === 'string'
          ? stats.summaryUpdatedAt
          : undefined,
      summary,
    })
  }
  return records
}

export async function listSkillMemoryOverview(params: {
  globalRoot: string
  projectRoots: string[]
}): Promise<SkillMemoryOverview[]> {
  const groups = await Promise.all([
    collectMemoryRoot(params.globalRoot, 'global'),
    ...params.projectRoots.map(root => collectMemoryRoot(root, 'project')),
  ])
  return groups
    .flat()
    .sort((a, b) =>
      (b.summaryUpdatedAt ?? b.lastUsedAt ?? '').localeCompare(
        a.summaryUpdatedAt ?? a.lastUsedAt ?? '',
      ),
    )
}

export async function ensureSkillLearningRoot(): Promise<string> {
  const root = getSkillLearningRoot()
  await ensurePrivateDir(root)
  return root
}
