/**
 * Settings Service — 读写用户级和项目级设置文件
 *
 * 设置文件为 JSON 格式：
 *   - 用户级: ~/.cyber/settings.json
 *   - 项目级: {projectRoot}/.cyber/settings.json
 *
 * 合并策略：Object.assign({}, userSettings, projectSettings)
 */

import * as fs from 'fs/promises'
import { randomBytes } from 'node:crypto'
import * as path from 'path'
import {
  ensureProjectConfigDirMigration,
  getClaudeConfigHomeDir,
  getExistingProjectConfigPath,
  getProjectConfigPath,
} from '../../utils/envUtils.js'
import { ApiError } from '../middleware/errorHandler.js'

const VALID_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'dontAsk',
] as const
export const DEFAULT_PERMISSION_MODE = 'bypassPermissions'
const MASKED_SECRET = '••••••••'

function restoreMaskedSettingsValues(
  incoming: unknown,
  current: unknown,
): unknown {
  if (incoming === MASKED_SECRET) return current
  if (Array.isArray(incoming)) {
    const currentItems = Array.isArray(current) ? current : []
    return incoming.map((item, index) =>
      restoreMaskedSettingsValues(item, currentItems[index])
    )
  }
  if (!incoming || typeof incoming !== 'object') return incoming
  const currentRecord =
    current && typeof current === 'object' && !Array.isArray(current)
      ? current as Record<string, unknown>
      : {}
  return Object.fromEntries(
    Object.entries(incoming as Record<string, unknown>)
      .map(([key, value]) => [
        key,
        restoreMaskedSettingsValues(value, currentRecord[key]),
      ]),
  )
}

export type PermissionMode = (typeof VALID_PERMISSION_MODES)[number]

export class SettingsService {
  private static writeLocks = new Map<string, Promise<void>>()
  private projectRoot?: string

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot
  }

  /** 配置目录，支持通过环境变量覆盖（便于测试） */
  private getConfigDir(): string {
    return getClaudeConfigHomeDir()
  }

  /** 用户级设置文件路径 */
  private getUserSettingsPath(): string {
    return path.join(this.getConfigDir(), 'settings.json')
  }

  /** 项目级设置文件路径 */
  private getProjectSettingsPath(
    projectRoot?: string,
    options?: { forWrite?: boolean },
  ): string {
    const root = projectRoot || this.projectRoot
    if (!root) {
      throw ApiError.badRequest('Project root is required for project settings')
    }
    if (options?.forWrite) {
      ensureProjectConfigDirMigration(root)
      return getProjectConfigPath(root, 'settings.json')
    }
    return getExistingProjectConfigPath(root, 'settings.json')
  }

  // ---------------------------------------------------------------------------
  // 读取
  // ---------------------------------------------------------------------------

  /** 安全读取 JSON 文件，文件不存在时返回空对象 */
  private async readJsonFile(filePath: string): Promise<Record<string, unknown>> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      await fs.chmod(filePath, 0o600).catch(() => {})
      return JSON.parse(raw) as Record<string, unknown>
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {}
      }
      throw ApiError.internal(`Failed to read settings from ${filePath}: ${err}`)
    }
  }

  /** 获取合并后的设置（user + project） */
  async getSettings(projectRoot?: string): Promise<Record<string, unknown>> {
    const user = await this.getUserSettings()
    try {
      const project = await this.getProjectSettings(projectRoot)
      return Object.assign({}, user, project)
    } catch {
      // project root 未指定时，仅返回 user settings
      return user
    }
  }

  /** 获取用户级设置 */
  async getUserSettings(): Promise<Record<string, unknown>> {
    return this.readJsonFile(this.getUserSettingsPath())
  }

  /** 获取项目级设置 */
  async getProjectSettings(projectRoot?: string): Promise<Record<string, unknown>> {
    return this.readJsonFile(this.getProjectSettingsPath(projectRoot))
  }

  // ---------------------------------------------------------------------------
  // 写入（原子写入：先写临时文件，再 rename）
  // ---------------------------------------------------------------------------

  /** 原子写入 JSON 文件 */
  private async withWriteLock<T>(
    filePath: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previousWrite = SettingsService.writeLocks.get(filePath) ?? Promise.resolve()
    const nextWrite = previousWrite
      .catch(() => {})
      .then(task)

    SettingsService.writeLocks.set(filePath, nextWrite)

    try {
      return await nextWrite
    } finally {
      if (SettingsService.writeLocks.get(filePath) === nextWrite) {
        SettingsService.writeLocks.delete(filePath)
      }
    }
  }

  private async writeJsonFile(
    filePath: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const dir = path.dirname(filePath)
    const contents = JSON.stringify(data, null, 2) + '\n'
    let lastError: unknown

    for (let attempt = 0; attempt < 2; attempt++) {
      const tmpFile = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}`
      try {
        await fs.mkdir(dir, { recursive: true, mode: 0o700 })
        await fs.chmod(dir, 0o700).catch(() => {})
        await fs.writeFile(tmpFile, contents, {
          encoding: 'utf-8',
          mode: 0o600,
        })
        await fs.rename(tmpFile, filePath)
        await fs.chmod(filePath, 0o600).catch(() => {})
        return
      } catch (err) {
        lastError = err
        await fs.unlink(tmpFile).catch(() => {})

        if (
          (err as NodeJS.ErrnoException).code !== 'ENOENT' ||
          attempt === 1
        ) {
          break
        }
      }
    }

    throw ApiError.internal(
      `Failed to write settings to ${filePath}: ${lastError}`,
    )
  }

  /** 更新用户级设置（浅合并） */
  async updateUserSettings(settings: Record<string, unknown>): Promise<void> {
    const filePath = this.getUserSettingsPath()
    await this.withWriteLock(filePath, async () => {
      const current = await this.readJsonFile(filePath)
      const restored = restoreMaskedSettingsValues(settings, current) as Record<string, unknown>
      const merged = Object.assign({}, current, restored)
      await this.writeJsonFile(filePath, merged)
    })
  }

  /** 更新项目级设置（浅合并） */
  async updateProjectSettings(
    settings: Record<string, unknown>,
    projectRoot?: string,
  ): Promise<void> {
    const filePath = this.getProjectSettingsPath(projectRoot, {
      forWrite: true,
    })
    await this.withWriteLock(filePath, async () => {
      const current = await this.readJsonFile(filePath)
      const restored = restoreMaskedSettingsValues(settings, current) as Record<string, unknown>
      const merged = Object.assign({}, current, restored)
      await this.writeJsonFile(filePath, merged)
    })
  }

  // ---------------------------------------------------------------------------
  // 权限模式
  // ---------------------------------------------------------------------------

  /** 获取当前权限模式 */
  async getPermissionMode(): Promise<string> {
    const settings = await this.getUserSettings()
    return (settings.defaultMode as string) || DEFAULT_PERMISSION_MODE
  }

  /** 设置权限模式 */
  async setPermissionMode(mode: string): Promise<void> {
    if (!VALID_PERMISSION_MODES.includes(mode as PermissionMode)) {
      throw ApiError.badRequest(
        `Invalid permission mode: "${mode}". Valid modes: ${VALID_PERMISSION_MODES.join(', ')}`,
      )
    }
    await this.updateUserSettings({ defaultMode: mode })
  }
}
