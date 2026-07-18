import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import {
  getCodeGraphVisualization,
  type CodeGraphVisualization as CodeGraphVisualizationData,
} from './codeGraphAnalysis.js'
import { openCodeGraphDatabaseForRead } from './codeGraphDatabase.js'

export type {
  CodeGraphArchitecture,
  CodeGraphConfidence,
  CodeGraphNodeRole,
  CodeGraphVisualization,
} from './codeGraphAnalysis.js'

const CODEGRAPH_SERVER_NAME = 'cybercode_codegraph'
const CONFIG_VERSION = 2

export const CODEGRAPH_BUNDLED_LANGUAGES = [
  'HTML (embedded JavaScript)',
  'TypeScript',
  'TSX',
  'JavaScript',
  'Python',
  'Go',
  'Rust',
  'Java',
  'C',
  'PHP',
  'Lua',
  'Solidity',
] as const

export type CodeGraphState =
  | 'disabled'
  | 'preparing'
  | 'indexing'
  | 'ready'
  | 'empty'
  | 'error'

export type CodeGraphStats = {
  fileCount: number
  nodeCount: number
  edgeCount: number
  errorFileCount: number
  dbSizeBytes: number
  lastUpdated: number | null
  filesByLanguage: Record<string, number>
}

export type CodeGraphStatus = {
  projectPath: string
  indexable: boolean
  enabled: boolean
  state: CodeGraphState
  progress: {
    phase: string
    current: number
    total: number
    currentFile?: string
  } | null
  stats: CodeGraphStats | null
  error: string | null
  bundledLanguages: readonly string[]
}

export type CodeGraphGlobalStatus = {
  enabled: boolean
}

type StoredConfig = {
  version: number
  enabled: boolean
  projects: Record<string, { updatedAt: number }>
}

type RuntimeState = {
  status: CodeGraphStatus
  indexGeneration: number | null
  indexStarting: boolean
  indexProcess: ReturnType<typeof Bun.spawn> | null
  watchProcess: ReturnType<typeof Bun.spawn> | null
}

type CodeGraphProcessConfig = {
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
}

type CodeGraphServiceOptions = {
  watcherRestartBaseDelayMs?: number
}

class CodeGraphProjectScopeError extends Error {
  constructor(
    message: string,
    readonly projectPath: string,
  ) {
    super(message)
    this.name = 'CodeGraphProjectScopeError'
  }
}

export class CodeGraphService {
  private runtimes = new Map<string, RuntimeState>()
  private watcherRestartTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private watcherRestartAttempts = new Map<string, number>()
  private watcherRestartBaseDelayMs: number
  private lifecycleGeneration = 0

  constructor(options: CodeGraphServiceOptions = {}) {
    this.watcherRestartBaseDelayMs = Math.max(0, options.watcherRestartBaseDelayMs ?? 1_000)
  }

  getGlobalStatus(): CodeGraphGlobalStatus {
    return { enabled: this.readConfig().enabled }
  }

  enableGlobal(): CodeGraphGlobalStatus {
    this.setGlobalEnabled(true)
    this.activateKnownProjects()
    return this.getGlobalStatus()
  }

  async disableGlobal(): Promise<CodeGraphGlobalStatus> {
    await this.disableEverywhere()
    return this.getGlobalStatus()
  }

  async enable(projectPath: string): Promise<CodeGraphStatus> {
    const canonicalPath = this.resolveProjectPath(projectPath)
    this.setGlobalEnabled(true, canonicalPath)
    this.activateKnownProjects(canonicalPath)
    const runtime = this.getOrCreateRuntime(canonicalPath, true)
    return this.cloneStatus(runtime.status)
  }

  async disable(projectPath: string): Promise<CodeGraphStatus> {
    const canonicalPath = this.resolveProjectPath(projectPath)
    await this.disableEverywhere(canonicalPath)
    const runtime = this.getOrCreateRuntime(canonicalPath, false)
    return this.cloneStatus(runtime.status)
  }

  private async disableEverywhere(projectPath?: string) {
    this.lifecycleGeneration += 1
    this.setGlobalEnabled(false, projectPath)
    for (const timer of this.watcherRestartTimers.values()) clearTimeout(timer)
    this.watcherRestartTimers.clear()
    this.watcherRestartAttempts.clear()

    const projectsToDetach = new Set<string>(projectPath ? [projectPath] : [])
    for (const [runtimePath, runtime] of this.runtimes) {
      projectsToDetach.add(runtimePath)
      this.stopRuntimeProcesses(runtime)
      runtime.status = {
        ...runtime.status,
        enabled: false,
        state: 'disabled',
        progress: null,
        error: null,
        stats: this.readStats(runtimePath),
      }
    }

    await Promise.all([...projectsToDetach].map((runtimePath) =>
      this.patchRunningSessions(runtimePath, null),
    ))
  }

  private activateKnownProjects(primaryProjectPath?: string) {
    const projects = new Set(this.runtimes.keys())
    if (primaryProjectPath) projects.add(primaryProjectPath)

    for (const projectPath of projects) {
      this.cancelWatcherRestart(projectPath)
      const runtime = this.getOrCreateRuntime(projectPath, true)
      runtime.status.enabled = true
      runtime.status.error = null
      if (runtime.indexGeneration === null) {
        void this.runIndex(projectPath, false)
      }
    }
  }

  ensureProject(projectPath: string): CodeGraphStatus {
    const canonicalPath = this.resolveProjectPath(projectPath)
    const enabled = this.isProjectEnabled(canonicalPath)
    const runtime = this.getOrCreateRuntime(canonicalPath, enabled)
    runtime.status.enabled = enabled
    if (!enabled) {
      runtime.status.state = 'disabled'
      return this.cloneStatus(runtime.status)
    }

    this.markProjectUsed(canonicalPath)
    runtime.status.enabled = true
    runtime.status.error = null
    if (runtime.indexGeneration === null && !runtime.watchProcess) {
      void this.runIndex(canonicalPath, false)
    }
    return this.cloneStatus(runtime.status)
  }

  async rebuild(projectPath: string): Promise<CodeGraphStatus> {
    const canonicalPath = this.resolveProjectPath(projectPath)
    this.cancelWatcherRestart(canonicalPath)
    if (!this.isProjectEnabled(canonicalPath)) {
      throw new Error('Enable Code Graph before rebuilding the index')
    }
    const runtime = this.getOrCreateRuntime(canonicalPath, true)
    runtime.watchProcess?.kill()
    runtime.watchProcess = null
    if (runtime.indexGeneration === null) {
      void this.runIndex(canonicalPath, true)
    }
    return this.cloneStatus(runtime.status)
  }

  getStatus(projectPath: string): CodeGraphStatus {
    let canonicalPath: string
    try {
      canonicalPath = this.resolveProjectPath(projectPath)
    } catch (error) {
      if (error instanceof CodeGraphProjectScopeError) {
        return {
          projectPath: error.projectPath,
          indexable: false,
          enabled: this.readConfig().enabled,
          state: 'disabled',
          progress: null,
          stats: null,
          error: null,
          bundledLanguages: CODEGRAPH_BUNDLED_LANGUAGES,
        }
      }
      throw error
    }
    const enabled = this.isProjectEnabled(canonicalPath)
    const runtime = this.getOrCreateRuntime(canonicalPath, enabled)
    runtime.status.enabled = enabled
    if (runtime.indexGeneration === null && runtime.status.state !== 'error') {
      runtime.status.stats = this.readStats(canonicalPath)
      runtime.status.state = enabled
        ? this.stateForStats(runtime.status.stats)
        : 'disabled'
    }
    if (
      enabled
      && runtime.indexGeneration === null
      && !runtime.watchProcess
      && !runtime.status.stats
    ) {
      this.markProjectUsed(canonicalPath)
      void this.runIndex(canonicalPath, false)
    }
    return this.cloneStatus(runtime.status)
  }

  getVisualization(projectPath: string, requestedLimit = 120): CodeGraphVisualizationData {
    const canonicalPath = this.resolveProjectPath(projectPath)
    const dbPath = this.getDatabasePath(canonicalPath)
    if (!fs.existsSync(dbPath)) {
      throw new Error('Code Graph index is not ready')
    }
    return getCodeGraphVisualization(dbPath, requestedLimit)
  }

  getMcpConfig(projectPath: string): { mcpServers: Record<string, CodeGraphProcessConfig> } | null {
    let canonicalPath: string
    try {
      canonicalPath = this.resolveProjectPath(projectPath)
    } catch {
      return null
    }
    if (!this.isProjectEnabled(canonicalPath)) return null
    return {
      mcpServers: {
        [CODEGRAPH_SERVER_NAME]: this.buildMcpServerConfig(canonicalPath),
      },
    }
  }

  restoreEnabledProjects(): void {
    const config = this.readConfig()
    if (!config.enabled) return

    // Projects are restored lazily when their session opens. Starting every
    // historical watcher here makes application startup scale with project count.
  }

  shutdown(): void {
    this.lifecycleGeneration += 1
    for (const timer of this.watcherRestartTimers.values()) clearTimeout(timer)
    this.watcherRestartTimers.clear()
    this.watcherRestartAttempts.clear()
    for (const runtime of this.runtimes.values()) {
      this.stopRuntimeProcesses(runtime)
    }
  }

  private async runIndex(projectPath: string, rebuild: boolean) {
    const runtime = this.getOrCreateRuntime(projectPath, true)
    if (runtime.indexGeneration !== null) return
    const lifecycleGeneration = this.lifecycleGeneration
    runtime.indexGeneration = lifecycleGeneration
    runtime.indexStarting = true

    runtime.status = {
      ...runtime.status,
      enabled: true,
      state: 'preparing',
      progress: { phase: 'preparing', current: 0, total: 0 },
      error: null,
    }

    try {
      await this.patchRunningSessions(projectPath, null)
      if (runtime.indexGeneration !== lifecycleGeneration) return
      if (
        lifecycleGeneration !== this.lifecycleGeneration
        || !this.isProjectEnabled(projectPath)
      ) {
        runtime.indexStarting = false
        runtime.indexGeneration = null
        return
      }
      this.assertAssetsAvailable()
      const invocation = this.buildInvocation('index', projectPath, rebuild)
      const proc = Bun.spawn([invocation.command, ...invocation.args], {
        cwd: projectPath,
        env: { ...process.env, ...invocation.env },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      runtime.indexProcess = proc
      runtime.indexStarting = false

      const stderrPromise = new Response(proc.stderr).text()
      await this.consumeJsonLines(proc.stdout, (event) => {
        if (
          runtime.indexGeneration !== lifecycleGeneration
          || runtime.indexProcess !== proc
          || lifecycleGeneration !== this.lifecycleGeneration
        ) return
        if (event.type === 'progress') {
          runtime.status.state = 'indexing'
          runtime.status.progress = {
            phase: String(event.phase || 'indexing'),
            current: Number(event.current || 0),
            total: Number(event.total || 0),
            ...(typeof event.currentFile === 'string' ? { currentFile: event.currentFile } : {}),
          }
        } else if (event.type === 'complete') {
          runtime.status.stats = this.normalizeRunnerStats(event.stats)
        } else if (event.type === 'error') {
          runtime.status.error = String(event.message || 'Code Graph indexing failed')
        }
      })

      const exitCode = await proc.exited
      const stderr = (await stderrPromise).trim()
      if (runtime.indexGeneration !== lifecycleGeneration) return
      if (runtime.indexProcess === proc) runtime.indexProcess = null
      if (
        lifecycleGeneration !== this.lifecycleGeneration
        || !this.isProjectEnabled(projectPath)
      ) {
        runtime.indexGeneration = null
        return
      }
      if (exitCode !== 0) {
        throw new Error(runtime.status.error || stderr || `Code Graph exited with code ${exitCode}`)
      }

      const nextStats = this.readStats(projectPath) ?? runtime.status.stats
      runtime.status = {
        ...runtime.status,
        state: this.stateForStats(nextStats),
        progress: null,
        stats: nextStats,
        error: null,
      }
      this.startWatcher(projectPath)
      await this.patchRunningSessions(
        projectPath,
        this.buildMcpServerConfig(projectPath),
      )
      if (runtime.indexGeneration === lifecycleGeneration) {
        runtime.indexGeneration = null
      }
    } catch (error) {
      if (runtime.indexGeneration !== lifecycleGeneration) return
      runtime.indexStarting = false
      runtime.indexProcess = null
      runtime.indexGeneration = null
      if (lifecycleGeneration !== this.lifecycleGeneration) return
      if (!this.isProjectEnabled(projectPath)) {
        runtime.status = {
          ...runtime.status,
          enabled: false,
          state: 'disabled',
          progress: null,
          error: null,
        }
        return
      }
      runtime.status = {
        ...runtime.status,
        state: 'error',
        progress: null,
        error: error instanceof Error ? error.message : String(error),
      }
      console.error(`[CodeGraph] ${projectPath}: ${runtime.status.error}`)
    }
  }

  private startWatcher(projectPath: string) {
    const runtime = this.getOrCreateRuntime(projectPath, true)
    if (runtime.watchProcess || !this.isProjectEnabled(projectPath)) return
    const invocation = this.buildInvocation('watch', projectPath, false)
    const proc = Bun.spawn([invocation.command, ...invocation.args], {
      cwd: projectPath,
      env: { ...process.env, ...invocation.env },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    runtime.watchProcess = proc

    void this.consumeJsonLines(proc.stdout, (event) => {
      if (runtime.watchProcess !== proc || !this.isProjectEnabled(projectPath)) return
      if (event.type === 'watching') {
        this.watcherRestartAttempts.delete(projectPath)
        return
      }
      if (event.type === 'sync') {
        const previousState = runtime.status.state
        const nextStats = this.readStats(projectPath)
        runtime.status.stats = nextStats
        runtime.status.state = this.stateForStats(nextStats)
        if (runtime.status.state !== previousState) {
          void this.patchRunningSessions(
            projectPath,
            this.buildMcpServerConfig(projectPath),
          )
        }
      }
      if (event.type === 'warning') console.warn(`[CodeGraph] ${String(event.message || '')}`)
    })
    void new Response(proc.stderr).text().then((stderr) => {
      if (stderr.trim()) console.warn(`[CodeGraph watcher] ${stderr.trim()}`)
    })
    void proc.exited.then((exitCode) => {
      if (runtime.watchProcess !== proc) return
      runtime.watchProcess = null
      if (!this.isProjectEnabled(projectPath)) return
      if (exitCode !== 0) {
        console.warn(`[CodeGraph] watcher exited with code ${exitCode}: ${projectPath}`)
      }
      this.scheduleWatcherRestart(projectPath)
    })
  }

  private async patchRunningSessions(
    projectPath: string,
    config: CodeGraphProcessConfig | null,
  ) {
    const { conversationService } = await import('./conversationService.js')
    const operations = conversationService.getActiveSessions()
      .filter((sessionId) => {
        const workDir = conversationService.getSessionWorkDir(sessionId)
        try {
          return this.resolveProjectPath(workDir) === projectPath
        } catch {
          return false
        }
      })
      .map(async (sessionId) => {
        const maxAttempts = config ? 3 : 1
        let lastError: unknown
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (config && !this.isProjectEnabled(projectPath)) return
          if (attempt > 1) await Bun.sleep(attempt * 750)
          try {
            await conversationService.requestControl(sessionId, {
              subtype: 'cybercode_mcp_patch_servers',
              servers: config ? { [CODEGRAPH_SERVER_NAME]: config } : {},
              remove: config ? [] : [CODEGRAPH_SERVER_NAME],
            }, attempt === 1 ? 5_000 : 12_000)
            return
          } catch (error) {
            lastError = error
            if (error instanceof Error && error.message === 'CLI session is not running') return
          }
        }
        console.warn(
          `[CodeGraph] Could not update MCP tools for session ${sessionId}: ${
            lastError instanceof Error ? lastError.message : String(lastError)
          }`,
        )
      })
    await Promise.all(operations)
  }

  private getOrCreateRuntime(projectPath: string, enabled: boolean): RuntimeState {
    const existing = this.runtimes.get(projectPath)
    if (existing) return existing
    const stats = this.readStats(projectPath)
    const runtime: RuntimeState = {
      status: {
        projectPath,
        indexable: true,
        enabled,
        state: enabled ? this.stateForStats(stats) : 'disabled',
        progress: null,
        stats,
        error: null,
        bundledLanguages: CODEGRAPH_BUNDLED_LANGUAGES,
      },
      indexGeneration: null,
      indexStarting: false,
      indexProcess: null,
      watchProcess: null,
    }
    this.runtimes.set(projectPath, runtime)
    return runtime
  }

  private stopRuntimeProcesses(runtime: RuntimeState) {
    runtime.indexProcess?.kill()
    runtime.watchProcess?.kill()
    runtime.indexProcess = null
    runtime.indexGeneration = null
    runtime.indexStarting = false
    runtime.watchProcess = null
  }

  private scheduleWatcherRestart(projectPath: string) {
    if (this.watcherRestartTimers.has(projectPath) || !this.isProjectEnabled(projectPath)) return
    const attempt = (this.watcherRestartAttempts.get(projectPath) ?? 0) + 1
    this.watcherRestartAttempts.set(projectPath, attempt)
    const delayMs = Math.min(
      30_000,
      this.watcherRestartBaseDelayMs * (2 ** Math.min(attempt - 1, 5)),
    )
    const timer = setTimeout(() => {
      this.watcherRestartTimers.delete(projectPath)
      if (!this.isProjectEnabled(projectPath)) return
      const runtime = this.getOrCreateRuntime(projectPath, true)
      if (runtime.indexProcess || runtime.indexStarting || runtime.watchProcess) return
      try {
        this.startWatcher(projectPath)
      } catch (error) {
        console.warn(
          `[CodeGraph] watcher restart failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        this.scheduleWatcherRestart(projectPath)
      }
    }, delayMs)
    this.watcherRestartTimers.set(projectPath, timer)
  }

  private cancelWatcherRestart(projectPath: string) {
    const timer = this.watcherRestartTimers.get(projectPath)
    if (timer) {
      clearTimeout(timer)
      this.watcherRestartTimers.delete(projectPath)
    }
    this.watcherRestartAttempts.delete(projectPath)
  }

  private buildMcpServerConfig(projectPath: string): CodeGraphProcessConfig {
    const invocation = this.buildInvocation('mcp', projectPath, false)
    return {
      type: 'stdio',
      command: invocation.command,
      args: invocation.args,
      env: invocation.env,
    }
  }

  private buildInvocation(mode: 'index' | 'watch' | 'mcp', projectPath: string, rebuild: boolean) {
    const sidecarName = path.basename(process.execPath).toLowerCase()
    const modeArgs = ['codegraph', mode, '--project', projectPath, ...(rebuild ? ['--rebuild'] : [])]
    const isBundledSidecar = sidecarName.startsWith('cybercode-sidecar') || sidecarName.startsWith('claude-sidecar')
    const args = isBundledSidecar
      ? modeArgs
      : ['run', path.join(this.getRepoRoot(), 'desktop', 'sidecars', 'cybercode-sidecar.ts'), ...modeArgs]
    return {
      command: process.execPath,
      args,
      env: {
        CYBER_CODEGRAPH_ASSET_DIR: this.getAssetDir(),
        CODEGRAPH_WAL_VALVE_MB: '64',
      },
    }
  }

  private normalizeRunnerStats(value: unknown): CodeGraphStats | null {
    if (!value || typeof value !== 'object') return null
    const stats = value as Record<string, unknown>
    return {
      fileCount: Number(stats.fileCount || 0),
      nodeCount: Number(stats.nodeCount || 0),
      edgeCount: Number(stats.edgeCount || 0),
      errorFileCount: 0,
      dbSizeBytes: Number(stats.dbSizeBytes || 0),
      lastUpdated: typeof stats.lastUpdated === 'number' ? stats.lastUpdated : null,
      filesByLanguage: this.toNumberRecord(stats.filesByLanguage),
    }
  }

  private readStats(projectPath: string): CodeGraphStats | null {
    const dbPath = this.getDatabasePath(projectPath)
    if (!fs.existsSync(dbPath)) return null
    const db = openCodeGraphDatabaseForRead(dbPath)
    try {
      const counts = db.query<{
        file_count: number
        node_count: number
        edge_count: number
        error_file_count: number
        last_updated: number | null
      }, []>(`
        SELECT
          (SELECT COUNT(*) FROM files) AS file_count,
          (SELECT COUNT(*) FROM nodes) AS node_count,
          (SELECT COUNT(*) FROM edges) AS edge_count,
          (SELECT COUNT(*) FROM files WHERE errors IS NOT NULL AND errors NOT IN ('', '[]')) AS error_file_count,
          (SELECT MAX(indexed_at) FROM files) AS last_updated
      `).get()
      if (!counts) return null
      const languages = db.query<{ language: string; count: number }, []>(`
        SELECT language, COUNT(*) AS count
        FROM files
        GROUP BY language
        ORDER BY count DESC
      `).all()
      const relatedFiles = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
      const dbSizeBytes = relatedFiles.reduce(
        (total, filePath) => total + (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0),
        0,
      )
      return {
        fileCount: Number(counts.file_count),
        nodeCount: Number(counts.node_count),
        edgeCount: Number(counts.edge_count),
        errorFileCount: Number(counts.error_file_count),
        dbSizeBytes,
        lastUpdated: counts.last_updated === null ? null : Number(counts.last_updated),
        filesByLanguage: Object.fromEntries(
          languages.map((entry) => [entry.language, Number(entry.count)]),
        ),
      }
    } catch {
      return null
    } finally {
      db.close()
    }
  }

  private async consumeJsonLines(
    stream: ReadableStream<Uint8Array>,
    onEvent: (event: Record<string, unknown>) => void,
  ) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      const lines = pending.split('\n')
      pending = lines.pop() || ''
      for (const line of lines) this.parseRunnerLine(line, onEvent)
    }
    pending += decoder.decode()
    if (pending.trim()) this.parseRunnerLine(pending, onEvent)
  }

  private parseRunnerLine(line: string, onEvent: (event: Record<string, unknown>) => void) {
    try {
      const event = JSON.parse(line) as unknown
      if (event && typeof event === 'object' && !Array.isArray(event)) {
        onEvent(event as Record<string, unknown>)
      }
    } catch {
      console.warn(`[CodeGraph] Ignoring malformed runner output: ${line.slice(0, 200)}`)
    }
  }

  private resolveProjectPath(projectPath: string): string {
    if (!projectPath.trim()) throw new Error('Project path is required')
    const resolved = fs.realpathSync.native(path.resolve(projectPath))
    if (!fs.statSync(resolved).isDirectory()) throw new Error('Project path is not a directory')
    if (path.parse(resolved).root === resolved) {
      throw new CodeGraphProjectScopeError(
        'Code Graph cannot index an entire filesystem root',
        resolved,
      )
    }
    if (resolved === fs.realpathSync.native(os.homedir())) {
      throw new CodeGraphProjectScopeError(
        'Code Graph cannot index the entire user home directory',
        resolved,
      )
    }
    return resolved
  }

  private getDatabasePath(projectPath: string) {
    return path.join(projectPath, '.codegraph', 'codegraph.db')
  }

  private getConfigPath() {
    return path.join(getClaudeConfigHomeDir(), 'cybercode', 'codegraph.json')
  }

  private getRepoRoot() {
    return path.resolve(import.meta.dir, '..', '..', '..')
  }

  private getAssetDir() {
    return process.env.CYBER_CODEGRAPH_ASSET_DIR
      || path.join(this.getRepoRoot(), 'desktop', 'src-tauri', 'resources', 'codegraph')
  }

  private assertAssetsAvailable() {
    const assetDir = this.getAssetDir()
    if (!fs.existsSync(path.join(assetDir, 'tree-sitter.wasm'))) {
      throw new Error(`Code Graph parser resources are missing: ${assetDir}`)
    }
  }

  private isProjectEnabled(_projectPath: string) {
    return this.readConfig().enabled
  }

  private setGlobalEnabled(enabled: boolean, projectPath?: string) {
    const config = this.readConfig()
    config.enabled = enabled
    if (projectPath) config.projects[projectPath] = { updatedAt: Date.now() }
    this.writeConfig(config)
  }

  private markProjectUsed(projectPath: string) {
    const config = this.readConfig()
    config.projects[projectPath] = { updatedAt: Date.now() }
    this.writeConfig(config)
  }

  private readConfig(): StoredConfig {
    const configPath = this.getConfigPath()
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<StoredConfig>
      const rawProjects = parsed.projects && typeof parsed.projects === 'object'
        ? parsed.projects as Record<string, { enabled?: boolean; updatedAt?: number }>
        : {}
      const enabled = typeof parsed.enabled === 'boolean'
        ? parsed.enabled
        : Object.values(rawProjects).some((project) => project?.enabled === true)
      return {
        version: CONFIG_VERSION,
        enabled,
        projects: Object.fromEntries(Object.entries(rawProjects).map(([projectPath, project]) => [
          projectPath,
          { updatedAt: Number(project?.updatedAt || 0) },
        ])),
      }
    } catch {
      return { version: CONFIG_VERSION, enabled: true, projects: {} }
    }
  }

  private writeConfig(config: StoredConfig) {
    const configPath = this.getConfigPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    const temporaryPath = `${configPath}.${process.pid}.tmp`
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporaryPath, configPath)
  }

  private toNumberRecord(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, Number(entry || 0)]),
    )
  }

  private stateForStats(stats: CodeGraphStats | null): CodeGraphState {
    if (!stats) return 'preparing'
    return stats.nodeCount > 0 ? 'ready' : 'empty'
  }

  private cloneStatus(status: CodeGraphStatus): CodeGraphStatus {
    return structuredClone(status)
  }
}

export const codeGraphService = new CodeGraphService()
