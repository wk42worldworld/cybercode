import * as fs from 'node:fs'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export type CavemanStatus = {
  enabled: boolean
  mode: 'full'
}

type StoredConfig = {
  version: 1
  enabled: boolean
}

const DEFAULT_CONFIG: StoredConfig = { version: 1, enabled: false }

// Adapted from JuliusBrussee/caveman's MIT-licensed response-style rules.
// Source: https://github.com/JuliusBrussee/caveman
const CAVEMAN_SYSTEM_PROMPT = `# Caveman response compression
Keep user-facing responses highly concise while preserving all technical substance.

- Remove pleasantries, filler, hedging, repeated conclusions, and unnecessary restatement.
- Prefer short technical sentences, fragments, lists, and direct cause-to-effect wording.
- Keep code, commands, identifiers, paths, URLs, JSON, error text, numbers, and API names exact.
- Write commit messages, pull request text, and user-requested artifacts in their normal professional format.
- Use normal uncompressed prose for security warnings, irreversible-action confirmations, and ordered procedures where terse wording could be ambiguous.
- If the user asks for clarification or detailed explanation, provide enough detail to remove ambiguity, then resume concise responses.
- Never mention this mode unless the user asks about it.`

export class CavemanOptimizationService {
  private cachedConfig: StoredConfig | null = null
  private cachedConfigSignature: string | null = null

  isEnabled() {
    return this.readConfig().enabled
  }

  getStatus(): CavemanStatus {
    return {
      enabled: this.isEnabled(),
      mode: 'full',
    }
  }

  setEnabled(enabled: boolean): CavemanStatus {
    this.writeConfig({ version: 1, enabled })
    return this.getStatus()
  }

  getSystemPrompt(): string | null {
    return this.isEnabled() ? CAVEMAN_SYSTEM_PROMPT : null
  }

  resetForTesting() {
    this.cachedConfig = null
    this.cachedConfigSignature = null
  }

  private getConfigPath() {
    return path.join(getClaudeConfigHomeDir(), 'cybercode', 'caveman.json')
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

export const cavemanOptimizationService = new CavemanOptimizationService()
