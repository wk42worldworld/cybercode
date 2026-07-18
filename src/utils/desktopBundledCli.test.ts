import { describe, expect, it } from 'bun:test'
import {
  buildClaudeCliArgs,
  resolveBundledCliPathFromExecPath,
  resolveClaudeCliLauncher,
} from './desktopBundledCli.js'

describe('desktop bundled CLI sidecar branding', () => {
  it('recognizes the CyberCode sidecar as the bundled CLI', () => {
    const sidecar = '/tmp/cybercode-sidecar-x86_64-pc-windows-msvc.exe'
    expect(resolveBundledCliPathFromExecPath(sidecar)).toBe(sidecar)

    const launcher = resolveClaudeCliLauncher({ cliPath: sidecar })
    expect(launcher).toMatchObject({
      command: sidecar,
      kind: 'sidecar',
      requiresAppRoot: true,
    })
    expect(buildClaudeCliArgs(launcher!, ['--version'], '/tmp/CyberCode')).toEqual([
      sidecar,
      'cli',
      '--app-root',
      '/tmp/CyberCode',
      '--version',
    ])
  })

  it('keeps recognizing the legacy sidecar name during upgrades', () => {
    const legacySidecar = '/tmp/claude-sidecar-aarch64-apple-darwin'
    expect(resolveBundledCliPathFromExecPath(legacySidecar)).toBe(legacySidecar)
    expect(resolveClaudeCliLauncher({ cliPath: legacySidecar })).toMatchObject({
      kind: 'sidecar',
      requiresAppRoot: true,
    })
  })
})
