import { createHash, randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { isAnalyticsDisabled } from './analytics/config.js'
import { getGlobalClaudeFile } from '../utils/env.js'
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from '../utils/envUtils.js'

const DEFAULT_ENDPOINT =
  'https://www.mybotworld.com/api/cybercode-usage/heartbeat'
const REPORT_INTERVAL_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 2500
const STATE_VERSION = 1
const STARTUP_RETRY_DELAYS_MS = [5_000, 30_000, 5 * 60_000] as const
const INSTALLATION_ID_PATTERN = /^[a-f0-9]{64}$/

export type CybercodeUsageSurface = 'cli' | 'desktop'
export type CybercodeUsageReportResult = 'sent' | 'skipped' | 'failed'

type UsageState = {
  version: typeof STATE_VERSION
  lastReportedDay?: string
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

type ReportOptions = {
  configDir?: string
  endpoint?: string
  fetchImpl?: FetchLike
  getUserId?: () => string
  globalConfigPath?: string
  isDisabled?: () => boolean
  now?: () => Date
  version?: string
  platform?: string
  arch?: string
  timeoutMs?: number
}

type ReporterOptions = ReportOptions & {
  reportIntervalMs?: number
  retryDelaysMs?: readonly number[]
}

type ReporterState = {
  periodicTimer: ReturnType<typeof setInterval>
  retryTimer?: ReturnType<typeof setTimeout>
  inFlight: boolean
}

const reporters = new Map<CybercodeUsageSurface, ReporterState>()

/**
 * Starts a best-effort reporter without delaying startup. The interval is
 * unreferenced so short-lived CLI commands can still exit immediately.
 */
export function startCybercodeUsageReporter(
  surface: CybercodeUsageSurface,
  options: ReporterOptions = {},
): void {
  const disabled = options.isDisabled
    ? options.isDisabled()
    : isCybercodeUsageAnalyticsDisabled()
  if (disabled || reporters.has(surface)) return

  const timer = setInterval(() => {
    const state = reporters.get(surface)
    if (!state) return
    if (state.retryTimer) {
      clearTimeout(state.retryTimer)
      state.retryTimer = undefined
    }
    void runScheduledReport(surface, options, state, 0)
  }, options.reportIntervalMs ?? REPORT_INTERVAL_MS)
  timer.unref?.()
  const state: ReporterState = { periodicTimer: timer, inFlight: false }
  reporters.set(surface, state)
  void runScheduledReport(surface, options, state, 0)
}

export function _resetCybercodeUsageReportersForTesting(): void {
  for (const state of reporters.values()) {
    clearInterval(state.periodicTimer)
    if (state.retryTimer) clearTimeout(state.retryTimer)
  }
  reporters.clear()
}

/**
 * Reports one anonymous daily heartbeat. Failures are intentionally silent:
 * analytics must never affect startup, conversations, or command execution.
 */
export async function reportCybercodeUsage(
  surface: CybercodeUsageSurface,
  options: ReportOptions = {},
): Promise<CybercodeUsageReportResult> {
  try {
    return await reportCybercodeUsageInternal(surface, options)
  } catch {
    return 'failed'
  }
}

async function reportCybercodeUsageInternal(
  surface: CybercodeUsageSurface,
  options: ReportOptions,
): Promise<CybercodeUsageReportResult> {
  const disabled = options.isDisabled
    ? options.isDisabled()
    : isCybercodeUsageAnalyticsDisabled()
  if (disabled) return 'skipped'

  const now = options.now?.() ?? new Date()
  const reportDay = localDay(now)
  const configDir = options.configDir ?? getClaudeConfigHomeDir()
  const statePath = path.join(
    configDir,
    'cybercode',
    'usage-analytics.json',
  )
  const state = await readState(statePath)
  if (state.lastReportedDay === reportDay) return 'skipped'

  const endpoint = resolveEndpoint(
    options.endpoint ?? process.env.CYBERCODE_USAGE_ANALYTICS_ENDPOINT,
  )
  if (!endpoint) return 'failed'

  const installationId = await getOrCreateInstallationId(configDir, options)
  if (!installationId) return 'failed'
  const payload = {
    schemaVersion: 1,
    installationId,
    version: truncate(options.version ?? getAppVersion(), 64),
    platform: truncate(options.platform ?? process.platform, 32),
    arch: truncate(options.arch ?? process.arch, 32),
    surface,
  }

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  )
  timeout.unref?.()

  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return 'failed'

    await writeState(statePath, {
      version: STATE_VERSION,
      lastReportedDay: reportDay,
    })
    return 'sent'
  } catch {
    return 'failed'
  } finally {
    clearTimeout(timeout)
  }
}

async function runScheduledReport(
  surface: CybercodeUsageSurface,
  options: ReporterOptions,
  state: ReporterState,
  retryIndex: number,
): Promise<void> {
  if (state.inFlight) return
  state.inFlight = true
  const result = await reportCybercodeUsage(surface, options)
  state.inFlight = false

  if (result === 'sent') {
    logForDiagnosticsNoPII('info', 'cybercode_usage_report_sent', { surface })
    return
  }
  if (result !== 'failed') return

  const retryDelays = options.retryDelaysMs ?? STARTUP_RETRY_DELAYS_MS
  const retryDelayMs = retryDelays[retryIndex]
  logForDiagnosticsNoPII('warn', 'cybercode_usage_report_failed', {
    surface,
    retry_attempt: retryIndex,
    retry_delay_ms: retryDelayMs ?? null,
  })
  if (retryDelayMs === undefined || !reporters.has(surface)) return

  state.retryTimer = setTimeout(() => {
    state.retryTimer = undefined
    void runScheduledReport(surface, options, state, retryIndex + 1)
  }, retryDelayMs)
  state.retryTimer.unref?.()
}

export function isCybercodeUsageAnalyticsDisabled(): boolean {
  return (
    isAnalyticsDisabled() ||
    isEnvTruthy(process.env.CYBERCODE_USAGE_ANALYTICS_DISABLED) ||
    isEnvTruthy(process.env.DO_NOT_TRACK)
  )
}

function getAppVersion(): string {
  if (typeof MACRO !== 'undefined' && MACRO.VERSION) return MACRO.VERSION
  return process.env.APP_VERSION || 'unknown'
}

function resolveEndpoint(configured?: string): string | null {
  try {
    const url = new URL(configured?.trim() || DEFAULT_ENDPOINT)
    const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

function localDay(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function truncate(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength) || 'unknown'
}

async function getOrCreateInstallationId(
  configDir: string,
  options: ReportOptions,
): Promise<string | null> {
  const installationIdPath = path.join(
    configDir,
    'cybercode',
    'installation-id',
  )
  const existing = await readInstallationId(installationIdPath)
  if (existing) return existing

  const legacyUserId = await readLegacyUserId(options)
  const candidate = legacyUserId
    ? hashLegacyUserId(legacyUserId)
    : randomBytes(32).toString('hex')

  try {
    await fs.mkdir(path.dirname(installationIdPath), { recursive: true })
    const temporaryPath = `${installationIdPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await fs.writeFile(temporaryPath, `${candidate}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      await fs.link(temporaryPath, installationIdPath)
      return candidate
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        return await readInstallationId(installationIdPath)
      }
      throw error
    } finally {
      await fs.rm(temporaryPath, { force: true })
    }
  } catch {
    // A migrated ID is deterministic even when the config directory is
    // read-only. A newly generated ID must be persisted before it is sent,
    // otherwise every launch could be counted as a different installation.
    return legacyUserId ? candidate : null
  }
}

async function readInstallationId(filePath: string): Promise<string | null> {
  try {
    const installationId = (await fs.readFile(filePath, 'utf8')).trim()
    return INSTALLATION_ID_PATTERN.test(installationId)
      ? installationId
      : null
  } catch {
    return null
  }
}

async function readLegacyUserId(options: ReportOptions): Promise<string | null> {
  if (options.getUserId) {
    try {
      return normalizeLegacyUserId(options.getUserId())
    } catch {
      return null
    }
  }

  try {
    const configPath = options.globalConfigPath ?? getGlobalClaudeFile()
    const parsed = JSON.parse(await fs.readFile(configPath, 'utf8')) as {
      userID?: unknown
    }
    return normalizeLegacyUserId(parsed.userID)
  } catch {
    return null
  }
}

function normalizeLegacyUserId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function hashLegacyUserId(userId: string): string {
  return createHash('sha256')
    .update('cybercode-usage-v1\0')
    .update(userId)
    .digest('hex')
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EEXIST'
  )
}

async function readState(filePath: string): Promise<UsageState> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as Partial<UsageState>
    return {
      version: STATE_VERSION,
      lastReportedDay:
        typeof parsed.lastReportedDay === 'string'
          ? parsed.lastReportedDay
          : undefined,
    }
  } catch {
    return { version: STATE_VERSION }
  }
}

async function writeState(filePath: string, state: UsageState): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
  } catch {
    // A read-only config directory may cause another heartbeat later. The
    // server de-duplicates by installation and day, so this remains harmless.
  }
}
