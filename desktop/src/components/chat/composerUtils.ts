import type { SettingsTab } from '../../stores/uiStore'

export const PANEL_SLASH_COMMANDS = [
  { name: 'mcp', description: 'Open available MCP tools for the current chat context' },
  { name: 'skills', description: 'Browse user-invocable skills for the current chat context' },
  { name: 'help', description: 'Show available desktop and agent commands' },
  { name: 'status', description: 'Show session status, usage, and context' },
  { name: 'cost', description: 'Show session usage and costs' },
  { name: 'context', description: 'Show current context usage' },
  { name: 'doctor', description: 'Show desktop diagnostics' },
  { name: 'memory', description: 'Inspect memory files for this session' },
  { name: 'bug', description: 'Open feedback and bug report options' },
] as const

export const SETTINGS_SLASH_COMMANDS = [
  { name: 'plugin', description: 'Open desktop plugin controls in Settings', tab: 'plugins' as const },
  { name: 'config', description: 'Open desktop configuration', tab: 'general' as const },
  { name: 'permissions', description: 'View or manage tool permissions', tab: 'permissions' as const },
  { name: 'terminal-setup', description: 'Set up terminal integration', tab: 'terminal' as const },
  { name: 'login', description: 'Open account and provider sign-in settings', tab: 'providers' as const },
  { name: 'logout', description: 'Open account and provider sign-out settings', tab: 'providers' as const },
  { name: 'agents', description: 'Open agent configuration', tab: 'agents' as const },
] as const

export const SLASH_COMMAND_ALIASES = [
  { name: 'plugins', target: 'plugin' },
  { name: 'feedback', target: 'bug' },
] as const

export const DESKTOP_UNSUPPORTED_SLASH_COMMANDS = [
  'add-dir',
  'branch',
  'remote-control',
  'btw',
  'buddy',
  'chrome',
  'color',
  'copy',
  'desktop',
  'diff',
  'effort',
  'exit',
  'export',
  'extra-usage',
  'fast',
  'hooks',
  'ide',
  'install-github-app',
  'mobile',
  'output-style',
  'passes',
  'plan',
  'privacy-settings',
  'rate-limit-options',
  'remote-env',
  'web-setup',
  'rename',
  'resume',
  'sandbox',
  'session',
  'stats',
  'tag',
  'tasks',
  'theme',
  'think-back',
  'upgrade',
  'usage',
  'vim',
] as const

export const FALLBACK_SLASH_COMMANDS = [
  ...PANEL_SLASH_COMMANDS,
  ...SETTINGS_SLASH_COMMANDS.map(({ name, description }) => ({ name, description })),
  { name: 'compact', description: 'Compact conversation context' },
  { name: 'clear', description: 'Clear conversation history' },
  { name: 'review', description: 'Review code changes' },
  { name: 'commit', description: 'Create a git commit' },
  { name: 'pr', description: 'Create a pull request' },
  { name: 'init', description: 'Initialize project CYBER.md' },
  { name: 'model', description: 'Switch AI model' },
]

export type SlashCommandOption = {
  name: string
  description: string
}

export type SlashUiAction =
  | {
      type: 'panel'
      command: typeof PANEL_SLASH_COMMANDS[number]['name']
    }
  | {
      type: 'settings'
      tab: SettingsTab
    }
  | {
      type: 'model'
    }
  | {
      type: 'unsupported'
      command: typeof DESKTOP_UNSUPPORTED_SLASH_COMMANDS[number]
    }

export function getSlashCommandName(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) return null

  const command = trimmed.slice(1).trim().split(/\s+/, 1)[0]
  return command || null
}

export function resolveSlashUiAction(value: string): SlashUiAction | null {
  const normalizedValue = SLASH_COMMAND_ALIASES.find((alias) => alias.name === value)?.target ?? value
  if (DESKTOP_UNSUPPORTED_SLASH_COMMANDS.some((command) => command === normalizedValue)) {
    return { type: 'unsupported', command: normalizedValue as typeof DESKTOP_UNSUPPORTED_SLASH_COMMANDS[number] }
  }

  if (normalizedValue === 'model') {
    return { type: 'model' }
  }

  const panelCommand = PANEL_SLASH_COMMANDS.find((command) => command.name === normalizedValue)
  if (panelCommand) {
    return { type: 'panel', command: panelCommand.name }
  }

  const settingsCommand = SETTINGS_SLASH_COMMANDS.find((command) => command.name === normalizedValue)
  if (settingsCommand) {
    return { type: 'settings', tab: settingsCommand.tab }
  }

  return null
}

export function mergeSlashCommands(
  preferred: ReadonlyArray<SlashCommandOption>,
  fallback: ReadonlyArray<SlashCommandOption> = FALLBACK_SLASH_COMMANDS,
): SlashCommandOption[] {
  const merged = new Map<string, SlashCommandOption>()
  const unsupportedCommands = new Set<string>(DESKTOP_UNSUPPORTED_SLASH_COMMANDS)

  for (const command of preferred) {
    if (!command?.name) continue
    if (unsupportedCommands.has(command.name)) continue
    merged.set(command.name, {
      name: command.name,
      description: command.description?.trim() || '',
    })
  }

  for (const command of fallback) {
    if (!command?.name) continue
    if (unsupportedCommands.has(command.name)) continue
    const existing = merged.get(command.name)
    if (existing) {
      if (!existing.description && command.description) {
        merged.set(command.name, {
          ...existing,
          description: command.description,
        })
      }
      continue
    }
    merged.set(command.name, command)
  }

  return [...merged.values()]
}

export type SlashTrigger = {
  slashPos: number
  filter: string
}

export function findSlashTrigger(value: string, cursorPos: number): SlashTrigger | null {
  const textBeforeCursor = value.slice(0, cursorPos)
  let slashPos = -1

  for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
    const ch = textBeforeCursor[i]!
    if (ch === '/') {
      if (i === 0 || /\s/.test(textBeforeCursor[i - 1]!)) {
        slashPos = i
        break
      }
      break
    }
    if (/\s/.test(ch)) {
      break
    }
  }

  if (slashPos < 0) return null

  const filter = textBeforeCursor.slice(slashPos + 1)
  if (/\s/.test(filter)) return null

  return { slashPos, filter }
}

export function replaceSlashToken(
  input: string,
  cursorPos: number,
  command: string,
  options?: { trailingSpace?: boolean },
): { value: string; cursorPos: number } {
  const trigger = findSlashTrigger(input, cursorPos)
  if (!trigger) {
    const prefix = input && !/\s$/.test(input) ? `${input} ` : input
    const token = `/${command}`
    const suffix = options?.trailingSpace !== false ? ' ' : ''
    const value = `${prefix}${token}${suffix}`
    return { value, cursorPos: value.length }
  }

  const before = input.slice(0, trigger.slashPos)
  const after = input.slice(cursorPos)
  const token = `/${command}`
  const suffix = options?.trailingSpace !== false ? ' ' : ''
  const value = `${before}${token}${suffix}${after}`
  const nextCursorPos = before.length + token.length + suffix.length
  return { value, cursorPos: nextCursorPos }
}

export type SlashToken = {
  start: number
  filter: string
}

export function findSlashToken(value: string, cursorPos: number): SlashToken | null {
  const trigger = findSlashTrigger(value, cursorPos)
  if (!trigger) return null
  return { start: trigger.slashPos, filter: trigger.filter }
}

export function replaceSlashCommand(
  value: string,
  cursorPos: number,
  command: string,
): { value: string; cursorPos: number } | null {
  const trigger = findSlashTrigger(value, cursorPos)
  if (!trigger) return null

  return replaceSlashToken(value, cursorPos, command, { trailingSpace: true })
}

export function insertSlashTrigger(
  value: string,
  cursorPos: number,
): { value: string; cursorPos: number } {
  const before = value.slice(0, cursorPos)
  const after = value.slice(cursorPos)
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before)
  const token = `${needsLeadingSpace ? ' ' : ''}/`
  return {
    value: `${before}${token}${after}`,
    cursorPos: before.length + token.length,
  }
}
