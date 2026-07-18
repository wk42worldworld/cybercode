import { describe, expect, it } from 'vitest'

import { parseLauncherArgs, resolveSidecarInvocation } from './launcherRouting'

describe('resolveSidecarInvocation', () => {
  it('keeps explicit sidecar modes unchanged', () => {
    expect(
      resolveSidecarInvocation(
        ['server', '--host', '127.0.0.1'],
        '/tmp/cybercode-sidecar',
      ),
    ).toEqual({
      mode: 'server',
      restArgs: ['--host', '127.0.0.1'],
      defaultAppRoot: null,
    })
  })

  it('routes embedded codegraph commands without treating them as CLI args', () => {
    expect(
      resolveSidecarInvocation(
        ['codegraph', 'index', '--project', '/tmp/project'],
        '/tmp/cybercode-sidecar',
      ),
    ).toEqual({
      mode: 'codegraph',
      restArgs: ['index', '--project', '/tmp/project'],
      defaultAppRoot: null,
    })
  })

  it('defaults cybercode invocations to cli mode', () => {
    expect(
      resolveSidecarInvocation(
        ['plugin', 'install', 'demo'],
        '/Users/demo/.local/bin/cybercode',
      ),
    ).toEqual({
      mode: 'cli',
      restArgs: ['plugin', 'install', 'demo'],
      defaultAppRoot: '/Users/demo/.local/bin',
    })
  })
})

describe('parseLauncherArgs', () => {
  it('falls back to the provided default app root', () => {
    expect(
      parseLauncherArgs(['plugin', 'install', 'demo'], '/Users/demo/.local/bin'),
    ).toEqual({
      appRoot: '/Users/demo/.local/bin',
      args: ['plugin', 'install', 'demo'],
    })
  })

  it('lets explicit app root override the default', () => {
    expect(
      parseLauncherArgs(
        ['--app-root', '/tmp/app', 'plugin', 'install', 'demo'],
        '/Users/demo/.local/bin',
      ),
    ).toEqual({
      appRoot: '/tmp/app',
      args: ['plugin', 'install', 'demo'],
    })
  })
})
