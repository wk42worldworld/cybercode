import * as fs from 'node:fs'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export type RtkShell = 'bash' | 'powershell'

export type RtkStats = {
  totalCommands: number
  totalInput: number
  totalOutput: number
  totalSaved: number
  averageSavingsPercent: number
}

export type RtkStatus = {
  enabled: boolean
  available: boolean
  version: string | null
  stats: RtkStats | null
  error: string | null
}

type StoredConfig = {
  version: 1
  enabled: boolean
}

type RtkResult = {
  exitCode: number
  stdout: string
  stderr: string
}

const DEFAULT_CONFIG: StoredConfig = { version: 1, enabled: false }
const RTK_TIMEOUT_MS = 1_500

export class RtkOptimizationService {
  private cachedConfig: StoredConfig | null = null
  private cachedConfigMtimeMs: number | null = null
  private cachedBinaryPath: string | null | undefined

  isEnabled() {
    return this.readConfig().enabled
  }

  async getStatus(): Promise<RtkStatus> {
    const binaryPath = this.resolveBinaryPath()
    if (!binaryPath) {
      return {
        enabled: this.isEnabled(),
        available: false,
        version: null,
        stats: null,
        error: 'RTK runtime is unavailable',
      }
    }

    try {
      const [versionResult, gainResult] = await Promise.all([
        this.runRtk(binaryPath, ['--version']),
        this.runRtk(binaryPath, ['gain', '--format', 'json']),
      ])
      if (versionResult.exitCode !== 0) {
        throw new Error(versionResult.stderr || versionResult.stdout || 'RTK version check failed')
      }

      return {
        enabled: this.isEnabled(),
        available: true,
        version: versionResult.stdout.trim().replace(/^rtk\s+/i, '') || null,
        stats: gainResult.exitCode === 0 ? parseStats(gainResult.stdout) : null,
        error: null,
      }
    } catch (error) {
      return {
        enabled: this.isEnabled(),
        available: false,
        version: null,
        stats: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async setEnabled(enabled: boolean): Promise<RtkStatus> {
    this.writeConfig({ version: 1, enabled })
    return this.getStatus()
  }

  async rewriteCommand(command: string, shell: RtkShell): Promise<string> {
    if (!command.trim() || !this.isEnabled()) return command
    const binaryPath = this.resolveBinaryPath()
    if (!binaryPath) return command

    // CyberCode bundles RTK as a local optimization detail. Never inherit an
    // opt-in from a separate system RTK installation; savings stats stay local.
    process.env.RTK_TELEMETRY_DISABLED = '1'

    try {
      const result = await this.runRtk(binaryPath, ['rewrite', command])
      const rewritten = result.stdout.trim() || buildTestRunnerFallback(command)
      // RTK 0.43 returns code 3 when its own global hook is not installed,
      // even though `rewrite` produced a valid command. CyberCode deliberately
      // owns interception itself, so validate the output instead of requiring 0.
      if (!rewritten) return command

      return buildRtkCommand(rewritten, binaryPath, shell) ?? command
    } catch {
      return command
    }
  }

  resetForTesting() {
    this.cachedConfig = null
    this.cachedConfigMtimeMs = null
    this.cachedBinaryPath = undefined
  }

  private resolveBinaryPath(): string | null {
    if (this.cachedBinaryPath !== undefined) return this.cachedBinaryPath

    const candidates = [
      process.env.CYBER_RTK_PATH,
      path.join(
        path.resolve(import.meta.dir, '..', '..'),
        'desktop',
        'src-tauri',
        'resources',
        'rtk',
        process.platform === 'win32' ? 'rtk.exe' : 'rtk',
      ),
      Bun.which('rtk'),
    ]

    this.cachedBinaryPath = candidates.find((candidate) =>
      typeof candidate === 'string' && candidate.length > 0 && fs.existsSync(candidate)
    ) ?? null
    return this.cachedBinaryPath
  }

  private getConfigPath() {
    return path.join(getClaudeConfigHomeDir(), 'cybercode', 'rtk.json')
  }

  private readConfig(): StoredConfig {
    const configPath = this.getConfigPath()
    let mtimeMs: number | null = null
    try {
      mtimeMs = fs.statSync(configPath).mtimeMs
    } catch {
      // Missing settings use the disabled default below.
    }
    if (this.cachedConfig && this.cachedConfigMtimeMs === mtimeMs) {
      return this.cachedConfig
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<StoredConfig>
      this.cachedConfig = {
        version: 1,
        enabled: parsed.enabled === true,
      }
    } catch {
      this.cachedConfig = { ...DEFAULT_CONFIG }
    }
    this.cachedConfigMtimeMs = mtimeMs
    return this.cachedConfig
  }

  private writeConfig(config: StoredConfig) {
    const configPath = this.getConfigPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 })
    const temporaryPath = `${configPath}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporaryPath, configPath)
    this.cachedConfig = config
    this.cachedConfigMtimeMs = fs.statSync(configPath).mtimeMs
  }

  private async runRtk(binaryPath: string, args: string[]): Promise<RtkResult> {
    const proc = Bun.spawn([binaryPath, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RTK_NO_UPDATE_CHECK: '1',
        RTK_TELEMETRY_DISABLED: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const exitCode = await Promise.race([
        proc.exited,
        new Promise<number>((_, reject) => {
          timeout = setTimeout(() => {
            proc.kill()
            reject(new Error('RTK command timed out'))
          }, RTK_TIMEOUT_MS)
        }),
      ])
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      return { exitCode, stdout, stderr }
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}

function quoteExecutable(executablePath: string, shell: RtkShell) {
  if (shell === 'powershell') {
    return `& '${executablePath.replaceAll("'", "''")}'`
  }
  return `'${executablePath.replaceAll("'", "'\\''")}'`
}

export function buildRtkCommand(
  rewritten: string,
  binaryPath: string,
  shell: RtkShell,
) {
  const commandPosition = /(^|(?:&&|\|\||[;|\n(])\s*)rtk(?:\.exe)?(?=\s|$)/i
  if (!commandPosition.test(rewritten)) return null
  const executable = quoteExecutable(binaryPath, shell)
  return rewritten.replace(
    /(^|(?:&&|\|\||[;|\n(])\s*)rtk(?:\.exe)?(?=\s|$)/gi,
    (_match, prefix: string) => `${prefix}${executable}`,
  )
}

export function buildTestRunnerFallback(command: string) {
  const trimmed = command.trim()
  const testRunner = /^(?:bun|npm|pnpm|yarn)(?:\s+run)?\s+test(?=\s|$)/i
  return testRunner.test(trimmed) ? `rtk test ${trimmed}` : ''
}

function parseStats(raw: string): RtkStats | null {
  try {
    const parsed = JSON.parse(raw) as {
      summary?: Record<string, unknown>
    }
    const summary = parsed.summary
    if (!summary) return null
    return {
      totalCommands: numberValue(summary.total_commands),
      totalInput: numberValue(summary.total_input),
      totalOutput: numberValue(summary.total_output),
      totalSaved: numberValue(summary.total_saved),
      averageSavingsPercent: numberValue(summary.avg_savings_pct),
    }
  } catch {
    return null
  }
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export const rtkOptimizationService = new RtkOptimizationService()
