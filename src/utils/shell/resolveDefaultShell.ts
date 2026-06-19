import { getInitialSettings } from '../settings/settings.js'
import { getPlatform, type Platform } from '../platform.js'
import { tryFindGitBashPath } from '../windowsPaths.js'

export function resolveDefaultShellFromState({
  configuredShell,
  platform,
  hasGitBash,
}: {
  configuredShell: 'bash' | 'powershell' | undefined
  platform: Platform
  hasGitBash: boolean
}): 'bash' | 'powershell' {
  if (configuredShell) return configuredShell
  if (platform === 'windows' && !hasGitBash) return 'powershell'
  return 'bash'
}

/**
 * Resolve the default shell for input-box `!` commands.
 *
 * Resolution order:
 *   settings.defaultShell → Windows Git Bash availability → 'bash'
 *
 * Windows keeps bash when Git Bash is available, but falls back to PowerShell
 * when it is not. This keeps existing Git Bash users stable while making the
 * desktop install work out of the box on native Windows.
 */
export function resolveDefaultShell(): 'bash' | 'powershell' {
  return resolveDefaultShellFromState({
    configuredShell: getInitialSettings().defaultShell,
    platform: getPlatform(),
    hasGitBash: tryFindGitBashPath() !== null,
  })
}
