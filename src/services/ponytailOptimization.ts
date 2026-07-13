import * as fs from 'node:fs'
import * as path from 'node:path'
import ponytailRules from '../defaults/ponytail-rules.md' with { type: 'text' }
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export type PonytailStatus = {
  enabled: boolean
  mode: 'full'
}

type StoredConfig = {
  version: 1
  enabled: boolean
}

const DEFAULT_CONFIG: StoredConfig = { version: 1, enabled: false }

// Adapted for CyberCode from DietrichGebert/ponytail's MIT-licensed rules.
// Source: https://github.com/DietrichGebert/ponytail
const PONYTAIL_SYSTEM_PROMPT = ponytailRules.trimEnd()

export class PonytailOptimizationService {
  private cachedConfig: StoredConfig | null = null
  private cachedConfigSignature: string | null = null

  isEnabled() {
    return this.readConfig().enabled
  }

  getStatus(): PonytailStatus {
    return {
      enabled: this.isEnabled(),
      mode: 'full',
    }
  }

  setEnabled(enabled: boolean): PonytailStatus {
    this.writeConfig({ version: 1, enabled })
    return this.getStatus()
  }

  getSystemPrompt(): string | null {
    return this.isEnabled() ? PONYTAIL_SYSTEM_PROMPT : null
  }

  resetForTesting() {
    this.cachedConfig = null
    this.cachedConfigSignature = null
  }

  private getConfigPath() {
    return path.join(getClaudeConfigHomeDir(), 'cybercode', 'ponytail.json')
  }

  private readConfig(): StoredConfig {
    const configPath = this.getConfigPath()
    let signature: string | null = null
    try {
      signature = this.getFileSignature(fs.statSync(configPath))
    } catch {
      // Missing settings use the disabled default below.
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

export const ponytailOptimizationService = new PonytailOptimizationService()
