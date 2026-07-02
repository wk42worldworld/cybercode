import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ConversationService } from '../services/conversationService.js'
import { ProviderService } from '../services/providerService.js'

describe('ConversationService', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let originalAuthToken: string | undefined
  let originalBaseUrl: string | undefined
  let originalModel: string | undefined
  let originalEntrypoint: string | undefined
  let originalOAuthToken: string | undefined
  let originalProviderManagedByHost: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cybercode-conversation-service-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalAuthToken = process.env.ANTHROPIC_AUTH_TOKEN
    originalBaseUrl = process.env.ANTHROPIC_BASE_URL
    originalModel = process.env.ANTHROPIC_MODEL
    originalEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
    originalOAuthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
    originalProviderManagedByHost = process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST

    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.ANTHROPIC_AUTH_TOKEN = 'test-token'
    process.env.ANTHROPIC_BASE_URL = 'https://example.invalid/anthropic'
    process.env.ANTHROPIC_MODEL = 'test-model'
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'inherited-parent-oauth-token'
    // Clear inherited CLAUDE_CODE_ENTRYPOINT so tests can assert whether
    // buildChildEnv injects it or not without interference from the shell env.
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir

    if (originalAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN
    else process.env.ANTHROPIC_AUTH_TOKEN = originalAuthToken

    if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = originalBaseUrl

    if (originalModel === undefined) delete process.env.ANTHROPIC_MODEL
    else process.env.ANTHROPIC_MODEL = originalModel

    if (originalEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
    else process.env.CLAUDE_CODE_ENTRYPOINT = originalEntrypoint

    if (originalOAuthToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = originalOAuthToken

    if (originalProviderManagedByHost === undefined) delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    else process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = originalProviderManagedByHost

    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('keeps inherited provider env when no desktop provider config exists', async () => {
    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('D:\\workspace\\code\\myself_code\\cybercode')) as Record<string, string>

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('test-token')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.invalid/anthropic')
    expect(env.ANTHROPIC_MODEL).toBe('test-model')
  })

  test('strips inherited provider env when desktop provider config exists', async () => {
    const cybercodeDir = path.join(tmpDir, 'cybercode')
    await fs.mkdir(cybercodeDir, { recursive: true })
    await fs.writeFile(
      path.join(cybercodeDir, 'providers.json'),
      JSON.stringify({ activeId: null, providers: [] }),
      'utf-8',
    )

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('D:\\workspace\\code\\myself_code\\cybercode')) as Record<string, string>

    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_MODEL).toBeUndefined()
  })

  test('buildChildEnv injects CLAUDE_CODE_OAUTH_TOKEN when official mode + cybercode oauth token exists', async () => {
    const cybercodeDir = path.join(tmpDir, 'cybercode')
    await fs.mkdir(cybercodeDir, { recursive: true })
    await fs.writeFile(
      path.join(cybercodeDir, 'settings.json'),
      JSON.stringify({ env: {} }),
      'utf-8',
    )

    const { cybercodeOAuthService } = await import('../services/cybercodeOAuthService.js')
    await cybercodeOAuthService.saveTokens({
      accessToken: 'cybercode-fresh-token',
      refreshToken: 'cybercode-refresh-xxx',
      expiresAt: Date.now() + 30 * 60_000,
      scopes: ['user:inference'],
      subscriptionType: 'max',
    })

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp')) as Record<string, string>

    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe('claude-desktop')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('cybercode-fresh-token')
  })

  test('buildChildEnv does NOT inject CLAUDE_CODE_OAUTH_TOKEN when not official mode', async () => {
    const cybercodeDir = path.join(tmpDir, 'cybercode')
    await fs.mkdir(cybercodeDir, { recursive: true })
    await fs.writeFile(
      path.join(cybercodeDir, 'settings.json'),
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'custom-provider-token' } }),
      'utf-8',
    )

    const { cybercodeOAuthService } = await import('../services/cybercodeOAuthService.js')
    await cybercodeOAuthService.saveTokens({
      accessToken: 'cybercode-token-should-not-be-used',
      refreshToken: null,
      expiresAt: null,
      scopes: [],
      subscriptionType: null,
    })

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp')) as Record<string, string>

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
  })

  test('buildChildEnv injects explicit provider runtime env for session-scoped providers', async () => {
    const providerService = new ProviderService()
    const provider = await providerService.addProvider({
      presetId: 'custom',
      name: 'Packy',
      apiKey: 'provider-key',
      baseUrl: 'https://api.packy.example',
      apiFormat: 'openai_chat',
      models: {
        main: 'kimi-k2.6',
        haiku: '',
        sonnet: '',
        opus: '',
      },
    })

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp', undefined, {
      providerId: provider.id,
    })) as Record<string, string>

    expect(env.ANTHROPIC_BASE_URL).toBe(`http://127.0.0.1:3456/proxy/providers/${provider.id}`)
    expect(env.ANTHROPIC_API_KEY).toBe('proxy-managed')
    expect(env.ANTHROPIC_MODEL).toBe('kimi-k2.6')
    expect(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST).toBe('1')
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
  })

  test('buildChildEnv uses the session-selected model for session-scoped providers', async () => {
    const providerService = new ProviderService()
    const provider = await providerService.addProvider({
      presetId: 'custom',
      name: 'Switchable',
      apiKey: 'provider-key',
      baseUrl: 'https://api.switchable.example',
      apiFormat: 'openai_chat',
      models: {
        main: 'old-provider-main',
        haiku: 'new-provider-haiku',
        sonnet: 'new-provider-sonnet',
        opus: 'new-provider-opus',
      },
    })

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp', undefined, {
      providerId: provider.id,
      model: 'new-provider-sonnet',
    })) as Record<string, string>

    expect(env.ANTHROPIC_BASE_URL).toBe(`http://127.0.0.1:3456/proxy/providers/${provider.id}`)
    expect(env.ANTHROPIC_MODEL).toBe('new-provider-sonnet')
  })

  test('buildChildEnv forwards model context windows for session-scoped providers', async () => {
    const providerService = new ProviderService()
    const provider = await providerService.addProvider({
      presetId: 'custom',
      name: 'Contextful',
      apiKey: 'provider-key',
      baseUrl: 'https://api.contextful.example',
      apiFormat: 'openai_chat',
      models: {
        main: 'provider-main',
        haiku: 'provider-haiku',
        sonnet: 'provider-sonnet',
        opus: 'provider-opus',
      },
      modelContextWindows: {
        main: 200_000,
        sonnet: 1_000_000,
      },
    })

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp', undefined, {
      providerId: provider.id,
      model: 'provider-sonnet',
      contextWindow: 128_000,
    })) as Record<string, string>

    expect(JSON.parse(env.CYBERCODE_MODEL_CONTEXT_WINDOWS)).toEqual({
      'provider-main': 200_000,
      'provider-sonnet': 128_000,
    })
  })

  test('buildChildEnv preserves provider capability overrides from presets', async () => {
    const providerService = new ProviderService()
    const provider = await providerService.addProvider({
      presetId: 'lmstudio',
      name: 'LM Studio',
      apiKey: 'provider-key',
      baseUrl: 'http://localhost:1234',
      apiFormat: 'anthropic',
      models: {
        main: 'qwen/qwen3.6-27b',
        haiku: 'qwen/qwen3.6-27b',
        sonnet: 'qwen/qwen3.6-27b',
        opus: 'qwen/qwen3.6-27b',
      },
    })

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp', undefined, {
      providerId: provider.id,
      model: 'qwen/qwen3.6-27b',
    })) as Record<string, string>

    expect(env.ANTHROPIC_BASE_URL).toBe('http://localhost:1234')
    expect(env.ANTHROPIC_MODEL).toBe('qwen/qwen3.6-27b')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('lmstudio')
  })

  test('buildChildEnv can force official auth even when a custom default provider exists', async () => {
    const cybercodeDir = path.join(tmpDir, 'cybercode')
    await fs.mkdir(cybercodeDir, { recursive: true })
    await fs.writeFile(
      path.join(cybercodeDir, 'settings.json'),
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'custom-provider-token' } }),
      'utf-8',
    )

    const { cybercodeOAuthService } = await import('../services/cybercodeOAuthService.js')
    await cybercodeOAuthService.saveTokens({
      accessToken: 'forced-official-token',
      refreshToken: 'forced-official-refresh',
      expiresAt: Date.now() + 30 * 60_000,
      scopes: ['user:inference'],
      subscriptionType: 'max',
    })

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp', undefined, {
      providerId: null,
    })) as Record<string, string>

    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe('claude-desktop')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('forced-official-token')
  })

  test('buildChildEnv does not leak inherited CLAUDE_CODE_OAUTH_TOKEN when official token is unavailable', async () => {
    const cybercodeDir = path.join(tmpDir, 'cybercode')
    await fs.mkdir(cybercodeDir, { recursive: true })
    await fs.writeFile(
      path.join(cybercodeDir, 'settings.json'),
      JSON.stringify({ env: {} }),
      'utf-8',
    )

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp')) as Record<string, string>

    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe('claude-desktop')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })

  test('buildChildEnv injects desktop Computer Use host bundle id for sdk sessions', async () => {
    const service = new ConversationService() as any
    const env = (await service.buildChildEnv(
      '/tmp',
      'ws://127.0.0.1:3456/sdk/test-session?token=test-token',
    )) as Record<string, string>

    expect(env.CYBERCODE_COMPUTER_USE_HOST_BUNDLE_ID).toBe(
      'com.cybercode.desktop',
    )
    expect(env.CYBERCODE_DESKTOP_SERVER_URL).toBe('http://127.0.0.1:3456')
    expect(env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING).toBe('1')
  })

  test('uses bun entrypoint fallback on Windows dev mode', () => {
    const service = new ConversationService() as any
    const args = service.resolveCliArgs(['--print'])

    if (process.platform === 'win32') {
      expect(args[0]).toBe(process.execPath)
      expect(args[1]).toBe('--preload')
      expect(args[2]).toContain('preload.ts')
      expect(args[3]).toContain(path.join('src', 'entrypoints', 'cli.tsx'))
    } else {
      expect(args[0]).toContain(path.join('bin', 'cybercode'))
    }
  })

  test('buildSessionCliArgs enables partial assistant messages for desktop streaming', () => {
    const service = new ConversationService() as any
    const args = service.buildSessionCliArgs(
      '123e4567-e89b-12d3-a456-426614174000',
      'ws://127.0.0.1:3456/sdk/test-session?token=test-token',
      false,
      undefined,
      { permissionMode: 'bypassPermissions' },
    ) as string[]

    expect(args).toContain('--include-partial-messages')
    expect(args).toContain('--sdk-url')
    expect(args).toContain('--replay-user-messages')
  })

  test('sendMessage forwards steering metadata to the SDK session', () => {
    const service = new ConversationService() as any
    const sent: any[] = []

    service.sessions.set('session-steer', {
      proc: null,
      outputCallbacks: [],
      workDir: process.cwd(),
      permissionMode: 'default',
      sdkToken: 'token',
      sdkSocket: {
        send(data: string) {
          sent.push(JSON.parse(data))
        },
      },
      pendingOutbound: [],
      stderrLines: [],
      sdkMessages: [],
      initMessage: null,
      pendingPermissionRequests: new Map(),
    })

    const result = service.sendMessage(
      'session-steer',
      '补充一下当前任务',
      undefined,
      {
        uuid: '123e4567-e89b-12d3-a456-426614174000',
        priority: 'next',
      },
    )

    expect(result).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      type: 'user',
      uuid: '123e4567-e89b-12d3-a456-426614174000',
      priority: 'next',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '补充一下当前任务' }],
      },
    })
    expect(Number.isNaN(Date.parse(sent[0].timestamp))).toBe(false)
  })

  test('buildChildEnv asks desktop SDK sessions to wait briefly for MCP tools', async () => {
    const service = new ConversationService() as any
    const env = (await service.buildChildEnv(
      '/tmp',
      'ws://127.0.0.1:3456/sdk/test-session?token=test-token',
    )) as Record<string, string>

    expect(env.CYBERCODE_DESKTOP_AWAIT_MCP).toBe('1')
    expect(env.CYBERCODE_DESKTOP_AWAIT_MCP_TIMEOUT_MS).toBe('5000')
  })

  test('buildSessionCliArgs forwards the selected runtime model and effort to the CLI process', () => {
    const service = new ConversationService() as any
    const args = service.buildSessionCliArgs(
      '123e4567-e89b-12d3-a456-426614174000',
      'ws://127.0.0.1:3456/sdk/test-session?token=test-token',
      false,
      undefined,
      {
        model: 'model-b-opus',
        effort: 'max',
      },
    ) as string[]

    expect(args).toContain('--model')
    expect(args).toContain('model-b-opus')
    expect(args).toContain('--effort')
    expect(args).toContain('max')
  })
})
