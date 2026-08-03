import * as fs from 'node:fs'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from './envUtils.js'

export const CYBER_PORTABLE_ROOT_ENV = 'CYBER_PORTABLE_ROOT'
export const PORTABLE_PROJECTS_FILE = 'portable-projects.json'
export const PORTABLE_PATH_SCHEME = 'cybercode-portable://'

export type PortableProjectEntry = {
  id: string
  name: string
  relativePath: string
  originalPaths: string[]
}

export type PortableProjectRegistry = {
  schemaVersion: 1
  createdAt: string
  projects: PortableProjectEntry[]
}

export type PortableRuntimeInfo = {
  active: boolean
  rootPath: string | null
  registryPath: string | null
  projectCount: number
}

type RegistryCache = {
  filePath: string
  signature: string
  registry: PortableProjectRegistry | null
}

let registryCache: RegistryCache | null = null

function normalizedForeignPath(value: string): string {
  const slashNormalized = value.trim().replace(/\\/g, '/')
  const scheme = slashNormalized.match(/^([a-zA-Z][a-zA-Z\d+.-]*:\/\/)(.*)$/)
  const normalized = scheme
    ? `${scheme[1]}${scheme[2]!.replace(/\/+/g, '/')}`
    : slashNormalized.replace(/\/+/g, '/')
  if (normalized.length > 1) return normalized.replace(/\/+$/, '')
  return normalized
}

function usesCaseInsensitivePathRules(value: string): boolean {
  const normalized = normalizedForeignPath(value)
  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//')
}

function comparisonKey(value: string): string {
  const normalized = normalizedForeignPath(value)
  return usesCaseInsensitivePathRules(normalized)
    ? normalized.toLowerCase()
    : normalized
}

function isPathMatch(candidate: string, prefix: string): boolean {
  const candidateKey = comparisonKey(candidate)
  const prefixKey = comparisonKey(prefix)
  return candidateKey === prefixKey || candidateKey.startsWith(`${prefixKey}/`)
}

function relativeSuffix(candidate: string, prefix: string): string {
  const normalizedCandidate = normalizedForeignPath(candidate)
  const normalizedPrefix = normalizedForeignPath(prefix)
  return normalizedCandidate.slice(normalizedPrefix.length).replace(/^\/+/, '')
}

function safeRelativePath(value: string): string | null {
  const normalized = path.posix.normalize(normalizedForeignPath(value))
  if (
    !normalized.startsWith('projects/')
    || normalized === 'projects'
    || normalized.startsWith('../')
    || path.posix.isAbsolute(normalized)
  ) {
    return null
  }
  return normalized
}

function currentPortableRoot(): string | null {
  const value = process.env[CYBER_PORTABLE_ROOT_ENV]?.trim()
  return value ? path.resolve(value) : null
}

function registryFilePath(): string {
  return path.join(getClaudeConfigHomeDir(), PORTABLE_PROJECTS_FILE)
}

function parseRegistry(value: unknown): PortableProjectRegistry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1 || !Array.isArray(record.projects)) return null

  const projects: PortableProjectEntry[] = []
  for (const candidate of record.projects) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const project = candidate as Record<string, unknown>
    const relativePath = typeof project.relativePath === 'string'
      ? safeRelativePath(project.relativePath)
      : null
    if (
      !relativePath
      || typeof project.id !== 'string'
      || !project.id.trim()
      || typeof project.name !== 'string'
    ) {
      continue
    }
    projects.push({
      id: project.id,
      name: project.name,
      relativePath,
      originalPaths: Array.isArray(project.originalPaths)
        ? project.originalPaths.filter((entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0)
        : [],
    })
  }

  return {
    schemaVersion: 1,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
    projects,
  }
}

export function loadPortableProjectRegistry(): PortableProjectRegistry | null {
  if (!currentPortableRoot()) return null

  const filePath = registryFilePath()
  let signature: string
  try {
    const stats = fs.statSync(filePath)
    signature = `${stats.mtimeMs}:${stats.size}`
  } catch {
    registryCache = { filePath, signature: 'missing', registry: null }
    return null
  }

  if (registryCache?.filePath === filePath && registryCache.signature === signature) {
    return registryCache.registry
  }

  let registry: PortableProjectRegistry | null = null
  try {
    registry = parseRegistry(JSON.parse(fs.readFileSync(filePath, 'utf8')))
  } catch {
    registry = null
  }
  registryCache = { filePath, signature, registry }
  return registry
}

export function getPortableRuntimeInfo(): PortableRuntimeInfo {
  const rootPath = currentPortableRoot()
  if (!rootPath) {
    return {
      active: false,
      rootPath: null,
      registryPath: null,
      projectCount: 0,
    }
  }

  const registry = loadPortableProjectRegistry()
  return {
    active: true,
    rootPath,
    registryPath: registryFilePath(),
    projectCount: registry?.projects.length ?? 0,
  }
}

export function isPortableProjectReference(value: string): boolean {
  return normalizedForeignPath(value).startsWith(PORTABLE_PATH_SCHEME)
}

function resolvedRegistryPath(
  portableRoot: string,
  project: PortableProjectEntry,
  suffix = '',
): string {
  const relativePath = safeRelativePath(project.relativePath)
  if (!relativePath) return portableRoot
  const segments = [relativePath, suffix]
    .filter(Boolean)
    .join('/')
    .split('/')
    .filter(segment => segment && segment !== '.' && segment !== '..')
  const resolved = path.resolve(portableRoot, ...segments)
  const relativeToRoot = path.relative(portableRoot, resolved)
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) return portableRoot
  return resolved
}

function matchPortableRelativePath(
  value: string,
  project: PortableProjectEntry,
): string | null {
  const normalized = normalizedForeignPath(value)
  const relativePath = safeRelativePath(project.relativePath)
  if (!relativePath) return null

  if (normalized.startsWith(PORTABLE_PATH_SCHEME)) {
    const portableReference = normalized.slice(PORTABLE_PATH_SCHEME.length)
    return isPathMatch(portableReference, relativePath)
      ? relativeSuffix(portableReference, relativePath)
      : null
  }

  for (const originalPath of project.originalPaths) {
    if (isPathMatch(normalized, originalPath)) {
      return relativeSuffix(normalized, originalPath)
    }
  }

  const marker = `/${relativePath}`
  const candidateKey = comparisonKey(normalized)
  const markerKey = usesCaseInsensitivePathRules(normalized)
    ? normalizedForeignPath(marker).toLowerCase()
    : comparisonKey(marker)
  const markerIndex = candidateKey.lastIndexOf(markerKey)
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + marker.length).replace(/^\/+/, '')
  }

  return null
}

export function resolvePortableProjectPath(value: string): string {
  const portableRoot = currentPortableRoot()
  if (!portableRoot || !value.trim()) return value
  const registry = loadPortableProjectRegistry()
  if (!registry) return value

  for (const project of registry.projects) {
    const suffix = matchPortableRelativePath(value, project)
    if (suffix !== null) {
      return resolvedRegistryPath(portableRoot, project, suffix)
    }
  }
  return value
}

export function toPortableProjectReference(value: string): string {
  const portableRoot = currentPortableRoot()
  if (!portableRoot || !value.trim()) return value
  const registry = loadPortableProjectRegistry()
  if (!registry) return value

  for (const project of registry.projects) {
    const suffix = matchPortableRelativePath(value, project)
    if (suffix === null) continue
    const relativePath = safeRelativePath(project.relativePath)
    if (!relativePath) continue
    return `${PORTABLE_PATH_SCHEME}${relativePath}${suffix ? `/${suffix}` : ''}`
  }
  return value
}

export function _resetPortablePathCacheForTesting(): void {
  registryCache = null
}
