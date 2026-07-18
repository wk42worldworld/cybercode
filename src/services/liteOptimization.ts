import * as fs from 'node:fs'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export type LiteOptimizationStatus = {
  enabled: boolean
  mode: 'deterministic'
}

type StoredConfig = {
  version: 1
  enabled: boolean
}

const DEFAULT_CONFIG: StoredConfig = { version: 1, enabled: true }

export class LiteOptimizationService {
  private cachedConfig: StoredConfig | null = null
  private cachedConfigSignature: string | null = null

  isEnabled() {
    return this.readConfig().enabled
  }

  getStatus(): LiteOptimizationStatus {
    return {
      enabled: this.isEnabled(),
      mode: 'deterministic',
    }
  }

  setEnabled(enabled: boolean): LiteOptimizationStatus {
    this.writeConfig({ version: 1, enabled })
    return this.getStatus()
  }

  cleanSystemPrompt(parts: readonly string[]): string[] {
    if (!this.isEnabled()) return [...parts]
    return cleanSystemPromptParts(parts)
  }

  resetForTesting() {
    this.cachedConfig = null
    this.cachedConfigSignature = null
  }

  private getConfigPath() {
    return path.join(getClaudeConfigHomeDir(), 'cybercode', 'lite-optimization.json')
  }

  private readConfig(): StoredConfig {
    const configPath = this.getConfigPath()
    let signature: string | null = null
    try {
      signature = this.getFileSignature(fs.statSync(configPath))
    } catch {
      // Missing settings use the enabled default below.
    }

    if (this.cachedConfig && this.cachedConfigSignature === signature) {
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
    this.cachedConfigSignature = signature
    return this.cachedConfig
  }

  private writeConfig(config: StoredConfig) {
    const configPath = this.getConfigPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 })
    const temporaryPath = `${configPath}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporaryPath, configPath)
    this.cachedConfig = config
    this.cachedConfigSignature = this.getFileSignature(fs.statSync(configPath))
  }

  private getFileSignature(stat: fs.Stats) {
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`
  }
}

export function cleanSystemPromptParts(parts: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const part of parts) {
    const cleaned = cleanPromptText(part)
    if (!cleaned || seen.has(cleaned)) continue
    seen.add(cleaned)
    result.push(cleaned)
  }

  return result
}

function cleanPromptText(value: string) {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  const result: string[] = []
  let fence: '```' | '~~~' | null = null
  let pendingBlank = false

  for (const rawLine of lines) {
    const trimmedStart = rawLine.trimStart()
    const fenceMarker = trimmedStart.startsWith('```')
      ? '```'
      : trimmedStart.startsWith('~~~')
        ? '~~~'
        : null

    if (fence) {
      result.push(rawLine)
      if (fenceMarker === fence) fence = null
      continue
    }

    const line = rawLine.replace(/[ \t]+$/g, '')
    if (fenceMarker) {
      if (pendingBlank && result.length > 0) result.push('')
      pendingBlank = false
      result.push(line)
      fence = fenceMarker
      continue
    }

    if (line.trim().length === 0) {
      pendingBlank = result.length > 0
      continue
    }

    if (pendingBlank) result.push('')
    pendingBlank = false
    result.push(line)
  }

  return result.join('\n')
}

export const liteOptimizationService = new LiteOptimizationService()
