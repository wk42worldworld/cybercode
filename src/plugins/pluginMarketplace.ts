import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { compare, valid } from 'semver'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { clearAllCaches } from '../utils/plugins/cacheUtils.js'
import { loadInstalledPluginsV2 } from '../utils/plugins/installedPluginsManager.js'
import {
  addMarketplaceSource,
  clearMarketplacesCache,
  loadKnownMarketplacesConfig,
} from '../utils/plugins/marketplaceManager.js'
import {
  installPluginOp,
  updatePluginOp,
} from '../services/plugins/pluginOperations.js'
import type { PluginMarketplaceEntry } from '../utils/plugins/schemas.js'
import {
  readLocalizedMarketplaceDescriptions,
  type MarketplaceLocalizedDescriptions,
} from '../utils/marketplaceLocalization.js'

export type PluginMarketplaceSourceDefinition = {
  id: string
  name: string
  repository: string
  homepage: string
  marketplaceName: string
  roots: string[]
  format: 'codex' | 'claude'
  localPath?: string
  archiveUrl?: string
}

export type PluginMarketplaceInstallation = {
  scope: 'user' | 'project' | 'local' | 'managed'
  version?: string
  updateAvailable: boolean
}

export type PluginMarketplaceItem = {
  id: string
  name: string
  displayName: string
  description: string
  localizedDescriptions?: MarketplaceLocalizedDescriptions
  version?: string
  updatedAt?: string
  popularity?: number
  author?: string
  category: string
  tags: string[]
  homepage?: string
  iconUrl?: string
  brandColor?: string
  sourceId: string
  sourceName: string
  sourceUrl: string
  features: string[]
  compatible: boolean
  compatibilityNote?: string
  revision: string
  installations: PluginMarketplaceInstallation[]
}

export type PluginMarketplaceSource = {
  id: string
  name: string
  homepage: string
  status: 'ready' | 'stale' | 'error'
  itemCount: number
  revision?: string
  refreshedAt?: string
  error?: string
}

export type PluginMarketplaceCatalog = {
  items: PluginMarketplaceItem[]
  sources: PluginMarketplaceSource[]
}

type MaterializedSource = {
  checkoutPath: string
  revision: string
  refreshedAt?: string
  staleError?: string
}

type NormalizedSource = {
  items: PluginMarketplaceItem[]
  entries: Map<string, PluginMarketplaceEntry>
}

const GIT_TIMEOUT_MS = 180_000
const ARCHIVE_TIMEOUT_MS = 180_000
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
const MAX_PLUGINS_PER_SOURCE = 2_000
const SUPPORTED_COMPONENTS = [
  'skills',
  'commands',
  'agents',
  'hooks',
  'mcpServers',
  'lspServers',
] as const

export const BUILTIN_PLUGIN_MARKETPLACE_SOURCES: readonly PluginMarketplaceSourceDefinition[] = [
  {
    id: 'openai',
    name: 'Codex Official',
    repository: 'https://github.com/openai/plugins.git',
    homepage: 'https://github.com/openai/plugins',
    marketplaceName: 'openai-plugins',
    roots: ['.agents/plugins', 'plugins'],
    format: 'codex',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Official',
    repository: 'https://github.com/anthropics/claude-plugins-official.git',
    homepage: 'https://github.com/anthropics/claude-plugins-official',
    marketplaceName: 'cybercode-anthropic-directory',
    roots: ['.claude-plugin', 'plugins', 'external_plugins'],
    format: 'claude',
  },
] as const

export class PluginMarketplaceError extends Error {
  constructor(
    public code: 'INVALID_INPUT' | 'NOT_FOUND' | 'INCOMPATIBLE' | 'UNAVAILABLE' | 'CANCELLED',
    message: string,
  ) {
    super(message)
    this.name = 'PluginMarketplaceError'
  }
}

let sourceOverrideForTesting: readonly PluginMarketplaceSourceDefinition[] | undefined
const materializeOperations = new Map<string, Promise<MaterializedSource>>()
const sourceLoadOperations = new Map<
  string,
  Promise<{ materialized: MaterializedSource; normalized: NormalizedSource }>
>()

export function setPluginMarketplaceSourcesForTesting(
  sources?: readonly PluginMarketplaceSourceDefinition[],
): void {
  sourceOverrideForTesting = sources
  materializeOperations.clear()
  sourceLoadOperations.clear()
}

function getSources(): readonly PluginMarketplaceSourceDefinition[] {
  return sourceOverrideForTesting ?? BUILTIN_PLUGIN_MARKETPLACE_SOURCES
}

function getMarketplaceCacheRoot(): string {
  return path.join(getClaudeConfigHomeDir(), 'cache', 'plugin-marketplace')
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(stringValue).filter((entry): entry is string => Boolean(entry))
  }
  const single = stringValue(value)
  return single ? [single] : []
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function marketplaceUpdatedAt(...records: Record<string, unknown>[]): string | undefined {
  for (const record of records) {
    for (const key of ['updatedAt', 'updated_at', 'lastUpdated', 'publishedAt', 'published_at']) {
      const value = stringValue(record[key])
      if (!value) continue
      const timestamp = Date.parse(value)
      if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString()
    }
  }
  return undefined
}

function marketplacePopularity(...records: Record<string, unknown>[]): number | undefined {
  for (const record of records) {
    const metrics = recordValue(record.metrics ?? record.stats)
    for (const value of [
      record.popularity,
      record.downloads,
      record.installCount,
      record.install_count,
      record.stars,
      metrics.popularity,
      metrics.downloads,
      metrics.installs,
      metrics.stars,
    ]) {
      const parsed = numberValue(value)
      if (parsed !== undefined) return parsed
    }
  }
  return undefined
}

function authorValue(value: unknown): string | undefined {
  return stringValue(value) ?? stringValue(recordValue(value).name)
}

function isSafeRelativePath(value: string): boolean {
  if (!value || path.isAbsolute(value) || value.includes('\0')) return false
  const normalized = path.normalize(value)
  return normalized !== '..' && !normalized.startsWith(`..${path.sep}`)
}

async function pathIsDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await fs.stat(targetPath)).isDirectory()
  } catch {
    return false
  }
}

async function pathIsFile(targetPath: string): Promise<boolean> {
  try {
    return (await fs.stat(targetPath)).isFile()
  } catch {
    return false
  }
}

function runGit(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish(() => reject(new Error('Git operation timed out')))
    }, GIT_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      if (stdout.length < 64_000) stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 64_000) stderr += String(chunk)
    })
    child.once('error', (error) => finish(() => reject(error)))
    child.once('close', (code) => finish(() => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `Git exited with code ${code}`))
    }))
  })
}

function githubArchiveUrl(source: PluginMarketplaceSourceDefinition): string | undefined {
  if (source.archiveUrl) return source.archiveUrl
  const match = source.repository.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/i)
  if (!match) return undefined
  return `https://api.github.com/repos/${match[1]}/${match[2]}/tarball/HEAD`
}

function isIncludedArchivePath(
  source: PluginMarketplaceSourceDefinition,
  relativePath: string,
): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  return source.roots.some((root) => {
    const normalizedRoot = root.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
    return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`)
  })
}

async function replaceCheckout(incomingPath: string, targetPath: string): Promise<void> {
  const backupPath = `${targetPath}.backup-${randomUUID()}`
  let movedExisting = false
  try {
    if (await pathIsDirectory(targetPath)) {
      await fs.rename(targetPath, backupPath)
      movedExisting = true
    }
    await fs.rename(incomingPath, targetPath)
    if (movedExisting) await fs.rm(backupPath, { recursive: true, force: true })
  } catch (error) {
    if (movedExisting && !await pathIsDirectory(targetPath)) {
      await fs.rename(backupPath, targetPath).catch(() => {})
    }
    throw error
  }
}

async function downloadArchiveSource(
  source: PluginMarketplaceSourceDefinition,
  targetPath: string,
): Promise<MaterializedSource> {
  const archiveUrl = githubArchiveUrl(source)
  if (!archiveUrl) throw new Error('Plugin source does not provide a downloadable archive')

  const parentPath = path.dirname(targetPath)
  await fs.mkdir(parentPath, { recursive: true })
  const incomingPath = await fs.mkdtemp(path.join(parentPath, `.${source.id}-archive-`))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ARCHIVE_TIMEOUT_MS)
  try {
    const response = await fetch(archiveUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'CyberCode-Plugin-Marketplace',
      },
    })
    if (!response.ok) {
      throw new Error(`Plugin archive download failed with HTTP ${response.status}`)
    }
    const compressed = new Uint8Array(await response.arrayBuffer())
    if (compressed.byteLength === 0 || compressed.byteLength > MAX_ARCHIVE_BYTES) {
      throw new Error('Plugin archive size is invalid')
    }
    const archiveRevision = response.url.match(/\/([0-9a-f]{40})(?:$|[/?#])/i)?.[1]
      ?? createHash('sha256').update(compressed).digest('hex')
    const archive = new Bun.Archive(compressed)
    const files = await archive.files()
    let extractedFiles = 0
    for (const [archivePath, file] of files) {
      const segments = archivePath.replace(/\\/g, '/').split('/').filter(Boolean)
      if (segments.length < 2) continue
      const relativePath = segments.slice(1).join('/')
      if (!isSafeRelativePath(relativePath) || !isIncludedArchivePath(source, relativePath)) {
        continue
      }
      const destination = path.resolve(incomingPath, relativePath)
      const relativeDestination = path.relative(incomingPath, destination)
      if (relativeDestination.startsWith('..') || path.isAbsolute(relativeDestination)) continue
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.writeFile(destination, new Uint8Array(await file.arrayBuffer()))
      extractedFiles += 1
    }
    if (extractedFiles === 0) throw new Error('Plugin archive did not contain marketplace files')
    for (const root of source.roots) {
      const rootPath = path.join(incomingPath, root)
      if (!await pathIsDirectory(rootPath) && !await pathIsFile(rootPath)) {
        throw new Error(`Plugin source is missing ${root}`)
      }
    }
    await replaceCheckout(incomingPath, targetPath)
    const stat = await fs.stat(targetPath)
    return {
      checkoutPath: targetPath,
      revision: archiveRevision,
      refreshedAt: stat.mtime.toISOString(),
    }
  } catch (error) {
    await fs.rm(incomingPath, { recursive: true, force: true }).catch(() => {})
    if (controller.signal.aborted) throw new Error('Plugin archive download timed out')
    throw error
  } finally {
    clearTimeout(timeout)
  }
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
  source: PluginMarketplaceSourceDefinition,
  targetPath: string,
): Promise<MaterializedSource> {
  const parentPath = path.dirname(targetPath)
  await fs.mkdir(parentPath, { recursive: true })
  const incomingPath = await fs.mkdtemp(path.join(parentPath, `.${source.id}-incoming-`))

  try {
    await runGit([
      'clone',
      '--depth=1',
      '--filter=blob:none',
      '--sparse',
      source.repository,
      incomingPath,
    ])
    await runGit(['-C', incomingPath, 'sparse-checkout', 'set', ...source.roots])
    for (const root of source.roots) {
      const rootPath = path.join(incomingPath, root)
      if (!await pathIsDirectory(rootPath) && !await pathIsFile(rootPath)) {
        throw new Error(`Plugin source is missing ${root}`)
      }
    }
    await replaceCheckout(incomingPath, targetPath)
    const stat = await fs.stat(targetPath)
    return {
      checkoutPath: targetPath,
      revision: await getCheckoutRevision(targetPath),
      refreshedAt: stat.mtime.toISOString(),
    }
  } catch (error) {
    await fs.rm(incomingPath, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function refreshSource(
  source: PluginMarketplaceSourceDefinition,
  targetPath: string,
): Promise<MaterializedSource> {
  try {
    return await cloneSource(source, targetPath)
  } catch (gitError) {
    try {
      return await downloadArchiveSource(source, targetPath)
    } catch (archiveError) {
      const gitMessage = gitError instanceof Error ? gitError.message : String(gitError)
      const archiveMessage = archiveError instanceof Error ? archiveError.message : String(archiveError)
      throw new Error(`Git source failed: ${gitMessage}; archive fallback failed: ${archiveMessage}`)
    }
  }
}

async function materializeSource(
  source: PluginMarketplaceSourceDefinition,
  refresh: boolean,
): Promise<MaterializedSource> {
  if (source.localPath) {
    if (!await pathIsDirectory(source.localPath)) {
      throw new Error('Local plugin source is unavailable')
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

  const operationKey = `${targetPath}:${source.id}`
  const existing = materializeOperations.get(operationKey)
  if (existing) return existing

  const operation = refreshSource(source, targetPath)
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
    .finally(() => materializeOperations.delete(operationKey))
  materializeOperations.set(operationKey, operation)
  return operation
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid JSON object in ${filePath}`)
  }
  return parsed as Record<string, unknown>
}

function marketplacePlugins(marketplace: Record<string, unknown>, filePath: string): unknown[] {
  if (!Array.isArray(marketplace.plugins)) {
    throw new Error(`Invalid plugin marketplace manifest in ${filePath}`)
  }
  return marketplace.plugins
}

function iconPathValue(value: unknown): string | undefined {
  const direct = stringValue(value)
  if (direct) return direct
  const record = recordValue(value)
  if (!record) return undefined
  return stringValue(record.src)
    ?? stringValue(record.url)
    ?? stringValue(record.default)
    ?? stringValue(record.light)
    ?? stringValue(record.dark)
}

function firstIconPath(...values: unknown[]): string | undefined {
  for (const value of values) {
    const iconPath = iconPathValue(value)
    if (iconPath) return iconPath
  }
  return undefined
}

function getOfficialIconUrl(
  repository: string,
  pluginRelativePath: string | undefined,
  iconPath: string | undefined,
  revision = 'HEAD',
): string | undefined {
  if (!iconPath) return undefined
  try {
    const remoteUrl = new URL(iconPath)
    if (remoteUrl.protocol === 'https:' && !remoteUrl.username && !remoteUrl.password) {
      return remoteUrl.toString()
    }
  } catch {
    // Relative icon paths are resolved against the official GitHub repository below.
  }
  if (!isSafeRelativePath(iconPath)) return undefined
  const repositoryMatch = repository.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i)
  if (!repositoryMatch) return undefined
  const normalizedBase = pluginRelativePath?.replace(/\\/g, '/').replace(/^\.\//, '')
  const normalized = path.posix.normalize([
    normalizedBase,
    iconPath.replace(/^\.\//, ''),
  ].filter(Boolean).join('/'))
  if (normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return undefined
  return `https://raw.githubusercontent.com/${repositoryMatch[1]}/${repositoryMatch[2]}/${revision}/${normalized}`
}

function componentFeatures(manifest: Record<string, unknown>): string[] {
  return SUPPORTED_COMPONENTS.filter((key) => {
    const value = manifest[key]
    return Array.isArray(value)
      ? value.length > 0
      : typeof value === 'string'
        ? value.trim().length > 0
        : Boolean(value && typeof value === 'object')
  })
}

function normalizeComponentValue(value: unknown): unknown {
  if (typeof value === 'string') return isSafeRelativePath(value) ? value : undefined
  if (Array.isArray(value)) {
    const values = value
      .map(stringValue)
      .filter((entry): entry is string => Boolean(entry && isSafeRelativePath(entry)))
    return values.length > 0 ? values : undefined
  }
  return value && typeof value === 'object' ? value : undefined
}

async function normalizeCodexSource(
  source: PluginMarketplaceSourceDefinition,
  materialized: MaterializedSource,
): Promise<NormalizedSource> {
  const marketplacePath = path.join(
    materialized.checkoutPath,
    '.agents',
    'plugins',
    'marketplace.json',
  )
  const marketplace = await readJson(marketplacePath)
  const rawPlugins = marketplacePlugins(marketplace, marketplacePath)
  const normalizedEntries: PluginMarketplaceEntry[] = []
  const items: PluginMarketplaceItem[] = []

  for (const rawValue of rawPlugins.slice(0, MAX_PLUGINS_PER_SOURCE)) {
    const rawEntry = recordValue(rawValue)
    const name = stringValue(rawEntry.name)
    const sourceConfig = recordValue(rawEntry.source)
    const pluginRelativePath = stringValue(sourceConfig.path)?.replace(/^\.\//, '')
    if (!name || !pluginRelativePath || !isSafeRelativePath(pluginRelativePath)) continue

    const pluginRoot = path.resolve(materialized.checkoutPath, pluginRelativePath)
    const relative = path.relative(materialized.checkoutPath, pluginRoot)
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue

    let manifest: Record<string, unknown>
    try {
      manifest = await readJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'))
    } catch {
      continue
    }

    const policy = recordValue(rawEntry.policy)
    if (stringValue(policy.installation)?.toUpperCase() === 'BLOCKED') continue
    const products = stringList(policy.products).map((value) => value.toUpperCase())
    if (products.length > 0 && !products.includes('CODEX')) continue

    const interfaceConfig = recordValue(manifest.interface)
    const entry: Record<string, unknown> = {
      name,
      source: `./${pluginRelativePath.replace(/\\/g, '/')}`,
      strict: false,
      description:
        stringValue(interfaceConfig.shortDescription) ??
        stringValue(manifest.description) ??
        stringValue(rawEntry.description),
      version: stringValue(manifest.version),
      author: manifest.author,
      homepage: stringValue(manifest.homepage) ?? stringValue(manifest.repository),
      category: stringValue(rawEntry.category) ?? stringValue(interfaceConfig.category),
      tags: stringList(manifest.keywords),
    }
    for (const key of SUPPORTED_COMPONENTS) {
      const value = normalizeComponentValue(manifest[key])
      if (value !== undefined) entry[key] = value
    }
    if (!entry.mcpServers && await pathIsFile(path.join(pluginRoot, '.mcp.json'))) {
      entry.mcpServers = './.mcp.json'
    }

    const features = componentFeatures(entry)
    const compatible = features.length > 0
    const displayName = stringValue(interfaceConfig.displayName) ?? name
    const localizedDescriptions = readLocalizedMarketplaceDescriptions(
      interfaceConfig,
      manifest,
      rawEntry,
    )
    const category = stringValue(entry.category) ?? 'general'
    const iconPath = firstIconPath(
      interfaceConfig.composerIcon,
      interfaceConfig.icon,
      manifest.icon,
      rawEntry.icon,
      interfaceConfig.logo,
      manifest.logo,
      rawEntry.logo,
    )
    const brandColor = stringValue(interfaceConfig.brandColor)
    const version = stringValue(entry.version)
    const updatedAt = marketplaceUpdatedAt(interfaceConfig, manifest, rawEntry)
    const popularity = marketplacePopularity(interfaceConfig, manifest, rawEntry)
    normalizedEntries.push(entry as PluginMarketplaceEntry)
    items.push({
      id: `${name}@${source.marketplaceName}`,
      name,
      displayName,
      description: stringValue(entry.description)
        ?? localizedDescriptions?.en
        ?? 'No description provided.',
      ...(localizedDescriptions && { localizedDescriptions }),
      version,
      ...(updatedAt && { updatedAt }),
      ...(popularity !== undefined && { popularity }),
      author: authorValue(entry.author) ?? stringValue(interfaceConfig.developerName),
      category,
      tags: stringList(entry.tags),
      homepage: stringValue(entry.homepage),
      iconUrl: getOfficialIconUrl(
        source.repository,
        pluginRelativePath,
        iconPath,
        materialized.revision,
      ),
      brandColor: brandColor && /^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : undefined,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.homepage,
      features,
      compatible,
      compatibilityNote: compatible
        ? undefined
        : 'This plugin only exposes a Codex-hosted connector and has no portable Skills, commands, agents, hooks, or MCP configuration.',
      revision: materialized.revision,
      installations: [],
    })
  }

  await writeNormalizedMarketplace(
    materialized.checkoutPath,
    source.marketplaceName,
    'CyberCode-compatible view of the OpenAI Codex plugin directory',
    normalizedEntries,
  )
  return {
    items,
    entries: new Map(normalizedEntries.map((entry) => [entry.name, entry])),
  }
}

async function normalizeClaudeSource(
  source: PluginMarketplaceSourceDefinition,
  materialized: MaterializedSource,
): Promise<NormalizedSource> {
  const marketplacePath = path.join(materialized.checkoutPath, '.claude-plugin', 'marketplace.json')
  const marketplace = await readJson(marketplacePath)
  const rawPlugins = marketplacePlugins(marketplace, marketplacePath)
  const normalizedEntries: PluginMarketplaceEntry[] = []
  const items: PluginMarketplaceItem[] = []

  for (const rawValue of rawPlugins.slice(0, MAX_PLUGINS_PER_SOURCE)) {
    const rawEntry = recordValue(rawValue)
    const name = stringValue(rawEntry.name)
    if (!name || rawEntry.source == null) continue
    const entry = { ...rawEntry } as PluginMarketplaceEntry
    normalizedEntries.push(entry)

    let manifest: Record<string, unknown> = {}
    let pluginRelativePath: string | undefined
    if (typeof rawEntry.source === 'string') {
      pluginRelativePath = rawEntry.source.replace(/^\.\//, '')
      if (isSafeRelativePath(pluginRelativePath)) {
        try {
          manifest = await readJson(path.join(
            materialized.checkoutPath,
            pluginRelativePath,
            '.claude-plugin',
            'plugin.json',
          ))
        } catch {
          // Marketplace metadata remains enough for remote and non-strict plugins.
        }
      }
    }
    const merged = { ...rawEntry, ...manifest }
    const interfaceConfig = recordValue(manifest.interface)
    const features = componentFeatures(merged)
    const version = stringValue(merged.version)
    const updatedAt = marketplaceUpdatedAt(interfaceConfig, manifest, rawEntry)
    const popularity = marketplacePopularity(interfaceConfig, manifest, rawEntry)
    const localizedDescriptions = readLocalizedMarketplaceDescriptions(manifest, rawEntry)
    const sourceRecord = recordValue(rawEntry.source)
    const sourceRevision = stringValue(sourceRecord.sha)
    const iconPath = firstIconPath(
      interfaceConfig.composerIcon,
      interfaceConfig.icon,
      manifest.icon,
      rawEntry.icon,
      interfaceConfig.logo,
      manifest.logo,
      rawEntry.logo,
    )
    const iconRepository = pluginRelativePath
      ? source.repository
      : stringValue(sourceRecord.url) ?? source.repository
    const iconBasePath = pluginRelativePath
      ?? stringValue(sourceRecord.path)?.replace(/^\.\//, '')
    const iconRevision = sourceRevision
      ?? stringValue(sourceRecord.ref)
      ?? materialized.revision
    items.push({
      id: `${name}@${source.marketplaceName}`,
      name,
      displayName: stringValue(merged.displayName) ?? name,
      description: stringValue(merged.description)
        ?? localizedDescriptions?.en
        ?? 'No description provided.',
      ...(localizedDescriptions && { localizedDescriptions }),
      version,
      ...(updatedAt && { updatedAt }),
      ...(popularity !== undefined && { popularity }),
      author: authorValue(merged.author),
      category: stringValue(rawEntry.category) ?? 'general',
      tags: stringList(rawEntry.tags),
      homepage: stringValue(rawEntry.homepage) ?? stringValue(manifest.homepage),
      iconUrl: getOfficialIconUrl(iconRepository, iconBasePath, iconPath, iconRevision),
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.homepage,
      features,
      compatible: true,
      revision: sourceRevision ?? materialized.revision,
      installations: [],
    })
  }

  await writeNormalizedMarketplace(
    materialized.checkoutPath,
    source.marketplaceName,
    stringValue(marketplace.description) ?? 'Anthropic plugin directory for CyberCode',
    normalizedEntries,
  )
  return {
    items,
    entries: new Map(normalizedEntries.map((entry) => [entry.name, entry])),
  }
}

async function writeNormalizedMarketplace(
  checkoutPath: string,
  name: string,
  description: string,
  plugins: PluginMarketplaceEntry[],
): Promise<void> {
  const manifestDirectory = path.join(checkoutPath, '.claude-plugin')
  await fs.mkdir(manifestDirectory, { recursive: true })
  await fs.writeFile(
    path.join(manifestDirectory, 'marketplace.json'),
    `${JSON.stringify({
      name,
      description,
      owner: { name: 'CyberCode' },
      plugins,
    }, null, 2)}\n`,
    'utf-8',
  )
}

async function normalizeSource(
  source: PluginMarketplaceSourceDefinition,
  materialized: MaterializedSource,
): Promise<NormalizedSource> {
  return source.format === 'codex'
    ? normalizeCodexSource(source, materialized)
    : normalizeClaudeSource(source, materialized)
}

function isUpdateAvailable(
  item: Pick<PluginMarketplaceItem, 'version' | 'revision'>,
  installation: { version?: string; gitCommitSha?: string },
): boolean {
  if (item.version && installation.version) {
    const marketplaceVersion = valid(item.version)
    const installedVersion = valid(installation.version)
    if (marketplaceVersion && installedVersion) {
      return compare(marketplaceVersion, installedVersion) > 0
    }
    if (item.version === installation.version) return false
  }
  return Boolean(
    installation.gitCommitSha && item.revision !== installation.gitCommitSha,
  )
}

function applyInstallations(items: PluginMarketplaceItem[]): void {
  const installed = loadInstalledPluginsV2().plugins
  for (const item of items) {
    const entries = installed[item.id] ?? []
    item.installations = entries.map((entry) => ({
      scope: entry.scope,
      version: entry.version,
      updateAvailable: isUpdateAvailable(item, entry),
    }))
  }
}

async function materializeAndNormalizeSource(
  source: PluginMarketplaceSourceDefinition,
  refresh: boolean,
): Promise<{ materialized: MaterializedSource; normalized: NormalizedSource }> {
  const operationKey = source.localPath
    ? `local:${path.resolve(source.localPath)}:${source.id}`
    : `${getMarketplaceCacheRoot()}:${source.id}`
  const previous = sourceLoadOperations.get(operationKey)
  const operation = (previous ? previous.catch(() => undefined) : Promise.resolve())
    .then(() => materializeAndNormalizeSourceUnlocked(source, refresh))
  sourceLoadOperations.set(operationKey, operation)
  try {
    return await operation
  } finally {
    if (sourceLoadOperations.get(operationKey) === operation) {
      sourceLoadOperations.delete(operationKey)
    }
  }
}

async function materializeAndNormalizeSourceUnlocked(
  source: PluginMarketplaceSourceDefinition,
  refresh: boolean,
): Promise<{ materialized: MaterializedSource; normalized: NormalizedSource }> {
  if (source.localPath) {
    const materialized = await materializeSource(source, refresh)
    return { materialized, normalized: await normalizeSource(source, materialized) }
  }

  if (refresh) return refreshAndNormalizeSource(source)

  const materialized = await materializeSource(source, false)
  try {
    return { materialized, normalized: await normalizeSource(source, materialized) }
  } catch {
    return refreshAndNormalizeSource(source)
  }
}

async function refreshAndNormalizeSource(
  source: PluginMarketplaceSourceDefinition,
): Promise<{ materialized: MaterializedSource; normalized: NormalizedSource }> {
  const targetPath = path.join(getMarketplaceCacheRoot(), source.id)
  const backupPath = `${targetPath}.validation-backup-${randomUUID()}`
  const hadCache = await pathIsDirectory(targetPath)
  if (hadCache) await fs.rename(targetPath, backupPath)

  try {
    const materialized = await materializeSource(source, true)
    const normalized = await normalizeSource(source, materialized)
    if (hadCache) await fs.rm(backupPath, { recursive: true, force: true })
    return { materialized, normalized }
  } catch (error) {
    await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {})
    if (hadCache) await fs.rename(backupPath, targetPath).catch(() => {})
    if (hadCache && await pathIsDirectory(targetPath)) {
      try {
        const stat = await fs.stat(targetPath)
        const materialized: MaterializedSource = {
          checkoutPath: targetPath,
          revision: await getCheckoutRevision(targetPath),
          refreshedAt: stat.mtime.toISOString(),
          staleError: error instanceof Error ? error.message : String(error),
        }
        return {
          materialized,
          normalized: await normalizeSource(source, materialized),
        }
      } catch {
        // Keep the old cache on disk even when it is also invalid.
      }
    }
    throw error
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new PluginMarketplaceError('CANCELLED', 'Plugin marketplace request was cancelled')
}

async function assertMarketplaceRegistrationIsSafe(
  marketplaceName: string,
  checkoutPath: string,
): Promise<void> {
  const existing = (await loadKnownMarketplacesConfig())[marketplaceName]
  if (!existing) return
  if (path.resolve(existing.installLocation) === path.resolve(checkoutPath)) return
  throw new PluginMarketplaceError(
    'UNAVAILABLE',
    `Marketplace name "${marketplaceName}" is already used by another source. ` +
      'CyberCode left the existing marketplace unchanged.',
  )
}

export async function listPluginMarketplace(options: {
  refresh?: boolean
  signal?: AbortSignal
} = {}): Promise<PluginMarketplaceCatalog> {
  throwIfAborted(options.signal)
  const sourceResults = await Promise.all(getSources().map(async (source) => {
    try {
      const { materialized, normalized } = await materializeAndNormalizeSource(
        source,
        options.refresh === true,
      )
      throwIfAborted(options.signal)
      return { source, materialized, normalized }
    } catch (error) {
      throwIfAborted(options.signal)
      return { source, error: error instanceof Error ? error.message : String(error) }
    }
  }))
  throwIfAborted(options.signal)

  const items: PluginMarketplaceItem[] = []
  const sources: PluginMarketplaceSource[] = []
  for (const result of sourceResults) {
    if ('error' in result) {
      sources.push({
        id: result.source.id,
        name: result.source.name,
        homepage: result.source.homepage,
        status: 'error',
        itemCount: 0,
        error: result.error,
      })
      continue
    }
    items.push(...result.normalized.items)
    sources.push({
      id: result.source.id,
      name: result.source.name,
      homepage: result.source.homepage,
      status: result.materialized.staleError ? 'stale' : 'ready',
      itemCount: result.normalized.items.length,
      revision: result.materialized.revision,
      refreshedAt: result.materialized.refreshedAt,
      error: result.materialized.staleError,
    })
  }

  applyInstallations(items)
  items.sort((a, b) => {
    if (a.compatible !== b.compatible) return a.compatible ? -1 : 1
    return a.displayName.localeCompare(b.displayName)
  })
  return { items, sources }
}

async function findMarketplaceItem(itemId: string): Promise<{
  item: PluginMarketplaceItem
  source: PluginMarketplaceSourceDefinition
  materialized: MaterializedSource
}> {
  if (!itemId || itemId.length > 512) {
    throw new PluginMarketplaceError('INVALID_INPUT', 'Invalid marketplace plugin')
  }
  const source = getSources().find((candidate) => itemId.endsWith(`@${candidate.marketplaceName}`))
  if (!source) {
    throw new PluginMarketplaceError('NOT_FOUND', 'Plugin marketplace source was not found')
  }
  try {
    const { materialized, normalized } = await materializeAndNormalizeSource(source, false)
    const item = normalized.items.find((candidate) => candidate.id === itemId)
    if (!item) throw new PluginMarketplaceError('NOT_FOUND', 'Marketplace plugin was not found')
    return { item, source, materialized }
  } catch (error) {
    if (error instanceof PluginMarketplaceError) throw error
    throw new PluginMarketplaceError(
      'UNAVAILABLE',
      error instanceof Error ? error.message : String(error),
    )
  }
}

const installOperations = new Map<
  string,
  Promise<{ item: PluginMarketplaceItem; updated: boolean; message: string }>
>()

export async function installPluginMarketplaceItem(input: {
  itemId: string
}): Promise<{ item: PluginMarketplaceItem; updated: boolean; message: string }> {
  const existingOperation = installOperations.get(input.itemId)
  if (existingOperation) return existingOperation
  const operation = performInstallPluginMarketplaceItem(input)
    .finally(() => installOperations.delete(input.itemId))
  installOperations.set(input.itemId, operation)
  return operation
}

async function performInstallPluginMarketplaceItem(input: {
  itemId: string
}): Promise<{ item: PluginMarketplaceItem; updated: boolean; message: string }> {
  try {
    const { item, source, materialized } = await findMarketplaceItem(input.itemId)
    if (!item.compatible) {
      throw new PluginMarketplaceError(
        'INCOMPATIBLE',
        'This plugin depends on a Codex-hosted connector that CyberCode cannot install yet.',
      )
    }

    await assertMarketplaceRegistrationIsSafe(
      source.marketplaceName,
      materialized.checkoutPath,
    )
    clearMarketplacesCache()
    await addMarketplaceSource({ source: 'directory', path: materialized.checkoutPath })
    clearMarketplacesCache()
    const installed = loadInstalledPluginsV2().plugins[item.id] ?? []
    const userInstallation = installed.find((entry) => entry.scope === 'user')
    if (userInstallation && !isUpdateAvailable(item, userInstallation)) {
      applyInstallations([item])
      return {
        item,
        updated: false,
        message: `${item.displayName} is already installed and up to date.`,
      }
    }
    const result = userInstallation
      ? await updatePluginOp(item.id, 'user')
      : await installPluginOp(item.id, 'user')
    if (!result.success) {
      throw new PluginMarketplaceError('UNAVAILABLE', result.message)
    }
    clearAllCaches()
    clearMarketplacesCache()
    applyInstallations([item])
    return {
      item,
      updated: Boolean(userInstallation) && result.alreadyUpToDate !== true,
      message: result.message,
    }
  } catch (error) {
    if (error instanceof PluginMarketplaceError) throw error
    throw new PluginMarketplaceError(
      'UNAVAILABLE',
      error instanceof Error ? error.message : String(error),
    )
  }
}
