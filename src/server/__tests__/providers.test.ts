/**
 * Unit tests for ProviderService and Providers REST API
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ProviderService } from '../services/providerService.js'
import { handleProvidersApi } from '../api/providers.js'
import type { CreateProviderInput } from '../types/provider.js'

// ─── Test helpers ─────────────────────────────────────────────────────────────

let tmpDir: string
let originalConfigDir: string | undefined

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
}

async function teardown() {
  if (originalConfigDir !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
}

/** Create a mock Request */
function makeRequest(
  method: string,
  urlStr: string,
  body?: Record<string, unknown>,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const init: RequestInit = { method }
  if (body) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const req = new Request(url.toString(), init)
  const segments = url.pathname.split('/').filter(Boolean)
  return { req, url, segments }
}

/** A sample provider input for reuse across tests */
function sampleInput(overrides?: Partial<CreateProviderInput>): CreateProviderInput {
  return {
    presetId: 'custom',
    name: 'Test Provider',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test-key-123',
    apiFormat: 'anthropic',
    models: {
      main: 'model-main',
      haiku: 'model-haiku',
      sonnet: 'model-sonnet',
      opus: 'model-opus',
    },
    ...overrides,
  }
}

/** Read the settings.json written to the temp config dir */
async function readSettings(): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.join(tmpDir, 'cybercode', 'settings.json'), 'utf-8')
  return JSON.parse(raw) as Record<string, unknown>
}

/** Read the providers.json written to the temp config dir */
async function readProvidersConfig(): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.join(tmpDir, 'cybercode', 'providers.json'), 'utf-8')
  return JSON.parse(raw) as Record<string, unknown>
}

// =============================================================================
// ProviderService
// =============================================================================

describe('ProviderService', () => {
  beforeEach(setup)
  afterEach(teardown)

  // ─── listProviders ───────────────────────────────────────────────────────

  describe('listProviders', () => {
    test('should return empty array when no providers exist', async () => {
      const svc = new ProviderService()
      const result = await svc.listProviders()
      expect(result).toEqual({ providers: [], activeId: null })
    })

    test('should return all added providers', async () => {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput({ name: 'Provider A' }))
      await svc.addProvider(sampleInput({ name: 'Provider B' }))

      const { providers, activeId } = await svc.listProviders()
      expect(providers).toHaveLength(2)
      expect(providers[0].name).toBe('Provider A')
      expect(providers[1].name).toBe('Provider B')
      expect(activeId).toBeNull()
    })

    test('should migrate saved Kimi Code providers to the dedicated preset id', async () => {
      await fs.mkdir(path.join(tmpDir, 'cybercode'), { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'cybercode', 'providers.json'), JSON.stringify({
        activeId: 'saved-kimi-code',
        providers: [{
          id: 'saved-kimi-code',
          presetId: 'kimi',
          name: 'Kimi Code',
          apiKey: 'sk-kimi-code',
          baseUrl: 'https://api.kimi.com/coding/',
          apiFormat: 'anthropic',
          models: {
            main: 'kimi-k2.7-code',
            haiku: 'kimi-k2.7-code',
            sonnet: 'kimi-k2.7-code',
            opus: 'kimi-k2.7-code',
          },
          supportsImages: false,
        }],
      }), 'utf-8')

      const svc = new ProviderService()
      const { providers, activeId } = await svc.listProviders()

      expect(activeId).toBe('saved-kimi-code')
      expect(providers[0].presetId).toBe('kimi-code')
      expect(providers[0].baseUrl).toBe('https://api.kimi.com/coding/')
      expect(providers[0].models.main).toBe('kimi-k2.7-code')
      expect(providers[0].imageSupportMode).toBe('auto')
      expect(providers[0].supportsImages).toBeUndefined()
    })

    test('should move saved Kimi API providers off misplaced code models', async () => {
      await fs.mkdir(path.join(tmpDir, 'cybercode'), { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'cybercode', 'providers.json'), JSON.stringify({
        activeId: 'saved-kimi-api',
        providers: [{
          id: 'saved-kimi-api',
          presetId: 'kimi',
          name: 'Kimi API',
          apiKey: 'sk-moonshot',
          baseUrl: 'https://api.moonshot.cn/anthropic',
          apiFormat: 'anthropic',
          models: {
            main: 'kimi-k2.7-code',
            haiku: 'kimi-k2.7-code',
            sonnet: 'kimi-k2.7-code',
            opus: 'kimi-k2.7-code',
          },
          supportsImages: false,
        }],
      }), 'utf-8')

      const svc = new ProviderService()
      const { providers, activeId } = await svc.listProviders()

      expect(activeId).toBe('saved-kimi-api')
      expect(providers[0].presetId).toBe('kimi')
      expect(providers[0].baseUrl).toBe('https://api.moonshot.cn/anthropic')
      expect(providers[0].models.main).toBe('kimi-k2.6')
      expect(providers[0].models.haiku).toBe('kimi-k2.6')
      expect(providers[0].models.sonnet).toBe('kimi-k2.6')
      expect(providers[0].models.opus).toBe('kimi-k2.6')
      expect(providers[0].imageSupportMode).toBe('auto')
      expect(providers[0].supportsImages).toBeUndefined()

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_MODEL).toBe('kimi-k2.6')
      expect(env.ANTHROPIC_MODEL_SUPPORTED_CAPABILITIES).toBeUndefined()
      expect(env.CYBERCODE_PROVIDER_BASE_URL).toBe('https://api.moonshot.cn/anthropic')
    })

    test('should migrate unsupported saved Xiaomi MiMo V2.5 Flash model ids', async () => {
      await fs.mkdir(path.join(tmpDir, 'cybercode'), { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'cybercode', 'providers.json'), JSON.stringify({
        activeId: 'saved-mimo',
        providers: [{
          id: 'saved-mimo',
          presetId: 'xiaomimimo',
          name: '小米 MiMo',
          apiKey: 'sk-mimo',
          baseUrl: 'https://api.xiaomimimo.com',
          apiFormat: 'anthropic',
          models: {
            main: 'mimo-v2.5-pro',
            haiku: 'mimo-v2.5-flash',
            sonnet: 'mimo-v2.5-pro',
            opus: 'mimo-v2.5-pro',
          },
        }],
      }), 'utf-8')

      const svc = new ProviderService()
      const { providers, activeId } = await svc.listProviders()

      expect(activeId).toBe('saved-mimo')
      expect(providers[0].models.main).toBe('mimo-v2.5-pro')
      expect(providers[0].models.haiku).toBe('mimo-v2.5')
      expect(providers[0].models.sonnet).toBe('mimo-v2.5-pro')
      expect(providers[0].models.opus).toBe('mimo-v2.5-pro')

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('mimo-v2.5')
    })

    test('should migrate unsupported saved Zhipu GLM 4.5 Air model ids', async () => {
      await fs.mkdir(path.join(tmpDir, 'cybercode'), { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'cybercode', 'providers.json'), JSON.stringify({
        activeId: 'saved-zhipu',
        providers: [{
          id: 'saved-zhipu',
          presetId: 'zhipuglm',
          name: 'Zhipu GLM',
          apiKey: 'sk-zhipu',
          baseUrl: 'https://open.bigmodel.cn/api/anthropic',
          apiFormat: 'anthropic',
          models: {
            main: 'glm-5.2',
            haiku: 'glm-4.5-air',
            sonnet: 'glm-5.2',
            opus: 'glm-5.2',
          },
        }],
      }), 'utf-8')

      const svc = new ProviderService()
      const { providers, activeId } = await svc.listProviders()

      expect(activeId).toBe('saved-zhipu')
      expect(providers[0].models.main).toBe('glm-5.2')
      expect(providers[0].models.haiku).toBe('glm-4.7')
      expect(providers[0].models.sonnet).toBe('glm-5.2')
      expect(providers[0].models.opus).toBe('glm-5.2')

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('glm-4.7')
    })

    test('should migrate legacy context aliases and blank role models', async () => {
      const cybercodeDir = path.join(tmpDir, 'cybercode')
      const providersPath = path.join(cybercodeDir, 'providers.json')
      await fs.mkdir(cybercodeDir, { recursive: true, mode: 0o777 })
      await fs.writeFile(providersPath, JSON.stringify({
        activeId: null,
        providers: [{
          id: 'legacy-zhipu',
          presetId: 'zhipuglm',
          name: 'Legacy Zhipu',
          apiKey: 'sk-zhipu',
          baseUrl: 'https://open.bigmodel.cn/api/anthropic',
          apiFormat: 'anthropic',
          models: {
            main: 'glm-5.2[1m]',
            haiku: '',
            sonnet: '',
            opus: '',
          },
        }],
      }), { mode: 0o644 })

      const svc = new ProviderService()
      const { providers } = await svc.listProviders()

      expect(providers[0].models).toEqual({
        main: 'glm-5.2',
        haiku: 'glm-5.2',
        sonnet: 'glm-5.2',
        opus: 'glm-5.2',
      })
      if (process.platform !== 'win32') {
        expect((await fs.stat(cybercodeDir)).mode & 0o777).toBe(0o700)
        expect((await fs.stat(providersPath)).mode & 0o777).toBe(0o600)
      }
    })

  })

  // ─── addProvider ─────────────────────────────────────────────────────────

  describe('addProvider', () => {
    test('should add a provider and return it with generated fields', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({ imageSupportMode: 'enabled' }))

      expect(provider.id).toBeDefined()
      expect(provider.name).toBe('Test Provider')
      expect(provider.baseUrl).toBe('https://api.example.com')
      expect(provider.apiKey).toBe('sk-test-key-123')
      expect(provider.models.main).toBe('model-main')
      expect(provider.imageSupportMode).toBe('enabled')
    })

    test('new providers should not be auto-activated', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())

      expect(provider.id).toBeDefined()
      const { activeId } = await svc.listProviders()
      expect(activeId).toBeNull()
    })

    test('adding a provider should not sync settings until activated', async () => {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput())

      await expect(fs.readFile(path.join(tmpDir, 'cybercode', 'settings.json'), 'utf-8')).rejects.toThrow()
    })

    test('adding additional providers should keep activeId unchanged', async () => {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput({ name: 'First' }))
      const second = await svc.addProvider(sampleInput({ name: 'Second' }))

      expect(second.id).toBeDefined()
      const { activeId } = await svc.listProviders()
      expect(activeId).toBeNull()
    })

    test('should preserve optional notes field', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({ notes: 'dev environment' }))

      expect(provider.notes).toBe('dev environment')
    })

    test('should store optional model context windows', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        modelContextWindows: {
          main: 1_000_000,
          sonnet: 200_000,
        },
      }))

      expect(provider.modelContextWindows).toEqual({
        main: 1_000_000,
        sonnet: 200_000,
      })
    })

    test('should make blank role models inherit the main model', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        models: {
          main: 'only-model',
          haiku: '',
          sonnet: '',
          opus: '',
        },
      }))

      expect(provider.models).toEqual({
        main: 'only-model',
        haiku: 'only-model',
        sonnet: 'only-model',
        opus: 'only-model',
      })
    })

    test('should store provider files with owner-only permissions', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())
      await svc.activateProvider(provider.id)

      if (process.platform !== 'win32') {
        const cybercodeDir = path.join(tmpDir, 'cybercode')
        expect((await fs.stat(cybercodeDir)).mode & 0o777).toBe(0o700)
        expect((await fs.stat(path.join(cybercodeDir, 'providers.json'))).mode & 0o777).toBe(0o600)
        expect((await fs.stat(path.join(cybercodeDir, 'settings.json'))).mode & 0o777).toBe(0o600)
      }
    })
  })

  // ─── getProvider ─────────────────────────────────────────────────────────

  describe('getProvider', () => {
    test('should return the provider by id', async () => {
      const svc = new ProviderService()
      const added = await svc.addProvider(sampleInput())

      const fetched = await svc.getProvider(added.id)
      expect(fetched.id).toBe(added.id)
      expect(fetched.name).toBe(added.name)
    })

    test('should throw 404 for non-existent id', async () => {
      const svc = new ProviderService()

      try {
        await svc.getProvider('non-existent-id')
        expect(true).toBe(false) // should not reach here
      } catch (err: unknown) {
        const apiErr = err as { statusCode: number }
        expect(apiErr.statusCode).toBe(404)
      }
    })
  })

  // ─── updateProvider ──────────────────────────────────────────────────────

  describe('updateProvider', () => {
    test('should update provider fields', async () => {
      const svc = new ProviderService()
      const added = await svc.addProvider(sampleInput())

      const updated = await svc.updateProvider(added.id, {
        name: 'Updated Name',
        baseUrl: 'https://new-api.example.com',
        imageSupportMode: 'disabled',
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.baseUrl).toBe('https://new-api.example.com')
      expect(updated.imageSupportMode).toBe('disabled')
      // unchanged fields preserved
      expect(updated.apiKey).toBe('sk-test-key-123')
    })

    test('updating image support mode clears legacy image settings', async () => {
      const svc = new ProviderService()
      const added = await svc.addProvider(sampleInput({ supportsImages: false }))

      const updated = await svc.updateProvider(added.id, {
        imageSupportMode: 'auto',
      })

      expect(updated.imageSupportMode).toBe('auto')
      expect(updated.supportsImages).toBeUndefined()
    })

    test('updating with a masked API key preserves the stored credential', async () => {
      const svc = new ProviderService()
      const added = await svc.addProvider(sampleInput())

      await svc.updateProvider(added.id, { apiKey: '••••••••', name: 'Renamed' })

      expect((await svc.getProvider(added.id)).apiKey).toBe('sk-test-key-123')
    })

    test('should throw 404 for non-existent provider', async () => {
      const svc = new ProviderService()

      try {
        await svc.updateProvider('non-existent-id', { name: 'X' })
        expect(true).toBe(false)
      } catch (err: unknown) {
        const apiErr = err as { statusCode: number }
        expect(apiErr.statusCode).toBe(404)
      }
    })

    test('updating active provider should re-sync settings.json', async () => {
      const svc = new ProviderService()
      const added = await svc.addProvider(sampleInput())
      await svc.activateProvider(added.id)

      await svc.updateProvider(added.id, {
        baseUrl: 'https://new-api.example.com',
        apiKey: 'sk-new-key',
      })

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_BASE_URL).toBe('https://new-api.example.com')
      expect(env.ANTHROPIC_API_KEY).toBe('sk-new-key')
      expect(env.ANTHROPIC_MODEL).toBe('model-main')
    })
  })

  // ─── deleteProvider ──────────────────────────────────────────────────────

  describe('deleteProvider', () => {
    test('should delete an inactive provider', async () => {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput({ name: 'First' }))
      const second = await svc.addProvider(sampleInput({ name: 'Second' }))

      // Second is inactive, so deletion should succeed
      await svc.deleteProvider(second.id)

      const { providers } = await svc.listProviders()
      expect(providers).toHaveLength(1)
      expect(providers[0].name).toBe('First')
    })

    test('should throw 409 when deleting an active provider', async () => {
      const svc = new ProviderService()
      const active = await svc.addProvider(sampleInput())
      await svc.activateProvider(active.id)

      try {
        await svc.deleteProvider(active.id)
        expect(true).toBe(false)
      } catch (err: unknown) {
        const apiErr = err as { statusCode: number }
        expect(apiErr.statusCode).toBe(409)
      }
    })

    test('should throw 404 when deleting non-existent provider', async () => {
      const svc = new ProviderService()

      try {
        await svc.deleteProvider('non-existent-id')
        expect(true).toBe(false)
      } catch (err: unknown) {
        const apiErr = err as { statusCode: number }
        expect(apiErr.statusCode).toBe(404)
      }
    })
  })

  // ─── activateProvider ────────────────────────────────────────────────────

  describe('activateProvider', () => {
    test('should activate a provider with a valid model', async () => {
      const svc = new ProviderService()
      const first = await svc.addProvider(sampleInput({ name: 'First' }))
      const second = await svc.addProvider(
        sampleInput({
          name: 'Second',
          baseUrl: 'https://second-api.example.com',
          apiKey: 'sk-second-key',
        }),
      )

      await svc.activateProvider(second.id)

      // Second should now be active
      const { activeId, providers } = await svc.listProviders()
      expect(activeId).toBe(second.id)
      expect(providers.find((p) => p.id === first.id)).toBeDefined()
      expect(providers.find((p) => p.id === second.id)).toBeDefined()
    })

    test('should write correct settings.json on activation', async () => {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput({ name: 'First' }))
      const second = await svc.addProvider(
        sampleInput({
          name: 'Second',
          baseUrl: 'https://second-api.example.com',
          apiKey: 'sk-second-key',
        }),
      )

      await svc.activateProvider(second.id)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_BASE_URL).toBe('https://second-api.example.com')
      expect(env.ANTHROPIC_API_KEY).toBe('sk-second-key')
      expect(env.ANTHROPIC_MODEL).toBe('model-main')
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('model-haiku')
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('model-sonnet')
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('model-opus')
      expect(env.ANTHROPIC_MODEL_SUPPORTED_CAPABILITIES).toBeUndefined()
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES).toBeUndefined()
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES).toBeUndefined()
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES).toBeUndefined()
      expect(env.CYBERCODE_PROVIDER_BASE_URL).toBe('https://second-api.example.com')
      expect(env.CYBERCODE_PROVIDER_ID).toBe(second.id)
      expect(settings.model).toBe('model-main')
      expect(settings.modelContext).toBeUndefined()
    })

    test('should replace stale managed model when switching providers', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        presetId: 'zhipuglm',
        name: 'Zhipu GLM',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
        models: {
          main: 'glm-5.2',
          haiku: 'glm-4.7',
          sonnet: 'glm-5-turbo',
          opus: 'glm-5.1',
        },
      }))

      await fs.mkdir(path.join(tmpDir, 'cybercode'), { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'cybercode', 'settings.json'), JSON.stringify({
        model: 'kimi-k2.6',
        modelContext: '1m',
        skipWebFetchPreflight: true,
      }, null, 2), 'utf-8')

      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(settings.model).toBe('glm-5.2')
      expect(settings.modelContext).toBeUndefined()
      expect(env.ANTHROPIC_MODEL).toBe('glm-5.2')
    })

    test('should preserve an existing managed model when it belongs to the active provider', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        presetId: 'zhipuglm',
        name: 'Zhipu GLM',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
        models: {
          main: 'glm-5.2',
          haiku: 'glm-4.7',
          sonnet: 'glm-5-turbo',
          opus: 'glm-5.1',
        },
      }))

      await fs.mkdir(path.join(tmpDir, 'cybercode'), { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'cybercode', 'settings.json'), JSON.stringify({
        model: 'glm-5-turbo',
      }, null, 2), 'utf-8')

      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      expect(settings.model).toBe('glm-5-turbo')
    })

    test('should repair stale managed model when settings are read', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        presetId: 'zhipuglm',
        name: 'Zhipu GLM',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
        models: {
          main: 'glm-5.2',
          haiku: 'glm-4.7',
          sonnet: 'glm-5-turbo',
          opus: 'glm-5.1',
        },
      }))
      await svc.activateProvider(provider.id)
      await fs.writeFile(path.join(tmpDir, 'cybercode', 'settings.json'), JSON.stringify({
        model: 'kimi-k2.6',
        env: {
          ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
          ANTHROPIC_API_KEY: 'sk-zhipu',
          ANTHROPIC_MODEL: 'glm-5.2',
        },
      }, null, 2), 'utf-8')

      const settings = await svc.getManagedSettings()
      const env = settings.env as Record<string, string>
      const persisted = await readSettings()
      const persistedEnv = persisted.env as Record<string, string>

      expect(settings.model).toBe('glm-5.2')
      expect(env.ANTHROPIC_MODEL).toBe('glm-5.2')
      expect(persisted.model).toBe('glm-5.2')
      expect(persistedEnv.ANTHROPIC_MODEL).toBe('glm-5.2')
    })

    test('should write image input capabilities on activation and runtime env', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        imageSupportMode: 'enabled',
      }))

      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES).toContain('images')
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES).toContain('images')
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES).toContain('images')

      const runtimeEnv = await svc.getProviderRuntimeEnv(provider.id)
      expect(runtimeEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES).toContain('images')
      expect(runtimeEnv.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES).toContain('images')
      expect(runtimeEnv.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES).toContain('images')
    })

    test('should write model context windows on activation', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        models: {
          main: 'model-large',
          haiku: 'model-small',
          sonnet: 'model-large',
          opus: 'model-opus',
        },
        modelContextWindows: {
          main: 200_000,
          haiku: 64_000,
          sonnet: 1_000_000,
          opus: 128_000,
        },
      }))

      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(JSON.parse(env.CYBERCODE_MODEL_CONTEXT_WINDOWS)).toEqual({
        'model-large': 200_000,
        'model-small': 64_000,
        'model-opus': 128_000,
      })
    })

    test('should not apply a preset role window to a different custom model', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        presetId: 'deepseek',
        models: {
          main: 'custom-future-model',
          haiku: 'deepseek-v4-flash',
          sonnet: 'custom-future-model',
          opus: 'custom-future-model',
        },
      }))

      expect(svc.getProviderRoleContextWindows(provider)).toEqual({
        haiku: 1_000_000,
      })
    })

    test('should include preset default env on activation and runtime env', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        presetId: 'lmstudio',
        baseUrl: 'http://localhost:1234',
      }))

      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('lmstudio')

      const runtimeEnv = await svc.getProviderRuntimeEnv(provider.id)
      expect(runtimeEnv.ANTHROPIC_AUTH_TOKEN).toBe('lmstudio')

      await svc.activateOfficial()
      const clearedSettings = await readSettings()
      const clearedEnv = (clearedSettings.env as Record<string, string> | undefined) ?? {}
      expect(clearedEnv.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    })

    test('should not overwrite saved provider models when preset defaults change', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        presetId: 'minimax',
        name: 'Existing MiniMax',
        baseUrl: 'https://api.minimaxi.com/anthropic',
        models: {
          main: 'MiniMax-M2.7',
          haiku: 'MiniMax-M2.7',
          sonnet: 'MiniMax-M2.7',
          opus: 'MiniMax-M2.7',
        },
        modelContextWindows: {
          main: 200_000,
          haiku: 200_000,
          sonnet: 200_000,
          opus: 200_000,
        },
      }))

      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_MODEL).toBe('MiniMax-M2.7')
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('MiniMax-M2.7')
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('MiniMax-M2.7')
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('MiniMax-M2.7')
      expect(JSON.parse(env.CYBERCODE_MODEL_CONTEXT_WINDOWS)).toEqual({
        'MiniMax-M2.7': 200_000,
      })

      const runtimeEnv = await svc.getProviderRuntimeEnv(provider.id)
      expect(runtimeEnv.ANTHROPIC_MODEL).toBe('MiniMax-M2.7')
      expect(runtimeEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('MiniMax-M2.7')
    })

    test('should preserve existing settings.json fields on activation', async () => {
      // Pre-seed settings with an extra field
      await fs.mkdir(path.join(tmpDir, 'cybercode'), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, 'cybercode', 'settings.json'),
        JSON.stringify({ theme: 'dark', env: { CUSTOM_VAR: 'keep-me' } }),
      )

      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())

      // Re-activate to verify merge behavior
      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      expect(settings.theme).toBe('dark')
      const env = settings.env as Record<string, string>
      expect(env.CUSTOM_VAR).toBe('keep-me')
      expect(env.ANTHROPIC_BASE_URL).toBe('https://api.example.com')
    })

    test('should throw 404 for non-existent provider id', async () => {
      const svc = new ProviderService()

      try {
        await svc.activateProvider('non-existent-id')
        expect(true).toBe(false)
      } catch (err: unknown) {
        const apiErr = err as { statusCode: number }
        expect(apiErr.statusCode).toBe(404)
      }
    })

    test('activeId should be persisted in providers.json', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())

      await svc.activateProvider(provider.id)

      const config = await readProvidersConfig()
      expect(config.activeId).toBe(provider.id)
    })
  })

  // ─── getProviderForProxy ─────────────────────────────────────────────────

  describe('getProviderForProxy', () => {
    test('should return null when no provider is active', async () => {
      const svc = new ProviderService()
      const active = await svc.getProviderForProxy()
      expect(active).toBeNull()
    })

    test('should return the active provider proxy config', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())
      await svc.activateProvider(provider.id)

      const active = await svc.getProviderForProxy()
      expect(active).not.toBeNull()
      expect(active!.baseUrl).toBe(provider.baseUrl)
      expect(active!.apiKey).toBe(provider.apiKey)
      expect(active!.apiFormat).toBe('anthropic')
    })

    test('should normalize unsupported session-scoped Xiaomi runtime model ids', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        presetId: 'xiaomimimo',
        name: '小米 MiMo',
        baseUrl: 'https://api.xiaomimimo.com',
        models: {
          main: 'mimo-v2.5-pro',
          haiku: 'mimo-v2.5',
          sonnet: 'mimo-v2.5-pro',
          opus: 'mimo-v2.5-pro',
        },
      }))

      const runtimeEnv = await svc.getProviderRuntimeEnv(provider.id, 'mimo-v2.5-flash')

      expect(runtimeEnv.ANTHROPIC_MODEL).toBe('mimo-v2.5')
    })

    test('should normalize unsupported session-scoped Zhipu runtime model ids', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        presetId: 'zhipuglm',
        name: 'Zhipu GLM',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
        models: {
          main: 'glm-5.2',
          haiku: 'glm-4.7',
          sonnet: 'glm-5.2',
          opus: 'glm-5.2',
        },
      }))

      const runtimeEnv = await svc.getProviderRuntimeEnv(provider.id, 'glm-4.5-air')

      expect(runtimeEnv.ANTHROPIC_MODEL).toBe('glm-4.7')
    })

    test('should make discovered models and capabilities available to runtime sessions', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        modelCatalog: [{
          id: 'future-vision-model',
          contextWindow: 262_144,
          supportsImages: true,
        }],
      }))

      const runtimeEnv = await svc.getProviderRuntimeEnv(
        provider.id,
        'future-vision-model',
      )

      expect(runtimeEnv.ANTHROPIC_MODEL).toBe('future-vision-model')
      expect(runtimeEnv.ANTHROPIC_MODEL_SUPPORTED_CAPABILITIES).toContain('images')
      expect(JSON.parse(runtimeEnv.CYBERCODE_MODEL_CONTEXT_WINDOWS)).toMatchObject({
        'future-vision-model': 262_144,
      })
    })
  })

  describe('testProviderConfig', () => {
    test('should test local providers without forcing the user to enter an API key', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        presetId: 'ollama',
        name: 'Ollama',
        baseUrl: 'http://localhost:11434',
        apiKey: '',
        models: {
          main: 'qwen3.6',
          haiku: 'qwen3.6',
          sonnet: 'qwen3.6',
          opus: 'qwen3.6',
        },
      }))
      const originalFetch = globalThis.fetch
      const urls: string[] = []

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        urls.push(url)
        if (url.endsWith('/api/show')) {
          expect(JSON.parse(String(init?.body))).toEqual({ model: 'qwen3.6' })
          return Response.json({ capabilities: ['completion', 'tools'] })
        }
        return Response.json({
          type: 'message',
          model: 'qwen3.6',
          content: [{ type: 'text', text: 'ok' }],
        })
      }) as typeof fetch

      try {
        const result = await svc.testProvider(provider.id)
        expect(result.connectivity.success).toBe(true)
        expect(result.imageCapability?.status).toBe('unsupported')
        expect(urls).toContain('http://localhost:11434/v1/messages')
        expect(urls).toContain('http://localhost:11434/api/show')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('should apply Kimi thinking defaults during connectivity checks', async () => {
      const svc = new ProviderService()
      const originalFetch = globalThis.fetch
      const bodies: Array<Record<string, unknown>> = []

      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
        return Response.json({
          type: 'message',
          model: 'kimi-for-coding',
          content: [{ type: 'text', text: 'ok' }],
        })
      }) as typeof fetch

      try {
        const result = await svc.testProviderConfig({
          baseUrl: 'https://api.kimi.com/coding/',
          apiKey: 'test-key',
          modelId: 'kimi-for-coding',
          apiFormat: 'anthropic',
        })

        expect(result.connectivity.success).toBe(true)
        expect(bodies[0].thinking).toEqual({ type: 'enabled' })
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('should apply GLM enabled-thinking defaults during connectivity checks', async () => {
      const svc = new ProviderService()
      const originalFetch = globalThis.fetch
      const bodies: Array<Record<string, unknown>> = []

      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
        return Response.json({
          type: 'message',
          model: 'glm-5.2',
          content: [{ type: 'text', text: 'ok' }],
        })
      }) as typeof fetch

      try {
        const result = await svc.testProviderConfig({
          baseUrl: 'https://open.bigmodel.cn/api/anthropic',
          apiKey: 'test-key',
          modelId: 'glm-5.2[1m]',
          apiFormat: 'anthropic',
        })

        expect(result.connectivity.success).toBe(true)
        expect(bodies[0].thinking).toEqual({ type: 'enabled' })
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('should not apply Zhipu thinking rules to the same model name on another endpoint', async () => {
      const svc = new ProviderService()
      const originalFetch = globalThis.fetch
      const bodies: Array<Record<string, unknown>> = []

      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        bodies.push(body)
        return Response.json({
          type: 'message',
          model: body.model,
          content: [{ type: 'text', text: 'ok' }],
        })
      }) as typeof fetch

      try {
        const result = await svc.testProviderConfig({
          baseUrl: 'https://ark.cn-beijing.volces.com/api/anthropic',
          apiKey: 'test-key',
          modelId: 'glm-5.2',
          apiFormat: 'anthropic',
        })

        expect(result.connectivity.success).toBe(true)
        expect(bodies[0]?.thinking).toBeUndefined()
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('should retry dynamically when an unknown endpoint requires enabled thinking', async () => {
      const svc = new ProviderService()
      const originalFetch = globalThis.fetch
      const bodies: Array<Record<string, unknown>> = []

      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        bodies.push(body)
        if (!body.thinking) {
          return Response.json({
            error: {
              type: 'invalid_request_error',
              message: 'invalid thinking: only type=enabled is allowed for this model',
            },
          }, { status: 400 })
        }
        return Response.json({
          type: 'message',
          model: body.model,
          content: [{ type: 'text', text: 'ok' }],
        })
      }) as typeof fetch

      try {
        const result = await svc.testProviderConfig({
          baseUrl: 'https://custom.example.com/anthropic',
          apiKey: 'test-key',
          modelId: 'future-reasoning-model',
          apiFormat: 'anthropic',
        })

        expect(result.connectivity.success).toBe(true)
        expect(bodies).toHaveLength(2)
        expect(bodies[0]?.thinking).toBeUndefined()
        expect(bodies[1]?.thinking).toEqual({ type: 'enabled' })
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('should test every unique configured role model and report the actual model used', async () => {
      const svc = new ProviderService()
      const originalFetch = globalThis.fetch

      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { model: string }
        return Response.json({
          type: 'message',
          model: body.model === 'role-opus' ? 'upstream-opus-alias' : body.model,
          content: [{ type: 'text', text: 'ok' }],
        })
      }) as typeof fetch

      try {
        const result = await svc.testProviderConfig({
          baseUrl: 'https://models.example.com/anthropic',
          apiKey: 'test-key',
          modelId: 'role-main',
          models: {
            main: 'role-main',
            haiku: 'role-haiku',
            sonnet: 'role-sonnet',
            opus: 'role-opus',
          },
          apiFormat: 'anthropic',
        })

        expect(result.allModelsPassed).toBe(true)
        expect(result.modelChecks).toHaveLength(4)
        const opus = result.modelChecks?.find((check) => check.roles.includes('opus'))
        expect(opus?.requestedModel).toBe('role-opus')
        expect(opus?.result.modelUsed).toBe('upstream-opus-alias')
        expect(opus?.result.modelMatched).toBe(false)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('should explain Kimi Code API key mismatches', async () => {
      const svc = new ProviderService()
      const originalFetch = globalThis.fetch

      globalThis.fetch = (async () => Response.json({
        error: {
          message: 'The API Key appears to be invalid or may have expired. Please verify your credentials and try again.',
        },
      }, { status: 401 })) as typeof fetch

      try {
        const result = await svc.testProviderConfig({
          baseUrl: 'https://api.kimi.com/coding/',
          apiKey: 'wrong-key',
          modelId: 'kimi-for-coding',
          apiFormat: 'anthropic',
        })

        expect(result.connectivity.success).toBe(false)
        expect(result.connectivity.error).toContain('Kimi For Coding')
        expect(result.connectivity.error).toContain('https://api.moonshot.cn/anthropic')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('should not duplicate /v1 for Gemini OpenAI-compatible endpoints', async () => {
      const svc = new ProviderService()
      const originalFetch = globalThis.fetch
      const urls: string[] = []
      const bodies: Array<Record<string, unknown>> = []

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        urls.push(String(input))
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
        return Response.json({
          model: 'gemini-3.5-flash',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          }],
        })
      }) as typeof fetch

      try {
        const result = await svc.testProviderConfig({
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: 'test-key',
          modelId: 'gemini-3.5-flash',
          apiFormat: 'openai_chat',
        })

        expect(result.connectivity.success).toBe(true)
        expect(result.proxy?.success).toBe(true)
        expect(urls).toEqual([
          'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
          'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        ])
        expect(bodies.every((body) => body.thinking === undefined)).toBe(true)
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })
})

// =============================================================================
// Providers REST API
// =============================================================================

describe('Providers API', () => {
  beforeEach(setup)
  afterEach(teardown)

  // ─── GET /api/providers ──────────────────────────────────────────────────

  test('GET /api/providers should return empty list initially', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers')
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { providers: unknown[] }
    expect(body.providers).toEqual([])
  })

  test('GET /api/providers should list added providers', async () => {
    // Seed a provider via service
    const svc = new ProviderService()
    await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest('GET', '/api/providers')
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { providers: { name: string; apiKey: string }[] }
    expect(body.providers).toHaveLength(1)
    expect(body.providers[0].name).toBe('Test Provider')
    expect(body.providers[0].apiKey).toBe('••••••••')
  })

  // ─── POST /api/providers ─────────────────────────────────────────────────

  test('POST /api/providers should create a provider', async () => {
    const { req, url, segments } = makeRequest('POST', '/api/providers', {
      presetId: 'custom',
      name: 'New Provider',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      apiFormat: 'anthropic',
      models: {
        main: 'gpt-4',
        haiku: 'gpt-4-haiku',
        sonnet: 'gpt-4-sonnet',
        opus: 'gpt-4-opus',
      },
    })
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      provider: { name: string; apiKey: string; models: { main: string } }
    }
    expect(body.provider.name).toBe('New Provider')
    expect(body.provider.models.main).toBe('gpt-4')
    expect(body.provider.apiKey).toBe('••••••••')
  })

  test('POST /api/providers should normalize model context windows', async () => {
    const { req, url, segments } = makeRequest('POST', '/api/providers', {
      presetId: 'custom',
      name: 'New Provider',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      apiFormat: 'anthropic',
      models: {
        main: 'gpt-4',
        haiku: 'gpt-4-haiku',
        sonnet: 'gpt-4-sonnet',
        opus: 'gpt-4-opus',
      },
      modelContextWindows: {
        main: '1m',
        haiku: '128k',
      },
    })
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(201)
    const body = (await res.json()) as { provider: { modelContextWindows: Record<string, number> } }
    expect(body.provider.modelContextWindows).toEqual({
      main: 1_000_000,
      haiku: 128_000,
    })
  })

  test('POST /api/providers/models/discover should return upstream model IDs', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => Response.json({
      data: [
        { id: 'new-model', context_window: 128_000 },
        { id: 'vision-model', capabilities: ['vision'] },
      ],
    })) as typeof fetch

    try {
      const { req, url, segments } = makeRequest(
        'POST',
        '/api/providers/models/discover',
        {
          presetId: 'custom',
          baseUrl: 'https://discover.example.com',
          apiKey: 'secret-key',
          apiFormat: 'openai_chat',
          force: true,
        },
      )
      const res = await handleProvidersApi(req, url, segments)
      const body = await res.json() as {
        result: { models: Array<{ id: string; contextWindow?: number; supportsImages?: boolean }> }
      }

      expect(res.status).toBe(200)
      expect(body.result.models).toEqual([
        { id: 'new-model', contextWindow: 128_000 },
        { id: 'vision-model', supportsImages: true },
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('POST /api/providers should return 400 for invalid input', async () => {
    const { req, url, segments } = makeRequest('POST', '/api/providers', {
      name: '', // invalid: empty name
    })
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(400)
  })

  // ─── GET /api/providers/:id ──────────────────────────────────────────────

  test('GET /api/providers/:id should return a provider', async () => {
    const svc = new ProviderService()
    const added = await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest('GET', `/api/providers/${added.id}`)
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { provider: { id: string; name: string } }
    expect(body.provider.id).toBe(added.id)
  })

  test('GET /api/providers/:id should return 404 for unknown id', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers/unknown-id')
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(404)
  })

  // ─── PUT /api/providers/:id ──────────────────────────────────────────────

  test('PUT /api/providers/:id should update a provider', async () => {
    const svc = new ProviderService()
    const added = await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest('PUT', `/api/providers/${added.id}`, {
      name: 'Renamed Provider',
    })
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { provider: { name: string } }
    expect(body.provider.name).toBe('Renamed Provider')
  })

  // ─── DELETE /api/providers/:id ───────────────────────────────────────────

  test('DELETE /api/providers/:id should delete an inactive provider', async () => {
    const svc = new ProviderService()
    await svc.addProvider(sampleInput({ name: 'First' }))
    const second = await svc.addProvider(sampleInput({ name: 'Second' }))

    const { req, url, segments } = makeRequest('DELETE', `/api/providers/${second.id}`)
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  test('DELETE /api/providers/:id should return 409 for active provider', async () => {
    const svc = new ProviderService()
    const active = await svc.addProvider(sampleInput())
    await svc.activateProvider(active.id)

    const { req, url, segments } = makeRequest('DELETE', `/api/providers/${active.id}`)
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(409)
  })

  // ─── POST /api/providers/:id/activate ────────────────────────────────────

  test('POST /api/providers/:id/activate should activate a provider', async () => {
    const svc = new ProviderService()
    await svc.addProvider(sampleInput({ name: 'First' }))
    const second = await svc.addProvider(
      sampleInput({
        name: 'Second',
        baseUrl: 'https://second.example.com',
        apiKey: 'sk-second',
      }),
    )

    const { req, url, segments } = makeRequest(
      'POST',
      `/api/providers/${second.id}/activate`,
    )
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)

    // Verify settings were synced
    const settings = await readSettings()
    const env = settings.env as Record<string, string>
    expect(env.ANTHROPIC_BASE_URL).toBe('https://second.example.com')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-second')
    expect(env.ANTHROPIC_MODEL).toBe('model-main')
  })

  test('POST /api/providers/:id/activate should not require modelId', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest(
      'POST',
      `/api/providers/${provider.id}/activate`,
      {},
    )
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
  })

  test('POST /api/providers/:id/activate should ignore modelId because session runtime selects the model', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest(
      'POST',
      `/api/providers/${provider.id}/activate`,
      { modelId: 'non-existent-model' },
    )
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
  })

  // ─── Method not allowed ──────────────────────────────────────────────────

  test('should return 405 for unsupported methods', async () => {
    const { req, url, segments } = makeRequest('PATCH', '/api/providers')
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(405)
  })
})
