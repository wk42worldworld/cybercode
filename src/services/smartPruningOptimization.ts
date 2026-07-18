import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export type SmartPruningLevel = 'conservative' | 'balanced' | 'aggressive'

export type SmartPruningStatus = {
  enabled: boolean
  level: SmartPruningLevel
  mode: 'deterministic'
}

export type SmartPruningStats = {
  prunedToolResults: number
  duplicateResults: number
  supersededReads: number
  truncatedResults: number
  savedCharacters: number
}

type StoredConfig = {
  version: 1
  enabled: boolean
  level: SmartPruningLevel
}

type OptimizationMessage = {
  type: string
  message: {
    content: unknown
  }
}

type ToolMetadata = {
  name: string
  path: string | null
  isRead: boolean
}

type PruningPolicy = {
  recentMessageCount: number
  maxToolResultChars: number
  retainedChars: number
}

const DEFAULT_CONFIG: StoredConfig = {
  version: 1,
  enabled: false,
  level: 'balanced',
}

const PRUNING_POLICIES: Record<SmartPruningLevel, PruningPolicy> = {
  conservative: {
    recentMessageCount: 20,
    maxToolResultChars: 32_000,
    retainedChars: 16_000,
  },
  balanced: {
    recentMessageCount: 14,
    maxToolResultChars: 16_000,
    retainedChars: 8_000,
  },
  aggressive: {
    recentMessageCount: 8,
    maxToolResultChars: 6_000,
    retainedChars: 2_400,
  },
}

export class SmartPruningOptimizationService {
  private cachedConfig: StoredConfig | null = null
  private cachedConfigSignature: string | null = null

  getStatus(): SmartPruningStatus {
    const config = this.readConfig()
    return {
      enabled: config.enabled,
      level: config.level,
      mode: 'deterministic',
    }
  }

  setEnabled(enabled: boolean): SmartPruningStatus {
    const config = this.readConfig()
    this.writeConfig({ ...config, enabled })
    return this.getStatus()
  }

  setLevel(level: SmartPruningLevel): SmartPruningStatus {
    if (!isSmartPruningLevel(level)) {
      throw new Error(`Unknown smart pruning level: ${level}`)
    }
    const config = this.readConfig()
    this.writeConfig({ ...config, level })
    return this.getStatus()
  }

  optimizeMessages<T extends OptimizationMessage>(messages: readonly T[]) {
    const config = this.readConfig()
    if (!config.enabled) {
      return {
        messages: [...messages],
        stats: createEmptyStats(),
      }
    }
    return pruneMessagesForAPI(messages, config.level)
  }

  resetForTesting() {
    this.cachedConfig = null
    this.cachedConfigSignature = null
  }

  private getConfigPath() {
    return path.join(getClaudeConfigHomeDir(), 'cybercode', 'smart-pruning.json')
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
        level: isSmartPruningLevel(parsed.level) ? parsed.level : DEFAULT_CONFIG.level,
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

export function pruneMessagesForAPI<T extends OptimizationMessage>(
  messages: readonly T[],
  level: SmartPruningLevel,
): { messages: T[]; stats: SmartPruningStats } {
  const policy = PRUNING_POLICIES[level]
  const recentBoundary = Math.max(0, messages.length - policy.recentMessageCount)
  const toolMetadata = collectToolMetadata(messages)
  const seenResults = new Set<string>()
  const seenReadPaths = new Set<string>()
  const stats = createEmptyStats()
  const nextMessages = [...messages]

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex]
    if (!message || message.type !== 'user' || !Array.isArray(message.message.content)) continue

    const content = message.message.content as Array<Record<string, unknown>>
    let nextContent: Array<Record<string, unknown>> | null = null

    for (let blockIndex = content.length - 1; blockIndex >= 0; blockIndex--) {
      const block = content[blockIndex]
      if (!isToolResultBlock(block)) continue

      const originalText = getTextOnlyToolResult(block.content)
      if (!originalText) continue

      const fingerprint = fingerprintText(originalText)
      const metadata = toolMetadata.get(block.tool_use_id)
      const normalizedPath = metadata?.path ? normalizePathKey(metadata.path) : null
      const isDuplicate = seenResults.has(fingerprint)
      const isSupersededRead = Boolean(
        metadata?.isRead
        && normalizedPath
        && seenReadPaths.has(normalizedPath),
      )
      const isOld = messageIndex < recentBoundary

      seenResults.add(fingerprint)
      if (metadata?.isRead && normalizedPath) seenReadPaths.add(normalizedPath)

      if (!isOld || block.is_error === true || looksLikeFailure(originalText)) continue

      let replacement: string | null = null
      let reason: 'duplicate' | 'superseded' | 'truncated' | null = null
      if (isDuplicate) {
        replacement = createOmissionMarker('duplicate', metadata, fingerprint)
        reason = 'duplicate'
      } else if (isSupersededRead) {
        replacement = createOmissionMarker('superseded', metadata, fingerprint)
        reason = 'superseded'
      } else if (originalText.length > policy.maxToolResultChars) {
        replacement = truncateToolResult(originalText, policy.retainedChars, fingerprint)
        reason = 'truncated'
      }

      if (!replacement || replacement.length >= originalText.length) continue
      if (!nextContent) nextContent = [...content]
      nextContent[blockIndex] = { ...block, content: replacement }
      if (reason === 'duplicate') stats.duplicateResults += 1
      if (reason === 'superseded') stats.supersededReads += 1
      if (reason === 'truncated') stats.truncatedResults += 1
      stats.prunedToolResults += 1
      stats.savedCharacters += originalText.length - replacement.length
    }

    if (!nextContent) continue
    nextMessages[messageIndex] = {
      ...message,
      message: {
        ...message.message,
        content: nextContent,
      },
    }
  }

  return { messages: nextMessages, stats }
}

export function isSmartPruningLevel(value: unknown): value is SmartPruningLevel {
  return value === 'conservative' || value === 'balanced' || value === 'aggressive'
}

function collectToolMetadata(messages: readonly OptimizationMessage[]) {
  const metadata = new Map<string, ToolMetadata>()
  for (const message of messages) {
    if (message.type !== 'assistant' || !Array.isArray(message.message.content)) continue
    for (const block of message.message.content) {
      if (!isRecord(block) || block.type !== 'tool_use' || typeof block.id !== 'string') continue
      const name = typeof block.name === 'string' ? block.name : 'tool'
      metadata.set(block.id, {
        name,
        path: extractPath(block.input),
        isRead: isReadTool(name),
      })
    }
  }
  return metadata
}

function extractPath(input: unknown) {
  if (!isRecord(input)) return null
  for (const key of ['file_path', 'path', 'file', 'filename']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function isReadTool(name: string) {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized === 'read'
    || normalized === 'fileread'
    || normalized === 'readfile'
    || normalized === 'readtextfile'
    || normalized.endsWith('fileread')
}

function isToolResultBlock(value: unknown): value is Record<string, unknown> & {
  type: 'tool_result'
  tool_use_id: string
} {
  return isRecord(value)
    && value.type === 'tool_result'
    && typeof value.tool_use_id === 'string'
}

function getTextOnlyToolResult(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content) || content.length === 0) return null
  const text: string[] = []
  for (const item of content) {
    if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') return null
    text.push(item.text)
  }
  return text.join('\n')
}

function createOmissionMarker(
  reason: 'duplicate' | 'superseded',
  metadata: ToolMetadata | undefined,
  fingerprint: string,
) {
  const detail = reason === 'duplicate' ? 'duplicate output' : 'superseded file read'
  const tool = metadata?.name ? `; tool=${sanitizeMarkerValue(metadata.name)}` : ''
  const filePath = metadata?.path ? `; path=${sanitizeMarkerValue(metadata.path)}` : ''
  return `[Smart pruning: omitted older ${detail}${tool}${filePath}; ref=${fingerprint.slice(0, 10)}]`
}

function truncateToolResult(text: string, retainedChars: number, fingerprint: string) {
  const marker = `\n...[Smart pruning: older tool output shortened; ref=${fingerprint.slice(0, 10)}]...\n`
  const available = Math.max(200, retainedChars - marker.length)
  const headLength = Math.ceil(available * 0.58)
  const tailLength = Math.floor(available * 0.42)
  return `${text.slice(0, headLength)}${marker}${text.slice(-tailLength)}`
}

function looksLikeFailure(text: string) {
  const sample = text.slice(0, 2_000)
  return /(^|\n)\s*(error|fatal|panic|exception|traceback)\b/i.test(sample)
    || /(^|\n)\s*(错误|失败|异常|致命错误)[:：]/.test(sample)
}

function fingerprintText(text: string) {
  return createHash('sha256').update(text.replace(/\r\n?/g, '\n')).digest('hex')
}

function normalizePathKey(value: string) {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function sanitizeMarkerValue(value: string) {
  return value.replace(/[\r\n;]+/g, ' ').slice(0, 160)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createEmptyStats(): SmartPruningStats {
  return {
    prunedToolResults: 0,
    duplicateResults: 0,
    supersededReads: 0,
    truncatedResults: 0,
    savedCharacters: 0,
  }
}

export const smartPruningOptimizationService = new SmartPruningOptimizationService()
