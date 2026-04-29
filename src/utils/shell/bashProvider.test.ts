import { afterEach, describe, expect, test } from 'bun:test'
import { createBashShellProvider } from './bashProvider.js'

const ORIGINAL_CLAUDE_CLI_PATH = process.env.CLAUDE_CLI_PATH
const ORIGINAL_CLAUDE_APP_ROOT = process.env.CLAUDE_APP_ROOT

afterEach(() => {
  if (ORIGINAL_CLAUDE_CLI_PATH === undefined) {
    delete process.env.CLAUDE_CLI_PATH
  } else {
    process.env.CLAUDE_CLI_PATH = ORIGINAL_CLAUDE_CLI_PATH
  }

  if (ORIGINAL_CLAUDE_APP_ROOT === undefined) {
    delete process.env.CLAUDE_APP_ROOT
  } else {
    process.env.CLAUDE_APP_ROOT = ORIGINAL_CLAUDE_APP_ROOT
  }
})

describe('createBashShellProvider', () => {
  test('injects a bundled claude wrapper for desktop sidecars', async () => {
    process.env.CLAUDE_CLI_PATH = '/tmp/claude-sidecar'
    process.env.CLAUDE_APP_ROOT = '/tmp/claude-desktop-app'

    const provider = await createBashShellProvider('/bin/bash', {
      skipSnapshot: true,
    })

    const { commandString } = await provider.buildExecCommand(
      'claude plugin install demo@claude-plugins-official --scope user',
      {
        id: 'wrapper-test',
        useSandbox: false,
      },
    )

    expect(commandString).toContain('claude() {')
    expect(commandString).toContain('/tmp/claude-sidecar cli --app-root "$CLAUDE_APP_ROOT" "$@"')
  })
})
