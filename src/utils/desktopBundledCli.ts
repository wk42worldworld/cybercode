import * as fs from 'node:fs'
import * as path from 'node:path'

export type ClaudeCliLauncher = {
  command: string
  kind: 'script' | 'sidecar' | 'binary'
  requiresAppRoot: boolean
}

export function resolveBundledCliPathFromExecPath(
  execPath: string = process.execPath,
): string | null {
  const execName = path.basename(execPath)

  if (execName.startsWith('claude-sidecar')) {
    return execPath
  }

  if (execName.startsWith('claude-server')) {
    const bundledCliPath = path.join(
      path.dirname(execPath),
      execName.replace(/^claude-server/, 'claude-cli'),
    )
    return fs.existsSync(bundledCliPath) ? bundledCliPath : null
  }

  return null
}

export function resolveClaudeCliLauncher(options?: {
  cliPath?: string | null
  execPath?: string
}): ClaudeCliLauncher | null {
  const command =
    options?.cliPath || resolveBundledCliPathFromExecPath(options?.execPath)

  if (!command) {
    return null
  }

  if (/\.(?:[cm]?[jt]s|tsx?)$/i.test(command)) {
    return {
      command,
      kind: 'script',
      requiresAppRoot: false,
    }
  }

  const cliBaseName = path.basename(command)
  if (cliBaseName.startsWith('claude-sidecar')) {
    return {
      command,
      kind: 'sidecar',
      requiresAppRoot: true,
    }
  }

  if (cliBaseName.startsWith('claude-cli')) {
    return {
      command,
      kind: 'binary',
      requiresAppRoot: true,
    }
  }

  return {
    command,
    kind: 'binary',
    requiresAppRoot: false,
  }
}

export function buildClaudeCliArgs(
  launcher: ClaudeCliLauncher,
  baseArgs: string[],
  appRoot: string | undefined = process.env.CLAUDE_APP_ROOT,
): string[] {
  if (launcher.kind === 'script') {
    return ['bun', launcher.command, ...baseArgs]
  }

  if (launcher.kind === 'sidecar') {
    return appRoot
      ? [launcher.command, 'cli', '--app-root', appRoot, ...baseArgs]
      : [launcher.command, 'cli', ...baseArgs]
  }

  if (launcher.requiresAppRoot && appRoot) {
    return [launcher.command, '--app-root', appRoot, ...baseArgs]
  }

  return [launcher.command, ...baseArgs]
}
