import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import {
  getClaudeConfigHomeDir,
  getExistingProjectConfigPath,
} from '../utils/envUtils.js'
import {
  readLocalizedMarketplaceDescriptions,
  type MarketplaceLocalizedDescriptions,
} from '../utils/marketplaceLocalization.js'

export type SkillMarketplaceScope = 'user' | 'project'

export type SkillMarketplaceSourceDefinition = {
  id: string
  name: string
  repository: string
  homepage: string
  roots: string[]
  localPath?: string
}

export type SkillMarketplaceInstallation = {
  scope: SkillMarketplaceScope
  managed: boolean
  updateAvailable: boolean
}

export type SkillMarketplaceItem = {
  id: string
  name: string
  displayName: string
  installName: string
  description: string
  localizedDescriptions?: MarketplaceLocalizedDescriptions
  version?: string
  updatedAt?: string
  popularity?: number
  author?: string
  license?: string
  category: string
  tags: string[]
  sourceId: string
  sourceName: string
  sourceUrl: string
  relativePath: string
  revision: string
  installations: SkillMarketplaceInstallation[]
}

export type SkillMarketplaceSource = {
  id: string
  name: string
  homepage: string
  status: 'ready' | 'stale' | 'error'
  itemCount: number
  revision?: string
  refreshedAt?: string
  error?: string
}

export type SkillMarketplaceCatalog = {
  items: SkillMarketplaceItem[]
  sources: SkillMarketplaceSource[]
}

type InstalledSkillMetadata = {
  version: 1
  itemId: string
  sourceId: string
  sourceName: string
  sourceRepository: string
  sourcePath: string
  revision: string
  installedAt: string
  updatedAt: string
}

type MaterializedSource = {
  checkoutPath: string
  revision: string
  refreshedAt?: string
  staleError?: string
}

type InstalledDirectory = {
  metadata: InstalledSkillMetadata | null
}

const MARKET_METADATA_FILE = '.cybercode-market.json'
const MAX_SKILL_FILES = 800
const MAX_SKILL_BYTES = 32 * 1024 * 1024
const MAX_SKILL_DEPTH = 8
const MAX_MARKET_SKILLS = 2_000
const GIT_TIMEOUT_MS = 120_000

export const BUILTIN_SKILL_MARKETPLACE_SOURCES: readonly SkillMarketplaceSourceDefinition[] = [
  {
    id: 'anthropic',
    name: 'Anthropic Agent Skills',
    repository: 'https://github.com/anthropics/skills.git',
    homepage: 'https://github.com/anthropics/skills',
    roots: ['skills'],
  },
  {
    id: 'vercel',
    name: 'Vercel Agent Skills',
    repository: 'https://github.com/vercel-labs/agent-skills.git',
    homepage: 'https://github.com/vercel-labs/agent-skills',
    roots: ['skills'],
  },
  {
    id: 'hermes',
    name: 'Hermes Optional Skills',
    repository: 'https://github.com/NousResearch/hermes-agent.git',
    homepage: 'https://github.com/NousResearch/hermes-agent/tree/main/optional-skills',
    roots: ['optional-skills'],
  },
] as const

export class SkillMarketplaceError extends Error {
  constructor(
    public code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE',
    message: string,
  ) {
    super(message)
    this.name = 'SkillMarketplaceError'
  }
}

let sourceOverrideForTesting: readonly SkillMarketplaceSourceDefinition[] | undefined
const materializeOperations = new Map<string, Promise<MaterializedSource>>()

export function setSkillMarketplaceSourcesForTesting(
  sources?: readonly SkillMarketplaceSourceDefinition[],
): void {
  sourceOverrideForTesting = sources
  materializeOperations.clear()
}

function getSources(): readonly SkillMarketplaceSourceDefinition[] {
  return sourceOverrideForTesting ?? BUILTIN_SKILL_MARKETPLACE_SOURCES
}

function getMarketplaceCacheRoot(): string {
  return path.join(getClaudeConfigHomeDir(), 'cache', 'skill-marketplace')
}

function getUserSkillsRoot(): string {
  return path.join(getClaudeConfigHomeDir(), 'skills')
}

async function getProjectSkillsRoot(cwd?: string): Promise<string | undefined> {
  if (!cwd) return undefined
  if (!path.isAbsolute(cwd)) {
    throw new SkillMarketplaceError('INVALID_INPUT', 'Project path must be absolute')
  }

  try {
    const stat = await fs.stat(cwd)
    if (!stat.isDirectory()) throw new Error('not a directory')
  } catch {
    throw new SkillMarketplaceError('INVALID_INPUT', 'Project path is not available')
  }

  return getExistingProjectConfigPath(cwd, 'skills')
}

function isSafeSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0')
  )
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join('/')
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized || undefined
  }
  if (typeof value === 'number') return String(value)
  return undefined
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function marketplaceUpdatedAt(frontmatter: Record<string, unknown>): string | undefined {
  const metadata = recordValue(frontmatter.metadata)
  for (const value of [
    frontmatter.updatedAt,
    frontmatter.updated_at,
    frontmatter.lastUpdated,
    frontmatter.publishedAt,
    metadata.updatedAt,
    metadata.updated_at,
  ]) {
    const candidate = stringValue(value)
    if (!candidate) continue
    const timestamp = Date.parse(candidate)
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString()
  }
  return undefined
}

function marketplacePopularity(frontmatter: Record<string, unknown>): number | undefined {
  const metadata = recordValue(frontmatter.metadata)
  const metrics = recordValue(frontmatter.metrics ?? metadata.metrics ?? metadata.stats)
  for (const value of [
    frontmatter.popularity,
    frontmatter.downloads,
    frontmatter.installCount,
    metadata.popularity,
    metadata.downloads,
    metadata.installCount,
    metrics.popularity,
    metrics.downloads,
    metrics.installs,
    metrics.stars,
  ]) {
    const parsed = numberValue(value)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

function authorValue(value: unknown): string | undefined {
  const direct = stringValue(value)
  if (direct) return direct
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return stringValue(record.name) ?? stringValue(record.author)
}

function tagsValue(frontmatter: Record<string, unknown>): string[] {
  const direct = frontmatter.tags
  const metadata = frontmatter.metadata
  const hermes = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).hermes
    : undefined
  const nestedTags = hermes && typeof hermes === 'object' && !Array.isArray(hermes)
    ? (hermes as Record<string, unknown>).tags
    : undefined
  const value = direct ?? nestedTags

  if (Array.isArray(value)) {
    return value
      .map(stringValue)
      .filter((tag): tag is string => Boolean(tag))
      .slice(0, 12)
  }
  const single = stringValue(value)
  return single
    ? single.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12)
    : []
}

function isInternalSkill(frontmatter: Record<string, unknown>): boolean {
  const metadata = frontmatter.metadata
  return Boolean(
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).internal === true,
  )
}

async function pathIsDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await fs.stat(targetPath)).isDirectory()
  } catch {
    return false
  }
}

function runGit(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Git operation timed out'))
    }, GIT_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      if (stdout.length < 64_000) stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 64_000) stderr += String(chunk)
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      reject(new Error(stderr.trim() || `Git exited with code ${code}`))
    })
  })
}

async function getCheckoutRevision(checkoutPath: string): Promise<string> {
  try {
    return await runGit(['-C', checkoutPath, 'rev-parse', 'HEAD'])
  } catch {
    const stat = await fs.stat(checkoutPath)
    return `local-${Math.floor(stat.mtimeMs)}`
  }
}

async function cloneSource(
  source: SkillMarketplaceSourceDefinition,
  targetPath: string,
): Promise<MaterializedSource> {
  const parentPath = path.dirname(targetPath)
  await fs.mkdir(parentPath, { recursive: true })
  const incomingPath = await fs.mkdtemp(
    path.join(parentPath, `.${source.id}-incoming-`),
  )
  const backupPath = `${targetPath}.backup-${randomUUID()}`
  let movedExisting = false

  try {
    await runGit([
      'clone',
      '--depth=1',
      '--filter=blob:none',
      '--sparse',
      source.repository,
      incomingPath,
    ])
    await runGit([
      '-C',
      incomingPath,
      'sparse-checkout',
      'set',
      ...source.roots,
    ])

    for (const root of source.roots) {
      if (!await pathIsDirectory(path.join(incomingPath, root))) {
        throw new Error(`Skill source is missing ${root}`)
      }
    }

    if (await pathIsDirectory(targetPath)) {
      await fs.rename(targetPath, backupPath)
      movedExisting = true
    }
    await fs.rename(incomingPath, targetPath)
    if (movedExisting) await fs.rm(backupPath, { recursive: true, force: true })

    const stat = await fs.stat(targetPath)
    return {
      checkoutPath: targetPath,
      revision: await getCheckoutRevision(targetPath),
      refreshedAt: stat.mtime.toISOString(),
    }
  } catch (error) {
    await fs.rm(incomingPath, { recursive: true, force: true }).catch(() => {})
    if (movedExisting && !await pathIsDirectory(targetPath)) {
      await fs.rename(backupPath, targetPath).catch(() => {})
    }
    throw error
  }
}

async function materializeSource(
  source: SkillMarketplaceSourceDefinition,
  refresh: boolean,
): Promise<MaterializedSource> {
  if (source.localPath) {
    if (!await pathIsDirectory(source.localPath)) {
      throw new Error('Local skill source is unavailable')
    }
    const stat = await fs.stat(source.localPath)
    return {
      checkoutPath: source.localPath,
      revision: await getCheckoutRevision(source.localPath),
      refreshedAt: stat.mtime.toISOString(),
    }
  }

  const targetPath = path.join(getMarketplaceCacheRoot(), source.id)
  const cached = await pathIsDirectory(targetPath)
  if (cached && !refresh) {
    const stat = await fs.stat(targetPath)
    return {
      checkoutPath: targetPath,
      revision: await getCheckoutRevision(targetPath),
      refreshedAt: stat.mtime.toISOString(),
    }
  }

  const operationKey = source.id
  const existingOperation = materializeOperations.get(operationKey)
  if (existingOperation) return existingOperation

  const operation = cloneSource(source, targetPath)
    .catch(async (error) => {
      if (!cached || !await pathIsDirectory(targetPath)) throw error
      const stat = await fs.stat(targetPath)
      return {
        checkoutPath: targetPath,
        revision: await getCheckoutRevision(targetPath),
        refreshedAt: stat.mtime.toISOString(),
        staleError: error instanceof Error ? error.message : String(error),
      }
    })
    .finally(() => {
      materializeOperations.delete(operationKey)
    })
  materializeOperations.set(operationKey, operation)
  return operation
}

async function discoverSkillDirectories(rootPath: string): Promise<string[]> {
  const found: string[] = []

  async function walk(currentPath: string, depth: number): Promise<void> {
    if (depth > MAX_SKILL_DEPTH || found.length >= MAX_MARKET_SKILLS) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true })
    } catch {
      return
    }

    if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
      found.push(currentPath)
      return
    }

    for (const entry of entries) {
      if (
        found.length >= MAX_MARKET_SKILLS ||
        !entry.isDirectory() ||
        entry.name.startsWith('.') ||
        entry.name === 'node_modules'
      ) {
        continue
      }
      await walk(path.join(currentPath, entry.name), depth + 1)
    }
  }

  await walk(rootPath, 0)
  return found
}

function getCategory(
  source: SkillMarketplaceSourceDefinition,
  skillDirectory: string,
  checkoutPath: string,
): string {
  const relative = normalizeRelativePath(path.relative(checkoutPath, skillDirectory))
  const matchingRoot = source.roots
    .map((root) => normalizeRelativePath(root).replace(/\/$/, ''))
    .find((root) => relative === root || relative.startsWith(`${root}/`))
  if (!matchingRoot) return 'general'
  const nested = relative.slice(matchingRoot.length).replace(/^\//, '').split('/')
  return nested.length > 1 ? nested.slice(0, -1).join(' / ') : 'general'
}

async function scanSource(
  source: SkillMarketplaceSourceDefinition,
  materialized: MaterializedSource,
): Promise<SkillMarketplaceItem[]> {
  const items: SkillMarketplaceItem[] = []
  const treeRevisions = new Map<string, string>()
  try {
    const output = await runGit([
      '-C',
      materialized.checkoutPath,
      'ls-tree',
      '-d',
      '-r',
      'HEAD',
      '--',
      ...source.roots,
    ])
    for (const line of output.split('\n')) {
      const match = line.match(/^\d+\s+tree\s+([0-9a-f]+)\t(.+)$/i)
      if (match) treeRevisions.set(normalizeRelativePath(match[2]), match[1])
    }
  } catch {
    // Local sources without Git metadata use the checkout revision fallback.
  }

  for (const sourceRoot of source.roots) {
    const rootPath = path.resolve(materialized.checkoutPath, sourceRoot)
    const relativeRoot = path.relative(materialized.checkoutPath, rootPath)
    if (relativeRoot.startsWith('..') || path.isAbsolute(relativeRoot)) continue

    const skillDirectories = await discoverSkillDirectories(rootPath)
    for (const skillDirectory of skillDirectories) {
      const installName = path.basename(skillDirectory)
      if (!isSafeSegment(installName)) continue

      const skillFile = path.join(skillDirectory, 'SKILL.md')
      try {
        const raw = await fs.readFile(skillFile, 'utf-8')
        const parsed = parseFrontmatter(raw, skillFile)
        const frontmatter = parsed.frontmatter as Record<string, unknown>
        if (isInternalSkill(frontmatter)) continue

        const relativePath = normalizeRelativePath(
          path.relative(materialized.checkoutPath, skillDirectory),
        )
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) continue

        const declaredName = stringValue(frontmatter.name)
        const displayName = declaredName ?? installName
        const localizedDescriptions = readLocalizedMarketplaceDescriptions(frontmatter)
        const updatedAt = marketplaceUpdatedAt(frontmatter)
        const popularity = marketplacePopularity(frontmatter)
        const description = stringValue(frontmatter.description)
          ?? localizedDescriptions?.en
          ?? parsed.content
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line && !line.startsWith('#'))
          ?? 'No description provided.'

        items.push({
          id: `${source.id}:${relativePath}`,
          name: declaredName ?? installName,
          displayName,
          installName,
          description,
          ...(localizedDescriptions && { localizedDescriptions }),
          version: stringValue(frontmatter.version),
          ...(updatedAt && { updatedAt }),
          ...(popularity !== undefined && { popularity }),
          author: authorValue(frontmatter.author),
          license: stringValue(frontmatter.license),
          category: getCategory(source, skillDirectory, materialized.checkoutPath),
          tags: tagsValue(frontmatter),
          sourceId: source.id,
          sourceName: source.name,
          sourceUrl: source.homepage,
          relativePath,
          revision: treeRevisions.get(relativePath) ?? materialized.revision,
          installations: [],
        })
      } catch {
        // Invalid or unreadable skills do not block the rest of the source.
      }
    }
  }

  return items
}

async function readInstalledMetadata(
  skillPath: string,
): Promise<InstalledSkillMetadata | null> {
  try {
    const raw = await fs.readFile(path.join(skillPath, MARKET_METADATA_FILE), 'utf-8')
    const value = JSON.parse(raw) as Partial<InstalledSkillMetadata>
    if (
      value.version !== 1 ||
      typeof value.itemId !== 'string' ||
      typeof value.sourceId !== 'string' ||
      typeof value.revision !== 'string'
    ) {
      return null
    }
    return value as InstalledSkillMetadata
  } catch {
    return null
  }
}

async function readInstalledDirectories(
  rootPath: string | undefined,
): Promise<Map<string, InstalledDirectory>> {
  const result = new Map<string, InstalledDirectory>()
  if (!rootPath) return result

  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true })
  } catch {
    return result
  }

  await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory() || entry.name.startsWith('.')) return
    const skillPath = path.join(rootPath, entry.name)
    try {
      const skillStat = await fs.stat(path.join(skillPath, 'SKILL.md'))
      if (!skillStat.isFile()) return
      result.set(entry.name, {
        metadata: await readInstalledMetadata(skillPath),
      })
    } catch {
      // Ignore directories that are not Skills.
    }
  }))
  return result
}

function applyInstallations(
  items: SkillMarketplaceItem[],
  scope: SkillMarketplaceScope,
  installed: Map<string, InstalledDirectory>,
): void {
  for (const item of items) {
    const directory = installed.get(item.installName)
    if (!directory) continue
    const managed = directory.metadata?.itemId === item.id
    item.installations.push({
      scope,
      managed,
      updateAvailable: Boolean(
        managed && directory.metadata?.revision !== item.revision,
      ),
    })
  }
}

export async function listSkillMarketplace(options: {
  cwd?: string
  refresh?: boolean
} = {}): Promise<SkillMarketplaceCatalog> {
  const sources = getSources()
  const projectRoot = await getProjectSkillsRoot(options.cwd)
  const [userInstalled, projectInstalled, sourceResults] = await Promise.all([
    readInstalledDirectories(getUserSkillsRoot()),
    readInstalledDirectories(projectRoot),
    Promise.all(sources.map(async (source) => {
      try {
        const materialized = await materializeSource(source, options.refresh === true)
        const items = await scanSource(source, materialized)
        return { source, materialized, items }
      } catch (error) {
        return {
          source,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })),
  ])

  const items: SkillMarketplaceItem[] = []
  const sourceStates: SkillMarketplaceSource[] = []

  for (const result of sourceResults) {
    if ('error' in result) {
      sourceStates.push({
        id: result.source.id,
        name: result.source.name,
        homepage: result.source.homepage,
        status: 'error',
        itemCount: 0,
        error: result.error,
      })
      continue
    }

    applyInstallations(result.items, 'user', userInstalled)
    applyInstallations(result.items, 'project', projectInstalled)
    items.push(...result.items)
    sourceStates.push({
      id: result.source.id,
      name: result.source.name,
      homepage: result.source.homepage,
      status: result.materialized.staleError ? 'stale' : 'ready',
      itemCount: result.items.length,
      revision: result.materialized.revision,
      refreshedAt: result.materialized.refreshedAt,
      error: result.materialized.staleError,
    })
  }

  items.sort((a, b) => a.displayName.localeCompare(b.displayName))
  return { items, sources: sourceStates }
}

async function findMarketplaceItem(
  itemId: string,
): Promise<{ item: SkillMarketplaceItem; sourcePath: string; source: SkillMarketplaceSourceDefinition }> {
  if (!itemId || itemId.length > 512) {
    throw new SkillMarketplaceError('INVALID_INPUT', 'Invalid marketplace skill')
  }
  const sourceId = itemId.split(':', 1)[0]
  const source = getSources().find((candidate) => candidate.id === sourceId)
  if (!source) {
    throw new SkillMarketplaceError('NOT_FOUND', 'Skill marketplace source was not found')
  }

  let materialized: MaterializedSource
  try {
    materialized = await materializeSource(source, false)
  } catch (error) {
    throw new SkillMarketplaceError(
      'UNAVAILABLE',
      error instanceof Error ? error.message : String(error),
    )
  }
  const items = await scanSource(source, materialized)
  const item = items.find((candidate) => candidate.id === itemId)
  if (!item) {
    throw new SkillMarketplaceError('NOT_FOUND', 'Marketplace skill was not found')
  }

  const sourcePath = path.resolve(materialized.checkoutPath, item.relativePath)
  const relative = path.relative(materialized.checkoutPath, sourcePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new SkillMarketplaceError('INVALID_INPUT', 'Invalid marketplace skill path')
  }
  return { item, sourcePath, source }
}

async function getInstallRoot(
  scope: SkillMarketplaceScope,
  cwd?: string,
): Promise<string> {
  if (scope === 'user') return getUserSkillsRoot()
  const root = await getProjectSkillsRoot(cwd)
  if (!root) {
    throw new SkillMarketplaceError(
      'INVALID_INPUT',
      'Open a project before installing a project Skill',
    )
  }
  return root
}

async function validateSkillDirectory(skillPath: string): Promise<void> {
  let fileCount = 0
  let totalBytes = 0

  async function walk(currentPath: string, depth: number): Promise<void> {
    if (depth > MAX_SKILL_DEPTH + 4) {
      throw new SkillMarketplaceError('INVALID_INPUT', 'Skill directory is too deeply nested')
    }
    const entries = await fs.readdir(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name)
      if (entry.isSymbolicLink()) {
        throw new SkillMarketplaceError(
          'INVALID_INPUT',
          'Skills containing symbolic links cannot be installed',
        )
      }
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue
        await walk(entryPath, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      fileCount += 1
      totalBytes += (await fs.stat(entryPath)).size
      if (fileCount > MAX_SKILL_FILES || totalBytes > MAX_SKILL_BYTES) {
        throw new SkillMarketplaceError('INVALID_INPUT', 'Skill package is too large')
      }
    }
  }

  await walk(skillPath, 0)
  if (!await pathIsDirectory(skillPath)) {
    throw new SkillMarketplaceError('NOT_FOUND', 'Marketplace skill files are unavailable')
  }
  try {
    const stat = await fs.stat(path.join(skillPath, 'SKILL.md'))
    if (!stat.isFile()) throw new Error('missing')
  } catch {
    throw new SkillMarketplaceError('INVALID_INPUT', 'Skill package is missing SKILL.md')
  }
}

export async function installSkillMarketplaceItem(input: {
  itemId: string
  scope: SkillMarketplaceScope
  cwd?: string
}): Promise<{ item: SkillMarketplaceItem; installPath: string; updated: boolean }> {
  if (input.scope !== 'user' && input.scope !== 'project') {
    throw new SkillMarketplaceError('INVALID_INPUT', 'Invalid Skill installation scope')
  }
  const { item, sourcePath, source } = await findMarketplaceItem(input.itemId)
  await validateSkillDirectory(sourcePath)

  const installRoot = await getInstallRoot(input.scope, input.cwd)
  await fs.mkdir(installRoot, { recursive: true })
  const installPath = path.join(installRoot, item.installName)
  const existing = await pathIsDirectory(installPath)
  const existingMetadata = existing ? await readInstalledMetadata(installPath) : null
  if (existing && existingMetadata?.itemId !== item.id) {
    throw new SkillMarketplaceError(
      'CONFLICT',
      `A different Skill named "${item.installName}" is already installed in this scope`,
    )
  }

  const now = new Date().toISOString()
  const metadata: InstalledSkillMetadata = {
    version: 1,
    itemId: item.id,
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    sourceRepository: source.repository,
    sourcePath: item.relativePath,
    revision: item.revision,
    installedAt: existingMetadata?.installedAt ?? now,
    updatedAt: now,
  }
  const incomingPath = path.join(installRoot, `.${item.installName}-installing-${randomUUID()}`)
  const backupPath = path.join(installRoot, `.${item.installName}-backup-${randomUUID()}`)
  let movedExisting = false

  try {
    await fs.cp(sourcePath, incomingPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: (source) => {
        const basename = path.basename(source)
        return basename !== '.git' && basename !== MARKET_METADATA_FILE
      },
    })
    await fs.writeFile(
      path.join(incomingPath, MARKET_METADATA_FILE),
      `${JSON.stringify(metadata, null, 2)}\n`,
      'utf-8',
    )
    if (existing) {
      await fs.rename(installPath, backupPath)
      movedExisting = true
    }
    await fs.rename(incomingPath, installPath)
    if (movedExisting) await fs.rm(backupPath, { recursive: true, force: true })
  } catch (error) {
    await fs.rm(incomingPath, { recursive: true, force: true }).catch(() => {})
    if (movedExisting && !await pathIsDirectory(installPath)) {
      await fs.rename(backupPath, installPath).catch(() => {})
    }
    if (error instanceof SkillMarketplaceError) throw error
    throw new SkillMarketplaceError(
      'UNAVAILABLE',
      error instanceof Error ? error.message : String(error),
    )
  }

  return { item, installPath, updated: existing }
}

export async function uninstallSkillMarketplaceItem(input: {
  itemId: string
  scope: SkillMarketplaceScope
  cwd?: string
}): Promise<{ installPath: string }> {
  if (input.scope !== 'user' && input.scope !== 'project') {
    throw new SkillMarketplaceError('INVALID_INPUT', 'Invalid Skill installation scope')
  }
  const { item } = await findMarketplaceItem(input.itemId)
  const installRoot = await getInstallRoot(input.scope, input.cwd)
  const installPath = path.join(installRoot, item.installName)
  if (!await pathIsDirectory(installPath)) {
    throw new SkillMarketplaceError('NOT_FOUND', 'Installed Skill was not found')
  }
  const metadata = await readInstalledMetadata(installPath)
  if (metadata?.itemId !== item.id) {
    throw new SkillMarketplaceError(
      'CONFLICT',
      'This Skill was not installed by the marketplace and will not be removed',
    )
  }
  await fs.rm(installPath, { recursive: true, force: true })
  return { installPath }
}
