import { createHash, randomBytes } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path'
import { homedir } from 'node:os'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import type {
  PortableProjectEntry,
  PortableProjectRegistry,
  PortableRuntimeInfo,
} from '../../utils/portablePaths.js'
import {
  sessionService,
  type PortablePathRepairResult,
} from './sessionService.js'
import {
  backgroundScheduler,
  type BackgroundScheduler,
} from '../background/scheduler.js'
import { verifyPortableSignature } from './portableSignature.js'

export const USB_PORTABLE_DIRECTORY_NAME = 'CyberCode-Portable'
export const USB_PORTABLE_MARKER = '.cybercode-portable'

export type UsbMigrationPlatform =
  | 'macos-arm64'
  | 'macos-x64'
  | 'windows-x64'
  | 'linux-x64'

export type PortableArchiveType = 'app-tar-gz' | 'zip' | 'appimage'

export type PortableReleaseAsset = {
  filename: string
  size: number
  sha256: string
  signature: string
  archiveType: PortableArchiveType
  urls?: string[]
}

export type PortableReleaseManifest = {
  schemaVersion: 2
  version: string
  generatedAt: string
  platforms: Record<UsbMigrationPlatform, PortableReleaseAsset>
}

export type UsbMigrationProject = {
  id: string
  name: string
  path: string
  sizeBytes: number
  modifiedAt: string
  sessionCount: number
}

export type UsbMigrationScan = {
  scannedAt: string
  configPath: string
  configSizeBytes: number
  projects: UsbMigrationProject[]
  currentPlatform: UsbMigrationPlatform | null
  release: {
    version: string
    generatedAt: string
    platforms: Partial<Record<UsbMigrationPlatform, {
      filename: string
      sizeBytes: number
      archiveType: PortableArchiveType
    }>>
  } | null
  releaseError: string | null
}

export type UsbMigrationStage =
  | 'queued'
  | 'preparing'
  | 'config'
  | 'projects'
  | 'applications'
  | 'launchers'
  | 'finalizing'
  | 'cleanup'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type UsbMigrationJob = {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  stage: UsbMigrationStage
  destinationPath: string
  portablePath: string
  currentItem: string | null
  processedBytes: number
  totalBytes: number
  progressPercent: number
  warnings: string[]
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type UsbMigrationRecoveryStatus = {
  state: 'idle' | 'running' | 'completed' | 'waiting-for-drive' | 'failed'
  totalJobs: number
  recoveredJobs: number
  waitingJobs: number
  failedJobs: number
  updatedAt: string
  lastError: string | null
}

export type StartUsbMigrationInput = {
  destinationPath: string
  projectIds?: string[]
  platforms?: UsbMigrationPlatform[]
  includeApplications?: boolean
  replaceExisting?: boolean
}

type ResolvedPortableRelease = {
  manifest: PortableReleaseManifest
  sourceUrl: string
}

export type UsbMigrationServiceOptions = {
  configDir?: string
  discoverProjects?: (signal?: AbortSignal) => Promise<Array<{
    path: string
    modifiedAt?: string
    sessionCount?: number
  }>>
  fetchImpl?: typeof fetch
  manifestUrls?: string[]
  resolveRelease?: () => Promise<ResolvedPortableRelease | null>
  availableBytes?: (path: string) => Promise<number | null>
  downloadStallTimeoutMs?: number
  now?: () => Date
  idFactory?: () => string
  backgroundScheduler?: BackgroundScheduler
  verifyAssetSignature?: (digest: Uint8Array, signature: string) => boolean
  recoveryParentCandidates?: (input: {
    jobId: string
    previousParent: string
    relativeParent: string
    markerName: string
  }) => Promise<string[]>
  copyChunkHook?: (event: {
    sourcePath: string
    destinationPath: string
    bytesCopied: number
    chunkBytes: number
    totalBytes: number
    signal: AbortSignal
  }) => void | Promise<void>
}

type InternalJob = UsbMigrationJob & {
  controller: AbortController
  completion: Promise<void>
  schedulerTaskId: string | null
  stagingPath: string
  backupPath: string
  journalSequence: number
  existingMoved: boolean
}

type UsbMigrationJournalPhase =
  | 'preparing'
  | 'copying'
  | 'prepared'
  | 'committing'
  | 'completed'
  | 'interrupted'
  | 'cancelled'

type UsbMigrationJournal = {
  schemaVersion: 1 | 2
  sequence: number
  jobId: string
  phase: UsbMigrationJournalPhase
  portablePath: string
  stagingPath: string
  backupPath: string
  existingMoved: boolean
  updatedAt: string
  volumeRelativeParent?: string
  volumeMarkerName?: string
}

type UsbMigrationRecoveryOutcome = 'recovered' | 'waiting-for-drive'

type CopyContext = {
  job: InternalJob
  signal: AbortSignal
  advance: (bytes: number) => void
  setCurrentItem: (item: string) => void
  afterCopyChunk?: NonNullable<UsbMigrationServiceOptions['copyChunkHook']>
}

type TreeCopyScope = 'config' | 'project'

type CopyEntryMetadata = {
  source: string
  destination: string
  mode: number
  atime: Date
  mtime: Date
}

type CopyPlan = {
  directories: CopyEntryMetadata[]
  files: Array<CopyEntryMetadata & { size: number }>
  symlinks: Array<{ source: string; destination: string }>
}

const DEFAULT_MANIFEST_URLS = [
  'https://github.com/wk42worldworld/cybercode/releases/latest/download/portable.json',
  'https://gh-proxy.com/https://github.com/wk42worldworld/cybercode/releases/latest/download/portable.json',
  'https://ghfast.top/https://github.com/wk42worldworld/cybercode/releases/latest/download/portable.json',
]
const MANIFEST_TIMEOUT_MS = 8_000
const DOWNLOAD_STALL_TIMEOUT_MS = 30_000
const SCAN_CACHE_TTL_MS = 20_000
const MIN_FREE_SPACE_RESERVE_BYTES = 256 * 1024 * 1024
const MAX_PORTABLE_ASSET_BYTES = 2 * 1024 * 1024 * 1024
const COPY_CONCURRENCY = 4
const COPY_CHUNK_BYTES = 1024 * 1024
const USB_MIGRATION_JOURNAL_DIRECTORY = 'usb-migration-journal'
const USB_MIGRATION_RECOVERY_MARKER_PREFIX = '.cybercode-usb-migration-'
const USB_MIGRATION_JOURNAL_PHASES = new Set<UsbMigrationJournalPhase>([
  'preparing',
  'copying',
  'prepared',
  'committing',
  'completed',
  'interrupted',
  'cancelled',
])
const CONFIG_CACHE_DIRECTORIES = new Set([
  '.runtime',
  'cache',
  'indexes',
  'logs',
  'shell-snapshots',
  'telemetry',
  'tmp',
])
const PROJECT_GENERATED_DIRECTORIES = new Set([
  '.angular',
  '.cache',
  '.codegraph',
  '.gradle',
  '.mypy_cache',
  '.next',
  '.nuxt',
  '.parcel-cache',
  '.playwright-cli',
  '.pytest_cache',
  '.ruff_cache',
  '.svelte-kit',
  '.tox',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'cmake-build-debug',
  'cmake-build-release',
  'coverage',
  'deriveddata',
  'dist',
  'node_modules',
  'out',
  'pods',
  'target',
  'venv',
])
const VALID_PLATFORMS = new Set<UsbMigrationPlatform>([
  'macos-arm64',
  'macos-x64',
  'windows-x64',
  'linux-x64',
])

export class UsbMigrationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'UsbMigrationError'
  }
}

export class UsbMigrationService {
  private readonly configDir: string
  private readonly discoverProjectsImpl: UsbMigrationServiceOptions['discoverProjects']
  private readonly fetchImpl: typeof fetch
  private readonly manifestUrls: string[]
  private readonly resolveReleaseImpl?: UsbMigrationServiceOptions['resolveRelease']
  private readonly availableBytesImpl: (path: string) => Promise<number | null>
  private readonly downloadStallTimeoutMs: number
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly backgroundScheduler: BackgroundScheduler
  private readonly verifyAssetSignature: NonNullable<UsbMigrationServiceOptions['verifyAssetSignature']>
  private readonly recoveryParentCandidates: NonNullable<UsbMigrationServiceOptions['recoveryParentCandidates']>
  private readonly copyChunkHook?: UsbMigrationServiceOptions['copyChunkHook']
  private readonly jobs = new Map<string, InternalJob>()
  private readonly scanConsumers = new Map<string, number>()
  private readonly targetReservations = new Map<string, string>()
  private acceptingJobs = true
  private recoveryPromise: Promise<void> | null = null
  private recoveryStatus: UsbMigrationRecoveryStatus
  private scanCache: { at: number; value: UsbMigrationScan; release: ResolvedPortableRelease | null } | null = null

  constructor(options: UsbMigrationServiceOptions = {}) {
    this.configDir = options.configDir ?? getClaudeConfigHomeDir()
    this.discoverProjectsImpl = options.discoverProjects
    this.fetchImpl = options.fetchImpl ?? fetch
    this.manifestUrls = options.manifestUrls ?? DEFAULT_MANIFEST_URLS
    this.resolveReleaseImpl = options.resolveRelease
    this.availableBytesImpl = options.availableBytes ?? availableBytes
    this.downloadStallTimeoutMs = Math.max(
      1,
      options.downloadStallTimeoutMs ?? DOWNLOAD_STALL_TIMEOUT_MS,
    )
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => randomBytes(12).toString('hex'))
    this.backgroundScheduler = options.backgroundScheduler ?? backgroundScheduler
    this.verifyAssetSignature = options.verifyAssetSignature ?? verifyPortableSignature
    this.recoveryParentCandidates = options.recoveryParentCandidates
      ?? defaultRecoveryParentCandidates
    this.copyChunkHook = options.copyChunkHook
    this.recoveryStatus = {
      state: 'idle',
      totalJobs: 0,
      recoveredJobs: 0,
      waitingJobs: 0,
      failedJobs: 0,
      updatedAt: this.now().toISOString(),
      lastError: null,
    }
  }

  getPortablePathStatus(): PortableRuntimeInfo {
    return sessionService.getPortablePathStatus()
  }

  getRecoveryStatus(): UsbMigrationRecoveryStatus {
    return { ...this.recoveryStatus }
  }

  repairPortableProjectPaths(): Promise<PortablePathRepairResult> {
    return sessionService.repairPortableProjectPaths()
  }

  async scan(force = false, signal?: AbortSignal): Promise<UsbMigrationScan> {
    signal?.throwIfAborted()
    if (
      !force
      && this.scanCache
      && Date.now() - this.scanCache.at < SCAN_CACHE_TTL_MS
    ) {
      return this.scanCache.value
    }

    const handle = this.backgroundScheduler.enqueue({
      type: 'usb-migration-scan',
      key: this.configDir,
      priority: 1,
      lane: 'disk-read',
      resourceKey: `usb-scan:${this.configDir}`,
      dedupe: 'join',
      run: async (context) => {
        const [configSizeBytes, projects, releaseResult] = await Promise.all([
          measureTree(this.configDir, 'config', context.signal).catch(error => {
            if (context.signal.aborted) throw context.signal.reason
            return 0
          }),
          this.discoverProjects(context.signal),
          this.resolveRelease(context.signal)
            .then(release => ({ release, error: null as string | null }))
            .catch(error => {
              if (context.signal.aborted) throw context.signal.reason
              return {
                release: null,
                error: error instanceof Error ? error.message : String(error),
              }
            }),
        ])
        context.signal.throwIfAborted()
        await context.checkpoint({ stage: 'scanned', projectCount: projects.length })

        const value: UsbMigrationScan = {
          scannedAt: this.now().toISOString(),
          configPath: this.configDir,
          configSizeBytes,
          projects,
          currentPlatform: currentPlatformKey(),
          release: releaseResult.release
            ? releaseSummary(releaseResult.release.manifest)
            : null,
          releaseError: releaseResult.error,
        }
        this.scanCache = {
          at: Date.now(),
          value,
          release: releaseResult.release,
        }
        return value
      },
    })

    this.scanConsumers.set(
      handle.id,
      (this.scanConsumers.get(handle.id) ?? 0) + 1,
    )
    let callerAborted = false
    let abortListener: (() => void) | undefined
    const callerAbort = signal
      ? new Promise<never>((_resolve, reject) => {
          abortListener = () => {
            if (callerAborted) return
            callerAborted = true
            reject(signal.reason instanceof Error
              ? signal.reason
              : new DOMException('USB migration scan cancelled', 'AbortError'))
          }
          signal.addEventListener('abort', abortListener, { once: true })
          if (signal.aborted) abortListener()
        })
      : null

    try {
      return await (callerAbort
        ? Promise.race([handle.promise, callerAbort])
        : handle.promise)
    } finally {
      if (abortListener) signal?.removeEventListener('abort', abortListener)
      const remaining = Math.max(0, (this.scanConsumers.get(handle.id) ?? 1) - 1)
      if (remaining === 0) {
        this.scanConsumers.delete(handle.id)
        if (callerAborted) handle.cancel(signal?.reason)
      } else {
        this.scanConsumers.set(handle.id, remaining)
      }
    }
  }

  async start(
    input: StartUsbMigrationInput,
    signal?: AbortSignal,
  ): Promise<UsbMigrationJob> {
    signal?.throwIfAborted()
    if (!this.acceptingJobs) {
      throw new UsbMigrationError(
        'SERVICE_SHUTTING_DOWN',
        '迁移服务正在关闭，请重新启动 CyberCode 后重试。',
        503,
      )
    }
    await this.recoverInterruptedMigrations()
    signal?.throwIfAborted()
    const destinationPath = await this.validateDestination(input.destinationPath)
    signal?.throwIfAborted()
    const portablePath = resolvePortablePath(destinationPath)
    const jobId = this.idFactory()
    const reservationOwner = `migration:${jobId}`
    if (!this.reserveTarget(portablePath, reservationOwner)) {
      throw new UsbMigrationError(
        'MIGRATION_ALREADY_RUNNING',
        '该目标位置已有迁移任务正在运行或恢复。',
        409,
      )
    }
    let reservationTransferred = false
    try {
      const scan = await this.scan(false, signal)
      signal?.throwIfAborted()
      const selectedProjects = selectProjects(scan.projects, input.projectIds)
      const includeApplications = input.includeApplications !== false
      const selectedPlatforms = includeApplications
        ? normalizePlatforms(input.platforms)
        : []
      const release = includeApplications ? this.scanCache?.release ?? null : null

      if (includeApplications && !release) {
        throw new UsbMigrationError(
          'PORTABLE_RELEASE_UNAVAILABLE',
          '当前 Release 尚未提供跨平台便携运行包，请稍后重试或暂时关闭“包含应用本体”。',
          503,
        )
      }

      const assets = selectedPlatforms.map(platform => {
        const asset = release?.manifest.platforms[platform]
        if (!asset) {
          throw new UsbMigrationError(
            'PLATFORM_ASSET_UNAVAILABLE',
            `当前 Release 缺少 ${platform} 便携运行包。`,
            503,
          )
        }
        return { platform, asset }
      })

      await this.validateSourceBoundaries(destinationPath, portablePath, selectedProjects)
      signal?.throwIfAborted()
      const exists = await pathExists(portablePath)
      signal?.throwIfAborted()
      if (exists && !(await isRecognizedPortableBundle(portablePath))) {
        throw new UsbMigrationError(
          'DESTINATION_CONFLICT',
          `${portablePath} 已存在且不是 CyberCode 便携包。`,
          409,
        )
      }
      signal?.throwIfAborted()
      if (exists && input.replaceExisting !== true) {
        throw new UsbMigrationError(
          'PORTABLE_BUNDLE_EXISTS',
          '目标位置已有 CyberCode 便携包，请确认更新后重试。',
          409,
        )
      }

      const totalBytes = scan.configSizeBytes
        + selectedProjects.reduce((sum, project) => sum + project.sizeBytes, 0)
        + assets.reduce((sum, item) => sum + item.asset.size, 0)
      const freeBytes = await this.availableBytesImpl(destinationPath)
      signal?.throwIfAborted()
      const requiredBytes = totalBytes + MIN_FREE_SPACE_RESERVE_BYTES
      if (freeBytes !== null && freeBytes < requiredBytes) {
        throw new UsbMigrationError(
          'INSUFFICIENT_SPACE',
          `目标磁盘空间不足，需要至少 ${requiredBytes} 字节，可用 ${freeBytes} 字节。`,
          409,
        )
      }

      const timestamp = this.now().toISOString()
      const portableParent = dirname(portablePath)
      signal?.throwIfAborted()
      const job: InternalJob = {
        id: jobId,
        status: 'queued',
        stage: 'queued',
        destinationPath,
        portablePath,
        currentItem: null,
        processedBytes: 0,
        totalBytes,
        progressPercent: 0,
        warnings: [],
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
        controller: new AbortController(),
        completion: Promise.resolve(),
        schedulerTaskId: null,
        stagingPath: join(
          portableParent,
          `.${USB_PORTABLE_DIRECTORY_NAME}.tmp-${jobId}`,
        ),
        backupPath: join(
          portableParent,
          `.${USB_PORTABLE_DIRECTORY_NAME}.backup-${jobId}`,
        ),
        journalSequence: 0,
        existingMoved: false,
      }
      signal?.throwIfAborted()
      const handle = this.backgroundScheduler.enqueue({
        type: 'usb-migration',
        key: job.id,
        priority: 1,
        lane: 'disk-write',
        resourceKey: migrationVolumeResourceKey(job.portablePath),
        dedupe: 'drop',
        run: async (context) => {
          const abortJob = () => {
            if (!job.controller.signal.aborted) job.controller.abort(context.signal.reason)
          }
          context.signal.addEventListener('abort', abortJob, { once: true })
          try {
            context.signal.throwIfAborted()
            await this.runJob(job, {
              projects: selectedProjects,
              assets,
              release,
              replaceExisting: input.replaceExisting === true,
            })
          } finally {
            context.signal.removeEventListener('abort', abortJob)
          }
        },
      })
      this.jobs.set(job.id, job)
      job.schedulerTaskId = handle.id
      job.completion = handle.promise
        .catch(error => {
          if (job.status !== 'queued' && job.status !== 'running') return
          const cancelled = job.controller.signal.aborted
            || (error instanceof Error && error.name === 'AbortError')
          this.updateJob(job, {
            status: cancelled ? 'cancelled' : 'failed',
            stage: cancelled ? 'cancelled' : 'failed',
            currentItem: null,
            error: cancelled ? null : error instanceof Error ? error.message : String(error),
            completedAt: this.now().toISOString(),
          })
        })
        .finally(() => this.releaseTarget(portablePath, reservationOwner))
      reservationTransferred = true
      void job.completion
      return publicJob(job)
    } finally {
      if (!reservationTransferred) {
        this.releaseTarget(portablePath, reservationOwner)
      }
    }
  }

  getJob(jobId: string): UsbMigrationJob {
    const job = this.jobs.get(jobId)
    if (!job) {
      throw new UsbMigrationError('JOB_NOT_FOUND', '迁移任务不存在。', 404)
    }
    return publicJob(job)
  }

  cancel(jobId: string): UsbMigrationJob {
    const job = this.jobs.get(jobId)
    if (!job) {
      throw new UsbMigrationError('JOB_NOT_FOUND', '迁移任务不存在。', 404)
    }
    if (job.status === 'queued' || job.status === 'running') {
      const wasQueued = job.status === 'queued'
      const reason = new DOMException('Migration cancelled', 'AbortError')
      job.controller.abort(reason)
      if (job.schedulerTaskId) this.backgroundScheduler.cancel(job.schedulerTaskId, reason)
      if (wasQueued) {
        this.updateJob(job, {
          status: 'cancelled',
          stage: 'cancelled',
          currentItem: null,
          error: null,
          completedAt: this.now().toISOString(),
        })
      }
    }
    return publicJob(job)
  }

  async recoverInterruptedMigrations(): Promise<void> {
    if (this.recoveryPromise) return this.recoveryPromise
    this.recoveryStatus = {
      state: 'running',
      totalJobs: 0,
      recoveredJobs: 0,
      waitingJobs: 0,
      failedJobs: 0,
      updatedAt: this.now().toISOString(),
      lastError: null,
    }
    const recovery = this.performInterruptedMigrationRecovery()
    this.recoveryPromise = recovery
    try {
      await recovery
    } finally {
      if (this.recoveryPromise === recovery) this.recoveryPromise = null
    }
  }

  async shutdown(options: { timeoutMs?: number } = {}): Promise<void> {
    this.acceptingJobs = false
    const active = [...this.jobs.values()].filter(job =>
      job.status === 'queued' || job.status === 'running')
    if (active.length === 0) return

    await Promise.allSettled(active.map(job =>
      this.persistLiveJournal(job, 'interrupted')))
    for (const job of active) {
      if (job.status === 'queued' || job.status === 'running') {
        const reason = new DOMException('Migration interrupted by shutdown', 'AbortError')
        job.controller.abort(reason)
        if (job.schedulerTaskId) this.backgroundScheduler.cancel(job.schedulerTaskId, reason)
      }
    }

    const waitForJobs = Promise.allSettled(active.map(job => job.completion))
      .then(() => undefined)
    const timeoutMs = Math.max(0, options.timeoutMs ?? 3_000)
    if (timeoutMs === 0) return
    await Promise.race([
      waitForJobs,
      new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
    ])
  }

  abortActiveJobs(): void {
    this.acceptingJobs = false
    for (const job of this.jobs.values()) {
      if (job.status === 'queued' || job.status === 'running') {
        const reason = new DOMException('Migration interrupted by shutdown', 'AbortError')
        job.controller.abort(reason)
        if (job.schedulerTaskId) this.backgroundScheduler.cancel(job.schedulerTaskId, reason)
      }
    }
  }

  private reserveTarget(portablePath: string, owner: string): boolean {
    const key = portableTargetKey(portablePath)
    if (this.targetReservations.has(key)) return false
    this.targetReservations.set(key, owner)
    return true
  }

  private releaseTarget(portablePath: string, owner: string): void {
    const key = portableTargetKey(portablePath)
    if (this.targetReservations.get(key) === owner) {
      this.targetReservations.delete(key)
    }
  }

  private journalRoot(): string {
    return join(this.configDir, 'tmp', USB_MIGRATION_JOURNAL_DIRECTORY)
  }

  private async persistLiveJournal(
    job: InternalJob,
    phase: UsbMigrationJournalPhase,
  ): Promise<void> {
    job.journalSequence += 1
    await this.persistJournal({
      schemaVersion: 2,
      sequence: job.journalSequence,
      jobId: job.id,
      phase,
      portablePath: job.portablePath,
      stagingPath: job.stagingPath,
      backupPath: job.backupPath,
      existingMoved: job.existingMoved,
      updatedAt: this.now().toISOString(),
      volumeRelativeParent: portableVolumeRelativeParent(job.portablePath),
      volumeMarkerName: recoveryMarkerName(job.id),
    })
  }

  private async persistJournal(journal: UsbMigrationJournal): Promise<void> {
    const directory = join(this.journalRoot(), journal.jobId)
    await mkdir(directory, { recursive: true })
    const filename = `${String(journal.sequence).padStart(8, '0')}-${journal.phase}.json`
    await writeFile(
      join(directory, filename),
      `${JSON.stringify(journal)}\n`,
      { mode: 0o600 },
    )
  }

  private async removeJournal(jobId: string): Promise<void> {
    await rm(join(this.journalRoot(), jobId), { recursive: true, force: true })
  }

  private async performInterruptedMigrationRecovery(): Promise<void> {
    const { journals, invalidJournals } = await this.readLatestJournals()
    const recoveryCount = journals.length + invalidJournals
    if (recoveryCount === 0) {
      this.recoveryStatus = {
        state: 'idle',
        totalJobs: 0,
        recoveredJobs: 0,
        waitingJobs: 0,
        failedJobs: 0,
        updatedAt: this.now().toISOString(),
        lastError: null,
      }
      return
    }
    this.recoveryStatus = {
      state: 'running',
      totalJobs: recoveryCount,
      recoveredJobs: 0,
      waitingJobs: 0,
      failedJobs: 0,
      updatedAt: this.now().toISOString(),
      lastError: null,
    }
    const recordOutcome = (
      outcome: UsbMigrationRecoveryOutcome | 'failed',
      error?: unknown,
    ) => {
      if (outcome === 'recovered') this.recoveryStatus.recoveredJobs += 1
      if (outcome === 'waiting-for-drive') this.recoveryStatus.waitingJobs += 1
      if (outcome === 'failed') {
        this.recoveryStatus.failedJobs += 1
        this.recoveryStatus.lastError = error instanceof Error
          ? error.message
          : String(error ?? 'Unknown recovery error')
      }
      this.recoveryStatus.updatedAt = this.now().toISOString()
    }
    for (let index = 0; index < invalidJournals; index += 1) {
      recordOutcome('failed', new Error('Interrupted migration journal failed safety validation'))
    }
    const recoveries: Promise<void>[] = []
    for (const storedJournal of journals) {
      const journal = await this.resolveRecoveryJournalLocation(storedJournal)
      if (!journal) {
        recordOutcome('waiting-for-drive')
        continue
      }
      const owner = `recovery:${journal.jobId}`
      if (!this.reserveTarget(journal.portablePath, owner)) {
        recordOutcome('waiting-for-drive')
        continue
      }
      try {
        const handle = this.backgroundScheduler.enqueue<UsbMigrationRecoveryOutcome>({
          type: 'usb-migration-recovery',
          key: journal.jobId,
          priority: 0,
          lane: 'disk-write',
          resourceKey: migrationVolumeResourceKey(journal.portablePath),
          dedupe: 'join',
          run: async context => {
            context.signal.throwIfAborted()
            const outcome = await this.recoverJournal(journal, context.signal)
            await context.checkpoint({ stage: outcome, jobId: journal.jobId })
            return outcome
          },
        })
        recoveries.push(handle.promise
          .then(outcome => recordOutcome(outcome))
          .catch(error => {
            recordOutcome('failed', error)
            console.warn(
              `[USB Migration] Deferred recovery for ${journal.jobId}:`,
              error instanceof Error ? error.message : error,
            )
          })
          .finally(() => this.releaseTarget(journal.portablePath, owner)))
      } catch (error) {
        this.releaseTarget(journal.portablePath, owner)
        recordOutcome('failed', error)
        console.warn(
          `[USB Migration] Deferred recovery for ${journal.jobId}:`,
          error instanceof Error ? error.message : error,
        )
      }
    }
    await Promise.all(recoveries)
    this.recoveryStatus.state = this.recoveryStatus.failedJobs > 0
      ? 'failed'
      : this.recoveryStatus.waitingJobs > 0
        ? 'waiting-for-drive'
        : 'completed'
    this.recoveryStatus.updatedAt = this.now().toISOString()
  }

  private async readLatestJournals(): Promise<{
    journals: UsbMigrationJournal[]
    invalidJournals: number
  }> {
    const root = this.journalRoot()
    const directories = await readdir(root, { withFileTypes: true }).catch(() => [])
    const journals: UsbMigrationJournal[] = []
    let invalidJournals = 0
    for (const directory of directories) {
      if (!directory.isDirectory() || !isSafeJournalId(directory.name)) continue
      const path = join(root, directory.name)
      const files = await readdir(path, { withFileTypes: true }).catch(() => [])
      const candidates = files
        .filter(file => file.isFile() && file.name.endsWith('.json'))
        .map(file => file.name)
        .sort((left, right) => right.localeCompare(left))
      let validJournalFound = false
      for (const filename of candidates) {
        try {
          const journal = parseUsbMigrationJournal(
            JSON.parse(await readFile(join(path, filename), 'utf8')),
            directory.name,
            this.configDir,
          )
          if (journal) {
            journals.push(journal)
            validJournalFound = true
            break
          }
        } catch {
          // A partially written latest checkpoint can fall back to the prior one.
        }
      }
      if (candidates.length > 0 && !validJournalFound) invalidJournals += 1
    }
    return { journals, invalidJournals }
  }

  private async recoverJournal(
    journal: UsbMigrationJournal,
    signal: AbortSignal,
  ): Promise<UsbMigrationRecoveryOutcome> {
    signal.throwIfAborted()
    const portableParent = dirname(journal.portablePath)
    if (!(await pathExists(portableParent))) return 'waiting-for-drive'
    if (!(await this.isCanonicalRecoveryTarget(journal))) {
      throw new Error('Interrupted migration journal failed safety validation')
    }

    signal.throwIfAborted()
    const finalValid = await isRecognizedPortableBundle(journal.portablePath)
    if (finalValid) {
      signal.throwIfAborted()
      await rm(journal.stagingPath, { recursive: true, force: true })
      signal.throwIfAborted()
      await rm(journal.backupPath, { recursive: true, force: true })
      signal.throwIfAborted()
      await this.completeRecoveredJournal(journal)
      return 'recovered'
    }

    const finalExists = await pathExists(journal.portablePath)
    const stagingValid = await isRecognizedPortableBundle(journal.stagingPath)
    const backupValid = await isRecognizedPortableBundle(journal.backupPath)

    if (finalExists && backupValid) {
      signal.throwIfAborted()
      await rm(journal.portablePath, { recursive: true, force: true })
      signal.throwIfAborted()
      await rename(journal.backupPath, journal.portablePath)
      if (await isRecognizedPortableBundle(journal.portablePath)) {
        signal.throwIfAborted()
        await rm(journal.stagingPath, { recursive: true, force: true })
        signal.throwIfAborted()
        await this.completeRecoveredJournal(journal)
      }
      return this.recoveryOutcome(journal.jobId)
    }

    const prepared = journal.phase === 'prepared'
      || journal.phase === 'committing'
      || journal.phase === 'completed'
    if (!finalExists && prepared && stagingValid) {
      signal.throwIfAborted()
      await rename(journal.stagingPath, journal.portablePath)
      if (await isRecognizedPortableBundle(journal.portablePath)) {
        signal.throwIfAborted()
        await rm(journal.backupPath, { recursive: true, force: true })
        signal.throwIfAborted()
        await this.completeRecoveredJournal(journal)
      }
      return this.recoveryOutcome(journal.jobId)
    }

    if (!finalExists && backupValid) {
      signal.throwIfAborted()
      await rename(journal.backupPath, journal.portablePath)
      if (await isRecognizedPortableBundle(journal.portablePath)) {
        signal.throwIfAborted()
        await rm(journal.stagingPath, { recursive: true, force: true })
        signal.throwIfAborted()
        await this.completeRecoveredJournal(journal)
      }
      return this.recoveryOutcome(journal.jobId)
    }

    if (!finalExists && !backupValid) {
      signal.throwIfAborted()
      await rm(journal.stagingPath, { recursive: true, force: true })
      signal.throwIfAborted()
      await this.completeRecoveredJournal(journal)
    }
    return this.recoveryOutcome(journal.jobId)
  }

  private async recoveryOutcome(jobId: string): Promise<UsbMigrationRecoveryOutcome> {
    return await pathExists(join(this.journalRoot(), jobId))
      ? 'waiting-for-drive'
      : 'recovered'
  }

  private async resolveRecoveryJournalLocation(
    journal: UsbMigrationJournal,
  ): Promise<UsbMigrationJournal | null> {
    const previousParent = dirname(journal.portablePath)
    if (journal.volumeRelativeParent === undefined || !journal.volumeMarkerName) {
      return journal
    }

    const existingMarker = await readFile(
      join(previousParent, journal.volumeMarkerName),
      'utf8',
    ).then(content => content.trim()).catch(() => null)
    if (existingMarker === journal.jobId) return journal

    const candidates = await this.recoveryParentCandidates({
      jobId: journal.jobId,
      previousParent,
      relativeParent: journal.volumeRelativeParent,
      markerName: journal.volumeMarkerName,
    })
    for (const value of candidates) {
      const parent = resolve(value)
      if (parent === previousParent) continue
      const marker = join(parent, journal.volumeMarkerName)
      const markerJobId = await readFile(marker, 'utf8')
        .then(content => content.trim())
        .catch(() => null)
      if (markerJobId !== journal.jobId) continue

      const relocated: UsbMigrationJournal = {
        ...journal,
        sequence: journal.sequence + 1,
        portablePath: join(parent, USB_PORTABLE_DIRECTORY_NAME),
        stagingPath: join(parent, `.${USB_PORTABLE_DIRECTORY_NAME}.tmp-${journal.jobId}`),
        backupPath: join(parent, `.${USB_PORTABLE_DIRECTORY_NAME}.backup-${journal.jobId}`),
        updatedAt: this.now().toISOString(),
      }
      if (!(await this.isCanonicalRecoveryTarget(relocated))) continue
      await this.persistJournal(relocated)
      return relocated
    }
    return null
  }

  private async completeRecoveredJournal(journal: UsbMigrationJournal): Promise<void> {
    if (journal.volumeMarkerName) {
      await rm(join(dirname(journal.portablePath), journal.volumeMarkerName), {
        force: true,
      }).catch(() => {})
    }
    await this.removeJournal(journal.jobId)
  }

  private async isCanonicalRecoveryTarget(
    journal: UsbMigrationJournal,
  ): Promise<boolean> {
    const lexicalParent = dirname(journal.portablePath)
    const [canonicalParent, canonicalHome, canonicalConfig] = await Promise.all([
      realpath(lexicalParent).catch(() => null),
      realpath(homedir()).catch(() => resolve(homedir())),
      realpath(this.configDir).catch(() => resolve(this.configDir)),
    ])
    if (!canonicalParent || canonicalParent !== lexicalParent) return false
    if (
      isUnsafePortableParent(canonicalParent)
      || canonicalParent === canonicalHome
      || isSameOrWithin(journal.portablePath, canonicalConfig)
    ) return false
    return journal.portablePath === join(canonicalParent, USB_PORTABLE_DIRECTORY_NAME)
      && journal.stagingPath === join(
        canonicalParent,
        `.${USB_PORTABLE_DIRECTORY_NAME}.tmp-${journal.jobId}`,
      )
      && journal.backupPath === join(
        canonicalParent,
        `.${USB_PORTABLE_DIRECTORY_NAME}.backup-${journal.jobId}`,
      )
  }

  private async discoverProjects(signal?: AbortSignal): Promise<UsbMigrationProject[]> {
    signal?.throwIfAborted()
    const rawProjects = this.discoverProjectsImpl
      ? await this.discoverProjectsImpl(signal)
      : await discoverSessionProjects(signal)
    signal?.throwIfAborted()
    const [canonicalConfigDir, canonicalHomeDir] = await Promise.all([
      realpath(this.configDir).catch(() => resolve(this.configDir)),
      realpath(homedir()).catch(() => resolve(homedir())),
    ])
    const deduped = new Map<string, {
      path: string
      modifiedAt: string
      sessionCount: number
    }>()

    for (const project of rawProjects) {
      signal?.throwIfAborted()
      let canonicalPath: string
      try {
        canonicalPath = await realpath(project.path)
        if (!(await stat(canonicalPath)).isDirectory()) continue
      } catch {
        continue
      }
      if (isUnsafeProjectRoot(
        canonicalPath,
        canonicalConfigDir,
        canonicalHomeDir,
      )) continue
      const existing = deduped.get(canonicalPath)
      const modifiedAt = project.modifiedAt ?? ''
      if (!existing) {
        deduped.set(canonicalPath, {
          path: canonicalPath,
          modifiedAt,
          sessionCount: project.sessionCount ?? 1,
        })
      } else {
        existing.sessionCount += project.sessionCount ?? 1
        if (modifiedAt > existing.modifiedAt) existing.modifiedAt = modifiedAt
      }
    }

    const measured = await mapWithConcurrency(
      [...deduped.values()],
      2,
      async project => ({
        id: projectId(project.path),
        name: basename(project.path) || 'project',
        path: project.path,
        sizeBytes: await measureTree(project.path, 'project', signal).catch(error => {
          if (signal?.aborted) throw signal.reason
          return 0
        }),
        modifiedAt: project.modifiedAt,
        sessionCount: project.sessionCount,
      }),
    )
    return measured.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  }

  private async resolveRelease(signal?: AbortSignal): Promise<ResolvedPortableRelease | null> {
    signal?.throwIfAborted()
    if (this.resolveReleaseImpl) return this.resolveReleaseImpl()
    if (this.manifestUrls.length === 0) return null

    const attempts = this.manifestUrls.map(async sourceUrl => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS)
      const abortFromParent = () => controller.abort(signal?.reason)
      signal?.addEventListener('abort', abortFromParent, { once: true })
      try {
        const response = await this.fetchImpl(sourceUrl, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const manifest = validateReleaseManifest(await response.json())
        return { manifest, sourceUrl }
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abortFromParent)
      }
    })

    try {
      return await Promise.any(attempts)
    } catch (error) {
      const message = error instanceof AggregateError
        ? error.errors.map(item => item instanceof Error ? item.message : String(item)).join('; ')
        : error instanceof Error ? error.message : String(error)
      throw new UsbMigrationError(
        'PORTABLE_RELEASE_UNAVAILABLE',
        `无法获取便携运行包清单：${message}`,
        503,
      )
    }
  }

  private async validateDestination(value: string): Promise<string> {
    if (!value?.trim()) {
      throw new UsbMigrationError('DESTINATION_REQUIRED', '请选择 U 盘或移动磁盘目录。')
    }
    const destinationPath = resolve(value.trim())
    let stats
    try {
      stats = await stat(destinationPath)
    } catch {
      throw new UsbMigrationError('DESTINATION_MISSING', '所选目录不存在。')
    }
    if (!stats.isDirectory()) {
      throw new UsbMigrationError('DESTINATION_NOT_DIRECTORY', '所选路径不是目录。')
    }
    return realpath(destinationPath)
  }

  private async validateSourceBoundaries(
    destinationPath: string,
    portablePath: string,
    projects: UsbMigrationProject[],
  ): Promise<void> {
    const sources = [this.configDir, ...projects.map(project => project.path)]
    for (const source of sources) {
      const canonicalSource = await realpath(source).catch(() => resolve(source))
      if (isSameOrWithin(destinationPath, canonicalSource)) {
        throw new UsbMigrationError(
          'DESTINATION_INSIDE_SOURCE',
          `目标目录不能位于待迁移目录内：${canonicalSource}`,
          409,
        )
      }
      if (isSameOrWithin(canonicalSource, portablePath)) {
        throw new UsbMigrationError(
          'SOURCE_INSIDE_DESTINATION',
          `待迁移目录不能位于现有便携包内：${canonicalSource}`,
          409,
        )
      }
    }
  }

  private async runJob(
    job: InternalJob,
    input: {
      projects: UsbMigrationProject[]
      assets: Array<{ platform: UsbMigrationPlatform; asset: PortableReleaseAsset }>
      release: ResolvedPortableRelease | null
      replaceExisting: boolean
    },
  ): Promise<void> {
    const signal = job.controller.signal
    const portableParent = dirname(job.portablePath)
    const stagingPath = job.stagingPath
    const backupPath = job.backupPath
    let lastCurrentItemUpdate = 0
    const context: CopyContext = {
      job,
      signal,
      advance: bytes => this.advanceJob(job, bytes),
      setCurrentItem: item => {
        const timestamp = Date.now()
        if (timestamp - lastCurrentItemUpdate < 100) return
        lastCurrentItemUpdate = timestamp
        this.updateJob(job, { currentItem: item })
      },
      afterCopyChunk: this.copyChunkHook,
    }
    let newFinalInstalled = false
    const recoveryMarkerPath = join(
      portableParent,
      recoveryMarkerName(job.id),
    )

    try {
      await writeFile(recoveryMarkerPath, `${job.id}\n`, { mode: 0o600 })
      await this.persistLiveJournal(job, 'preparing')
      this.updateJob(job, {
        status: 'running',
        stage: 'preparing',
        currentItem: null,
      })
      await rm(stagingPath, { recursive: true, force: true })
      await mkdir(stagingPath, { recursive: true })
      signal.throwIfAborted()
      await this.persistLiveJournal(job, 'copying')

      this.updateJob(job, {
        stage: 'config',
        currentItem: this.configDir,
      })
      const portableConfigDir = join(stagingPath, 'data', 'config')
      if (await pathExists(this.configDir)) {
        await copyTree(this.configDir, portableConfigDir, context, 'config')
      } else {
        await mkdir(portableConfigDir, { recursive: true })
      }

      const registryProjects: PortableProjectEntry[] = []
      this.updateJob(job, { stage: 'projects', currentItem: null })
      for (const project of input.projects) {
        signal.throwIfAborted()
        const relativePath = `projects/${projectSlug(project)}`
        this.updateJob(job, { currentItem: project.path })
        await copyTree(
          project.path,
          join(stagingPath, relativePath),
          context,
          'project',
        )
        registryProjects.push({
          id: project.id,
          name: project.name,
          relativePath,
          originalPaths: [project.path],
        })
      }

      const registry: PortableProjectRegistry = {
        schemaVersion: 1,
        createdAt: this.now().toISOString(),
        projects: registryProjects,
      }
      await mkdir(join(stagingPath, 'data', 'config'), { recursive: true })
      await writeFile(
        join(stagingPath, 'data', 'config', 'portable-projects.json'),
        `${JSON.stringify(registry, null, 2)}\n`,
        { mode: 0o600 },
      )

      this.updateJob(job, { stage: 'applications', currentItem: null })
      const checksums: string[] = []
      for (const { platform, asset } of input.assets) {
        signal.throwIfAborted()
        this.updateJob(job, { currentItem: `${platform}: ${asset.filename}` })
        const packageDir = join(stagingPath, 'packages', platform)
        await mkdir(packageDir, { recursive: true })
        const packagePath = join(packageDir, asset.filename)
        await this.downloadAsset(
          input.release!,
          asset,
          packagePath,
          context,
        )
        checksums.push(`${asset.sha256.toLowerCase()}  packages/${platform}/${asset.filename}`)
      }
      if (checksums.length > 0) {
        await writeFile(join(stagingPath, 'checksums.sha256'), `${checksums.join('\n')}\n`)
      }

      this.updateJob(job, { stage: 'launchers', currentItem: null })
      await writePortableLaunchers(stagingPath)
      await writePortableMetadata(stagingPath, {
        createdAt: this.now().toISOString(),
        releaseVersion: input.release?.manifest.version ?? null,
        projects: registryProjects.map(project => ({
          id: project.id,
          name: project.name,
          relativePath: project.relativePath,
        })),
        platforms: input.assets.map(item => item.platform),
      })

      this.updateJob(job, { stage: 'finalizing', currentItem: job.portablePath })
      signal.throwIfAborted()
      if (!(await isRecognizedPortableBundle(stagingPath))) {
        throw new Error('Prepared portable bundle failed validation')
      }
      await this.persistLiveJournal(job, 'prepared')
      signal.throwIfAborted()
      await this.persistLiveJournal(job, 'committing')
      if (input.replaceExisting && await pathExists(job.portablePath)) {
        await rm(backupPath, { recursive: true, force: true })
        await rename(job.portablePath, backupPath)
        job.existingMoved = true
        await this.persistLiveJournal(job, 'committing')
      }
      await rename(stagingPath, job.portablePath)
      newFinalInstalled = true
      if (!(await isRecognizedPortableBundle(job.portablePath))) {
        throw new Error('Committed portable bundle failed validation')
      }
      await this.persistLiveJournal(job, 'completed')
      if (job.existingMoved) {
        this.updateJob(job, {
          stage: 'cleanup',
          currentItem: job.portablePath,
        })
        await rm(backupPath, { recursive: true, force: true })
        job.existingMoved = false
      }
      await this.removeJournal(job.id)
      await rm(recoveryMarkerPath, { force: true }).catch(() => {})

      this.updateJob(job, {
        status: 'completed',
        stage: 'completed',
        currentItem: null,
        processedBytes: job.totalBytes,
        progressPercent: 100,
        completedAt: this.now().toISOString(),
      })
    } catch (error) {
      const cancelled = signal.aborted || (
        error instanceof DOMException && error.name === 'AbortError'
      )
      await this.persistLiveJournal(
        job,
        cancelled ? 'cancelled' : 'interrupted',
      ).catch(() => {})

      await rm(stagingPath, { recursive: true, force: true }).catch(() => {})
      if (job.existingMoved) {
        if (newFinalInstalled && !(await isRecognizedPortableBundle(job.portablePath))) {
          await rm(job.portablePath, { recursive: true, force: true }).catch(() => {})
        }
        if (!(await pathExists(job.portablePath))) {
          await rename(backupPath, job.portablePath).catch(() => {})
        }
      } else if (newFinalInstalled && !(await isRecognizedPortableBundle(job.portablePath))) {
        await rm(job.portablePath, { recursive: true, force: true }).catch(() => {})
      }

      const parentAvailable = await pathExists(portableParent)
      const recoveryMaterialRemains = await pathExists(stagingPath)
        || await pathExists(backupPath)
      if (parentAvailable && !recoveryMaterialRemains) {
        await this.removeJournal(job.id).catch(() => {})
        await rm(recoveryMarkerPath, { force: true }).catch(() => {})
      }
      this.updateJob(job, {
        status: cancelled ? 'cancelled' : 'failed',
        stage: cancelled ? 'cancelled' : 'failed',
        currentItem: null,
        error: cancelled
          ? null
          : error instanceof Error ? error.message : String(error),
        completedAt: this.now().toISOString(),
      })
    }
  }

  private async downloadAsset(
    release: ResolvedPortableRelease,
    asset: PortableReleaseAsset,
    destinationPath: string,
    context: CopyContext,
  ): Promise<void> {
    const urls = asset.urls?.length
      ? asset.urls
      : archiveUrls(release.sourceUrl, asset.filename)
    const errors: string[] = []

    for (const url of urls) {
      context.signal.throwIfAborted()
      const partialPath = `${destinationPath}.part`
      await rm(partialPath, { force: true })
      let attemptDownloaded = 0
      const controller = new AbortController()
      const onAbort = () => controller.abort(context.signal.reason)
      context.signal.addEventListener('abort', onAbort, { once: true })
      let stallTimer: ReturnType<typeof setTimeout> | undefined
      const resetStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer)
        stallTimer = setTimeout(
          () => controller.abort(
            new DOMException('Download stalled', 'TimeoutError'),
          ),
          this.downloadStallTimeoutMs,
        )
      }
      const cleanupRequest = () => {
        if (stallTimer) clearTimeout(stallTimer)
        context.signal.removeEventListener('abort', onAbort)
      }
      try {
        resetStallTimer()
        const response = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/octet-stream',
            'Accept-Encoding': 'identity',
          },
        })
        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}`)
        }

        const hash = createHash('sha256')
        const signatureHash = createHash('blake2b512')
        const handle = await open(partialPath, 'w')
        const reader = response.body.getReader()
        let downloaded = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            context.signal.throwIfAborted()
            resetStallTimer()
            await handle.write(value)
            hash.update(value)
            signatureHash.update(value)
            downloaded += value.byteLength
            if (downloaded > asset.size) {
              throw new Error(`下载大小超过清单声明：${downloaded}/${asset.size}`)
            }
            attemptDownloaded += value.byteLength
            this.advanceJob(context.job, value.byteLength)
          }
        } finally {
          await reader.cancel().catch(() => {})
          await handle.close()
        }

        if (downloaded !== asset.size) {
          throw new Error(`下载大小不一致：${downloaded}/${asset.size}`)
        }
        if (hash.digest('hex').toLowerCase() !== asset.sha256.toLowerCase()) {
          throw new Error('SHA-256 校验失败')
        }
        if (!this.verifyAssetSignature(signatureHash.digest(), asset.signature)) {
          throw new Error('发布签名校验失败')
        }
        await rename(partialPath, destinationPath)
        cleanupRequest()
        return
      } catch (error) {
        cleanupRequest()
        this.advanceJob(context.job, -attemptDownloaded)
        await rm(partialPath, { force: true }).catch(() => {})
        if (context.signal.aborted) throw context.signal.reason
        errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    throw new UsbMigrationError(
      'PACKAGE_DOWNLOAD_FAILED',
      `便携运行包下载失败：${errors.join('; ')}`,
      502,
    )
  }

  private advanceJob(job: InternalJob, bytes: number): void {
    const processedBytes = Math.max(
      0,
      Math.min(job.totalBytes, job.processedBytes + bytes),
    )
    this.updateJob(job, {
      processedBytes,
      progressPercent: job.totalBytes > 0
        ? Math.min(99, Math.round((processedBytes / job.totalBytes) * 100))
        : 0,
    })
  }

  private updateJob(job: InternalJob, patch: Partial<UsbMigrationJob>): void {
    Object.assign(job, patch, { updatedAt: this.now().toISOString() })
  }
}

async function discoverSessionProjects(signal?: AbortSignal): Promise<Array<{
  path: string
  modifiedAt: string
  sessionCount: number
}>> {
  signal?.throwIfAborted()
  const { sessions } = await sessionService.listSessions({
    limit: Number.MAX_SAFE_INTEGER,
  })
  const projects = new Map<string, {
    path: string
    modifiedAt: string
    sessionCount: number
  }>()
  for (const session of sessions) {
    signal?.throwIfAborted()
    if (session.isTemporary || !session.workDirExists || !session.workDir) continue
    const existing = projects.get(session.workDir)
    if (!existing) {
      projects.set(session.workDir, {
        path: session.workDir,
        modifiedAt: session.modifiedAt,
        sessionCount: 1,
      })
    } else {
      existing.sessionCount += 1
      if (session.modifiedAt > existing.modifiedAt) {
        existing.modifiedAt = session.modifiedAt
      }
    }
  }
  return [...projects.values()]
}

async function measureTree(
  root: string,
  scope: TreeCopyScope,
  signal?: AbortSignal,
): Promise<number> {
  let total = 0
  const visit = async (target: string, relativePath: string): Promise<void> => {
    signal?.throwIfAborted()
    const stats = await lstat(target)
    signal?.throwIfAborted()
    if (
      relativePath
      && shouldSkipTreeEntry(scope, relativePath, stats.isDirectory())
    ) {
      return
    }
    if (stats.isSymbolicLink()) return
    if (stats.isFile()) {
      total += stats.size
      return
    }
    if (!stats.isDirectory()) return
    const entries = await readdir(target, { withFileTypes: true })
    for (const entry of entries) {
      signal?.throwIfAborted()
      await visit(
        join(target, entry.name),
        relativePath ? join(relativePath, entry.name) : entry.name,
      )
    }
  }
  await visit(root, '')
  return total
}

async function copyTree(
  source: string,
  destination: string,
  context: CopyContext,
  scope: TreeCopyScope,
): Promise<void> {
  const plan = await createCopyPlan(source, destination, context, scope)
  await mapWithConcurrency(
    plan.directories,
    COPY_CONCURRENCY,
    async entry => {
      context.signal.throwIfAborted()
      await mkdir(entry.destination, { recursive: true })
    },
  )
  await mapWithConcurrency(
    [...plan.files, ...plan.symlinks],
    COPY_CONCURRENCY,
    async entry => {
      context.signal.throwIfAborted()
      context.setCurrentItem(entry.source)
      if ('size' in entry) {
        await copyFileInChunks(entry, context)
        await chmod(entry.destination, entry.mode).catch(() => {})
        await utimes(entry.destination, entry.atime, entry.mtime).catch(() => {})
        return
      }

      const target = await readlink(entry.source)
      try {
        await symlink(target, entry.destination)
      } catch (error) {
        context.job.warnings.push(
          `未能复制符号链接 ${entry.source}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    },
  )
  for (const entry of [...plan.directories].reverse()) {
    context.signal.throwIfAborted()
    await chmod(entry.destination, entry.mode).catch(() => {})
    await utimes(entry.destination, entry.atime, entry.mtime).catch(() => {})
  }
}

async function copyFileInChunks(
  entry: CopyEntryMetadata & { size: number },
  context: CopyContext,
): Promise<void> {
  context.signal.throwIfAborted()
  const sourceHandle = await open(entry.source, 'r')
  let destinationHandle: Awaited<ReturnType<typeof open>> | null = null
  let bytesCopied = 0
  try {
    destinationHandle = await open(entry.destination, 'w', entry.mode)
    const buffer = Buffer.allocUnsafe(Math.max(1, Math.min(COPY_CHUNK_BYTES, entry.size)))
    while (bytesCopied < entry.size) {
      context.signal.throwIfAborted()
      const bytesToRead = Math.min(buffer.byteLength, entry.size - bytesCopied)
      const { bytesRead } = await sourceHandle.read(
        buffer,
        0,
        bytesToRead,
        bytesCopied,
      )
      if (bytesRead === 0) break

      let chunkOffset = 0
      while (chunkOffset < bytesRead) {
        context.signal.throwIfAborted()
        const { bytesWritten } = await destinationHandle.write(
          buffer,
          chunkOffset,
          bytesRead - chunkOffset,
          bytesCopied + chunkOffset,
        )
        if (bytesWritten === 0) {
          throw new Error(`Unable to copy file chunk: ${entry.source}`)
        }
        chunkOffset += bytesWritten
      }

      bytesCopied += bytesRead
      context.advance(bytesRead)
      await context.afterCopyChunk?.({
        sourcePath: entry.source,
        destinationPath: entry.destination,
        bytesCopied,
        chunkBytes: bytesRead,
        totalBytes: entry.size,
        signal: context.signal,
      })
      context.signal.throwIfAborted()
    }
    if (bytesCopied !== entry.size) {
      throw new Error(
        `Source file changed while copying: ${entry.source} (${bytesCopied}/${entry.size})`,
      )
    }
  } finally {
    await Promise.allSettled([
      sourceHandle.close(),
      destinationHandle?.close() ?? Promise.resolve(),
    ])
  }
}

async function createCopyPlan(
  sourceRoot: string,
  destinationRoot: string,
  context: CopyContext,
  scope: TreeCopyScope,
): Promise<CopyPlan> {
  const plan: CopyPlan = {
    directories: [],
    files: [],
    symlinks: [],
  }
  const visit = async (
    source: string,
    destination: string,
    relativePath: string,
  ): Promise<void> => {
    context.signal.throwIfAborted()
    context.setCurrentItem(source)
    const stats = await lstat(source)
    if (
      relativePath
      && shouldSkipTreeEntry(scope, relativePath, stats.isDirectory())
    ) {
      return
    }
    if (stats.isSymbolicLink()) {
      plan.symlinks.push({ source, destination })
      return
    }
    if (stats.isFile()) {
      plan.files.push({
        source,
        destination,
        size: stats.size,
        mode: stats.mode,
        atime: stats.atime,
        mtime: stats.mtime,
      })
      return
    }
    if (!stats.isDirectory()) {
      context.job.warnings.push(`已跳过不支持的文件类型：${source}`)
      return
    }

    plan.directories.push({
      source,
      destination,
      mode: stats.mode,
      atime: stats.atime,
      mtime: stats.mtime,
    })
    const entries = await readdir(source, { withFileTypes: true })
    for (const entry of entries) {
      await visit(
        join(source, entry.name),
        join(destination, entry.name),
        relativePath ? join(relativePath, entry.name) : entry.name,
      )
    }
  }
  await visit(sourceRoot, destinationRoot, '')
  return plan
}

function shouldSkipTreeEntry(
  scope: TreeCopyScope,
  relativePath: string,
  isDirectory: boolean,
): boolean {
  if (!isDirectory) return false
  const segments = relativePath
    .split(/[\\/]+/)
    .map(segment => segment.toLowerCase())
  if (scope === 'config') {
    return segments.length === 1 && CONFIG_CACHE_DIRECTORIES.has(segments[0]!)
  }
  return segments.some(segment => PROJECT_GENERATED_DIRECTORIES.has(segment))
}

function isSafeJournalId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}

function parseUsbMigrationJournal(
  value: unknown,
  expectedJobId: string,
  configDir: string,
): UsbMigrationJournal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<UsbMigrationJournal>
  if (
    (candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2)
    || candidate.jobId !== expectedJobId
    || !isSafeJournalId(candidate.jobId)
    || !Number.isSafeInteger(candidate.sequence)
    || (candidate.sequence ?? 0) < 1
    || !USB_MIGRATION_JOURNAL_PHASES.has(candidate.phase as UsbMigrationJournalPhase)
    || typeof candidate.portablePath !== 'string'
    || typeof candidate.stagingPath !== 'string'
    || typeof candidate.backupPath !== 'string'
    || !isAbsolute(candidate.portablePath)
    || !isAbsolute(candidate.stagingPath)
    || !isAbsolute(candidate.backupPath)
    || typeof candidate.existingMoved !== 'boolean'
    || typeof candidate.updatedAt !== 'string'
  ) return null

  const portablePath = resolve(candidate.portablePath)
  const stagingPath = resolve(candidate.stagingPath)
  const backupPath = resolve(candidate.backupPath)
  const portableParent = dirname(portablePath)
  if (
    candidate.portablePath !== portablePath
    || candidate.stagingPath !== stagingPath
    || candidate.backupPath !== backupPath
    || basename(portablePath) !== USB_PORTABLE_DIRECTORY_NAME
    || isUnsafePortableParent(portableParent)
    || portableParent === resolve(homedir())
    || isSameOrWithin(portablePath, resolve(configDir))
    || dirname(stagingPath) !== portableParent
    || dirname(backupPath) !== portableParent
    || stagingPath !== join(
      portableParent,
      `.${USB_PORTABLE_DIRECTORY_NAME}.tmp-${candidate.jobId}`,
    )
    || backupPath !== join(
      portableParent,
      `.${USB_PORTABLE_DIRECTORY_NAME}.backup-${candidate.jobId}`,
    )
  ) return null

  if (candidate.schemaVersion === 2 && (
    typeof candidate.volumeRelativeParent !== 'string'
    || isAbsolute(candidate.volumeRelativeParent)
    || candidate.volumeRelativeParent.split(/[\\/]+/).includes('..')
    || candidate.volumeMarkerName !== recoveryMarkerName(candidate.jobId)
  )) return null

  return {
    schemaVersion: candidate.schemaVersion,
    sequence: candidate.sequence,
    jobId: candidate.jobId,
    phase: candidate.phase as UsbMigrationJournalPhase,
    portablePath,
    stagingPath,
    backupPath,
    existingMoved: candidate.existingMoved,
    updatedAt: candidate.updatedAt,
    volumeRelativeParent: candidate.volumeRelativeParent,
    volumeMarkerName: candidate.volumeMarkerName,
  }
}

function publicJob(job: InternalJob): UsbMigrationJob {
  const {
    controller: _controller,
    completion: _completion,
    schedulerTaskId: _schedulerTaskId,
    stagingPath: _stagingPath,
    backupPath: _backupPath,
    journalSequence: _journalSequence,
    existingMoved: _existingMoved,
    ...snapshot
  } = job
  return {
    ...snapshot,
    warnings: [...snapshot.warnings],
  }
}

function projectId(projectPath: string): string {
  return createHash('sha256').update(projectPath).digest('hex').slice(0, 20)
}

function projectSlug(project: UsbMigrationProject): string {
  const safeName = project.name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'project'
  return `${safeName}-${project.id.slice(0, 8)}`
}

function normalizePlatforms(
  values: UsbMigrationPlatform[] | undefined,
): UsbMigrationPlatform[] {
  const defaults: UsbMigrationPlatform[] = [
    'macos-arm64',
    'macos-x64',
    'windows-x64',
    'linux-x64',
  ]
  if (values === undefined) return defaults
  const unique = [...new Set(values)]
  if (unique.length === 0 || unique.some(value => !VALID_PLATFORMS.has(value))) {
    throw new UsbMigrationError('INVALID_PLATFORMS', '请选择至少一个受支持的平台。')
  }
  return unique
}

function selectProjects(
  projects: UsbMigrationProject[],
  projectIds: string[] | undefined,
): UsbMigrationProject[] {
  if (projectIds === undefined) return projects
  const requested = new Set(projectIds)
  const selected = projects.filter(project => requested.has(project.id))
  if (selected.length !== requested.size) {
    throw new UsbMigrationError('UNKNOWN_PROJECT', '所选项目已失效，请重新扫描。')
  }
  return selected
}

function currentPlatformKey(): UsbMigrationPlatform | null {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'macos-arm64' : 'macos-x64'
  }
  if (process.platform === 'win32' && process.arch === 'x64') return 'windows-x64'
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64'
  return null
}

function resolvePortablePath(destinationPath: string): string {
  return basename(destinationPath).toLowerCase() === USB_PORTABLE_DIRECTORY_NAME.toLowerCase()
    ? destinationPath
    : join(destinationPath, USB_PORTABLE_DIRECTORY_NAME)
}

function recoveryMarkerName(jobId: string): string {
  return `${USB_MIGRATION_RECOVERY_MARKER_PREFIX}${jobId}`
}

function portableVolumeRelativeParent(portablePath: string): string {
  const parent = dirname(portablePath)
  return relative(parse(parent).root, parent)
}

async function defaultRecoveryParentCandidates(input: {
  relativeParent: string
  markerName: string
}): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const candidates: string[] = []
  for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
    const driveRoot = `${String.fromCharCode(code)}:\\`
    const parent = resolve(driveRoot, input.relativeParent)
    if (await pathExists(join(parent, input.markerName))) candidates.push(parent)
  }
  return candidates
}

function isUnsafePortableParent(parent: string): boolean {
  if (parent !== parse(parent).root) return false
  return !/^[a-zA-Z]:[\\/]$/.test(parent)
}

function isSameOrWithin(candidate: string, parent: string): boolean {
  const result = relative(resolve(parent), resolve(candidate))
  return result === ''
    || (!result.startsWith(`..${sep}`) && result !== '..' && !isAbsolute(result))
}

function isUnsafeProjectRoot(
  projectPath: string,
  configDir: string,
  homeDir: string,
): boolean {
  const normalizedProjectPath = resolve(projectPath)
  return (
    dirname(normalizedProjectPath) === normalizedProjectPath
    || normalizedProjectPath === resolve(homeDir)
    || isSameOrWithin(configDir, normalizedProjectPath)
  )
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

async function isRecognizedPortableBundle(target: string): Promise<boolean> {
  try {
    return (await readFile(join(target, USB_PORTABLE_MARKER), 'utf8')).trim() === 'cybercode-portable-v1'
  } catch {
    return false
  }
}

async function availableBytes(target: string): Promise<number | null> {
  try {
    const stats = await statfs(target)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return null
  }
}

function releaseSummary(manifest: PortableReleaseManifest): UsbMigrationScan['release'] {
  return {
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    platforms: Object.fromEntries(
      Object.entries(manifest.platforms).map(([platform, asset]) => [
        platform,
        {
          filename: asset.filename,
          sizeBytes: asset.size,
          archiveType: asset.archiveType,
        },
      ]),
    ),
  }
}

function validateReleaseManifest(value: unknown): PortableReleaseManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('便携运行包清单格式无效')
  }
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== 2
    || typeof record.version !== 'string'
    || !record.version.trim()
    || typeof record.generatedAt !== 'string'
    || !record.platforms
    || typeof record.platforms !== 'object'
    || Array.isArray(record.platforms)
  ) {
    throw new Error('便携运行包清单缺少必要字段')
  }

  const platforms = {} as Record<UsbMigrationPlatform, PortableReleaseAsset>
  for (const platform of VALID_PLATFORMS) {
    const candidate = (record.platforms as Record<string, unknown>)[platform]
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`便携运行包清单缺少 ${platform}`)
    }
    const asset = candidate as Record<string, unknown>
    const archiveType = asset.archiveType
    if (
      typeof asset.filename !== 'string'
      || !asset.filename
      || basename(asset.filename) !== asset.filename
      || typeof asset.size !== 'number'
      || !Number.isSafeInteger(asset.size)
      || asset.size <= 0
      || asset.size > MAX_PORTABLE_ASSET_BYTES
      || typeof asset.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/i.test(asset.sha256)
      || typeof asset.signature !== 'string'
      || asset.signature.length === 0
      || asset.signature.length > 4_096
      || !/^[a-zA-Z0-9+/=]+$/.test(asset.signature)
      || !['app-tar-gz', 'zip', 'appimage'].includes(String(archiveType))
    ) {
      throw new Error(`${platform} 便携运行包字段无效`)
    }
    platforms[platform] = {
      filename: asset.filename,
      size: asset.size,
      sha256: asset.sha256.toLowerCase(),
      signature: asset.signature,
      archiveType: archiveType as PortableArchiveType,
      urls: Array.isArray(asset.urls)
        ? asset.urls.filter((url): url is string =>
          typeof url === 'string' && /^https:\/\//.test(url))
        : undefined,
    }
  }

  return {
    schemaVersion: 2,
    version: record.version,
    generatedAt: record.generatedAt,
    platforms,
  }
}

function archiveUrls(manifestUrl: string, filename: string): string[] {
  const officialManifest = manifestUrl.includes('/https://')
    ? manifestUrl.slice(manifestUrl.indexOf('/https://') + 1)
    : manifestUrl
  const official = officialManifest.replace(/portable\.json(?:\?.*)?$/, filename)
  return [...new Set([
    official,
    `https://gh-proxy.com/${official}`,
    `https://ghfast.top/${official}`,
  ])]
}

function migrationVolumeResourceKey(targetPath: string): string {
  const normalized = resolve(targetPath)
  const root = parse(normalized).root
  const relativeParts = normalized.slice(root.length).split(sep).filter(Boolean)
  if (root === sep && relativeParts[0] === 'Volumes' && relativeParts[1]) {
    return `usb-volume:${join(root, relativeParts[0], relativeParts[1])}`
  }
  if (
    root === sep
    && (relativeParts[0] === 'media' || relativeParts[0] === 'mnt')
    && relativeParts[1]
  ) {
    return `usb-volume:${join(root, relativeParts[0], relativeParts[1])}`
  }
  if (
    root === sep
    && relativeParts[0] === 'run'
    && relativeParts[1] === 'media'
    && relativeParts[2]
  ) {
    return `usb-volume:${join(root, relativeParts[0], relativeParts[1], relativeParts[2])}`
  }
  return `usb-volume:${root || normalized}`
}

function portableTargetKey(targetPath: string): string {
  const normalized = resolve(targetPath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function writePortableMetadata(
  root: string,
  input: {
    createdAt: string
    releaseVersion: string | null
    projects: Array<{ id: string; name: string; relativePath: string }>
    platforms: UsbMigrationPlatform[]
  },
): Promise<void> {
  await writeFile(join(root, USB_PORTABLE_MARKER), 'cybercode-portable-v1\n')
  await writeFile(
    join(root, 'portable.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      ...input,
    }, null, 2)}\n`,
  )
  await writeFile(
    join(root, 'README.txt'),
    [
      'CyberCode Portable',
      '',
      'macOS: double-click Start-CyberCode.command',
      'Windows: double-click Start-CyberCode.cmd',
      'Linux: run ./Start-CyberCode.sh',
      '',
      'The data/config directory contains account credentials and local settings.',
      'Keep this drive secure and eject it only after CyberCode is closed.',
      '',
      'macOS：双击 Start-CyberCode.command',
      'Windows：双击 Start-CyberCode.cmd',
      'Linux：运行 ./Start-CyberCode.sh',
      '',
      'data/config 中包含账号凭据和本地设置，请妥善保管 U 盘，并在退出 CyberCode 后再弹出。',
      '',
    ].join('\n'),
  )
}

async function writePortableLaunchers(root: string): Promise<void> {
  const shellLauncher = `#!/usr/bin/env bash
set -u

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export CYBER_CONFIG_DIR="$ROOT/data/config"
export CLAUDE_CONFIG_DIR="$CYBER_CONFIG_DIR"
export CYBER_PORTABLE_ROOT="$ROOT"

OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$OS" = "Darwin" ]; then
  if [ "$ARCH" = "arm64" ]; then
    PLATFORM="macos-arm64"
  else
    PLATFORM="macos-x64"
  fi
  ARCHIVE="$(find "$ROOT/packages/$PLATFORM" -maxdepth 1 -type f -name '*.tar.gz' -print -quit 2>/dev/null)"
  APP_ROOT="$ROOT/apps/$PLATFORM"
  APP_BUNDLE="$(find "$APP_ROOT" -type d -name 'CyberCode.app' -print -quit 2>/dev/null)"
  if [ -z "$APP_BUNDLE" ]; then
    if [ -z "$ARCHIVE" ]; then
      echo "CyberCode package for $PLATFORM is missing."
      exit 1
    fi
    mkdir -p "$APP_ROOT"
    tar -xzf "$ARCHIVE" -C "$APP_ROOT" || exit 1
    APP_BUNDLE="$(find "$APP_ROOT" -type d -name 'CyberCode.app' -print -quit 2>/dev/null)"
  fi
  if [ -z "$APP_BUNDLE" ]; then
    echo "CyberCode app bundle was not found after extraction."
    exit 1
  fi
  EXECUTABLE_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_BUNDLE/Contents/Info.plist" 2>/dev/null || true)"
  case "$EXECUTABLE_NAME" in
    ''|*/*)
      echo "CyberCode bundle has an invalid CFBundleExecutable."
      exit 1
      ;;
  esac
  EXECUTABLE="$APP_BUNDLE/Contents/MacOS/$EXECUTABLE_NAME"
  if [ ! -f "$EXECUTABLE" ]; then
    echo "CyberCode executable was not found after extraction."
    exit 1
  fi
  chmod +x "$EXECUTABLE" 2>/dev/null || true
  exec "$EXECUTABLE" "$@"
fi

if [ "$OS" = "Linux" ]; then
  if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "amd64" ]; then
    echo "This portable bundle currently supports Linux x64."
    exit 1
  fi
  APPIMAGE="$(find "$ROOT/packages/linux-x64" -maxdepth 1 -type f -name '*.AppImage' -print -quit 2>/dev/null)"
  if [ -z "$APPIMAGE" ]; then
    echo "CyberCode AppImage is missing."
    exit 1
  fi
  chmod +x "$APPIMAGE" || exit 1
  APPIMAGE_EXTRACT_AND_RUN=1 exec "$APPIMAGE" "$@"
fi

echo "Unsupported operating system: $OS"
exit 1
`

  const powerShellLauncher = `$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:CYBER_CONFIG_DIR = Join-Path $Root "data\\config"
$env:CLAUDE_CONFIG_DIR = $env:CYBER_CONFIG_DIR
$env:CYBER_PORTABLE_ROOT = $Root

$Package = Get-ChildItem (Join-Path $Root "packages\\windows-x64") -Filter *.zip -File | Select-Object -First 1
if (-not $Package) {
  throw "CyberCode Windows portable package is missing."
}

$AppRoot = Join-Path $Root "apps\\windows-x64"
$Executable = Get-ChildItem $AppRoot -Recurse -Filter *.exe -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match "CyberCode|cybercode-desktop" -and $_.Name -notmatch "sidecar|uninstall" } |
  Select-Object -First 1

if (-not $Executable) {
  New-Item -ItemType Directory -Path $AppRoot -Force | Out-Null
  Expand-Archive -LiteralPath $Package.FullName -DestinationPath $AppRoot -Force
  $Executable = Get-ChildItem $AppRoot -Recurse -Filter *.exe -File |
    Where-Object { $_.Name -match "CyberCode|cybercode-desktop" -and $_.Name -notmatch "sidecar|uninstall" } |
    Select-Object -First 1
}

if (-not $Executable) {
  throw "CyberCode executable was not found after extraction."
}

$LaunchOptions = @{
  FilePath = $Executable.FullName
  WorkingDirectory = $Executable.DirectoryName
}
if ($args.Count -gt 0) {
  $LaunchOptions.ArgumentList = $args
}
Start-Process @LaunchOptions
`

  const cmdLauncher = `@echo off
set SCRIPT_DIR=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Start-CyberCode.ps1" %*
if errorlevel 1 pause
`

  const shellPath = join(root, 'Start-CyberCode.sh')
  const commandPath = join(root, 'Start-CyberCode.command')
  await writeFile(shellPath, shellLauncher)
  await writeFile(commandPath, shellLauncher)
  await writeFile(join(root, 'Start-CyberCode.ps1'), powerShellLauncher)
  await writeFile(join(root, 'Start-CyberCode.cmd'), cmdLauncher)
  await chmod(shellPath, 0o755).catch(() => {})
  await chmod(commandPath, 0o755).catch(() => {})
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  let failed = false
  let failure: unknown
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (cursor < values.length && !failed) {
        const index = cursor
        cursor += 1
        try {
          results[index] = await mapper(values[index]!)
        } catch (error) {
          failed = true
          failure = error
        }
      }
    },
  )
  await Promise.all(workers)
  if (failed) throw failure
  return results
}

export const usbMigrationService = new UsbMigrationService()
