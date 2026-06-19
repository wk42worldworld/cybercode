import { describe, expect, test } from 'bun:test'
import {
  shouldEnableBashTool,
  shouldEnablePowerShellTool,
} from './shellToolUtils.js'

describe('shouldEnableBashTool', () => {
  test('hides Bash on Windows when Git Bash is unavailable', () => {
    expect(
      shouldEnableBashTool({
        platform: 'windows',
        hasGitBash: false,
      }),
    ).toBe(false)
  })

  test('keeps Bash visible when Git Bash is available or off Windows', () => {
    expect(
      shouldEnableBashTool({
        platform: 'windows',
        hasGitBash: true,
      }),
    ).toBe(true)

    expect(
      shouldEnableBashTool({
        platform: 'macos',
        hasGitBash: false,
      }),
    ).toBe(true)
  })
})

describe('shouldEnablePowerShellTool', () => {
  test('keeps PowerShell disabled outside Windows', () => {
    expect(
      shouldEnablePowerShellTool({
        platform: 'macos',
        userType: undefined,
        envValue: undefined,
        hasGitBash: false,
      }),
    ).toBe(false)
  })

  test('falls back to PowerShell for external Windows users without Git Bash', () => {
    expect(
      shouldEnablePowerShellTool({
        platform: 'windows',
        userType: undefined,
        envValue: undefined,
        hasGitBash: false,
      }),
    ).toBe(true)
  })

  test('keeps PowerShell hidden by default when Git Bash is available', () => {
    expect(
      shouldEnablePowerShellTool({
        platform: 'windows',
        userType: undefined,
        envValue: undefined,
        hasGitBash: true,
      }),
    ).toBe(false)
  })

  test('honors explicit external opt-in and opt-out', () => {
    expect(
      shouldEnablePowerShellTool({
        platform: 'windows',
        userType: undefined,
        envValue: '1',
        hasGitBash: true,
      }),
    ).toBe(true)

    expect(
      shouldEnablePowerShellTool({
        platform: 'windows',
        userType: undefined,
        envValue: '0',
        hasGitBash: false,
      }),
    ).toBe(false)
  })

  test('keeps ant users default-on unless explicitly disabled', () => {
    expect(
      shouldEnablePowerShellTool({
        platform: 'windows',
        userType: 'ant',
        envValue: undefined,
        hasGitBash: true,
      }),
    ).toBe(true)

    expect(
      shouldEnablePowerShellTool({
        platform: 'windows',
        userType: 'ant',
        envValue: 'false',
        hasGitBash: false,
      }),
    ).toBe(false)
  })
})
