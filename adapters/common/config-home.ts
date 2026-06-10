import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const CYBER_CONFIG_DIR_ENV = 'CYBER_CONFIG_DIR'
const LEGACY_CLAUDE_CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR'
const CYBER_CONFIG_DIRNAME = '.cyber'
const LEGACY_CLAUDE_CONFIG_DIRNAME = '.claude'

let homeDirOverrideForTesting: string | undefined

function getHomeDir(): string {
  return homeDirOverrideForTesting ?? os.homedir()
}

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? path.resolve(value) : undefined
}

function preferredConfigHome(): string {
  return path.join(getHomeDir(), CYBER_CONFIG_DIRNAME)
}

function legacyConfigHome(): string {
  return path.join(getHomeDir(), LEGACY_CLAUDE_CONFIG_DIRNAME)
}

function explicitConfigHome(): string | undefined {
  return (
    nonEmptyEnv(CYBER_CONFIG_DIR_ENV) ??
    nonEmptyEnv(LEGACY_CLAUDE_CONFIG_DIR_ENV)
  )
}

export function getAdapterConfigHomeDir(): string {
  return explicitConfigHome() ?? preferredConfigHome()
}

export function getAdapterConfigPath(...segments: string[]): string {
  return path.join(getAdapterConfigHomeDir(), ...segments)
}

export function getExistingAdapterConfigPath(...segments: string[]): string {
  const explicit = explicitConfigHome()
  if (explicit) {
    return path.join(explicit, ...segments)
  }

  const preferred = path.join(preferredConfigHome(), ...segments)
  if (fs.existsSync(preferred)) {
    return preferred
  }

  const legacy = path.join(legacyConfigHome(), ...segments)
  if (fs.existsSync(legacy)) {
    return legacy
  }

  return preferred
}

export function _setAdapterConfigHomeForTesting(
  homeDir: string | undefined,
): void {
  homeDirOverrideForTesting = homeDir
}
