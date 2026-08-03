import { api } from './client'

export type UsbMigrationPlatform =
  | 'macos-arm64'
  | 'macos-x64'
  | 'windows-x64'
  | 'linux-x64'

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
      archiveType: 'app-tar-gz' | 'zip' | 'appimage'
    }>>
  } | null
  releaseError: string | null
}

export type UsbMigrationJob = {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  stage:
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

export type PortablePathStatus = {
  active: boolean
  rootPath: string | null
  registryPath: string | null
  projectCount: number
}

export type PortablePathRepairResult = PortablePathStatus & {
  scannedSessions: number
  eligibleSessions: number
  repairedSessions: number
  failedSessions: number
}

export const usbMigrationApi = {
  scan: (force = false, signal?: AbortSignal) =>
    api.get<UsbMigrationScan>(
      `/api/usb-migration/scan${force ? '?force=true' : ''}`,
      { timeout: 120_000, signal },
    ),

  start: (input: {
    destinationPath: string
    projectIds: string[]
    platforms: UsbMigrationPlatform[]
    includeApplications: boolean
    replaceExisting?: boolean
  }) =>
    api.post<UsbMigrationJob>(
      '/api/usb-migration/start',
      input,
      { timeout: 120_000 },
    ),

  getJob: (jobId: string) =>
    api.get<UsbMigrationJob>(
      `/api/usb-migration/jobs/${encodeURIComponent(jobId)}`,
    ),

  cancel: (jobId: string) =>
    api.post<UsbMigrationJob>(
      `/api/usb-migration/jobs/${encodeURIComponent(jobId)}/cancel`,
    ),

  getRecoveryStatus: () =>
    api.get<UsbMigrationRecoveryStatus>('/api/usb-migration/recovery'),

  getPortablePathStatus: () =>
    api.get<PortablePathStatus>('/api/usb-migration/portable-paths'),

  repairPortableProjectPaths: () =>
    api.post<PortablePathRepairResult>(
      '/api/usb-migration/portable-paths/repair',
      undefined,
      { timeout: 5 * 60_000 },
    ),
}
