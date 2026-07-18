import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import JSON5 from 'json5'
import { getCoordinatorSystemPrompt } from '../coordinator/coordinatorMode.js'
import { DEFAULT_AGENT_PROMPT } from './prompts.js'
import { CLI_SYSPROMPT_PREFIXES } from './system.js'
import { SPINNER_VERBS } from './spinnerVerbs.js'

function readJson(relativePath: string): Record<string, any> {
  return JSON5.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'))
}

function readText(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('CyberCode product identity', () => {
  it('uses CyberCode in every core system prompt prefix', () => {
    for (const prefix of CLI_SYSPROMPT_PREFIXES) {
      expect(prefix).toContain('CyberCode')
      expect(prefix).not.toContain('Claude Code')
    }
  })

  it('uses CyberCode for delegated and coordinator agents', () => {
    const prompts = [DEFAULT_AGENT_PROMPT, getCoordinatorSystemPrompt()]

    for (const prompt of prompts) {
      expect(prompt).toContain('CyberCode')
      expect(prompt).not.toContain('You are Claude Code')
      expect(prompt).not.toContain('agent for Claude Code')
    }
  })

  it('uses CyberCode workspace package names in manifests and lockfiles', () => {
    const workspaces = [
      ['../../package.json', '../../bun.lock'],
      ['../../desktop/package.json', '../../desktop/bun.lock'],
      ['../../adapters/package.json', '../../adapters/bun.lock'],
    ] as const

    for (const [manifestPath, lockPath] of workspaces) {
      const manifest = readJson(manifestPath)
      const lock = readJson(lockPath)
      expect(manifest.name.startsWith('cybercode')).toBe(true)
      expect(lock.workspaces[''].name).toBe(manifest.name)
    }
  })

  it('uses CyberCode desktop bundle metadata', () => {
    const tauriConfig = readJson('../../desktop/src-tauri/tauri.conf.json')
    const capabilities = readText('../../desktop/src-tauri/capabilities/default.json')
    expect(tauriConfig.productName).toBe('CyberCode')
    expect(tauriConfig.identifier).toContain('cybercode')
    expect(tauriConfig.app.windows[0].title).toBe('CyberCode')
    expect(tauriConfig.bundle.externalBin).toContain('binaries/cybercode-sidecar')
    expect(tauriConfig.bundle.externalBin).not.toContain('binaries/claude-sidecar')
    expect(capabilities).toContain('binaries/cybercode-sidecar')
    expect(capabilities).not.toContain('"name": "binaries/claude-sidecar"')
    expect(
      existsSync(
        new URL('../../desktop/sidecars/cybercode-sidecar.ts', import.meta.url),
      ),
    ).toBe(true)
    expect(
      existsSync(
        new URL('../../desktop/sidecars/claude-sidecar.ts', import.meta.url),
      ),
    ).toBe(false)

    const deepLinkRegistration = readText('../utils/deepLink/registerProtocol.ts')
    expect(deepLinkRegistration).toContain("MACOS_BUNDLE_ID = 'com.cybercode.url-handler'")
    expect(deepLinkRegistration).toContain("APP_NAME = 'CyberCode URL Handler'")
  })

  it('keeps user-visible activity and help copy on the CyberCode brand', () => {
    expect(SPINNER_VERBS).toContain('Cybercoding')
    expect(SPINNER_VERBS).not.toContain('Clauding')

    const helpFiles = [
      '../components/hooks/ViewHookMode.tsx',
      '../components/hooks/SelectMatcherMode.tsx',
      '../components/hooks/SelectHookMode.tsx',
      '../components/hooks/SelectEventMode.tsx',
      '../components/hooks/HooksConfigMenu.tsx',
    ]
    for (const file of helpFiles) {
      const copy = readText(file)
      expect(copy).not.toContain('ask Claude')
      expect(copy).toContain('CyberCode')
    }

    const insights = readText('../commands/insights.ts')
    expect(insights).toContain('Parallel CyberCode Sessions')
    expect(insights).toContain('detectParallelSessions')
    expect(insights).toContain('USER INSTRUCTIONS TO CYBERCODE')
    expect(insights).not.toContain('Multi-Clauding (Parallel Sessions)')
    expect(insights).not.toContain('detectMultiClauding')
    expect(insights).not.toContain('USER INSTRUCTIONS TO CLAUDE')

    const permissionCopy = readText('../utils/permissions/filesystem.ts')
    expect(permissionCopy).toContain('CyberCode requested permissions')
    expect(permissionCopy).not.toContain('Claude requested permissions')

    const hookCopy = readText('../utils/hooks/hooksConfigManager.ts')
    expect(hookCopy).toContain('stdout shown to CyberCode')
    expect(hookCopy).toContain('Right before CyberCode concludes its response')
    expect(hookCopy).not.toContain('stdout shown to Claude')
    expect(hookCopy).not.toContain('Right before Claude concludes its response')

    const nativeShellCopy = readText('../utils/Shell.ts')
    expect(nativeShellCopy).toContain('CyberCode CLI requires a Posix shell')
    expect(nativeShellCopy).not.toContain('Claude CLI requires a Posix shell')

    const nativeLogs = readText('../../desktop/src-tauri/src/lib.rs')
    expect(nativeLogs).toContain('[cybercode-server]')
    expect(nativeLogs).not.toContain('[claude-server]')

    const conversationCopy = readText(
      '../server/services/conversationService.ts',
    )
    expect(conversationCopy).toContain('CyberCode CLI is not authenticated')
    expect(conversationCopy).not.toContain('Claude CLI is not authenticated')

    const configCopy = readText('../utils/config.ts')
    expect(configCopy).toContain('CyberCode configuration file not found')
    expect(configCopy).not.toContain('Claude configuration file not found')

    const installerCopy = readText('../utils/localInstaller.ts')
    expect(installerCopy).toContain('Failed to install CyberCode CLI package')
    expect(installerCopy).not.toContain('Failed to install Claude CLI package')

    const suggestionCopy = readText(
      '../services/PromptSuggestion/promptSuggestion.ts',
    )
    expect(suggestionCopy).toContain('CyberCode offers options')
    expect(suggestionCopy).not.toContain('Claude offers options')

    const remoteMessageCopy = readText(
      '../tools/SendMessageTool/SendMessageTool.ts',
    )
    expect(remoteMessageCopy).toContain('receiving CyberCode session')
    expect(remoteMessageCopy).not.toContain('receiving Claude')

    const chromeIntegration = readText('../utils/claudeInChrome/setup.ts')
    expect(chromeIntegration).toContain('Generated by CyberCode')
    expect(chromeIntegration).not.toContain('Generated by Claude Code')
  })
})
