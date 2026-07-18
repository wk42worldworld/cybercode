import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { isAnalyticsDisabled } from './analytics/config.js'
import { getOrCreateUserID } from '../utils/config.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from '../utils/envUtils.js'

const DEFAULT_ENDPOINT =
  'https://www.mybotworld.com/api/cybercode-usage/heartbeat'
const REPORT_INTERVAL_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 2500
const STATE_VERSION = 1

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
  isDisabled?: () => boolean
  now?: () => Date
  version?: string
  platform?: string
  arch?: string
  timeoutMs?: number
}

const reporters = new Map<CybercodeUsageSurface, ReturnType<typeof setInterval>>()

/**
 * Starts a best-effort reporter without delaying startup. The interval is
 * unreferenced so short-lived CLI commands can still exit immediately.
 */
export function startCybercodeUsageReporter(
  surface: CybercodeUsageSurface,
): void {
  if (isCybercodeUsageAnalyticsDisabled() || reporters.has(surface)) return

  void reportCybercodeUsage(surface)
  const timer = setInterval(() => {
    void reportCybercodeUsage(surface)
  }, REPORT_INTERVAL_MS)
  timer.unref?.()
  reporters.set(surface, timer)
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

  const userId = (options.getUserId ?? getOrCreateUserID)()
  const installationId = createHash('sha256')
    .update('cybercode-usage-v1\0')
    .update(userId)
    .digest('hex')
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
