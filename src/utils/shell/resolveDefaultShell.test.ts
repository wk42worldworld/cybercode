import { describe, expect, test } from 'bun:test'
import { resolveDefaultShellFromState } from './resolveDefaultShell.js'

describe('resolveDefaultShellFromState', () => {
  test('honors configured shell before runtime fallback', () => {
    expect(
      resolveDefaultShellFromState({
        configuredShell: 'bash',
        platform: 'windows',
        hasGitBash: false,
      }),
    ).toBe('bash')

    expect(
      resolveDefaultShellFromState({
        configuredShell: 'powershell',
        platform: 'macos',
        hasGitBash: true,
      }),
    ).toBe('powershell')
  })

  test('uses PowerShell by default on Windows when Git Bash is unavailable', () => {
    expect(
      resolveDefaultShellFromState({
        configuredShell: undefined,
        platform: 'windows',
        hasGitBash: false,
      }),
    ).toBe('powershell')
  })

  test('keeps bash as the default when Git Bash is available or off Windows', () => {
    expect(
      resolveDefaultShellFromState({
        configuredShell: undefined,
        platform: 'windows',
        hasGitBash: true,
      }),
    ).toBe('bash')

    expect(
      resolveDefaultShellFromState({
        configuredShell: undefined,
        platform: 'macos',
        hasGitBash: false,
      }),
    ).toBe('bash')
  })
})
