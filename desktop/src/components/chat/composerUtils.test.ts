import { describe, expect, it } from 'vitest'
import {
  DESKTOP_UNSUPPORTED_SLASH_COMMANDS,
  findSlashToken,
  getSlashCommandName,
  insertSlashTrigger,
  mergeSlashCommands,
  replaceSlashCommand,
  resolveSlashUiAction,
} from './composerUtils'

describe('composerUtils', () => {
  it('finds slash token without trailing space', () => {
    expect(findSlashToken('/rev', 4)).toEqual({ start: 0, filter: 'rev' })
    expect(findSlashToken('hello /rev', 10)).toEqual({ start: 6, filter: 'rev' })
  })

  it('does not treat slash followed by a space as an active token', () => {
    expect(findSlashToken('/ review', 8)).toBeNull()
  })

  it('inserts a slash trigger without appending a trailing space', () => {
    expect(insertSlashTrigger('', 0)).toEqual({ value: '/', cursorPos: 1 })
    expect(insertSlashTrigger('hello', 5)).toEqual({ value: 'hello /', cursorPos: 7 })
  })

  it('replaces the current slash token with a command and one trailing separator', () => {
    expect(replaceSlashCommand('/rev', 4, 'review')).toEqual({
      value: '/review ',
      cursorPos: 8,
    })
  })

  it('merges fallback commands so built-in entries like /clear remain visible', () => {
    expect(
      mergeSlashCommands([
        { name: 'help', description: '' },
      ]),
    ).toEqual(
      expect.arrayContaining([
        { name: 'help', description: 'Show available desktop and agent commands' },
        { name: 'clear', description: 'Clear conversation history' },
        { name: 'context', description: 'Show current context usage' },
      ]),
    )
  })

  it('keeps server-provided descriptions when they exist', () => {
    expect(
      mergeSlashCommands([
        { name: 'clear', description: 'Server description' },
      ]),
    ).toEqual(
      expect.arrayContaining([
        { name: 'clear', description: 'Server description' },
      ]),
    )
  })

  it('resolves hidden settings aliases without displaying duplicate fallback rows', () => {
    expect(resolveSlashUiAction('plugins')).toEqual({ type: 'settings', tab: 'plugins' })
    expect(resolveSlashUiAction('feedback')).toEqual({ type: 'panel', command: 'bug' })
    expect(mergeSlashCommands([]).map((command) => command.name)).toContain('plugin')
    expect(mergeSlashCommands([]).map((command) => command.name)).not.toContain('plugins')
  })

  it('extracts the command name from slash input with optional arguments', () => {
    expect(getSlashCommandName('/help')).toBe('help')
    expect(getSlashCommandName('/help status')).toBe('help')
    expect(getSlashCommandName('  /plugins  ')).toBe('plugins')
    expect(getSlashCommandName('/')).toBeNull()
    expect(getSlashCommandName('hello /help')).toBeNull()
  })

  it('routes session inspection commands to the desktop panel', () => {
    expect(resolveSlashUiAction('cost')).toEqual({ type: 'panel', command: 'cost' })
    expect(resolveSlashUiAction('context')).toEqual({ type: 'panel', command: 'context' })
    expect(resolveSlashUiAction('status')).toEqual({ type: 'panel', command: 'status' })
  })

  it('routes /model to the desktop model selector', () => {
    expect(resolveSlashUiAction('model')).toEqual({ type: 'model' })
  })

  it('routes desktop settings commands to settings tabs', () => {
    expect(resolveSlashUiAction('config')).toEqual({ type: 'settings', tab: 'general' })
    expect(resolveSlashUiAction('permissions')).toEqual({ type: 'settings', tab: 'permissions' })
    expect(resolveSlashUiAction('terminal-setup')).toEqual({ type: 'settings', tab: 'terminal' })
    expect(resolveSlashUiAction('login')).toEqual({ type: 'settings', tab: 'providers' })
    expect(resolveSlashUiAction('logout')).toEqual({ type: 'settings', tab: 'providers' })
    expect(resolveSlashUiAction('agents')).toEqual({ type: 'settings', tab: 'agents' })
  })

  it('routes completed desktop-only commands to local panels', () => {
    expect(resolveSlashUiAction('doctor')).toEqual({ type: 'panel', command: 'doctor' })
    expect(resolveSlashUiAction('memory')).toEqual({ type: 'panel', command: 'memory' })
    expect(resolveSlashUiAction('bug')).toEqual({ type: 'panel', command: 'bug' })
  })

  it('hides TUI-only commands from desktop suggestions while still intercepting manual use', () => {
    expect(DESKTOP_UNSUPPORTED_SLASH_COMMANDS).toContain('vim')
    expect(DESKTOP_UNSUPPORTED_SLASH_COMMANDS).toContain('theme')
    expect(mergeSlashCommands([
      { name: 'vim', description: 'Toggle vim editing mode' },
      { name: 'theme', description: 'Change the theme' },
    ]).map((command) => command.name)).not.toEqual(expect.arrayContaining(['vim', 'theme']))
    expect(resolveSlashUiAction('vim')).toEqual({ type: 'unsupported', command: 'vim' })
    expect(resolveSlashUiAction('theme')).toEqual({ type: 'unsupported', command: 'theme' })
  })
})
