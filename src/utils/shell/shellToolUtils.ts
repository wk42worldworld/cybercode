import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { getPlatform, type Platform } from '../platform.js'
import { tryFindGitBashPath } from '../windowsPaths.js'

export const SHELL_TOOL_NAMES: string[] = [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME]

export function shouldEnableBashTool({
  platform,
  hasGitBash,
}: {
  platform: Platform
  hasGitBash: boolean
}): boolean {
  return platform !== 'windows' || hasGitBash
}

export function isBashToolEnabled(): boolean {
  return shouldEnableBashTool({
    platform: getPlatform(),
    hasGitBash: tryFindGitBashPath() !== null,
  })
}

export function shouldEnablePowerShellTool({
  platform,
  userType,
  envValue,
  hasGitBash,
}: {
  platform: Platform
  userType: string | undefined
  envValue: string | undefined
  hasGitBash: boolean
}): boolean {
  if (platform !== 'windows') return false
  if (userType === 'ant') {
    return !isEnvDefinedFalsy(envValue)
  }
  if (envValue !== undefined) {
    return isEnvTruthy(envValue)
  }
  return !hasGitBash
}

/**
 * Runtime gate for PowerShellTool. Windows-only (the permission engine uses
 * Win32-specific path normalizations). Ant defaults on (opt-out via env=0).
 * External users can opt in/out via env; when unset, Windows falls back to
 * PowerShell automatically if Git Bash is unavailable.
 *
 * Used by tools.ts (tool-list visibility), processBashCommand (! routing),
 * and promptShellExecution (skill frontmatter routing) so the gate is
 * consistent across all paths that invoke PowerShellTool.call().
 */
export function isPowerShellToolEnabled(): boolean {
  return shouldEnablePowerShellTool({
    platform: getPlatform(),
    userType: process.env.USER_TYPE,
    envValue: process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL,
    hasGitBash: tryFindGitBashPath() !== null,
  })
}
