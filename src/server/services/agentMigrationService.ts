import { createHash, randomUUID } from 'crypto'
import { homedir } from 'os'
import { fileURLToPath } from 'url'
import JSON5 from 'json5'
import {
  appendFile,
  copyFile,
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'path'
import { ensureSessionSearchIndexFresh } from '../../sessionSearch/indexer.js'
import { clearCommandCaches } from '../../skills/loadSkillsDir.js'
import {
  getClaudeConfigHomeDir,
  getProjectConfigPath,
} from '../../utils/envUtils.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'
import { sessionService } from './sessionService.js'

export type ExternalAgentId =
  | 'cybercode'
  | 'openclaw'
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'hermes-agent'
  | 'deepseek-tui'

export type MigrationItemKind = 'skill' | 'memory' | 'instruction'
export type MigrationItemScope = 'global' | 'project'
export type MigrationDestinationState = 'ready' | 'merge' | 'exists' | 'conflict'
export type MigrationAdaptation = 'native' | 'converted'
export type MigrationSelectionIssue = 'size-limit' | 'destination-conflict'
export type MigrationWriteMode =
  | 'skill-copy'
  | 'markdown-file'
  | 'markdown-merge'
  | 'agent-skill'
  | 'cursor-mdc'
  | 'hermes-memory'
  | 'codewhale-memory'

export type AgentMigrationItem = {
  id: string
  agentId: ExternalAgentId
  kind: MigrationItemKind
  scope: MigrationItemScope
  name: string
  sourcePath: string
  destinationPath: string
  destinationRoot: string
  projectPath: string | null
  sizeBytes: number
  modifiedAt: string
  previewable: boolean
  recommended: boolean
  selectable: boolean
  selectionIssue?: MigrationSelectionIssue
  destinationState: MigrationDestinationState
  adaptation: MigrationAdaptation
  destinationFormat: string
  writeMode: MigrationWriteMode
  compatibilityNote?: string
}

export type AgentMigrationProject = {
  id: string
  agentId: ExternalAgentId
  name: string
  path: string
  exists: boolean
  itemIds: string[]
  lastSeenAt: string | null
}

export type DetectedExternalAgent = {
  id: ExternalAgentId
  name: string
  installed: boolean
  executablePath: string | null
  dataRoots: string[]
  counts: {
    skills: number
    memories: number
    instructions: number
    projects: number
  }
  items: AgentMigrationItem[]
  projects: AgentMigrationProject[]
}

export type AgentMigrationScan = {
  scannedAt: string
  targetAgentId: ExternalAgentId
  agents: DetectedExternalAgent[]
}

export type AgentMigrationRequest = {
  agentId: ExternalAgentId
  targetAgentId?: ExternalAgentId
  itemIds?: string[]
  projectIds?: string[]
  allRecommended?: boolean
}

export type AgentMigrationResultItem = {
  id: string
  status: 'imported' | 'skipped' | 'failed'
  destinationPath?: string
  message?: string
}

export type AgentMigrationResult = {
  imported: number
  skipped: number
  failed: number
  registeredProjects: string[]
  items: AgentMigrationResultItem[]
}

type AgentMigrationServiceOptions = {
  homeDir?: string
  cyberConfigDir?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  findExecutable?: (command: string) => string | null
  registerProject?: (projectPath: string) => Promise<boolean>
  refreshSearchIndex?: () => Promise<void>
}

type SourceProject = {
  path: string
  lastSeenAt: string | null
  sourceMemoryDirs?: string[]
}

type AgentScanContext = {
  id: ExternalAgentId
  name: string
  commands: string[]
  roots: string[]
  destinationRoots?: string[]
  workspaces?: string[]
  builtIn?: boolean
}

type AgentMigrationItemInput = Omit<
  AgentMigrationItem,
  | 'id'
  | 'sizeBytes'
  | 'modifiedAt'
  | 'previewable'
  | 'selectable'
  | 'selectionIssue'
  | 'destinationState'
  | 'adaptation'
  | 'destinationFormat'
  | 'writeMode'
  | 'destinationRoot'
  | 'compatibilityNote'
>

type MigrationDestination = {
  path: string
  root: string
  mode: MigrationWriteMode
  adaptation: MigrationAdaptation
  format: string
  compatibilityNote?: string
}

const MAX_SCAN_FILES = 1_500
const MAX_SCAN_ENTRIES = 20_000
const MAX_PROJECTS = 100
const MAX_ITEM_FILE_BYTES = 2 * 1024 * 1024
const MAX_SKILL_FILES = 200
const MAX_SKILL_BYTES = 8 * 1024 * 1024
const PREVIEW_BYTES = 160 * 1024
const SESSION_PREFIX_BYTES = 192 * 1024
const HERMES_MEMORY_MAX_CHARS = 2_200
const HERMES_USER_MAX_CHARS = 1_375
const CODEWHALE_MEMORY_MAX_BYTES = 100 * 1024
const SKIP_DIRS = new Set([
  '.git',
  '.cyber',
  '.venv',
  '.system',
  'node_modules',
  '__pycache__',
  'cache',
  'build',
  'dist',
  'logs',
  'target',
  'telemetry',
  'vendor_imports',
])
const PREVIEW_EXTENSIONS = new Set([
  '.md', '.mdc', '.txt', '.json', '.jsonl', '.toml', '.yaml', '.yml', '.xml', '.ini', '.cfg', '.sql',
])
const GLOBAL_INSTRUCTION_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'SOUL.md',
  'IDENTITY.md',
  'TOOLS.md',
  'HEARTBEAT.md',
] as const

export class AgentMigrationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(message)
    this.name = 'AgentMigrationError'
  }
}

export class AgentMigrationService {
  private readonly homeDir: string
  private readonly cyberConfigDir: string
  private readonly env: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform
  private readonly findExecutable: (command: string) => string | null
  private readonly registerProject: (projectPath: string) => Promise<boolean>
  private readonly refreshSearchIndex: () => Promise<void>
  private migrationQueue: Promise<void> = Promise.resolve()

  constructor(options: AgentMigrationServiceOptions = {}) {
    this.homeDir = resolve(options.homeDir ?? homedir())
    this.cyberConfigDir = resolve(options.cyberConfigDir ?? getClaudeConfigHomeDir())
    this.env = options.env ?? process.env
    this.platform = options.platform ?? process.platform
    this.findExecutable = options.findExecutable ?? ((command) => {
      try {
        return Bun.which(command) ?? null
      } catch {
        return null
      }
    })
    this.registerProject = options.registerProject ?? (async (projectPath) => {
      const existing = await sessionService.listSessions({ project: projectPath, limit: 1 })
      if (existing.sessions.length > 0) return false
      await sessionService.createSession(projectPath)
      return true
    })
    this.refreshSearchIndex = options.refreshSearchIndex ?? (() => ensureSessionSearchIndexFresh())
  }

  async scan(targetAgentId: ExternalAgentId = 'cybercode'): Promise<AgentMigrationScan> {
    const contexts = await this.buildScanContexts()
    const targetContext = this.findContext(contexts, targetAgentId)
    const agents = await Promise.all(contexts.map(context => this.scanAgent(context, targetContext)))
    return {
      scannedAt: new Date().toISOString(),
      targetAgentId,
      agents,
    }
  }

  async preview(
    agentId: ExternalAgentId,
    itemId: string,
    targetAgentId: ExternalAgentId = 'cybercode',
  ): Promise<{
    item: AgentMigrationItem
    content: string
    truncated: boolean
  }> {
    const agent = await this.scanAgentById(agentId, targetAgentId)
    const item = agent.items.find(candidate => candidate.id === itemId)
    if (!item) {
      throw new AgentMigrationError('Migration item was not found.', 'ITEM_NOT_FOUND', 404)
    }
    if (!item.previewable) {
      throw new AgentMigrationError('This item cannot be previewed as text.', 'PREVIEW_UNAVAILABLE')
    }

    const sourcePath = await this.assertReadableSource(item.sourcePath, item.agentId)
    const sourceStat = await stat(sourcePath)
    const content = await this.readUtf8Prefix(sourcePath, PREVIEW_BYTES)
    return {
      item,
      content,
      truncated: sourceStat.size > PREVIEW_BYTES,
    }
  }

  async migrate(request: AgentMigrationRequest): Promise<AgentMigrationResult> {
    const operation = this.migrationQueue.then(() => this.migrateUnlocked(request))
    this.migrationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async migrateUnlocked(request: AgentMigrationRequest): Promise<AgentMigrationResult> {
    const targetAgentId = request.targetAgentId ?? 'cybercode'
    if (targetAgentId === request.agentId) {
      throw new AgentMigrationError('The source and destination agents must be different.', 'SAME_AGENT')
    }
    const contexts = await this.buildScanContexts()
    const sourceContext = this.findContext(contexts, request.agentId)
    const targetContext = this.findContext(contexts, targetAgentId)
    const agent = await this.scanAgent(sourceContext, targetContext)
    if (!agent.installed) {
      throw new AgentMigrationError('The selected agent was not detected.', 'AGENT_NOT_DETECTED', 404)
    }
    const targetInstalled = targetContext.builtIn
      || targetContext.commands.some(command => Boolean(this.findExecutable(command)))
      || (await this.existingPaths([...targetContext.roots, ...(targetContext.workspaces ?? [])])).length > 0
    if (!targetInstalled) {
      throw new AgentMigrationError('The destination agent was not detected.', 'TARGET_NOT_DETECTED', 404)
    }

    const requestedItemIds = new Set(request.itemIds ?? [])
    const requestedProjectIds = new Set(request.projectIds ?? [])
    if (request.allRecommended) {
      for (const item of agent.items) {
        if (item.scope === 'global' && item.recommended && item.selectable) {
          requestedItemIds.add(item.id)
        }
      }
    }

    const selectedProjects = agent.projects.filter(project => requestedProjectIds.has(project.id))
    for (const project of selectedProjects) {
      for (const itemId of project.itemIds) requestedItemIds.add(itemId)
    }

    const knownIds = new Set(agent.items.map(item => item.id))
    const unknownItem = [...requestedItemIds].find(id => !knownIds.has(id))
    const knownProjectIds = new Set(agent.projects.map(project => project.id))
    const unknownProject = [...requestedProjectIds].find(id => !knownProjectIds.has(id))
    if (unknownItem || unknownProject) {
      throw new AgentMigrationError(
        'The migration selection changed. Refresh detection and try again.',
        'STALE_SELECTION',
        409,
      )
    }
    if (requestedItemIds.size === 0 && selectedProjects.length === 0) {
      throw new AgentMigrationError('Select at least one item or project.', 'EMPTY_SELECTION')
    }

    const result: AgentMigrationResult = {
      imported: 0,
      skipped: 0,
      failed: 0,
      registeredProjects: [],
      items: [],
    }
    const backupRoot = join(
      this.cyberConfigDir,
      'migration-backups',
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
    )

    for (const item of agent.items.filter(candidate => requestedItemIds.has(candidate.id))) {
      if (!item.selectable) {
        result.skipped += 1
        result.items.push({
          id: item.id,
          status: 'skipped',
          message: item.selectionIssue === 'destination-conflict'
            ? 'The destination is occupied by an incompatible file type. Existing data was left unchanged.'
            : 'Item exceeds the migration size or file-count limit.',
        })
        continue
      }
      try {
        const migrated = await this.migrateItem(item, agent.name, targetContext.name, targetContext, backupRoot)
        if (migrated.changed) result.imported += 1
        else result.skipped += 1
        result.items.push({
          id: item.id,
          status: migrated.changed ? 'imported' : 'skipped',
          destinationPath: migrated.destinationPath,
          message: migrated.message,
        })
      } catch (error) {
        result.failed += 1
        result.items.push({
          id: item.id,
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    for (const project of selectedProjects) {
      if (!project.exists) {
        result.skipped += 1
        result.items.push({
          id: project.id,
          status: 'skipped',
          message: 'The project path no longer exists.',
        })
        continue
      }
      if (targetAgentId !== 'cybercode') {
        if (project.itemIds.length === 0) {
          result.skipped += 1
          result.items.push({
            id: project.id,
            status: 'skipped',
            message: 'This project has no compatible data for the destination agent.',
          })
        }
        continue
      }
      try {
        if (await this.registerProject(project.path)) {
          result.registeredProjects.push(project.path)
        } else {
          result.skipped += 1
          result.items.push({
            id: project.id,
            status: 'skipped',
            message: 'The project is already registered in CyberCode.',
          })
        }
      } catch (error) {
        result.failed += 1
        result.items.push({
          id: project.id,
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (result.imported > 0 && targetAgentId === 'cybercode') {
      try {
        clearCommandCaches()
      } catch {
        // The imported files are already durable; cache refresh is best effort.
      }
      await this.refreshSearchIndex().catch(() => {})
    }
    await this.appendMigrationLog(request, result).catch(() => {})
    return result
  }

  private async buildScanContexts(): Promise<AgentScanContext[]> {
    const openClawRoot = this.expandHome(this.env.OPENCLAW_STATE_DIR || join(this.homeDir, '.openclaw'))
    const openClawWorkspaces = await this.discoverOpenClawWorkspaces(openClawRoot)
    const hermesRoots = await this.discoverHermesRoots()
    const claudeRoot = this.expandHome(this.env.CLAUDE_CONFIG_DIR || join(this.homeDir, '.claude'))
    const codexRoot = this.expandHome(this.env.CODEX_HOME || join(this.homeDir, '.codex'))
    const configuredCodeWhaleRoot = this.env.CODEWHALE_HOME
      ? this.expandHome(this.env.CODEWHALE_HOME)
      : ''
    const codeWhaleCandidates = this.uniquePaths([
      configuredCodeWhaleRoot,
      join(this.homeDir, '.codewhale'),
      join(this.homeDir, '.deepseek'),
    ])
    const activeCodeWhaleRoot = configuredCodeWhaleRoot
      || await this.firstExistingPath(codeWhaleCandidates)
      || join(this.homeDir, '.codewhale')
    const codeWhaleRoots = this.uniquePaths([activeCodeWhaleRoot, ...codeWhaleCandidates])
    const cursorHome = this.expandHome(this.env.CURSOR_HOME || join(this.homeDir, '.cursor'))
    const cursorRoots = this.uniquePaths([
      cursorHome,
      join(this.homeDir, 'Library', 'Application Support', 'Cursor'),
      this.env.APPDATA ? join(this.env.APPDATA, 'Cursor') : '',
      this.env.LOCALAPPDATA ? join(this.env.LOCALAPPDATA, 'Cursor') : '',
      this.env.LOCALAPPDATA ? join(this.env.LOCALAPPDATA, 'Programs', 'cursor') : '',
      this.env.ProgramFiles || this.env.PROGRAMFILES
        ? join((this.env.ProgramFiles || this.env.PROGRAMFILES)!, 'Cursor')
        : '',
      this.env.XDG_CONFIG_HOME
        ? join(this.env.XDG_CONFIG_HOME, 'Cursor')
        : join(this.homeDir, '.config', 'Cursor'),
      '/Applications/Cursor.app',
      join(this.homeDir, 'Applications', 'Cursor.app'),
      '/opt/Cursor',
      '/usr/share/cursor',
    ])

    return [
      {
        id: 'cybercode',
        name: 'CyberCode',
        commands: ['cybercode'],
        roots: [this.cyberConfigDir],
        builtIn: true,
      },
      {
        id: 'openclaw',
        name: 'OpenClaw',
        commands: ['openclaw'],
        roots: [openClawRoot],
        workspaces: openClawWorkspaces,
      },
      {
        id: 'claude-code',
        name: 'Claude Code',
        commands: ['claude'],
        roots: [claudeRoot],
      },
      {
        id: 'codex',
        name: 'Codex',
        commands: ['codex'],
        roots: [codexRoot],
        destinationRoots: [join(this.homeDir, '.agents')],
      },
      {
        id: 'cursor',
        name: 'Cursor',
        commands: ['cursor-agent', 'cursor'],
        roots: cursorRoots,
      },
      {
        id: 'hermes-agent',
        name: 'Hermes Agent',
        commands: ['hermes'],
        roots: hermesRoots,
      },
      {
        id: 'deepseek-tui',
        name: 'DeepSeek TUI / CodeWhale',
        commands: ['codewhale', 'codew', 'deepseek', 'deepseek-tui'],
        roots: codeWhaleRoots,
      },
    ]
  }

  private findContext(contexts: AgentScanContext[], agentId: ExternalAgentId): AgentScanContext {
    const context = contexts.find(candidate => candidate.id === agentId)
    if (!context) throw new AgentMigrationError('Unknown agent.', 'UNKNOWN_AGENT', 404)
    return context
  }

  private async scanAgentById(
    agentId: ExternalAgentId,
    targetAgentId: ExternalAgentId,
  ): Promise<DetectedExternalAgent> {
    const contexts = await this.buildScanContexts()
    return this.scanAgent(
      this.findContext(contexts, agentId),
      this.findContext(contexts, targetAgentId),
    )
  }

  private async scanAgent(
    context: AgentScanContext,
    targetContext: AgentScanContext,
  ): Promise<DetectedExternalAgent> {
    const executablePath = context.commands
      .map(command => this.findExecutable(command))
      .find((candidate): candidate is string => Boolean(candidate)) ?? null
    const existingRoots = await this.existingPaths(context.roots)
    const existingWorkspaces = await this.existingPaths(context.workspaces ?? [])
    const canonicalCyberConfigDir = await this.canonicalPath(this.cyberConfigDir)
    const items = new Map<string, AgentMigrationItem>()

    const addItem = async (input: AgentMigrationItemInput) => {
      const sourcePath = await this.safeExistingFile(input.sourcePath)
      if (!sourcePath || (context.id !== 'cybercode' && this.isInside(sourcePath, canonicalCyberConfigDir))) return
      const sourceStat = await stat(sourcePath)
      const id = this.itemId(input.agentId, input.kind, sourcePath, input.projectPath)
      if (items.has(id)) return
      const skillMetrics = input.kind === 'skill'
        ? await this.directoryMetrics(dirname(sourcePath))
        : null
      const sizeBytes = skillMetrics?.sizeBytes ?? sourceStat.size
      const withinSizeLimit = skillMetrics
        ? !skillMetrics.exceeded
        : sizeBytes <= MAX_ITEM_FILE_BYTES
      const destination = await this.migrationDestination(targetContext, { ...input, sourcePath })
      const destinationPath = destination.path
      const destinationState = await this.inspectDestinationState(destination)
      const selectionIssue: MigrationSelectionIssue | undefined = !withinSizeLimit
        ? 'size-limit'
        : destinationState === 'conflict'
          ? 'destination-conflict'
          : undefined
      items.set(id, {
        ...input,
        id,
        sourcePath,
        destinationPath,
        destinationRoot: destination.root,
        sizeBytes,
        modifiedAt: sourceStat.mtime.toISOString(),
        previewable: PREVIEW_EXTENSIONS.has(extname(sourcePath).toLowerCase()),
        selectable: !selectionIssue,
        selectionIssue,
        destinationState,
        adaptation: destination.adaptation,
        destinationFormat: destination.format,
        writeMode: destination.mode,
        compatibilityNote: destination.compatibilityNote,
      })
    }

    await this.scanGlobalItems(context, addItem)
    const sourceProjects = await this.discoverProjects(context)
    const projects: AgentMigrationProject[] = []

    for (const sourceProject of sourceProjects.slice(0, MAX_PROJECTS)) {
      const before = new Set(items.keys())
      await this.scanProjectItems(context.id, sourceProject, addItem)
      const itemIds = [...items.keys()].filter(id => !before.has(id))
      projects.push({
        id: this.projectId(context.id, sourceProject.path),
        agentId: context.id,
        name: basename(sourceProject.path) || sourceProject.path,
        path: sourceProject.path,
        exists: await this.isDirectory(sourceProject.path),
        itemIds,
        lastSeenAt: sourceProject.lastSeenAt,
      })
    }

    const allItems = [...items.values()].sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'global' ? -1 : 1
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
      return a.name.localeCompare(b.name)
    })

    return {
      id: context.id,
      name: context.name,
      installed: Boolean(
        context.builtIn
        || executablePath
        || existingRoots.length > 0
        || existingWorkspaces.length > 0
        || allItems.length > 0,
      ),
      executablePath,
      dataRoots: this.uniquePaths([...existingRoots, ...existingWorkspaces]),
      counts: {
        skills: allItems.filter(item => item.kind === 'skill').length,
        memories: allItems.filter(item => item.kind === 'memory').length,
        instructions: allItems.filter(item => item.kind === 'instruction').length,
        projects: projects.length,
      },
      items: allItems,
      projects: projects.sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '')),
    }
  }

  private async scanGlobalItems(
    context: AgentScanContext,
    addItem: (item: AgentMigrationItemInput) => Promise<void>,
  ): Promise<void> {
    const globalSkillRoots: string[] = []
    const memoryFiles: Array<{ path: string; recommended?: boolean }> = []
    const instructionFiles: Array<{ path: string; recommended?: boolean }> = []

    switch (context.id) {
      case 'cybercode': {
        const root = context.roots[0]!
        globalSkillRoots.push(join(root, 'skills'))
        const files = await this.walkFiles(join(root, 'prompt-memory'), {
          extensions: new Set(['.md']),
          maxDepth: 3,
        })
        memoryFiles.push(...files.map(path => ({ path, recommended: true })))
        instructionFiles.push({ path: join(root, 'CYBER.md'), recommended: true })
        break
      }
      case 'claude-code': {
        const root = context.roots[0]!
        globalSkillRoots.push(join(root, 'skills'))
        instructionFiles.push({ path: join(root, 'CLAUDE.md'), recommended: true })
        const files = await this.walkFiles(join(root, 'rules'), {
          extensions: new Set(['.md']),
          maxDepth: 6,
        })
        instructionFiles.push(...files.map(path => ({ path, recommended: true })))
        break
      }
      case 'codex':
        globalSkillRoots.push(join(context.roots[0]!, 'skills'), join(this.homeDir, '.agents', 'skills'))
        instructionFiles.push({ path: join(context.roots[0]!, 'AGENTS.md'), recommended: true })
        break
      case 'cursor': {
        const root = context.roots[0]!
        globalSkillRoots.push(join(root, 'skills'), join(this.homeDir, '.agents', 'skills'))
        const files = await this.walkFiles(join(root, 'rules'), {
          extensions: new Set(['.md', '.mdc']),
          maxDepth: 6,
        })
        instructionFiles.push(...files.map(path => ({ path, recommended: true })))
        break
      }
      case 'openclaw': {
        globalSkillRoots.push(join(context.roots[0]!, 'skills'), join(this.homeDir, '.agents', 'skills'))
        for (const workspace of context.workspaces ?? []) {
          globalSkillRoots.push(join(workspace, 'skills'), join(workspace, '.agents', 'skills'))
          memoryFiles.push(
            { path: join(workspace, 'MEMORY.md'), recommended: true },
            { path: join(workspace, 'DREAMS.md') },
            { path: join(workspace, 'USER.md'), recommended: true },
          )
          const dailyFiles = await this.walkFiles(join(workspace, 'memory'), {
            extensions: new Set(['.md']),
            maxDepth: 4,
          })
          memoryFiles.push(...dailyFiles.map(path => ({ path, recommended: true })))
          for (const fileName of GLOBAL_INSTRUCTION_FILES) {
            if (fileName === 'CLAUDE.md') continue
            instructionFiles.push({
              path: join(workspace, fileName),
              recommended: fileName === 'AGENTS.md',
            })
          }
        }
        break
      }
      case 'hermes-agent':
        for (const root of context.roots) {
          globalSkillRoots.push(join(root, 'skills'))
          const files = await this.walkFiles(join(root, 'memories'), {
            extensions: new Set(['.md']),
            maxDepth: 5,
          })
          memoryFiles.push(...files.map(path => ({ path, recommended: true })))
          instructionFiles.push(
            { path: join(root, 'AGENTS.md'), recommended: true },
            { path: join(root, 'SOUL.md') },
          )
        }
        break
      case 'deepseek-tui':
        globalSkillRoots.push(join(this.homeDir, '.agents', 'skills'))
        instructionFiles.push({ path: join(this.homeDir, '.agents', 'AGENTS.md'), recommended: true })
        for (const root of context.roots) {
          globalSkillRoots.push(join(root, 'skills'))
          memoryFiles.push({ path: join(root, 'memory.md'), recommended: true })
          for (const memoryDir of ['memory', 'memories']) {
            const files = await this.walkFiles(join(root, memoryDir), {
              extensions: new Set(['.md']),
              maxDepth: 5,
            })
            memoryFiles.push(...files.map(path => ({ path, recommended: true })))
          }
          instructionFiles.push(
            { path: join(root, 'AGENTS.md'), recommended: true },
            { path: join(root, 'prompts', 'constitution.md') },
            { path: join(root, 'constitution.json') },
          )
        }
        break
    }

    for (const skillRoot of this.uniquePaths(globalSkillRoots)) {
      for (const skillFile of await this.discoverSkillFiles(skillRoot)) {
        const name = await this.skillName(skillFile)
        await addItem({
          agentId: context.id,
          kind: 'skill',
          scope: 'global',
          name,
          sourcePath: skillFile,
          destinationPath: join(this.cyberConfigDir, 'skills', this.safeName(name)),
          projectPath: null,
          recommended: true,
        })
      }
    }

    for (const memory of memoryFiles) {
      const name = basename(memory.path)
      await addItem({
        agentId: context.id,
        kind: 'memory',
        scope: 'global',
        name,
        sourcePath: memory.path,
        destinationPath: this.memoryDestination(context.id, memory.path, this.homeDir),
        projectPath: null,
        recommended: memory.recommended === true,
      })
    }

    for (const instruction of instructionFiles) {
      await addItem({
        agentId: context.id,
        kind: 'instruction',
        scope: 'global',
        name: basename(instruction.path),
        sourcePath: instruction.path,
        destinationPath: join(this.cyberConfigDir, 'CYBER.md'),
        projectPath: null,
        recommended: instruction.recommended === true,
      })
    }
  }

  private async scanProjectItems(
    agentId: ExternalAgentId,
    project: SourceProject,
    addItem: (item: AgentMigrationItemInput) => Promise<void>,
  ): Promise<void> {
    const projectPath = project.path
    if (!(await this.isDirectory(projectPath))) return
    const cyberProjectConfigIsGlobal = agentId === 'cybercode'
      && await this.canonicalPath(getProjectConfigPath(projectPath, ''))
        === await this.canonicalPath(this.cyberConfigDir)

    const exactInstructions = [join(projectPath, 'AGENTS.md'), join(projectPath, 'CLAUDE.md')]
    if (agentId === 'cybercode') exactInstructions.unshift(join(projectPath, 'CYBER.md'))
    if (agentId === 'claude-code') {
      exactInstructions.push(
        join(projectPath, '.claude', 'CLAUDE.md'),
        join(projectPath, 'CLAUDE.local.md'),
      )
    }
    if (agentId === 'codex') exactInstructions.push(join(projectPath, 'AGENTS.override.md'))
    if (agentId === 'cursor') exactInstructions.push(join(projectPath, '.cursorrules'))
    if (agentId === 'hermes-agent') {
      exactInstructions.unshift(join(projectPath, '.hermes.md'), join(projectPath, 'HERMES.md'))
    }
    if (agentId === 'deepseek-tui') {
      exactInstructions.push(join(projectPath, '.codewhale', 'constitution.json'))
      exactInstructions.push(join(projectPath, '.deepseek', 'constitution.json'))
      exactInstructions.push(join(projectPath, '.codewhale', 'instructions.md'))
      exactInstructions.push(join(projectPath, '.deepseek', 'instructions.md'))
    }
    for (const sourcePath of exactInstructions) {
      await addItem({
        agentId,
        kind: 'instruction',
        scope: 'project',
        name: basename(sourcePath),
        sourcePath,
        destinationPath: this.projectRuleDestination(agentId, projectPath, sourcePath),
        projectPath,
        recommended: true,
      })
    }

    const nestedInstructionNames = agentId === 'claude-code'
      ? new Set(['CLAUDE.md', 'CLAUDE.local.md'])
      : agentId === 'codex'
        ? new Set(['AGENTS.md', 'AGENTS.override.md'])
        : agentId === 'cursor' || agentId === 'deepseek-tui'
          ? new Set(['AGENTS.md', 'CLAUDE.md'])
          : agentId === 'hermes-agent'
            ? new Set(['AGENTS.md', 'CLAUDE.md', 'SOUL.md', '.cursorrules'])
            : null
    if (nestedInstructionNames) {
      const nestedInstructions = await this.walkFiles(projectPath, {
        names: nestedInstructionNames,
        maxDepth: 6,
        maxFiles: 300,
      })
      for (const sourcePath of nestedInstructions) {
        await addItem({
          agentId,
          kind: 'instruction',
          scope: 'project',
          name: basename(sourcePath),
          sourcePath,
          destinationPath: this.projectRuleDestination(agentId, projectPath, sourcePath),
          projectPath,
          recommended: true,
        })
      }
    }

    const skillRoots = agentId === 'cybercode'
      ? cyberProjectConfigIsGlobal ? [] : [join(projectPath, '.cyber', 'skills')]
      : agentId === 'claude-code'
      ? [join(projectPath, '.claude', 'skills')]
      : agentId === 'codex'
        ? [join(projectPath, '.agents', 'skills'), join(projectPath, '.codex', 'skills')]
        : agentId === 'cursor'
          ? [join(projectPath, '.cursor', 'skills'), join(projectPath, '.agents', 'skills')]
        : agentId === 'openclaw'
          ? [join(projectPath, 'skills'), join(projectPath, '.agents', 'skills')]
          : agentId === 'hermes-agent'
            ? [join(projectPath, '.hermes', 'skills')]
            : [
                join(projectPath, '.codewhale', 'skills'),
                join(projectPath, '.deepseek', 'skills'),
                join(projectPath, '.agents', 'skills'),
              ]

    for (const skillRoot of skillRoots) {
      for (const skillFile of await this.discoverSkillFiles(skillRoot)) {
        const name = await this.skillName(skillFile)
        await addItem({
          agentId,
          kind: 'skill',
          scope: 'project',
          name,
          sourcePath: skillFile,
          destinationPath: getProjectConfigPath(projectPath, 'skills', this.safeName(name)),
          projectPath,
          recommended: true,
        })
      }
    }

    const ruleDirs = agentId === 'cybercode'
      ? cyberProjectConfigIsGlobal ? [] : [join(projectPath, '.cyber', 'rules')]
      : agentId === 'claude-code'
      ? [join(projectPath, '.claude', 'rules')]
      : agentId === 'codex'
        ? [join(projectPath, '.agents', 'rules')]
        : agentId === 'cursor'
          ? [join(projectPath, '.cursor', 'rules')]
        : agentId === 'deepseek-tui'
          ? [join(projectPath, '.codewhale', 'rules'), join(projectPath, '.deepseek', 'rules')]
          : []
    for (const ruleDir of ruleDirs) {
      const files = await this.walkFiles(ruleDir, { extensions: new Set(['.md', '.mdc']), maxDepth: 6 })
      for (const sourcePath of files) {
        await addItem({
          agentId,
          kind: 'instruction',
          scope: 'project',
          name: basename(sourcePath),
          sourcePath,
          destinationPath: this.projectRuleDestination(agentId, projectPath, sourcePath),
          projectPath,
          recommended: true,
        })
      }
    }
    if (agentId === 'cursor') {
      for (const sourcePath of await this.discoverNestedCursorRuleFiles(projectPath)) {
        await addItem({
          agentId,
          kind: 'instruction',
          scope: 'project',
          name: basename(sourcePath),
          sourcePath,
          destinationPath: this.projectRuleDestination(agentId, projectPath, sourcePath),
          projectPath,
          recommended: true,
        })
      }
    }

    for (const memoryDir of project.sourceMemoryDirs ?? []) {
      const files = await this.walkFiles(memoryDir, { extensions: new Set(['.md']), maxDepth: 5 })
      for (const sourcePath of files) {
        await addItem({
          agentId,
          kind: 'memory',
          scope: 'project',
          name: basename(sourcePath),
          sourcePath,
          destinationPath: this.memoryDestination(agentId, sourcePath, projectPath),
          projectPath,
          recommended: true,
        })
      }
    }
  }

  private async discoverProjects(context: AgentScanContext): Promise<SourceProject[]> {
    const projects = new Map<string, SourceProject>()
    const canonicalCyberConfigDir = await this.canonicalPath(this.cyberConfigDir)
    const add = async (rawPath: string, lastSeenAt: string | null, sourceMemoryDir?: string) => {
      const expanded = this.expandHome(rawPath.trim())
      if (!expanded || !isAbsolute(expanded)) return
      const normalized = await this.canonicalPath(expanded)
      if (this.isInside(normalized, canonicalCyberConfigDir)) return
      const existing = projects.get(normalized)
      const next: SourceProject = existing ?? { path: normalized, lastSeenAt }
      if (!next.lastSeenAt || (lastSeenAt && lastSeenAt > next.lastSeenAt)) next.lastSeenAt = lastSeenAt
      if (sourceMemoryDir) {
        next.sourceMemoryDirs = this.uniquePaths([...(next.sourceMemoryDirs ?? []), sourceMemoryDir])
      }
      projects.set(normalized, next)
    }

    if (context.id === 'openclaw') {
      for (const workspace of context.workspaces ?? []) {
        if (await this.isDirectory(workspace)) {
          await add(workspace, await this.pathModifiedAt(workspace))
        }
      }
      return [...projects.values()]
    }

    if (context.id === 'claude-code' || context.id === 'cybercode') {
      const projectStore = join(context.roots[0]!, 'projects')
      let dirs: import('fs').Dirent[] = []
      try {
        dirs = await readdir(projectStore, { withFileTypes: true })
      } catch {
        return []
      }
      for (const entry of dirs.filter(candidate => candidate.isDirectory()).slice(0, MAX_PROJECTS * 2)) {
        const dirPath = join(projectStore, entry.name)
        let sessionFiles: string[] = []
        try {
          const entries = await readdir(dirPath, { withFileTypes: true })
          sessionFiles = entries
            .filter(candidate => candidate.isFile() && candidate.name.endsWith('.jsonl'))
            .slice(0, 50)
            .map(candidate => join(dirPath, candidate.name))
        } catch {
          continue
        }
        let lastSeenAt: string | null = null
        let memoryProjectPath = ''
        for (const sessionFile of sessionFiles) {
          const source = await this.readPrefix(sessionFile)
          const discoveredPath = this.extractWorkDir(source) ?? ''
          const modifiedAt = await this.pathModifiedAt(sessionFile)
          if (!lastSeenAt || (modifiedAt && modifiedAt > lastSeenAt)) lastSeenAt = modifiedAt
          if (discoveredPath) {
            await add(discoveredPath, modifiedAt)
            if (sanitizePath(discoveredPath) === entry.name) {
              memoryProjectPath = discoveredPath
            }
          }
        }

        if (!memoryProjectPath) {
          const decodedPath = entry.name.replace(/-/g, sep)
          if (isAbsolute(decodedPath) && await this.isDirectory(decodedPath)) {
            memoryProjectPath = decodedPath
          }
        }
        if (memoryProjectPath) {
          await add(memoryProjectPath, lastSeenAt, join(dirPath, 'memory'))
        }
      }
      return [...projects.values()]
    }

    if (context.id === 'cursor') {
      for (const root of context.roots) {
        const workspaceStore = join(root, 'User', 'workspaceStorage')
        let workspaceEntries: import('fs').Dirent[] = []
        try {
          workspaceEntries = await readdir(workspaceStore, { withFileTypes: true })
        } catch {
          continue
        }
        for (const entry of workspaceEntries.filter(candidate => candidate.isDirectory()).slice(0, MAX_PROJECTS * 2)) {
          const metadataPath = join(workspaceStore, entry.name, 'workspace.json')
          const metadata = await this.readJson(metadataPath)
          if (!metadata) continue
          for (const key of ['folder', 'workspace', 'folderUri', 'workspaceUri', 'configPath']) {
            const projectPath = this.cursorWorkspacePath(this.stringValue(metadata, key))
            if (projectPath) await add(projectPath, await this.pathModifiedAt(metadataPath))
          }
        }
      }
    }

    const sessionRoots = context.roots.flatMap(root => [join(root, 'sessions'), join(root, 'history')])
    for (const sessionRoot of sessionRoots) {
      const files = await this.walkFiles(sessionRoot, {
        extensions: new Set(['.jsonl', '.json']),
        maxDepth: 6,
        maxFiles: 600,
      })
      for (const file of files) {
        const source = await this.readPrefix(file)
        const workDir = this.extractWorkDir(source)
        if (workDir) await add(workDir, await this.pathModifiedAt(file))
      }
    }

    return [...projects.values()]
  }

  private async discoverNestedCursorRuleFiles(projectPath: string): Promise<string[]> {
    const files: string[] = []
    let visitedEntries = 0
    const walk = async (current: string, depth: number): Promise<void> => {
      if (depth > 6 || files.length >= 500 || visitedEntries >= MAX_SCAN_ENTRIES) return
      let entries: import('fs').Dirent[] = []
      try {
        entries = await readdir(current, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        visitedEntries += 1
        if (visitedEntries > MAX_SCAN_ENTRIES) break
        if (!entry.isDirectory() || entry.isSymbolicLink() || this.shouldSkipDirectory(entry.name)) continue
        const directory = join(current, entry.name)
        if (entry.name === '.cursor') {
          files.push(...await this.walkFiles(join(directory, 'rules'), {
            extensions: new Set(['.md', '.mdc']),
            maxDepth: 6,
            maxFiles: 500 - files.length,
          }))
          continue
        }
        await walk(directory, depth + 1)
      }
    }
    await walk(projectPath, 0)
    return this.uniquePaths(files).slice(0, 500)
  }

  private cursorWorkspacePath(value: string | null): string | null {
    if (!value) return null
    try {
      const path = value.startsWith('file:') ? fileURLToPath(value) : value
      if (!isAbsolute(path)) return null
      return extname(path).toLowerCase() === '.code-workspace' ? dirname(path) : path
    } catch {
      return null
    }
  }

  private async migrationDestination(
    target: AgentScanContext,
    item: AgentMigrationItemInput,
  ): Promise<MigrationDestination> {
    if (target.id === 'cybercode') {
      return {
        path: item.destinationPath,
        root: item.projectPath ?? this.cyberConfigDir,
        mode: item.kind === 'skill'
          ? 'skill-copy'
          : item.kind === 'instruction' && item.scope === 'global'
            ? 'markdown-merge'
            : 'markdown-file',
        adaptation: 'native',
        format: item.kind === 'skill'
          ? 'CyberCode Agent Skill'
          : item.kind === 'memory'
            ? 'CyberCode searchable project memory'
            : 'CyberCode instruction Markdown',
      }
    }

    const root = target.roots[0]!
    const projectPath = item.projectPath ?? this.homeDir
    const sourceName = this.safeName(item.agentId)
    const stem = `${this.safeName(basename(item.sourcePath, extname(item.sourcePath)))}-${this.shortHash(item.sourcePath)}`
    const markdownName = `${stem}.md`
    const projectSuffix = item.scope === 'project' && item.projectPath
      ? `-${this.safeName(basename(item.projectPath))}-${this.shortHash(item.projectPath)}`
      : ''

    if (item.kind === 'skill') {
      switch (target.id) {
        case 'claude-code': {
          const skillRoot = item.scope === 'global'
            ? join(root, 'skills')
            : join(projectPath, '.claude', 'skills')
          return {
            path: join(skillRoot, this.safeName(item.name)),
            root: item.scope === 'global' ? root : projectPath,
            mode: 'skill-copy',
            adaptation: 'native',
            format: 'Claude Code Agent Skill',
          }
        }
        case 'codex': {
          const skillRoot = item.scope === 'global'
            ? join(this.homeDir, '.agents', 'skills')
            : join(projectPath, '.agents', 'skills')
          return {
            path: join(skillRoot, this.safeName(item.name)),
            root: item.scope === 'global' ? join(this.homeDir, '.agents') : projectPath,
            mode: 'skill-copy',
            adaptation: 'native',
            format: 'Codex Agent Skill',
          }
        }
        case 'cursor': {
          const skillRoot = item.scope === 'global'
            ? join(root, 'skills')
            : join(projectPath, '.cursor', 'skills')
          return {
            path: join(skillRoot, this.safeName(item.name)),
            root: item.scope === 'global' ? root : projectPath,
            mode: 'skill-copy',
            adaptation: 'native',
            format: 'Cursor Agent Skill',
          }
        }
        case 'openclaw': {
          const workspace = target.workspaces?.[0] ?? join(root, 'workspace')
          const skillRoot = item.scope === 'global' ? join(root, 'skills') : join(workspace, 'skills')
          return {
            path: join(skillRoot, this.safeName(`${item.name}${projectSuffix}`)),
            root: item.scope === 'global' ? root : workspace,
            mode: 'skill-copy',
            adaptation: 'native',
            format: item.scope === 'global' ? 'OpenClaw managed skill' : 'OpenClaw workspace skill',
          }
        }
        case 'hermes-agent':
          return {
            path: join(root, 'skills', this.safeName(`${item.name}${projectSuffix}`)),
            root,
            mode: 'skill-copy',
            adaptation: item.scope === 'global' ? 'native' : 'converted',
            format: 'Hermes Agent global Skill',
            compatibilityNote: item.scope === 'project'
              ? 'Hermes loads skills from its profile, so the project name is added to avoid collisions.'
              : undefined,
          }
        case 'deepseek-tui': {
          const skillRoot = item.scope === 'global'
            ? join(root, 'skills')
            : join(projectPath, '.codewhale', 'skills')
          return {
            path: join(skillRoot, this.safeName(item.name)),
            root: item.scope === 'global' ? root : projectPath,
            mode: 'skill-copy',
            adaptation: 'native',
            format: 'CodeWhale Agent Skill',
          }
        }
      }
    }

    if (item.kind === 'memory') {
      switch (target.id) {
        case 'claude-code': {
          if (item.scope === 'global') {
            return {
              path: join(root, 'rules', `imported-memory-${sourceName}-${markdownName}`),
              root,
              mode: 'markdown-file',
              adaptation: 'converted',
              format: 'Claude Code user-level rule',
              compatibilityNote: 'Claude auto memory is repository-scoped; global memory is converted to a user rule.',
            }
          }
          const memoryRoot = await this.claudeProjectMemoryRoot(root, projectPath)
          return {
            path: join(memoryRoot, 'MEMORY.md'),
            root: memoryRoot,
            mode: 'markdown-merge',
            adaptation: 'native',
            format: 'Claude Code auto memory (MEMORY.md)',
          }
        }
        case 'codex': {
          const skillRoot = item.scope === 'global'
            ? join(this.homeDir, '.agents', 'skills')
            : join(projectPath, '.agents', 'skills')
          const skillName = this.safeName(`imported-memory-${sourceName}-${stem}`)
          return {
            path: join(skillRoot, skillName, 'SKILL.md'),
            root: item.scope === 'global' ? join(this.homeDir, '.agents') : projectPath,
            mode: 'agent-skill',
            adaptation: 'converted',
            format: 'Codex Agent Skill (memory conversion)',
            compatibilityNote: 'Codex has no native long-term memory file; the content is converted to an on-demand Skill.',
          }
        }
        case 'cursor': {
          if (item.scope === 'global') {
            const skillName = this.safeName(`imported-memory-${sourceName}-${stem}`)
            return {
              path: join(root, 'skills', skillName, 'SKILL.md'),
              root,
              mode: 'agent-skill',
              adaptation: 'converted',
              format: 'Cursor Agent Skill (memory conversion)',
              compatibilityNote: 'Cursor does not expose a portable global memory file; global memory is converted to a Skill.',
            }
          }
          return {
            path: join(projectPath, '.cursor', 'rules', 'imports', sourceName, `${stem}.mdc`),
            root: projectPath,
            mode: 'cursor-mdc',
            adaptation: 'converted',
            format: 'Cursor project MDC rule (memory conversion)',
          }
        }
        case 'openclaw': {
          const workspace = target.workspaces?.[0] ?? join(root, 'workspace')
          return item.scope === 'global'
            ? {
                path: join(workspace, 'MEMORY.md'),
                root: workspace,
                mode: 'markdown-merge',
                adaptation: 'native',
                format: 'OpenClaw curated memory (MEMORY.md)',
              }
            : {
                path: join(
                  workspace,
                  'memory',
                  `${sourceName}-${this.safeName(basename(projectPath))}-${stem}.md`,
                ),
                root: workspace,
                mode: 'markdown-file',
                adaptation: 'native',
                format: 'OpenClaw searchable workspace memory',
              }
        }
        case 'hermes-agent': {
          if (item.scope === 'project') {
            return {
              path: await this.hermesProjectContextPath(projectPath),
              root: projectPath,
              mode: 'markdown-merge',
              adaptation: 'converted',
              format: 'Hermes project context (memory conversion)',
              compatibilityNote: 'Hermes built-in memory is global; project memory is converted to project context.',
            }
          }
          const userMemory = basename(item.sourcePath).toLowerCase() === 'user.md'
          return {
            path: join(root, 'memories', userMemory ? 'USER.md' : 'MEMORY.md'),
            root,
            mode: 'hermes-memory',
            adaptation: 'native',
            format: userMemory ? 'Hermes user profile memory (USER.md)' : 'Hermes persistent memory (MEMORY.md)',
          }
        }
        case 'deepseek-tui': {
          if (item.scope === 'project') {
            return {
              path: join(projectPath, '.codewhale', 'rules', `${sourceName}-memory-${markdownName}`),
              root: projectPath,
              mode: 'markdown-file',
              adaptation: 'converted',
              format: 'CodeWhale project rule (memory conversion)',
              compatibilityNote: 'CodeWhale memory is user-global; project memory is converted to a project rule.',
            }
          }
          const memoryPath = await this.codeWhaleMemoryPath(root)
          return {
            path: memoryPath,
            root: dirname(memoryPath),
            mode: 'codewhale-memory',
            adaptation: 'native',
            format: 'CodeWhale user memory (memory.md)',
            compatibilityNote: 'CodeWhale must have its memory feature enabled for this file to be injected.',
          }
        }
      }
    }

    switch (target.id) {
      case 'claude-code':
        return item.scope === 'global'
          ? {
              path: join(root, 'CLAUDE.md'),
              root,
              mode: 'markdown-merge',
              adaptation: 'native',
              format: 'Claude Code user instructions (CLAUDE.md)',
            }
          : {
              path: join(projectPath, '.claude', 'rules', 'imports', sourceName, markdownName),
              root: projectPath,
              mode: 'markdown-file',
              adaptation: 'native',
              format: 'Claude Code project rule',
            }
      case 'codex':
        return {
          path: item.scope === 'global' ? join(root, 'AGENTS.md') : join(projectPath, 'AGENTS.md'),
          root: item.scope === 'global' ? root : projectPath,
          mode: 'markdown-merge',
          adaptation: 'native',
          format: 'Codex AGENTS.md instructions',
        }
      case 'cursor': {
        if (item.scope === 'global') {
          const skillName = this.safeName(`imported-instructions-${sourceName}-${stem}`)
          return {
            path: join(root, 'skills', skillName, 'SKILL.md'),
            root,
            mode: 'agent-skill',
            adaptation: 'converted',
            format: 'Cursor Agent Skill (global instruction conversion)',
            compatibilityNote: 'Cursor global User Rules have no documented portable file format; the content is converted to a Skill.',
          }
        }
        return {
          path: join(projectPath, '.cursor', 'rules', 'imports', sourceName, `${stem}.mdc`),
          root: projectPath,
          mode: 'cursor-mdc',
          adaptation: 'native',
          format: 'Cursor project MDC rule',
        }
      }
      case 'openclaw': {
        const workspace = target.workspaces?.[0] ?? join(root, 'workspace')
        return {
          path: join(workspace, 'AGENTS.md'),
          root: workspace,
          mode: 'markdown-merge',
          adaptation: item.scope === 'global' ? 'native' : 'converted',
          format: 'OpenClaw workspace instructions (AGENTS.md)',
          compatibilityNote: item.scope === 'project'
            ? 'OpenClaw uses an agent workspace, so project instructions are namespaced inside its workspace AGENTS.md.'
            : undefined,
        }
      }
      case 'hermes-agent':
        return item.scope === 'global'
          ? {
              path: join(root, 'SOUL.md'),
              root,
              mode: 'markdown-merge',
              adaptation: 'converted',
              format: 'Hermes global identity context (SOUL.md)',
              compatibilityNote: 'Hermes has no global AGENTS.md layer; standing guidance is merged into SOUL.md.',
            }
          : {
              path: await this.hermesProjectContextPath(projectPath),
              root: projectPath,
              mode: 'markdown-merge',
              adaptation: 'native',
              format: 'Hermes project context',
            }
      case 'deepseek-tui':
        return item.scope === 'global'
          ? {
              path: join(this.homeDir, '.agents', 'AGENTS.md'),
              root: join(this.homeDir, '.agents'),
              mode: 'markdown-merge',
              adaptation: 'native',
              format: 'CodeWhale global ~/.agents/AGENTS.md fallback',
            }
          : {
              path: join(projectPath, '.codewhale', 'rules', `${sourceName}-${markdownName}`),
              root: projectPath,
              mode: 'markdown-file',
              adaptation: 'native',
              format: 'CodeWhale project rule',
            }
    }
  }

  private isMergeMode(mode: MigrationWriteMode): boolean {
    return mode === 'markdown-merge' || mode === 'hermes-memory' || mode === 'codewhale-memory'
  }

  private async inspectDestinationState(
    destination: MigrationDestination,
  ): Promise<MigrationDestinationState> {
    const missingState: MigrationDestinationState = this.isMergeMode(destination.mode)
      ? 'merge'
      : 'ready'
    try {
      const destinationStat = await lstat(destination.path)
      const expectedTypeMatches = destination.mode === 'skill-copy'
        ? destinationStat.isDirectory()
        : destinationStat.isFile()
      if (destinationStat.isSymbolicLink() || !expectedTypeMatches) return 'conflict'
      return this.isMergeMode(destination.mode) ? 'merge' : 'exists'
    } catch {
      return missingState
    }
  }

  private async claudeProjectMemoryRoot(claudeRoot: string, projectPath: string): Promise<string> {
    const settings = await this.readJson(join(claudeRoot, 'settings.json'))
    const configured = this.stringValue(settings, 'autoMemoryDirectory')
    if (configured) {
      const expanded = this.configuredAbsolutePath(configured)
      if (expanded) return expanded
    }
    return join(claudeRoot, 'projects', sanitizePath(projectPath), 'memory')
  }

  private async hermesProjectContextPath(projectPath: string): Promise<string> {
    const candidates = [
      join(projectPath, '.hermes.md'),
      join(projectPath, 'HERMES.md'),
      join(projectPath, 'AGENTS.md'),
      join(projectPath, 'CLAUDE.md'),
      join(projectPath, '.cursorrules'),
    ]
    for (const candidate of candidates) {
      if (await this.safeExistingFile(candidate)) return candidate
    }
    return candidates[0]!
  }

  private async codeWhaleMemoryPath(codeWhaleRoot: string): Promise<string> {
    const envPath = this.env.DEEPSEEK_MEMORY_PATH
    if (envPath) {
      const expanded = this.configuredAbsolutePath(envPath)
      if (expanded) return expanded
    }

    try {
      const raw = await readFile(join(codeWhaleRoot, 'config.toml'), 'utf-8')
      const config = Bun.TOML.parse(raw) as Record<string, unknown>
      const configured = typeof config.memory_path === 'string' ? config.memory_path.trim() : ''
      if (configured) {
        const expanded = this.configuredAbsolutePath(configured)
        if (expanded) return expanded
      }
    } catch {
      // Missing or invalid target config falls back to CodeWhale's documented path.
    }

    return join(codeWhaleRoot, 'memory.md')
  }

  private async migrateItem(
    item: AgentMigrationItem,
    agentName: string,
    targetName: string,
    targetContext: AgentScanContext,
    backupRoot: string,
  ): Promise<{ changed: boolean; destinationPath: string; message?: string }> {
    const sourcePath = await this.assertReadableSource(item.sourcePath, item.agentId)
    if (item.writeMode !== 'skill-copy'
      && await this.canonicalPath(item.destinationPath) === sourcePath) {
      throw new AgentMigrationError('Source and destination resolve to the same file.', 'DESTINATION_CONFLICT')
    }
    await this.assertSafeDestination(item, item.destinationPath, targetContext)
    if (item.writeMode === 'skill-copy') {
      return this.migrateSkill(item, sourcePath, targetName, targetContext, backupRoot)
    }

    const raw = await readFile(sourcePath, 'utf-8')
    switch (item.writeMode) {
      case 'agent-skill': {
        const content = this.convertToAgentSkill(agentName, item, raw)
        const changed = await this.writeImportedFile(item.destinationPath, content, backupRoot)
        return { changed, destinationPath: item.destinationPath, message: item.compatibilityNote }
      }
      case 'cursor-mdc': {
        const content = this.convertToCursorRule(agentName, item, raw)
        const changed = await this.writeImportedFile(item.destinationPath, content, backupRoot)
        return { changed, destinationPath: item.destinationPath, message: item.compatibilityNote }
      }
      case 'hermes-memory': {
        const changed = await this.mergeHermesMemory(item, agentName, raw, backupRoot)
        return { changed, destinationPath: item.destinationPath }
      }
      case 'codewhale-memory': {
        const content = this.wrapImportedMarkdown(agentName, item, raw)
        const changed = await this.mergeImportedSection(
          item,
          content,
          backupRoot,
          CODEWHALE_MEMORY_MAX_BYTES,
        )
        const enabled = await this.codeWhaleMemoryEnabled(targetContext.roots[0]!)
        return {
          changed,
          destinationPath: item.destinationPath,
          message: enabled
            ? undefined
            : 'CodeWhale memory was migrated, but its memory feature is currently disabled in the target configuration.',
        }
      }
      case 'markdown-merge': {
        const content = this.wrapImportedMarkdown(agentName, item, raw)
        const changed = await this.mergeImportedSection(item, content, backupRoot)
        return { changed, destinationPath: item.destinationPath, message: item.compatibilityNote }
      }
      case 'markdown-file': {
        const content = this.wrapImportedMarkdown(agentName, item, raw)
        const changed = await this.writeImportedFile(item.destinationPath, content, backupRoot)
        return { changed, destinationPath: item.destinationPath, message: item.compatibilityNote }
      }
      case 'skill-copy':
        throw new AgentMigrationError('Unexpected skill migration mode.', 'MIGRATION_MODE_INVALID')
    }
  }

  private async migrateSkill(
    item: AgentMigrationItem,
    sourcePath: string,
    targetName: string,
    targetContext: AgentScanContext,
    backupRoot: string,
  ): Promise<{ changed: boolean; destinationPath: string; message?: string }> {
    const sourceDir = dirname(sourcePath)
    const sourceMetrics = await this.directoryMetrics(sourceDir)
    if (sourceMetrics.exceeded) {
      throw new AgentMigrationError(
        `Skill exceeds the ${MAX_SKILL_FILES}-file or ${MAX_SKILL_BYTES}-byte migration limit.`,
        'SOURCE_LIMIT_EXCEEDED',
      )
    }
    let destinationPath = item.destinationPath
    if (await this.pathExists(destinationPath)) {
      await this.assertExistingPathKind(destinationPath, 'directory')
      if (await this.skillDirectoriesEqual(sourceDir, destinationPath, item)) {
        return { changed: false, destinationPath, message: 'An identical skill is already installed.' }
      }
      destinationPath = `${destinationPath}-from-${item.agentId}-${this.shortHash(sourceDir)}`
    }
    await this.assertSafeDestination(item, destinationPath, targetContext)
    if (await this.pathExists(destinationPath)) {
      await this.assertExistingPathKind(destinationPath, 'directory')
      if (await this.skillDirectoriesEqual(sourceDir, destinationPath, item)) {
        return { changed: false, destinationPath, message: 'The imported skill is already up to date.' }
      }
      await this.backupPath(destinationPath, backupRoot)
      await rm(destinationPath, { recursive: true, force: true })
    }
    await mkdir(dirname(destinationPath), { recursive: true })
    const temporaryPath = `${destinationPath}.importing-${process.pid}-${Date.now()}`
    try {
      await cp(sourceDir, temporaryPath, {
        recursive: true,
        errorOnExist: true,
        force: false,
        filter: async source => {
          try {
            const sourceStat = await lstat(source)
            if (sourceStat.isSymbolicLink()) return false
            return source === sourceDir
              || !sourceStat.isDirectory()
              || !this.shouldSkipDirectory(basename(source))
          } catch {
            return false
          }
        },
      })
      if ((await this.directoryMetrics(temporaryPath)).exceeded) {
        throw new AgentMigrationError(
          `Copied skill exceeds the ${MAX_SKILL_FILES}-file or ${MAX_SKILL_BYTES}-byte migration limit.`,
          'SOURCE_LIMIT_EXCEEDED',
        )
      }
      const temporarySkillFile = join(temporaryPath, 'SKILL.md')
      const temporarySkill = await readFile(temporarySkillFile, 'utf-8')
      const normalizedSkill = this.normalizeSkillEntrypoint(temporarySkill, item)
      if (normalizedSkill !== temporarySkill) {
        await writeFile(temporarySkillFile, normalizedSkill, 'utf-8')
      }
      await rename(temporaryPath, destinationPath)
    } catch (error) {
      await rm(temporaryPath, { recursive: true, force: true }).catch(() => {})
      throw error
    }
    return {
      changed: true,
      destinationPath,
      message: destinationPath === item.destinationPath
        ? undefined
        : `The existing ${targetName} skill was preserved; the imported copy uses a source suffix.`,
    }
  }

  private async writeImportedFile(
    destinationPath: string,
    content: string,
    backupRoot: string,
  ): Promise<boolean> {
    const normalized = content.trimEnd() + '\n'
    const destinationExists = await this.pathExists(destinationPath)
    if (destinationExists) {
      await this.assertExistingPathKind(destinationPath, 'file')
      const existing = await readFile(destinationPath, 'utf-8').catch(() => '')
      if (existing === normalized) return false
      await this.backupPath(destinationPath, backupRoot)
    }
    await mkdir(dirname(destinationPath), { recursive: true })
    const temporaryPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`
    const displacedPath = `${destinationPath}.replacing-${process.pid}-${Date.now()}`
    await writeFile(temporaryPath, normalized, 'utf-8')
    try {
      if (destinationExists) await rename(destinationPath, displacedPath)
      await rename(temporaryPath, destinationPath)
      if (destinationExists) await rm(displacedPath, { force: true }).catch(() => {})
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {})
      if (destinationExists && !(await this.pathExists(destinationPath))) {
        await rename(displacedPath, destinationPath).catch(() => {})
      }
      throw error
    }
    return true
  }

  private normalizeSkillEntrypoint(raw: string, item: AgentMigrationItem): string {
    const frontmatterMatch = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
    const frontmatter = frontmatterMatch?.[1] ?? ''
    const additions: string[] = []
    if (!/^name\s*:/m.test(frontmatter)) {
      additions.push(`name: ${JSON.stringify(this.safeName(item.name))}`)
    }
    if (!/^description\s*:/m.test(frontmatter)) {
      additions.push(`description: ${JSON.stringify(`Imported ${item.name} skill from ${item.agentId}.`)}`)
    }
    if (additions.length === 0) return raw

    if (!frontmatterMatch) {
      return `---\n${additions.join('\n')}\n---\n\n${raw.trimStart()}`
    }
    const body = raw.slice(frontmatterMatch[0].length).trimStart()
    const nextFrontmatter = [frontmatter.trimEnd(), ...additions].filter(Boolean).join('\n')
    return `---\n${nextFrontmatter}\n---\n\n${body}`
  }

  private convertToAgentSkill(agentName: string, item: AgentMigrationItem, raw: string): string {
    const skillName = this.safeName(basename(dirname(item.destinationPath)))
    const scope = item.projectPath ? ` for project ${basename(item.projectPath)}` : ''
    const description = `Recall imported ${item.kind} from ${agentName}${scope} when it is relevant to the user's task.`
    return [
      '---',
      `name: ${JSON.stringify(skillName)}`,
      `description: ${JSON.stringify(description)}`,
      '---',
      '',
      this.wrapImportedMarkdown(agentName, item, this.stripFrontmatter(raw)),
    ].join('\n')
  }

  private convertToCursorRule(agentName: string, item: AgentMigrationItem, raw: string): string {
    const scope = item.projectPath ? ` for project ${basename(item.projectPath)}` : ''
    const description = `Imported ${item.kind} from ${agentName}${scope}`
    return [
      '---',
      `description: ${JSON.stringify(description)}`,
      'globs:',
      `alwaysApply: ${item.kind === 'instruction' ? 'true' : 'false'}`,
      '---',
      '',
      this.wrapImportedMarkdown(agentName, item, this.stripFrontmatter(raw)),
    ].join('\n')
  }

  private stripFrontmatter(raw: string): string {
    const match = raw.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/)
    return match ? raw.slice(match[0].length).trimStart() : raw
  }

  private async mergeHermesMemory(
    item: AgentMigrationItem,
    agentName: string,
    raw: string,
    backupRoot: string,
  ): Promise<boolean> {
    const marker = createHash('sha256').update(`${item.agentId}:${item.sourcePath}`).digest('hex').slice(0, 16)
    const start = `[cybercode-import:${marker}:start]`
    const end = `[cybercode-import:${marker}:end]`
    const entry = [
      start,
      `Imported from ${agentName}. Original file: ${item.sourcePath}`,
      this.stripFrontmatter(raw).trim(),
      end,
    ].filter(Boolean).join('\n')
    if (await this.pathExists(item.destinationPath)) {
      await this.assertExistingPathKind(item.destinationPath, 'file')
    }
    const existing = await readFile(item.destinationPath, 'utf-8').catch(() => '')
    const pattern = new RegExp(`${this.escapeRegExp(start)}[\\s\\S]*?${this.escapeRegExp(end)}`, 'm')
    const next = pattern.test(existing)
      ? existing.replace(pattern, entry)
      : `${existing.trimEnd()}${existing.trim() ? '\n\u00a7\n' : ''}${entry}\n`
    const maxChars = basename(item.destinationPath).toUpperCase() === 'USER.MD'
      ? HERMES_USER_MAX_CHARS
      : HERMES_MEMORY_MAX_CHARS
    if (next === existing) return false
    if ([...next].length > maxChars) {
      throw new AgentMigrationError(
        `Hermes ${basename(item.destinationPath)} would exceed its ${maxChars}-character limit. Shorten or split this memory before migrating it.`,
        'TARGET_FORMAT_LIMIT',
      )
    }
    if (existing) await this.backupPath(item.destinationPath, backupRoot)
    await mkdir(dirname(item.destinationPath), { recursive: true })
    await writeFile(item.destinationPath, next.trimEnd() + '\n', 'utf-8')
    return true
  }

  private async codeWhaleMemoryEnabled(codeWhaleRoot: string): Promise<boolean> {
    if (/^(1|on|true|yes|y|enabled)$/i.test(this.env.DEEPSEEK_MEMORY?.trim() ?? '')) return true
    try {
      const raw = await readFile(join(codeWhaleRoot, 'config.toml'), 'utf-8')
      const config = Bun.TOML.parse(raw) as Record<string, unknown>
      const memory = config.memory
      return Boolean(memory && typeof memory === 'object' && (memory as Record<string, unknown>).enabled === true)
    } catch {
      return false
    }
  }

  private async mergeImportedSection(
    item: AgentMigrationItem,
    content: string,
    backupRoot: string,
    maxBytes?: number,
  ): Promise<boolean> {
    const destinationPath = item.destinationPath
    const marker = createHash('sha256').update(`${item.agentId}:${item.sourcePath}`).digest('hex').slice(0, 16)
    const start = `<!-- cybercode-import:${marker}:start -->`
    const end = `<!-- cybercode-import:${marker}:end -->`
    const section = `${start}\n${content.trim()}\n${end}`
    if (await this.pathExists(destinationPath)) {
      await this.assertExistingPathKind(destinationPath, 'file')
    }
    const existing = await readFile(destinationPath, 'utf-8').catch(() => '')
    const pattern = new RegExp(`${this.escapeRegExp(start)}[\\s\\S]*?${this.escapeRegExp(end)}`, 'm')
    const next = pattern.test(existing)
      ? existing.replace(pattern, section)
      : `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${section}\n`
    if (next === existing) return false
    if (maxBytes && Buffer.byteLength(next, 'utf-8') > maxBytes) {
      throw new AgentMigrationError(
        `${basename(destinationPath)} would exceed the destination format's ${maxBytes}-byte limit.`,
        'TARGET_FORMAT_LIMIT',
      )
    }
    if (existing) await this.backupPath(destinationPath, backupRoot)
    await mkdir(dirname(destinationPath), { recursive: true })
    await writeFile(destinationPath, next.trimEnd() + '\n', 'utf-8')
    return true
  }

  private wrapImportedMarkdown(agentName: string, item: AgentMigrationItem, raw: string): string {
    const body = extname(item.sourcePath).toLowerCase() === '.json'
      ? `\`\`\`json\n${raw.trim()}\n\`\`\``
      : raw.trim()
    return [
      `# ${item.name}`,
      '',
      `> Imported from ${agentName}. Original file: ${item.sourcePath}`,
      '',
      body,
    ].join('\n')
  }

  private async backupPath(targetPath: string, backupRoot: string): Promise<void> {
    if (!(await this.pathExists(targetPath))) return
    const suffix = createHash('sha256').update(targetPath).digest('hex').slice(0, 12)
    const backupPath = join(backupRoot, `${suffix}-${basename(targetPath)}`)
    if (await this.pathExists(backupPath)) return
    await mkdir(dirname(backupPath), { recursive: true })
    const targetStat = await lstat(targetPath)
    if (targetStat.isDirectory()) {
      await cp(targetPath, backupPath, { recursive: true, force: false })
    } else {
      await copyFile(targetPath, backupPath)
    }
  }

  private async appendMigrationLog(request: AgentMigrationRequest, result: AgentMigrationResult): Promise<void> {
    const logPath = join(this.cyberConfigDir, 'migrations', 'history.jsonl')
    await mkdir(dirname(logPath), { recursive: true })
    await appendFile(logPath, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      agentId: request.agentId,
      targetAgentId: request.targetAgentId ?? 'cybercode',
      requestedItems: request.itemIds?.length ?? 0,
      requestedProjects: request.projectIds?.length ?? 0,
      allRecommended: request.allRecommended === true,
      imported: result.imported,
      skipped: result.skipped,
      failed: result.failed,
      registeredProjects: result.registeredProjects,
    })}\n`, 'utf-8')
  }

  private async discoverOpenClawWorkspaces(openClawRoot: string): Promise<string[]> {
    const workspaces: string[] = []
    const configPath = this.env.OPENCLAW_CONFIG_PATH
      ? this.expandHome(this.env.OPENCLAW_CONFIG_PATH)
      : join(openClawRoot, 'openclaw.json')
    const config = await this.readJson5(configPath)
    const defaults = this.objectValue(this.objectValue(config, 'agents'), 'defaults')
    const defaultWorkspace = this.stringValue(defaults, 'workspace')
    const configuredDefault = defaultWorkspace
      ? this.configuredAbsolutePath(defaultWorkspace)
      : null
    if (configuredDefault) workspaces.push(configuredDefault)
    const envWorkspace = this.env.OPENCLAW_WORKSPACE_DIR
      ? this.configuredAbsolutePath(this.env.OPENCLAW_WORKSPACE_DIR)
      : null
    if (envWorkspace) workspaces.push(envWorkspace)
    const profile = this.env.OPENCLAW_PROFILE?.trim()
    workspaces.push(join(
      openClawRoot,
      profile && profile !== 'default' ? `workspace-${this.safeName(profile)}` : 'workspace',
    ))
    const agents = this.objectValue(config, 'agents')?.list
    if (Array.isArray(agents)) {
      for (const agent of agents) {
        if (!agent || typeof agent !== 'object') continue
        const workspace = this.stringValue(agent as Record<string, unknown>, 'workspace')
        const configured = workspace ? this.configuredAbsolutePath(workspace) : null
        if (configured) workspaces.push(configured)
      }
    }
    return this.uniquePaths(workspaces)
  }

  private async discoverHermesRoots(): Promise<string[]> {
    const configured = this.env.HERMES_HOME
      ? this.expandHome(this.env.HERMES_HOME)
      : ''
    const accountDefault = join(this.homeDir, '.hermes')
    const windowsDefault = this.platform === 'win32' && this.env.LOCALAPPDATA
      ? join(this.env.LOCALAPPDATA, 'hermes')
      : ''
    const candidates = this.uniquePaths([
      configured,
      windowsDefault,
      accountDefault,
    ])
    const primary = configured
      || await this.firstExistingPath(candidates)
      || windowsDefault
      || accountDefault
    const roots: string[] = []

    if (!configured) {
      for (const base of candidates) {
        const profileName = (await readFile(join(base, 'active_profile'), 'utf-8').catch(() => '')).trim()
        if (!this.isSafeProfileName(profileName)) continue
        const profileRoot = join(base, 'profiles', profileName)
        if (await this.isDirectory(profileRoot)) {
          roots.push(profileRoot)
          break
        }
      }
    }
    roots.push(primary, ...candidates)
    for (const base of candidates) {
      try {
        const profiles = await readdir(join(base, 'profiles'), { withFileTypes: true })
        for (const profile of profiles) {
          if (profile.isDirectory() && !profile.isSymbolicLink()) {
            roots.push(join(base, 'profiles', profile.name))
          }
        }
      } catch {
        // Profiles are optional.
      }
    }
    return this.uniquePaths(roots)
  }

  private async discoverSkillFiles(root: string): Promise<string[]> {
    return this.walkFiles(root, {
      names: new Set(['SKILL.md']),
      maxDepth: 6,
      maxFiles: 500,
    })
  }

  private async walkFiles(
    root: string,
    options: {
      extensions?: Set<string>
      names?: Set<string>
      maxDepth: number
      maxFiles?: number
    },
  ): Promise<string[]> {
    const files: string[] = []
    const maxFiles = Math.min(options.maxFiles ?? MAX_SCAN_FILES, MAX_SCAN_FILES)
    let visitedEntries = 0

    const walk = async (current: string, depth: number): Promise<void> => {
      if (depth > options.maxDepth || files.length >= maxFiles || visitedEntries >= MAX_SCAN_ENTRIES) return
      let entries: import('fs').Dirent[]
      try {
        entries = await readdir(current, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        visitedEntries += 1
        if (files.length >= maxFiles || visitedEntries > MAX_SCAN_ENTRIES) break
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory() && this.shouldSkipDirectory(entry.name)) continue
        const filePath = join(current, entry.name)
        if (entry.isDirectory()) {
          await walk(filePath, depth + 1)
          continue
        }
        if (!entry.isFile()) continue
        const matchesName = options.names?.has(entry.name) ?? false
        const matchesExtension = options.extensions?.has(extname(entry.name).toLowerCase()) ?? false
        if (matchesName || matchesExtension) files.push(filePath)
      }
    }

    await walk(root, 0)
    return files
  }

  private async directoryMetrics(root: string): Promise<{
    sizeBytes: number
    fileCount: number
    exceeded: boolean
  }> {
    let sizeBytes = 0
    let fileCount = 0
    let visitedEntries = 0
    let exceeded = false
    const walk = async (current: string): Promise<void> => {
      if (exceeded) return
      let entries: import('fs').Dirent[]
      try {
        entries = await readdir(current, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        visitedEntries += 1
        if (visitedEntries > MAX_SCAN_ENTRIES) {
          exceeded = true
          break
        }
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory() && this.shouldSkipDirectory(entry.name)) continue
        const candidate = join(current, entry.name)
        if (entry.isDirectory()) await walk(candidate)
        else if (entry.isFile()) {
          fileCount += 1
          try {
            sizeBytes += (await stat(candidate)).size
          } catch {
            exceeded = true
          }
        }
        if (fileCount > MAX_SKILL_FILES || sizeBytes > MAX_SKILL_BYTES) {
          exceeded = true
          break
        }
      }
    }
    await walk(root)
    return { sizeBytes, fileCount, exceeded }
  }

  private async skillDirectoriesEqual(
    sourceRoot: string,
    destinationRoot: string,
    item: AgentMigrationItem,
  ): Promise<boolean> {
    const list = async (root: string) => {
      const files = new Map<string, string>()
      let visitedEntries = 0
      const walk = async (current: string): Promise<void> => {
        const entries = await readdir(current, { withFileTypes: true })
        for (const entry of entries) {
          visitedEntries += 1
          if (visitedEntries > MAX_SCAN_ENTRIES || files.size > MAX_SKILL_FILES) {
            throw new Error('Skill directory exceeds comparison limits.')
          }
          if (entry.isSymbolicLink()) continue
          if (entry.isDirectory() && this.shouldSkipDirectory(entry.name)) continue
          const candidate = join(current, entry.name)
          if (entry.isDirectory()) await walk(candidate)
          else if (entry.isFile()) files.set(relative(root, candidate), candidate)
        }
      }
      await walk(root)
      if (files.size > MAX_SKILL_FILES) throw new Error('Skill directory exceeds comparison limits.')
      return files
    }
    try {
      const sourceFiles = await list(sourceRoot)
      const destinationFiles = await list(destinationRoot)
      if (sourceFiles.size !== destinationFiles.size) return false
      for (const [relativePath, sourceFile] of sourceFiles) {
        const destinationFile = destinationFiles.get(relativePath)
        if (!destinationFile) return false
        const source = relativePath === 'SKILL.md'
          ? Buffer.from(this.normalizeSkillEntrypoint(await readFile(sourceFile, 'utf-8'), item))
          : await readFile(sourceFile)
        const destination = await readFile(destinationFile)
        if (!source.equals(destination)) return false
      }
      return true
    } catch {
      return false
    }
  }

  private async skillName(skillFile: string): Promise<string> {
    try {
      const content = await readFile(skillFile, 'utf-8')
      const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/)
      const name = frontmatter?.[1]?.match(/^name:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim()
      return name || basename(dirname(skillFile))
    } catch {
      return basename(dirname(skillFile))
    }
  }

  private memoryDestination(agentId: ExternalAgentId, sourcePath: string, workDir: string): string {
    const fileName = `${this.safeName(basename(sourcePath, extname(sourcePath)))}-${this.shortHash(sourcePath)}.md`
    return join(
      this.cyberConfigDir,
      'projects',
      sanitizePath(workDir),
      'memory',
      'imports',
      agentId,
      fileName,
    )
  }

  private projectRuleDestination(agentId: ExternalAgentId, projectPath: string, sourcePath: string): string {
    const fileName = `${this.safeName(basename(sourcePath, extname(sourcePath)))}-${this.shortHash(sourcePath)}.md`
    return getProjectConfigPath(projectPath, 'rules', 'imports', agentId, fileName)
  }

  private itemId(agentId: ExternalAgentId, kind: MigrationItemKind, sourcePath: string, projectPath: string | null): string {
    return createHash('sha256')
      .update(`${agentId}\0${kind}\0${sourcePath}\0${projectPath ?? ''}`)
      .digest('hex')
      .slice(0, 24)
  }

  private projectId(agentId: ExternalAgentId, projectPath: string): string {
    return createHash('sha256')
      .update(`${agentId}\0project\0${projectPath}`)
      .digest('hex')
      .slice(0, 24)
  }

  private shortHash(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 8)
  }

  private shouldSkipDirectory(name: string): boolean {
    return SKIP_DIRS.has(name) || name.includes('.importing-')
  }

  private safeName(value: string): string {
    const normalized = value.normalize('NFC').toLowerCase()
    const hash = this.shortHash(normalized)
    let candidate = normalized
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^[.]+|[.]+$/g, '')

    if (/[^\x00-\x7f]/.test(normalized)) {
      candidate = candidate
        ? `${candidate.slice(0, 70)}-${hash}`
        : `imported-${hash}`
    }
    if (!candidate || candidate === '.' || candidate === '..') {
      candidate = `imported-${hash}`
    }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(candidate)) {
      candidate = `imported-${candidate}`
    }
    candidate = candidate.slice(0, 80).replace(/[. ]+$/g, '')
    return candidate || `imported-${hash}`
  }

  private extractWorkDir(content: string): string | null {
    for (const line of content.split('\n').slice(0, 80)) {
      try {
        const parsed = JSON.parse(line) as unknown
        const found = this.findStringField(parsed, new Set(['cwd', 'workDir', 'work_dir']))
        if (found) return found
      } catch {
        // Some session formats are JSON rather than JSONL; regex fallback follows.
      }
    }
    const match = content.match(/"(?:cwd|workDir|work_dir)"\s*:\s*"((?:\\.|[^"\\])*)"/)
    if (!match?.[1]) return null
    try {
      return JSON.parse(`"${match[1]}"`) as string
    } catch {
      return match[1]
    }
  }

  private findStringField(value: unknown, keys: Set<string>, depth = 0): string | null {
    if (!value || typeof value !== 'object' || depth > 5) return null
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 20)) {
        const found = this.findStringField(item, keys, depth + 1)
        if (found) return found
      }
      return null
    }
    const record = value as Record<string, unknown>
    for (const key of keys) {
      if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim()
    }
    for (const nested of Object.values(record).slice(0, 30)) {
      const found = this.findStringField(nested, keys, depth + 1)
      if (found) return found
    }
    return null
  }

  private async readPrefix(filePath: string): Promise<string> {
    return this.readUtf8Prefix(filePath, SESSION_PREFIX_BYTES, true)
  }

  private async readUtf8Prefix(filePath: string, maxBytes: number, quiet = false): Promise<string> {
    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      handle = await open(filePath, 'r')
      const buffer = Buffer.allocUnsafe(maxBytes)
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
      return buffer.subarray(0, bytesRead).toString('utf-8')
    } catch (error) {
      if (quiet) return ''
      throw error
    } finally {
      await handle?.close().catch(() => {})
    }
  }

  private async assertReadableSource(
    sourcePath: string,
    sourceAgentId: ExternalAgentId,
  ): Promise<string> {
    const canonical = await realpath(sourcePath).catch(() => '')
    const canonicalCyberConfigDir = await this.canonicalPath(this.cyberConfigDir)
    if (!canonical || (sourceAgentId !== 'cybercode' && this.isInside(canonical, canonicalCyberConfigDir))) {
      throw new AgentMigrationError('The source item is no longer available.', 'SOURCE_UNAVAILABLE', 404)
    }
    const sourceStat = await lstat(canonical)
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new AgentMigrationError('The source item is not a regular file.', 'SOURCE_INVALID')
    }
    return canonical
  }

  private async assertSafeDestination(
    item: AgentMigrationItem,
    destinationPath: string,
    targetContext: AgentScanContext,
  ): Promise<void> {
    const allowedRoots = this.uniquePaths([
      ...targetContext.roots,
      ...(targetContext.destinationRoots ?? []),
      ...(targetContext.workspaces ?? []),
      item.destinationRoot,
      item.projectPath ?? '',
    ])
    const root = allowedRoots
      .filter(candidate => this.isInside(destinationPath, candidate))
      .sort((a, b) => b.length - a.length)[0]
    if (!root) {
      throw new AgentMigrationError('Migration destination escaped the destination agent data root.', 'DESTINATION_INVALID')
    }

    let current = resolve(destinationPath)
    const stop = resolve(root)
    while (true) {
      try {
        if ((await lstat(current)).isSymbolicLink()) {
          throw new AgentMigrationError('Migration destination contains a symbolic link.', 'DESTINATION_SYMLINK')
        }
      } catch (error) {
        if (error instanceof AgentMigrationError) throw error
      }
      if (current === stop) break
      const parent = dirname(current)
      if (parent === current) {
        throw new AgentMigrationError('Migration destination root could not be verified.', 'DESTINATION_INVALID')
      }
      current = parent
    }
  }

  private async safeExistingFile(filePath: string): Promise<string | null> {
    try {
      const fileStat = await lstat(filePath)
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) return null
      return await realpath(filePath)
    } catch {
      return null
    }
  }

  private async assertExistingPathKind(
    filePath: string,
    expected: 'file' | 'directory',
  ): Promise<void> {
    const fileStat = await lstat(filePath)
    if (fileStat.isSymbolicLink()) {
      throw new AgentMigrationError('Migration destination contains a symbolic link.', 'DESTINATION_SYMLINK')
    }
    const matches = expected === 'file' ? fileStat.isFile() : fileStat.isDirectory()
    if (!matches) {
      throw new AgentMigrationError(
        `Migration destination is not a ${expected}. Existing data was left unchanged.`,
        'DESTINATION_TYPE_CONFLICT',
      )
    }
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await lstat(filePath)
      return true
    } catch {
      return false
    }
  }

  private async isDirectory(filePath: string): Promise<boolean> {
    try {
      const fileStat = await stat(filePath)
      return fileStat.isDirectory()
    } catch {
      return false
    }
  }

  private async existingPaths(paths: string[]): Promise<string[]> {
    const existing: string[] = []
    for (const candidate of this.uniquePaths(paths)) {
      if (await this.isDirectory(candidate)) existing.push(candidate)
    }
    return existing
  }

  private async firstExistingPath(paths: string[]): Promise<string | null> {
    for (const candidate of paths) {
      if (await this.isDirectory(candidate)) return candidate
    }
    return null
  }

  private async pathModifiedAt(filePath: string): Promise<string | null> {
    try {
      return (await stat(filePath)).mtime.toISOString()
    } catch {
      return null
    }
  }

  private async canonicalPath(filePath: string): Promise<string> {
    return (await realpath(filePath).catch(() => resolve(filePath))).normalize('NFC')
  }

  private expandHome(filePath: string): string {
    if (!filePath) return ''
    if (filePath === '~') return this.homeDir
    if (filePath.startsWith(`~${sep}`) || filePath.startsWith('~/') || filePath.startsWith('~\\')) {
      return join(this.homeDir, filePath.slice(2))
    }
    return resolve(filePath)
  }

  private configuredAbsolutePath(filePath: string): string | null {
    const trimmed = filePath.trim()
    if (!trimmed) return null
    if (trimmed === '~'
      || trimmed.startsWith(`~${sep}`)
      || trimmed.startsWith('~/')
      || trimmed.startsWith('~\\')) {
      return this.expandHome(trimmed)
    }
    return isAbsolute(trimmed) ? resolve(trimmed) : null
  }

  private isSafeProfileName(value: string): boolean {
    return Boolean(value)
      && value !== '.'
      && value !== '..'
      && /^[a-zA-Z0-9._-]+$/.test(value)
  }

  private uniquePaths(paths: string[]): string[] {
    return [...new Set(paths.filter(Boolean).map(path => resolve(path).normalize('NFC')))]
  }

  private isInside(candidate: string, root: string): boolean {
    const rel = relative(resolve(root), resolve(candidate))
    return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
  }

  private async readJson(filePath: string): Promise<Record<string, unknown> | null> {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf-8')) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null
    } catch {
      return null
    }
  }

  private async readJson5(filePath: string): Promise<Record<string, unknown> | null> {
    try {
      const parsed = JSON5.parse(await readFile(filePath, 'utf-8')) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null
    } catch {
      return null
    }
  }

  private objectValue(record: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
    const value = record?.[key]
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  }

  private stringValue(record: Record<string, unknown> | null, key: string): string | null {
    const value = record?.[key]
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}

export const agentMigrationService = new AgentMigrationService()
