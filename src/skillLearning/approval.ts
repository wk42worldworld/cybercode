import { randomBytes } from 'crypto'
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'path'
import { scanForSecrets } from '../services/teamMemorySync/secretScanner.js'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { getSkillLearningBackupsRoot } from './paths.js'
import {
  getSkillCandidate,
  recordSkillLearningEvent,
  updateSkillCandidate,
} from './store.js'
import type { SkillCandidate } from './types.js'

const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const MAX_SKILL_MARKDOWN_CHARS = 40_000

function assertSafeSkillName(name: string): void {
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error(
      'Skill name must use 1-64 lowercase letters, numbers, or hyphens.',
    )
  }
}

function assertProjectRoot(projectRoot: string | undefined): string {
  if (!projectRoot || !isAbsolute(projectRoot)) {
    throw new Error('Project-scoped Skill candidate is missing a valid project root.')
  }
  return resolve(projectRoot)
}

function skillRootForCandidate(candidate: SkillCandidate): string {
  if (candidate.action === 'update' && candidate.target) {
    if (candidate.target.source === 'user') {
      return join(getClaudeConfigHomeDir(), 'skills', candidate.target.skillName)
    }
    return join(
      assertProjectRoot(candidate.projectRoot),
      '.cyber',
      'skills',
      candidate.target.skillName,
    )
  }

  if (candidate.scope === 'global') {
    return join(getClaudeConfigHomeDir(), 'skills', candidate.name)
  }
  return join(
    assertProjectRoot(candidate.projectRoot),
    '.cyber',
    'skills',
    candidate.name,
  )
}

function validateCandidateMarkdown(candidate: SkillCandidate): void {
  assertSafeSkillName(candidate.name)
  if (!candidate.markdown.trim()) throw new Error('Skill candidate is empty.')
  if (candidate.markdown.length > MAX_SKILL_MARKDOWN_CHARS) {
    throw new Error('Skill candidate is too large to save safely.')
  }

  const parsed = parseFrontmatter(
    candidate.markdown,
    `Skill candidate ${candidate.name}`,
  )
  const frontmatterName = parsed.frontmatter.name
  const expectedName = candidate.target?.skillName ?? candidate.name
  if (typeof frontmatterName !== 'string' || frontmatterName !== expectedName) {
    throw new Error(
      `Skill frontmatter name must be "${expectedName}" before it can be saved.`,
    )
  }

  const secrets = scanForSecrets(candidate.markdown)
  if (secrets.length > 0) {
    throw new Error(
      `Skill candidate contains possible credentials: ${secrets.map(item => item.label).join(', ')}`,
    )
  }
}

function isInside(child: string, parent: string): boolean {
  const normalizedChild = resolve(child)
  const normalizedParent = resolve(parent)
  return normalizedChild === normalizedParent ||
    normalizedChild.startsWith(`${normalizedParent}${sep}`)
}

function assertTargetBoundary(candidate: SkillCandidate, skillRoot: string): void {
  const allowedRoot = candidate.scope === 'global' || candidate.target?.source === 'user'
    ? join(getClaudeConfigHomeDir(), 'skills')
    : join(assertProjectRoot(candidate.projectRoot), '.cyber', 'skills')
  if (!isInside(skillRoot, allowedRoot)) {
    throw new Error('Skill candidate resolved outside its allowed skills directory.')
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 })
  try {
    await rename(tmpPath, filePath)
    await chmod(filePath, 0o600).catch(() => {})
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}

async function backupExistingSkill(
  candidate: SkillCandidate,
  existingContent: string,
): Promise<void> {
  const backupDir = join(getSkillLearningBackupsRoot(), candidate.id)
  await mkdir(backupDir, { recursive: true, mode: 0o700 })
  await writeFile(join(backupDir, 'SKILL.md'), existingContent, {
    encoding: 'utf-8',
    mode: 0o600,
  })
}

export async function approveSkillCandidate(
  id: string,
  options: { automatic?: boolean } = {},
): Promise<SkillCandidate> {
  const candidate = await getSkillCandidate(id)
  if (!candidate) throw new Error(`Skill candidate not found: ${id}`)
  if (candidate.status !== 'pending') {
    throw new Error(`Skill candidate is already ${candidate.status}.`)
  }
  validateCandidateMarkdown(candidate)

  const skillRoot = skillRootForCandidate(candidate)
  assertTargetBoundary(candidate, skillRoot)
  const skillPath = join(skillRoot, 'SKILL.md')

  if (candidate.action === 'create') {
    try {
      await stat(skillPath)
      throw new Error(`A Skill named "${candidate.name}" already exists.`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await mkdir(skillRoot, { recursive: true, mode: 0o700 })
    await writeFile(skillPath, candidate.markdown, {
      encoding: 'utf-8',
      mode: 0o600,
      flag: 'wx',
    })
  } else {
    let existingContent: string
    try {
      existingContent = await readFile(skillPath, 'utf-8')
    } catch {
      throw new Error(`The Skill selected for update no longer exists: ${skillPath}`)
    }
    await backupExistingSkill(candidate, existingContent)
    await atomicWrite(skillPath, candidate.markdown)
  }

  const now = new Date().toISOString()
  const approved = await updateSkillCandidate(id, {
    status: 'approved',
    reviewedAt: now,
    outputPath: skillPath,
    error: undefined,
  })
  await recordSkillLearningEvent({
    kind: options.automatic
      ? 'candidate-auto-approved'
      : 'candidate-approved',
    message: options.automatic
      ? `Automatically saved /${approved.name}.`
      : `Approved and saved /${approved.name}.`,
    projectRoot: approved.projectRoot,
    sessionId: approved.sourceSessionId,
    candidateId: approved.id,
    skillName: approved.name,
    toolUseCount: approved.sourceToolUses,
  })
  return approved
}

export async function rejectSkillCandidate(id: string): Promise<SkillCandidate> {
  const candidate = await getSkillCandidate(id)
  if (!candidate) throw new Error(`Skill candidate not found: ${id}`)
  if (candidate.status !== 'pending') {
    throw new Error(`Skill candidate is already ${candidate.status}.`)
  }
  const rejected = await updateSkillCandidate(id, {
    status: 'rejected',
    reviewedAt: new Date().toISOString(),
  })
  await recordSkillLearningEvent({
    kind: 'candidate-rejected',
    message: `Rejected /${rejected.name}.`,
    projectRoot: rejected.projectRoot,
    sessionId: rejected.sourceSessionId,
    candidateId: rejected.id,
    skillName: rejected.name,
    toolUseCount: rejected.sourceToolUses,
  })
  return rejected
}
