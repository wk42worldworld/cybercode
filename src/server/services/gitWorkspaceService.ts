import { spawnBackground } from '../../utils/spawnBackground.js'
import { lstat, readFile, readlink, rm } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { gitExe } from '../../utils/git.js'

const MAX_PREVIEW_BYTES = 512_000
const MAX_PREVIEW_LINES = 4_000
const MAX_PATHS_PER_OPERATION = 500
const DEFAULT_GIT_TIMEOUT_MS = 15_000
const MUTATING_GIT_TIMEOUT_MS = 60_000

export type GitDiffScope = 'staged' | 'unstaged'

export type GitFileChange = {
  path: string
  previousPath?: string
  indexStatus: string
  worktreeStatus: string
  kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted' | 'type-changed' | 'unknown'
  staged: boolean
  unstaged: boolean
  conflicted: boolean
}

export type GitWorkspaceStatus = {
  gitAvailable: boolean
  isRepository: boolean
  workDir: string
  repoRoot: string | null
  repoName: string | null
  branch: string | null
  detached: boolean
  headCommit: string | null
  upstream: string | null
  ahead: number
  behind: number
  stagedCount: number
  unstagedCount: number
  conflictedCount: number
  changes: GitFileChange[]
}

export type GitFileDiff = {
  path: string
  previousPath?: string
  scope: GitDiffScope
  oldText: string
  newText: string
  additions: number
  deletions: number
  binary: boolean
  truncated: boolean
}

export type GitBranchInfo = {
  name: string
  commit: string | null
  upstream: string | null
  current: boolean
  ahead: number
  behind: number
  upstreamGone: boolean
}

export type GitCommitInfo = {
  hash: string
  shortHash: string
  subject: string
  authorName: string
  authoredAt: string
  refs: string[]
}

type GitRunResult = {
  code: number
  stdout: Uint8Array
  stderr: Uint8Array
}

type FileContent = {
  bytes: Uint8Array
  truncated: boolean
}

export class GitWorkspaceError extends Error {
  constructor(
    message: string,
    public code:
      | 'GIT_NOT_AVAILABLE'
      | 'NOT_REPOSITORY'
      | 'INVALID_PATH'
      | 'INVALID_OPERATION'
      | 'GIT_COMMAND_FAILED',
  ) {
    super(message)
    this.name = 'GitWorkspaceError'
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function commandError(result: GitRunResult, fallback: string): GitWorkspaceError {
  const detail = decode(result.stderr).trim() || decode(result.stdout).trim()
  return new GitWorkspaceError(detail || fallback, 'GIT_COMMAND_FAILED')
}

async function runGit(
  cwd: string,
  args: string[],
  timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
): Promise<GitRunResult> {
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = spawnBackground([gitExe(), '--no-optional-locks', ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
        LC_ALL: 'C',
      },
    })
  } catch (error) {
    throw new GitWorkspaceError(
      error instanceof Error ? error.message : 'Git is not available',
      'GIT_NOT_AVAILABLE',
    )
  }

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      proc.kill()
    } catch {
      // Process already exited.
    }
  }, timeoutMs)

  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).arrayBuffer(),
      proc.exited,
    ])
    if (timedOut) {
      throw new GitWorkspaceError('Git operation timed out', 'GIT_COMMAND_FAILED')
    }
    return {
      code,
      stdout: new Uint8Array(stdout),
      stderr: new Uint8Array(stderr),
    }
  } finally {
    clearTimeout(timer)
  }
}

function statusKind(indexStatus: string, worktreeStatus: string): GitFileChange['kind'] {
  const pair = `${indexStatus}${worktreeStatus}`
  if (pair === '??') return 'untracked'
  if (new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']).has(pair)) return 'conflicted'
  const statuses = `${indexStatus}${worktreeStatus}`
  if (statuses.includes('R')) return 'renamed'
  if (statuses.includes('C')) return 'copied'
  if (statuses.includes('A')) return 'added'
  if (statuses.includes('D')) return 'deleted'
  if (statuses.includes('T')) return 'type-changed'
  if (statuses.includes('M')) return 'modified'
  return 'unknown'
}

export function parseGitStatusPorcelain(output: string): GitFileChange[] {
  if (!output) return []
  const records = output.split('\0')
  const changes: GitFileChange[] = []

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record || record.length < 4) continue

    const indexStatus = record[0] ?? ' '
    const worktreeStatus = record[1] ?? ' '
    const filePath = record.slice(3)
    const renamedOrCopied = indexStatus === 'R'
      || indexStatus === 'C'
      || worktreeStatus === 'R'
      || worktreeStatus === 'C'
    const previousPath = renamedOrCopied ? records[++index] || undefined : undefined
    const pair = `${indexStatus}${worktreeStatus}`
    const conflicted = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']).has(pair)

    changes.push({
      path: filePath,
      ...(previousPath ? { previousPath } : {}),
      indexStatus,
      worktreeStatus,
      kind: statusKind(indexStatus, worktreeStatus),
      staged: indexStatus !== ' ' && indexStatus !== '?' && indexStatus !== '!',
      unstaged: pair === '??' || (worktreeStatus !== ' ' && worktreeStatus !== '!'),
      conflicted,
    })
  }

  return changes.sort((left, right) => left.path.localeCompare(right.path))
}

function emptyStatus(workDir: string, gitAvailable: boolean): GitWorkspaceStatus {
  return {
    gitAvailable,
    isRepository: false,
    workDir,
    repoRoot: null,
    repoName: null,
    branch: null,
    detached: false,
    headCommit: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    conflictedCount: 0,
    changes: [],
  }
}

function parseBranchHeader(header: string): {
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
} {
  const value = header.startsWith('## ') ? header.slice(3) : header
  if (value === 'HEAD (no branch)') {
    return {
      branch: null,
      detached: true,
      upstream: null,
      ahead: 0,
      behind: 0,
    }
  }

  const initialPrefix = value.startsWith('No commits yet on ')
    ? 'No commits yet on '
    : value.startsWith('Initial commit on ')
      ? 'Initial commit on '
      : null
  if (initialPrefix) {
    return {
      branch: value.slice(initialPrefix.length) || null,
      detached: false,
      upstream: null,
      ahead: 0,
      behind: 0,
    }
  }

  const trackingStart = value.indexOf('...')
  const branch = (trackingStart >= 0 ? value.slice(0, trackingStart) : value.split(' [', 1)[0]) || null
  const tracking = trackingStart >= 0 ? value.slice(trackingStart + 3) : ''
  const metadataStart = tracking.indexOf(' [')
  const upstream = tracking
    ? (metadataStart >= 0 ? tracking.slice(0, metadataStart) : tracking) || null
    : null
  const metadata = value.match(/\[(.+)]$/)?.[1] ?? ''
  const ahead = Number.parseInt(metadata.match(/ahead (\d+)/)?.[1] ?? '0', 10) || 0
  const behind = Number.parseInt(metadata.match(/behind (\d+)/)?.[1] ?? '0', 10) || 0

  return {
    branch,
    detached: false,
    upstream,
    ahead,
    behind,
  }
}

async function repositoryRoot(workDir: string): Promise<string | null> {
  const result = await runGit(workDir, ['rev-parse', '--show-toplevel'])
  if (result.code !== 0) return null
  return decode(result.stdout).trim() || null
}

async function hasHead(repoRoot: string): Promise<boolean> {
  const result = await runGit(repoRoot, ['rev-parse', '--verify', 'HEAD'])
  return result.code === 0
}

function ensureRepository(status: GitWorkspaceStatus): string {
  if (!status.gitAvailable) {
    throw new GitWorkspaceError('Git is not installed or is not available in PATH', 'GIT_NOT_AVAILABLE')
  }
  if (!status.isRepository || !status.repoRoot) {
    throw new GitWorkspaceError('The current project is not a Git repository', 'NOT_REPOSITORY')
  }
  return status.repoRoot
}

function ensureRepositoryPath(repoRoot: string, filePath: string): string {
  if (!filePath || filePath.includes('\0') || isAbsolute(filePath)) {
    throw new GitWorkspaceError('Invalid repository path', 'INVALID_PATH')
  }
  const absolutePath = resolve(repoRoot, filePath)
  const relativePath = relative(repoRoot, absolutePath)
  if (
    !relativePath
    || relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)
  ) {
    throw new GitWorkspaceError('Path is outside the repository', 'INVALID_PATH')
  }
  return absolutePath
}

function normalizeOperationPaths(
  repoRoot: string,
  paths: unknown,
  changes: GitFileChange[],
  predicate: (change: GitFileChange) => boolean,
): string[] {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS_PER_OPERATION) {
    throw new GitWorkspaceError('A valid list of changed files is required', 'INVALID_OPERATION')
  }

  const available = new Map(changes.filter(predicate).map((change) => [change.path, change]))
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || seen.has(candidate) || !available.has(candidate)) {
      if (typeof candidate === 'string' && seen.has(candidate)) continue
      throw new GitWorkspaceError('One or more files are no longer in the expected Git state', 'INVALID_OPERATION')
    }
    ensureRepositoryPath(repoRoot, candidate)
    seen.add(candidate)
    normalized.push(candidate)
  }
  return normalized
}

async function readGitBlob(repoRoot: string, spec: string): Promise<FileContent> {
  const sizeResult = await runGit(repoRoot, ['cat-file', '-s', spec])
  if (sizeResult.code !== 0) return { bytes: new Uint8Array(), truncated: false }
  const size = Number.parseInt(decode(sizeResult.stdout).trim(), 10)
  if (Number.isFinite(size) && size > MAX_PREVIEW_BYTES) {
    return { bytes: new Uint8Array(), truncated: true }
  }
  const result = await runGit(repoRoot, ['show', spec])
  if (result.code !== 0) return { bytes: new Uint8Array(), truncated: false }
  return { bytes: result.stdout, truncated: result.stdout.byteLength > MAX_PREVIEW_BYTES }
}

async function readWorkingTreeFile(repoRoot: string, filePath: string): Promise<FileContent> {
  const absolutePath = ensureRepositoryPath(repoRoot, filePath)
  try {
    const fileStat = await lstat(absolutePath)
    if (fileStat.isSymbolicLink()) {
      return { bytes: encode(await readlink(absolutePath)), truncated: false }
    }
    if (!fileStat.isFile()) return { bytes: new Uint8Array(), truncated: false }
    if (fileStat.size > MAX_PREVIEW_BYTES) {
      return { bytes: new Uint8Array(), truncated: true }
    }
    const content = await readFile(absolutePath)
    return { bytes: content, truncated: content.byteLength > MAX_PREVIEW_BYTES }
  } catch {
    return { bytes: new Uint8Array(), truncated: false }
  }
}

function containsNullByte(bytes: Uint8Array): boolean {
  const sampleLength = Math.min(bytes.length, 8_192)
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] === 0) return true
  }
  return false
}

function decodePreview(content: FileContent): { text: string; truncated: boolean } {
  if (content.truncated) return { text: '', truncated: true }
  const text = decode(content.bytes)
  const lines = text.split('\n')
  if (lines.length <= MAX_PREVIEW_LINES) return { text, truncated: false }
  return {
    text: lines.slice(0, MAX_PREVIEW_LINES).join('\n'),
    truncated: true,
  }
}

function countLines(text: string): number {
  if (!text) return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

function parseTrackingStatus(value: string): {
  ahead: number
  behind: number
  upstreamGone: boolean
} {
  return {
    ahead: Number.parseInt(value.match(/ahead (\d+)/)?.[1] ?? '0', 10) || 0,
    behind: Number.parseInt(value.match(/behind (\d+)/)?.[1] ?? '0', 10) || 0,
    upstreamGone: value.includes('gone'),
  }
}

export function parseGitBranches(output: string): GitBranchInfo[] {
  const branches = output
    .split('\n')
    .map((record) => record.trimStart())
    .filter(Boolean)
    .map((record) => {
      const [name = '', commit = '', upstream = '', tracking = '', head = ''] = record.split('\0')
      const trackingStatus = parseTrackingStatus(tracking)
      return {
        name,
        commit: commit || null,
        upstream: upstream || null,
        current: head === '*',
        ...trackingStatus,
      }
    })
    .filter((branch) => branch.name)

  return branches.sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1
    return left.name.localeCompare(right.name)
  })
}

export function parseGitHistory(output: string): GitCommitInfo[] {
  if (!output) return []
  const fields = output.split('\0')
  const commits: GitCommitInfo[] = []
  for (let index = 0; index + 5 < fields.length; index += 6) {
    const hash = fields[index] ?? ''
    const shortHash = fields[index + 1] ?? ''
    if (!hash || !shortHash) continue
    commits.push({
      hash,
      shortHash,
      authorName: fields[index + 2] ?? '',
      authoredAt: fields[index + 3] ?? '',
      refs: (fields[index + 4] ?? '')
        .split(',')
        .map((ref) => ref.trim())
        .filter(Boolean),
      subject: fields[index + 5] ?? '',
    })
  }
  return commits
}

async function normalizeBranchName(repoRoot: string, value: unknown): Promise<string> {
  if (typeof value !== 'string') {
    throw new GitWorkspaceError('A valid branch name is required', 'INVALID_OPERATION')
  }
  const branchName = value.trim()
  if (
    !branchName
    || branchName.length > 255
    || branchName.startsWith('-')
    || branchName.includes('\0')
  ) {
    throw new GitWorkspaceError('A valid branch name is required', 'INVALID_OPERATION')
  }

  const result = await runGit(repoRoot, ['check-ref-format', `refs/heads/${branchName}`])
  if (result.code !== 0) {
    throw new GitWorkspaceError('The branch name is not valid', 'INVALID_OPERATION')
  }
  return branchName
}

async function diffStats(
  repoRoot: string,
  scope: GitDiffScope,
  filePath: string,
  fallbackText: string,
): Promise<{ additions: number; deletions: number }> {
  const result = await runGit(repoRoot, [
    'diff',
    '--numstat',
    '-z',
    ...(scope === 'staged' ? ['--cached'] : []),
    '--',
    filePath,
  ])
  const match = decode(result.stdout).match(/^([-\d]+)\t([-\d]+)\t/)
  if (!match) {
    return scope === 'unstaged'
      ? { additions: countLines(fallbackText), deletions: 0 }
      : { additions: 0, deletions: 0 }
  }
  return {
    additions: match[1] === '-' ? 0 : Number.parseInt(match[1] ?? '0', 10) || 0,
    deletions: match[2] === '-' ? 0 : Number.parseInt(match[2] ?? '0', 10) || 0,
  }
}

export class GitWorkspaceService {
  async getStatus(workDir: string): Promise<GitWorkspaceStatus> {
    let root: string | null
    try {
      root = await repositoryRoot(workDir)
    } catch (error) {
      if (error instanceof GitWorkspaceError && error.code === 'GIT_NOT_AVAILABLE') {
        return emptyStatus(workDir, false)
      }
      throw error
    }
    if (!root) return emptyStatus(workDir, true)

    const statusResult = await runGit(root, [
      'status',
      '--porcelain=v1',
      '-z',
      '--branch',
      '--ahead-behind',
      '--untracked-files=all',
    ])
    if (statusResult.code !== 0) throw commandError(statusResult, 'Unable to read Git status')
    const statusOutput = decode(statusResult.stdout)
    const [branchHeader = '', ...statusRecords] = statusOutput.split('\0')
    const changes = parseGitStatusPorcelain(statusRecords.join('\0'))
    const branchInfo = parseBranchHeader(branchHeader)
    const detachedHeadResult = branchInfo.detached
      ? await runGit(root, ['rev-parse', '--short', 'HEAD'])
      : null

    return {
      gitAvailable: true,
      isRepository: true,
      workDir,
      repoRoot: root,
      repoName: basename(root),
      branch: branchInfo.branch
        ?? (detachedHeadResult?.code === 0 ? decode(detachedHeadResult.stdout).trim() : null),
      detached: branchInfo.detached,
      headCommit: detachedHeadResult?.code === 0 ? decode(detachedHeadResult.stdout).trim() : null,
      upstream: branchInfo.upstream,
      ahead: branchInfo.ahead,
      behind: branchInfo.behind,
      stagedCount: changes.filter((change) => change.staged).length,
      unstagedCount: changes.filter((change) => change.unstaged).length,
      conflictedCount: changes.filter((change) => change.conflicted).length,
      changes,
    }
  }

  async getDiff(workDir: string, scope: GitDiffScope, filePath: string): Promise<GitFileDiff> {
    const status = await this.getStatus(workDir)
    const repoRoot = ensureRepository(status)
    ensureRepositoryPath(repoRoot, filePath)
    const change = status.changes.find((candidate) => candidate.path === filePath)
    if (!change || (scope === 'staged' ? !change.staged : !change.unstaged)) {
      throw new GitWorkspaceError('The selected file is no longer changed in this scope', 'INVALID_OPERATION')
    }

    const repositoryHasHead = await hasHead(repoRoot)
    let oldContent: FileContent
    let newContent: FileContent

    if (scope === 'staged') {
      const oldPath = change.previousPath || change.path
      oldContent = repositoryHasHead
        ? await readGitBlob(repoRoot, `HEAD:${oldPath}`)
        : { bytes: new Uint8Array(), truncated: false }
      newContent = change.indexStatus === 'D'
        ? { bytes: new Uint8Array(), truncated: false }
        : await readGitBlob(repoRoot, `:${change.path}`)
    } else {
      oldContent = change.kind === 'untracked'
        ? { bytes: new Uint8Array(), truncated: false }
        : await readGitBlob(repoRoot, `:${change.path}`)
      newContent = change.worktreeStatus === 'D'
        ? { bytes: new Uint8Array(), truncated: false }
        : await readWorkingTreeFile(repoRoot, change.path)
    }

    const binary = containsNullByte(oldContent.bytes) || containsNullByte(newContent.bytes)
    const oldPreview = decodePreview(oldContent)
    const newPreview = decodePreview(newContent)
    const stats = await diffStats(repoRoot, scope, change.path, newPreview.text)

    return {
      path: change.path,
      ...(change.previousPath ? { previousPath: change.previousPath } : {}),
      scope,
      oldText: binary ? '' : oldPreview.text,
      newText: binary ? '' : newPreview.text,
      additions: stats.additions,
      deletions: stats.deletions,
      binary,
      truncated: oldPreview.truncated || newPreview.truncated,
    }
  }

  async initialize(workDir: string): Promise<GitWorkspaceStatus> {
    const current = await this.getStatus(workDir)
    if (!current.gitAvailable) ensureRepository(current)
    if (current.isRepository) return current
    const result = await runGit(workDir, ['init'], MUTATING_GIT_TIMEOUT_MS)
    if (result.code !== 0) throw commandError(result, 'Unable to initialize Git repository')
    return this.getStatus(workDir)
  }

  async listBranches(workDir: string): Promise<GitBranchInfo[]> {
    const status = await this.getStatus(workDir)
    const repoRoot = ensureRepository(status)
    const result = await runGit(repoRoot, [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)',
      'refs/heads',
    ])
    if (result.code !== 0) throw commandError(result, 'Unable to list Git branches')
    const branches = parseGitBranches(decode(result.stdout))
    if (
      status.branch
      && !status.detached
      && !branches.some((branch) => branch.name === status.branch)
    ) {
      branches.unshift({
        name: status.branch,
        commit: status.headCommit,
        upstream: status.upstream,
        current: true,
        ahead: status.ahead,
        behind: status.behind,
        upstreamGone: false,
      })
    }
    return branches
  }

  async listHistory(workDir: string, limit = 40): Promise<GitCommitInfo[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new GitWorkspaceError('History limit must be between 1 and 100', 'INVALID_OPERATION')
    }
    const status = await this.getStatus(workDir)
    const repoRoot = ensureRepository(status)
    if (!await hasHead(repoRoot)) return []
    const result = await runGit(repoRoot, [
      'log',
      '-z',
      `--max-count=${limit}`,
      '--decorate=short',
      '--format=%H%x00%h%x00%an%x00%aI%x00%D%x00%s',
    ])
    if (result.code !== 0) throw commandError(result, 'Unable to read Git history')
    return parseGitHistory(decode(result.stdout))
  }

  async switchBranch(workDir: string, name: unknown): Promise<GitWorkspaceStatus> {
    const status = await this.getStatus(workDir)
    const repoRoot = ensureRepository(status)
    if (status.conflictedCount > 0) {
      throw new GitWorkspaceError('Resolve merge conflicts before switching branches', 'INVALID_OPERATION')
    }
    const branchName = await normalizeBranchName(repoRoot, name)
    const exists = await runGit(repoRoot, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${branchName}`,
    ])
    if (exists.code !== 0) {
      throw new GitWorkspaceError('The selected local branch no longer exists', 'INVALID_OPERATION')
    }
    if (!status.detached && status.branch === branchName) return status

    const result = await runGit(
      repoRoot,
      ['switch', '--', branchName],
      MUTATING_GIT_TIMEOUT_MS,
    )
    if (result.code !== 0) throw commandError(result, 'Unable to switch Git branch')
    return this.getStatus(workDir)
  }

  async createBranch(workDir: string, name: unknown): Promise<GitWorkspaceStatus> {
    const status = await this.getStatus(workDir)
    const repoRoot = ensureRepository(status)
    if (status.conflictedCount > 0) {
      throw new GitWorkspaceError('Resolve merge conflicts before creating a branch', 'INVALID_OPERATION')
    }
    const branchName = await normalizeBranchName(repoRoot, name)
    const exists = await runGit(repoRoot, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${branchName}`,
    ])
    if (exists.code === 0) {
      throw new GitWorkspaceError('A local branch with this name already exists', 'INVALID_OPERATION')
    }

    const result = await runGit(
      repoRoot,
      ['switch', '-c', branchName],
      MUTATING_GIT_TIMEOUT_MS,
    )
    if (result.code !== 0) throw commandError(result, 'Unable to create Git branch')
    return this.getStatus(workDir)
  }

  async stage(workDir: string, paths: unknown): Promise<GitWorkspaceStatus> {
    const status = await this.getStatus(workDir)
    const repoRoot = ensureRepository(status)
    const normalized = normalizeOperationPaths(repoRoot, paths, status.changes, (change) => change.unstaged)
    const result = await runGit(repoRoot, ['add', '--', ...normalized], MUTATING_GIT_TIMEOUT_MS)
    if (result.code !== 0) throw commandError(result, 'Unable to stage files')
    return this.getStatus(workDir)
  }

  async unstage(workDir: string, paths: unknown): Promise<GitWorkspaceStatus> {
    const status = await this.getStatus(workDir)
    const repoRoot = ensureRepository(status)
    const normalized = normalizeOperationPaths(repoRoot, paths, status.changes, (change) => change.staged)
    const repositoryHasHead = await hasHead(repoRoot)
    const args = repositoryHasHead
      ? ['restore', '--staged', '--', ...normalized]
      : ['rm', '--cached', '--force', '--', ...normalized]
    let result = await runGit(repoRoot, args, MUTATING_GIT_TIMEOUT_MS)
    if (result.code !== 0 && repositoryHasHead) {
      result = await runGit(repoRoot, ['reset', '--quiet', 'HEAD', '--', ...normalized], MUTATING_GIT_TIMEOUT_MS)
    }
    if (result.code !== 0) throw commandError(result, 'Unable to unstage files')
    return this.getStatus(workDir)
  }

  async discard(workDir: string, paths: unknown): Promise<GitWorkspaceStatus> {
    const status = await this.getStatus(workDir)
    const repoRoot = ensureRepository(status)
    const normalized = normalizeOperationPaths(repoRoot, paths, status.changes, (change) => change.unstaged)
    const changesByPath = new Map(status.changes.map((change) => [change.path, change]))

    const tracked: string[] = []
    for (const filePath of normalized) {
      const change = changesByPath.get(filePath)
      if (change?.kind !== 'untracked') {
        tracked.push(filePath)
        continue
      }

      const absolutePath = ensureRepositoryPath(repoRoot, filePath)
      const fileStat = await lstat(absolutePath).catch(() => null)
      if (!fileStat) continue
      if (!fileStat.isFile() && !fileStat.isSymbolicLink()) {
        throw new GitWorkspaceError('Only individual untracked files can be discarded', 'INVALID_OPERATION')
      }
      await rm(absolutePath, { force: true })
    }

    if (tracked.length > 0) {
      let result = await runGit(
        repoRoot,
        ['restore', '--worktree', '--', ...tracked],
        MUTATING_GIT_TIMEOUT_MS,
      )
      if (result.code !== 0) {
        result = await runGit(
          repoRoot,
          ['checkout', '--', ...tracked],
          MUTATING_GIT_TIMEOUT_MS,
        )
      }
      if (result.code !== 0) throw commandError(result, 'Unable to discard working tree changes')
    }

    return this.getStatus(workDir)
  }

  async commit(
    workDir: string,
    message: unknown,
  ): Promise<{ status: GitWorkspaceStatus; commit: string; output: string }> {
    if (typeof message !== 'string' || !message.trim() || message.trim().length > 5_000) {
      throw new GitWorkspaceError('Commit message must be between 1 and 5000 characters', 'INVALID_OPERATION')
    }
    const status = await this.getStatus(workDir)
    const repoRoot = ensureRepository(status)
    if (status.stagedCount === 0) {
      throw new GitWorkspaceError('Stage at least one file before committing', 'INVALID_OPERATION')
    }
    if (status.conflictedCount > 0) {
      throw new GitWorkspaceError('Resolve merge conflicts before committing', 'INVALID_OPERATION')
    }

    const result = await runGit(
      repoRoot,
      ['commit', '-m', message.trim()],
      MUTATING_GIT_TIMEOUT_MS,
    )
    if (result.code !== 0) throw commandError(result, 'Unable to create commit')
    const commitResult = await runGit(repoRoot, ['rev-parse', '--short', 'HEAD'])
    return {
      status: await this.getStatus(workDir),
      commit: commitResult.code === 0 ? decode(commitResult.stdout).trim() : '',
      output: decode(result.stdout).trim(),
    }
  }
}

export const gitWorkspaceService = new GitWorkspaceService()
