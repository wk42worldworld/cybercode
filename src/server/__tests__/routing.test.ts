import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleProxyRequest } from '../proxy/handler.js'
import { routingService } from '../routing/routingService.js'
import { getRouteTargetCost } from '../routing/sourceCatalog.js'
import type { RouteProfile } from '../routing/types.js'
import { ProviderService } from '../services/providerService.js'

const TEST_ROUTE_PROFILES = [
  {
    id: 'balanced',
    name: 'Balanced',
    enabled: true,
    strategy: 'auto' as const,
    strictFree: false,
    allowExperimental: false,
    maxAttempts: 3,
    targets: [],
  },
  {
    id: 'free-first',
    name: 'Free first',
    enabled: true,
    strategy: 'cost-optimized' as const,
    strictFree: true,
    allowExperimental: false,
    maxAttempts: 3,
    targets: [],
  },
  {
    id: 'stable',
    name: 'Stable',
    enabled: true,
    strategy: 'lkgp' as const,
    strictFree: false,
    allowExperimental: false,
    maxAttempts: 3,
    targets: [],
  },
]

describe('native smart routing', () => {
  let tempDir: string
  let originalConfigDir: string | undefined
  let upstream: ReturnType<typeof Bun.serve> | null

  beforeEach(async () => {
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cybercode-routing-'))
    process.env.CLAUDE_CONFIG_DIR = tempDir
    ProviderService.setServerPort(3456)
    routingService.resetHealth()
    await routingService.updateConfig({
      version: 1,
      enabled: true,
      profiles: TEST_ROUTE_PROFILES,
    })
    upstream = null
  })

  afterEach(async () => {
    upstream?.stop(true)
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    routingService.resetHealth()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  test('starts with an empty route list without touching existing provider settings', async () => {
    await fs.rm(path.join(tempDir, 'cybercode', 'routing.json'), { force: true })
    const service = new ProviderService()
    const provider = await service.addProvider({
      presetId: 'custom',
      name: 'Existing source',
      apiKey: 'secret-key',
      baseUrl: 'https://models.example.com',
      apiFormat: 'openai_chat',
      models: {
        main: 'model-a',
        haiku: 'model-a',
        sonnet: 'model-a',
        opus: 'model-a',
      },
    })

    const dashboard = await routingService.getDashboard()
    expect(dashboard.config.profiles).toEqual([])
    expect(dashboard.sources.find((source) => source.providerId === provider.id)).toMatchObject({
      configured: true,
      routable: true,
      cost: 'unknown',
      auth: 'api-key',
    })
    expect(dashboard.sources.find((source) => source.presetId === 'nvidia')).toMatchObject({
      cost: 'recurring-free',
    })
    expect(dashboard.sources.find((source) => source.presetId === 'deepinfra')).toMatchObject({
      cost: 'paid',
    })
    expect(dashboard.sources.find((source) => source.presetId === 'featherless-ai')).toMatchObject({
      cost: 'paid',
      risk: 'restricted',
    })
    expect(dashboard.sources.find((source) => source.presetId === 'cloudflare-ai')).toMatchObject({
      cost: 'recurring-free',
      risk: 'stable',
    })
    expect(dashboard.sources.find((source) => source.presetId === 'ollama-cloud')).toMatchObject({
      cost: 'recurring-free',
      risk: 'experimental',
    })
    expect(dashboard.sources.find((source) => source.presetId === 'llm7')).toMatchObject({
      cost: 'mixed',
      risk: 'experimental',
    })
    expect(dashboard.health).toEqual([])
    expect(JSON.stringify(dashboard)).not.toContain('secret-key')

    const providerIndex = JSON.parse(
      await fs.readFile(path.join(tempDir, 'cybercode', 'providers.json'), 'utf-8'),
    ) as { providers: unknown[] }
    expect(providerIndex.providers).toHaveLength(1)
    expect(await fs.stat(path.join(tempDir, 'cybercode', 'routing.json')).catch(() => null)).toBeNull()
  })

  test('repairs conflicting strategies on untouched legacy built-in routes', async () => {
    const configPath = path.join(tempDir, 'cybercode', 'routing.json')
    await fs.writeFile(configPath, JSON.stringify({
      version: 1,
      enabled: true,
      profiles: [
        {
          ...TEST_ROUTE_PROFILES[0],
          strictFree: true,
          targets: [{ providerId: 'legacy-balanced-provider' }],
        },
        {
          id: 'coding-first',
          name: 'Coding first',
          enabled: true,
          strategy: 'cost-optimized',
          strictFree: false,
          allowExperimental: false,
          maxAttempts: 3,
          targets: [{ providerId: 'legacy-coding-provider' }],
        },
        TEST_ROUTE_PROFILES[1],
      ],
    }))

    const config = await routingService.getConfig()

    expect(config.profiles.find((profile) => profile.id === 'balanced')).toMatchObject({
      strategy: 'auto',
      strictFree: false,
    })
    expect(config.profiles.find((profile) => profile.id === 'coding-first')).toMatchObject({
      strategy: 'headroom',
      strictFree: false,
    })
    expect(config.profiles.find((profile) => profile.id === 'free-first')).toMatchObject({
      strategy: 'cost-optimized',
      strictFree: true,
    })

    const persisted = JSON.parse(await fs.readFile(configPath, 'utf-8')) as {
      profiles: RouteProfile[]
    }
    expect(persisted.profiles.find((profile) => profile.id === 'coding-first')).toMatchObject({
      strategy: 'headroom',
      strictFree: false,
    })
  })

  test('does not rewrite a user-edited legacy route with explicit models', async () => {
    const config = await routingService.updateConfig({
      version: 1,
      enabled: true,
      profiles: [{
        ...TEST_ROUTE_PROFILES[0],
        strategy: 'cost-optimized',
        targets: [{ providerId: 'provider-a', modelId: 'model-a' }],
      }],
    })

    expect(config.profiles[0]).toMatchObject({
      strategy: 'cost-optimized',
      strictFree: false,
    })
  })

  test('classifies only documented Zhipu Flash models as free', () => {
    expect(getRouteTargetCost('zhipuglm', 'glm-4.7-flash')).toBe('recurring-free')
    expect(getRouteTargetCost('zhipuglm', 'glm-4-flash-250414')).toBe('recurring-free')
    expect(getRouteTargetCost('zhipuglm', 'glm-5.2')).toBe('paid')
  })

  test('classifies only the LLM7 default router as recurring free', () => {
    expect(getRouteTargetCost('llm7', 'default')).toBe('recurring-free')
    expect(getRouteTargetCost('llm7', 'fast')).toBe('paid')
    expect(getRouteTargetCost('llm7', 'pro')).toBe('paid')
  })

  test('builds a session-scoped local runtime without exposing upstream keys', async () => {
    const service = new ProviderService()
    await service.addProvider({
      presetId: 'custom',
      name: 'Routed source',
      apiKey: 'upstream-secret',
      baseUrl: 'https://models.example.com',
      apiFormat: 'openai_chat',
      models: {
        main: 'model-a',
        haiku: 'model-a',
        sonnet: 'model-a',
        opus: 'model-a',
      },
      modelContextWindows: { main: 200_000 },
    })

    const env = await routingService.getRuntimeEnv('balanced', 'session-123')
    expect(env.ANTHROPIC_BASE_URL).toBe(
      'http://127.0.0.1:3456/proxy/routes/balanced/sessions/session-123',
    )
    expect(env.ANTHROPIC_MODEL).toBe('cybercode-route-balanced')
    expect(env.ANTHROPIC_API_KEY).not.toBe('upstream-secret')
    expect(env.CYBERCODE_MODEL_CONTEXT_WINDOWS).toContain('200000')
    expect(env.CYBERCODE_LOCAL_MODEL_PERFORMANCE).toBeUndefined()

    const dashboard = await routingService.getDashboard()
    expect(dashboard.routeAvailability.balanced?.contextWindow).toBe(200_000)
  })

  test('excludes cloud sources without credentials while keeping keyless local sources routable', async () => {
    const service = new ProviderService()
    const missingKey = await service.addProvider({
      presetId: 'custom',
      name: 'Missing key',
      apiKey: '',
      baseUrl: 'https://models.example.com',
      apiFormat: 'openai_chat',
      models: { main: 'cloud-model', haiku: 'cloud-model', sonnet: 'cloud-model', opus: 'cloud-model' },
    })
    const local = await service.addProvider({
      presetId: 'ollama',
      name: 'Local Ollama',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:11434',
      apiFormat: 'openai_chat',
      models: { main: 'qwen3:8b', haiku: 'qwen3:8b', sonnet: 'qwen3:8b', opus: 'qwen3:8b' },
    })

    const dashboard = await routingService.getDashboard()
    expect(dashboard.sources.find((source) => source.providerId === missingKey.id)?.routable).toBe(false)
    expect(dashboard.sources.find((source) => source.providerId === local.id)?.routable).toBe(true)
    expect(dashboard.routeAvailability.balanced?.candidateCount).toBe(1)

    const plan = await routingService.resolveAttempts('balanced', 'credential-filter', {
      messages: [{ role: 'user', content: 'use an available source' }],
    })
    expect(plan.targets.map((target) => target.provider.id)).toEqual([local.id])

    const env = await routingService.getRuntimeEnv('balanced', 'local-only')
    expect(env.CYBERCODE_LOCAL_MODEL_PERFORMANCE).toBe('1')
  })

  test('keeps connected OAuth providers routable without persisting their access token', async () => {
    const service = new ProviderService()
    const oauthProvider = await service.upsertOAuthProvider('test-oauth', {
      presetId: 'test-oauth-runtime',
      name: 'OAuth runtime',
      baseUrl: 'https://oauth.example.com/v1',
      apiFormat: 'openai_chat',
      models: {
        main: 'oauth-model',
        haiku: 'oauth-model',
        sonnet: 'oauth-model',
        opus: 'oauth-model',
      },
    })
    const config = await routingService.getConfig()
    await routingService.updateConfig({
      ...config,
      profiles: config.profiles.map((profile) => profile.id === 'balanced'
        ? {
            ...profile,
            targets: [{ providerId: oauthProvider.id }],
          }
        : profile),
    })

    const dashboard = await routingService.getDashboard()
    expect(dashboard.sources.find((source) => source.providerId === oauthProvider.id)).toMatchObject({
      configured: true,
      routable: true,
      auth: 'oauth',
    })
    expect(dashboard.routeAvailability.balanced).toMatchObject({
      available: true,
      candidateCount: 1,
    })

    const plan = await routingService.resolveAttempts('balanced', 'oauth-runtime', {
      messages: [{ role: 'user', content: 'Use the OAuth connection' }],
    })
    expect(plan.targets.map((target) => target.provider.id)).toEqual([oauthProvider.id])
  })

  test('does not send an empty authorization header to a keyless local source', async () => {
    let authorization: string | null = 'not-called'
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        authorization = request.headers.get('authorization')
        const body = await request.json() as { model?: string }
        return Response.json({
          id: 'chatcmpl-local',
          object: 'chat.completion',
          created: 1,
          model: body.model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'local reply' },
            finish_reason: 'stop',
          }],
        })
      },
    })
    const service = new ProviderService()
    await service.addProvider({
      presetId: 'ollama',
      name: 'Keyless Ollama',
      apiKey: '',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiFormat: 'openai_chat',
      models: { main: 'qwen3:8b', haiku: 'qwen3:8b', sonnet: 'qwen3:8b', opus: 'qwen3:8b' },
    })

    const response = await routeRequest('balanced', 'keyless-local', {
      model: 'cybercode-route-balanced',
      messages: [{ role: 'user', content: 'use the local model' }],
    })

    expect(response.status).toBe(200)
    expect(authorization).toBeNull()
  })

  test('routes a configured no-auth cloud source without inventing credentials', async () => {
    let authorization: string | null = 'not-called'
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        authorization = request.headers.get('authorization')
        const body = await request.json() as { model?: string }
        return Response.json({
          id: 'chatcmpl-no-auth',
          object: 'chat.completion',
          created: 1,
          model: body.model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'anonymous reply' },
            finish_reason: 'stop',
          }],
        })
      },
    })
    const service = new ProviderService()
    const provider = await service.addProvider({
      presetId: 'opencode-free',
      name: 'OpenCode Free',
      apiKey: '',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiFormat: 'openai_chat',
      models: {
        main: 'north-mini-code-free',
        haiku: 'ling-3.0-flash-free',
        sonnet: 'north-mini-code-free',
        opus: 'mimo-v2.5-free',
      },
    })
    const config = await routingService.getConfig()
    await routingService.updateConfig({
      ...config,
      profiles: config.profiles.map((profile) => profile.id === 'free-first'
        ? {
            ...profile,
            allowExperimental: true,
            targets: [{ providerId: provider.id }],
          }
        : profile),
    })

    const dashboard = await routingService.getDashboard()
    expect(dashboard.sources.find((source) => source.providerId === provider.id)).toMatchObject({
      configured: true,
      routable: true,
      cost: 'recurring-free',
      auth: 'none',
      risk: 'experimental',
    })

    const response = await routeRequest('free-first', 'no-auth-cloud', {
      model: 'cybercode-route-free-first',
      messages: [{ role: 'user', content: 'use the anonymous model' }],
    })

    expect(response.status).toBe(200)
    expect(authorization).toBeNull()
    expect(response.headers.get('x-cybercode-route-provider')).toBe(provider.id)
  })

  test('rejects duplicate route ids and duplicate provider-model targets', async () => {
    const config = await routingService.getConfig()
    const firstProfile = config.profiles[0]!

    await expect(routingService.updateConfig({
      ...config,
      profiles: [...config.profiles, { ...firstProfile }],
    })).rejects.toThrow('Route profile id is duplicated')

    await expect(routingService.updateConfig({
      ...config,
      profiles: config.profiles.map((profile) => profile.id === firstProfile.id
        ? {
            ...profile,
            targets: [
              { providerId: 'provider-a', modelId: 'same-model' },
              { providerId: 'provider-a', modelId: 'same-model' },
            ],
          }
        : profile),
    })).rejects.toThrow('Route target is duplicated')
  })

  test('keeps multiple models from the same provider in fallback order', async () => {
    const service = new ProviderService()
    const provider = await service.addProvider({
      presetId: 'custom',
      name: 'Multi-model source',
      apiKey: 'provider-key',
      baseUrl: 'https://models.example.com',
      apiFormat: 'openai_chat',
      models: {
        main: 'model-primary',
        haiku: 'model-primary',
        sonnet: 'model-primary',
        opus: 'model-primary',
      },
    })
    const config = await routingService.getConfig()
    await routingService.updateConfig({
      ...config,
      profiles: config.profiles.map((profile) => profile.id === 'balanced'
        ? {
            ...profile,
            strategy: 'priority' as const,
            maxAttempts: 2,
            targets: [
              { providerId: provider.id, modelId: 'model-primary', priority: 0 },
              { providerId: provider.id, modelId: 'model-fallback', priority: 1 },
            ],
          }
        : profile),
    })

    const plan = await routingService.resolveAttempts('balanced', 'same-provider-models', {
      messages: [{ role: 'user', content: 'use the fallback chain' }],
    })

    expect(plan.targets.map((target) => target.modelId)).toEqual([
      'model-primary',
      'model-fallback',
    ])
  })

  test('fails over before output and pins the successful target through a tool loop', async () => {
    const seenKeys: string[] = []
    const seenModels: string[] = []
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const authorization = request.headers.get('authorization') ?? ''
        const body = await request.json() as { model?: string }
        seenKeys.push(authorization)
        seenModels.push(body.model ?? '')
        if (authorization === 'Bearer rate-limited') {
          return Response.json({ error: { message: 'rate limited' } }, { status: 429 })
        }
        return Response.json({
          id: 'chatcmpl-route',
          object: 'chat.completion',
          created: 1,
          model: body.model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'routed' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        })
      },
    })

    const service = new ProviderService()
    await service.addProvider({
      presetId: 'custom',
      name: 'Limited',
      apiKey: 'rate-limited',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiFormat: 'openai_chat',
      models: { main: 'model-limited', haiku: 'model-limited', sonnet: 'model-limited', opus: 'model-limited' },
    })
    await service.addProvider({
      presetId: 'custom',
      name: 'Healthy',
      apiKey: 'healthy',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiFormat: 'openai_chat',
      models: { main: 'model-healthy', haiku: 'model-healthy', sonnet: 'model-healthy', opus: 'model-healthy' },
    })

    const firstBody = {
      model: 'cybercode-route-balanced',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'inspect the project' }],
    }
    const first = await routeRequest('balanced', 'session-tool-loop', firstBody)
    expect(first.status).toBe(200)
    expect(seenKeys).toEqual(['Bearer rate-limited', 'Bearer healthy'])
    expect(seenModels).toEqual(['model-limited', 'model-healthy'])

    const second = await routeRequest('balanced', 'session-tool-loop', {
      ...firstBody,
      messages: [
        ...firstBody.messages,
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: 'Read' }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'done' }] },
      ],
    })
    expect(second.status).toBe(200)
    expect(seenKeys).toEqual([
      'Bearer rate-limited',
      'Bearer healthy',
      'Bearer healthy',
    ])

    const dashboard = await routingService.getDashboard()
    expect(dashboard.events.map((event) => event.status)).toEqual([
      'success',
      'success',
      'failed',
    ])
    expect(dashboard.health.find((entry) => entry.providerName === 'Limited')?.failures).toBe(1)
    expect(dashboard.health.find((entry) => entry.providerName === 'Healthy')?.successes).toBe(2)
  })

  test('releases a sticky and last-known-good target as soon as it fails', async () => {
    const service = new ProviderService()
    const first = await service.addProvider({
      presetId: 'custom',
      name: 'Previously good',
      apiKey: 'first-key',
      baseUrl: 'https://models.example.com',
      apiFormat: 'openai_chat',
      models: { main: 'first-model', haiku: 'first-model', sonnet: 'first-model', opus: 'first-model' },
    })
    const second = await service.addProvider({
      presetId: 'custom',
      name: 'Healthy alternative',
      apiKey: 'second-key',
      baseUrl: 'https://models.example.com',
      apiFormat: 'openai_chat',
      models: { main: 'second-model', haiku: 'second-model', sonnet: 'second-model', opus: 'second-model' },
    })
    const body = { messages: [{ role: 'user', content: 'continue the tool loop' }] }
    const initial = await routingService.resolveAttempts('stable', 'sticky-session', body)
    const firstTarget = initial.targets.find((target) => target.provider.id === first.id)!
    const secondTarget = initial.targets.find((target) => target.provider.id === second.id)!
    routingService.recordSuccess({
      routeId: 'stable',
      sessionId: 'sticky-session',
      fingerprint: initial.fingerprint,
      target: firstTarget,
      latencyMs: 20,
      attempt: 1,
    })
    routingService.recordSuccess({
      routeId: 'balanced',
      sessionId: 'other-session',
      fingerprint: 'other-turn',
      target: secondTarget,
      latencyMs: 10,
      attempt: 1,
    })
    routingService.recordFailure({
      routeId: 'stable',
      sessionId: 'sticky-session',
      fingerprint: initial.fingerprint,
      target: firstTarget,
      latencyMs: 30,
      attempt: 1,
      error: 'account unavailable',
      retryable: true,
    })

    const afterFailure = await routingService.resolveAttempts('stable', 'sticky-session', body)
    expect(afterFailure.targets[0]?.provider.id).toBe(second.id)
  })

  test('keeps tool-loop fingerprints stable without merging later repeated prompts', async () => {
    const service = new ProviderService()
    await service.addProvider({
      presetId: 'custom',
      name: 'Fingerprint source',
      apiKey: 'fingerprint-key',
      baseUrl: 'https://models.example.com',
      apiFormat: 'openai_chat',
      models: { main: 'model-a', haiku: 'model-a', sonnet: 'model-a', opus: 'model-a' },
    })

    const prompt = { role: 'user', content: 'run the tests' }
    const first = await routingService.resolveAttempts('balanced', 'repeat-session', {
      messages: [prompt],
    })
    const continuation = await routingService.resolveAttempts('balanced', 'repeat-session', {
      messages: [
        prompt,
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash' }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'done' }] },
      ],
    })
    const repeatedTurn = await routingService.resolveAttempts('balanced', 'repeat-session', {
      messages: [
        prompt,
        { role: 'assistant', content: 'The tests passed.' },
        prompt,
      ],
    })

    expect(continuation.fingerprint).toBe(first.fingerprint)
    expect(repeatedTurn.fingerprint).not.toBe(first.fingerprint)
  })

  test('resets the round-robin position together with routing health', async () => {
    const service = new ProviderService()
    for (const name of ['First source', 'Second source']) {
      await service.addProvider({
        presetId: 'custom',
        name,
        apiKey: `${name}-key`,
        baseUrl: 'https://models.example.com',
        apiFormat: 'openai_chat',
        models: { main: name, haiku: name, sonnet: name, opus: name },
      })
    }
    const config = await routingService.getConfig()
    await routingService.updateConfig({
      ...config,
      profiles: config.profiles.map((profile) => profile.id === 'balanced'
        ? { ...profile, strategy: 'round-robin' as const, maxAttempts: 1 }
        : profile),
    })

    const first = await routingService.resolveAttempts('balanced', 'round-robin-1', {
      messages: [{ role: 'user', content: 'first turn' }],
    })
    routingService.resetHealth()
    const afterReset = await routingService.resolveAttempts('balanced', 'round-robin-2', {
      messages: [{ role: 'user', content: 'second turn' }],
    })

    expect(afterReset.targets[0]?.provider.id).toBe(first.targets[0]?.provider.id)
  })

  test('combines configured weights with learned source health', async () => {
    const service = new ProviderService()
    const unhealthy = await service.addProvider({
      presetId: 'custom',
      name: 'Unhealthy weighted source',
      apiKey: 'unhealthy-key',
      baseUrl: 'https://models.example.com',
      apiFormat: 'openai_chat',
      models: { main: 'unhealthy-model', haiku: 'unhealthy-model', sonnet: 'unhealthy-model', opus: 'unhealthy-model' },
    })
    const healthy = await service.addProvider({
      presetId: 'custom',
      name: 'Healthy weighted source',
      apiKey: 'healthy-key',
      baseUrl: 'https://models.example.com',
      apiFormat: 'openai_chat',
      models: { main: 'healthy-model', haiku: 'healthy-model', sonnet: 'healthy-model', opus: 'healthy-model' },
    })
    const initial = await routingService.resolveAttempts('balanced', 'weight-training', {
      messages: [{ role: 'user', content: 'train source health' }],
    })
    const unhealthyTarget = initial.targets.find((target) => target.provider.id === unhealthy.id)!
    const healthyTarget = initial.targets.find((target) => target.provider.id === healthy.id)!
    routingService.recordFailure({
      routeId: 'training',
      sessionId: 'weight-training',
      fingerprint: 'failure',
      target: unhealthyTarget,
      latencyMs: 20,
      attempt: 1,
      error: 'failed',
      retryable: true,
    })
    routingService.recordSuccess({
      routeId: 'training',
      sessionId: 'weight-training',
      fingerprint: 'success',
      target: healthyTarget,
      latencyMs: 20,
      attempt: 1,
    })
    const config = await routingService.getConfig()
    await routingService.updateConfig({
      ...config,
      profiles: config.profiles.map((profile) => profile.id === 'balanced'
        ? {
            ...profile,
            strategy: 'weighted' as const,
            targets: [
              { providerId: unhealthy.id, weight: 1 },
              { providerId: healthy.id, weight: 1 },
            ],
          }
        : profile),
    })

    const originalRandom = Math.random
    Math.random = () => 0.3
    try {
      const plan = await routingService.resolveAttempts('balanced', 'weighted-route', {
        messages: [{ role: 'user', content: 'pick a weighted source' }],
      })
      expect(plan.targets[0]?.provider.id).toBe(healthy.id)
    } finally {
      Math.random = originalRandom
    }
  })

  test('does not fail open when no candidate supports an image request', async () => {
    const service = new ProviderService()
    await service.addProvider({
      presetId: 'custom',
      name: 'Text only',
      apiKey: 'key',
      baseUrl: 'https://models.example.com',
      apiFormat: 'openai_chat',
      models: { main: 'text-model', haiku: 'text-model', sonnet: 'text-model', opus: 'text-model' },
      imageSupportMode: 'disabled',
    })

    await expect(routingService.resolveAttempts('balanced', 'image-session', {
      model: 'cybercode-route-balanced',
      messages: [{
        role: 'user',
        content: [{ type: 'image', source: { type: 'base64', data: 'AA==' } }],
      }],
    })).rejects.toThrow('No route candidate satisfies this request')
  })

  test('does not count base64 image bytes as ordinary context tokens', async () => {
    const service = new ProviderService()
    const provider = await service.addProvider({
      presetId: 'custom',
      name: 'Vision source',
      apiKey: 'vision-key',
      baseUrl: 'https://models.example.com',
      apiFormat: 'openai_chat',
      models: { main: 'vision-model', haiku: 'vision-model', sonnet: 'vision-model', opus: 'vision-model' },
      modelContextWindows: { main: 200_000 },
      imageSupportMode: 'enabled',
    })

    const plan = await routingService.resolveAttempts('balanced', 'large-image', {
      model: 'cybercode-route-balanced',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [{
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(2_000_000) },
        }],
      }],
    })

    expect(plan.targets.map((target) => target.provider.id)).toEqual([provider.id])
  })

  test('includes tool definitions when filtering candidates by context size', async () => {
    const service = new ProviderService()
    const small = await service.addProvider({
      presetId: 'custom',
      name: 'Small context',
      apiKey: 'small-key',
      baseUrl: 'https://models.example.com',
      apiFormat: 'openai_chat',
      models: { main: 'small-model', haiku: 'small-model', sonnet: 'small-model', opus: 'small-model' },
      modelContextWindows: { main: 10_000 },
    })
    const large = await service.addProvider({
      presetId: 'custom',
      name: 'Large context',
      apiKey: 'large-key',
      baseUrl: 'https://models.example.com',
      apiFormat: 'openai_chat',
      models: { main: 'large-model', haiku: 'large-model', sonnet: 'large-model', opus: 'large-model' },
      modelContextWindows: { main: 100_000 },
    })

    const plan = await routingService.resolveAttempts('balanced', 'large-tool-schema', {
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'Use the available tools.' }],
      tools: [{
        name: 'large_schema_tool',
        description: 'x'.repeat(50_000),
        input_schema: { type: 'object', properties: {} },
      }],
    })

    expect(plan.targets.map((target) => target.provider.id)).toEqual([large.id])
    expect(plan.targets.some((target) => target.provider.id === small.id)).toBe(false)
  })

  test('keeps paid models out of strict-free routes for mixed gateways', async () => {
    const service = new ProviderService()
    const signupCredit = await service.addProvider({
      presetId: 'zhipuglm',
      name: 'Promotional credit',
      apiKey: 'credit-key',
      baseUrl: 'https://credit.example.com',
      apiFormat: 'anthropic',
      models: {
        main: 'credit-model',
        haiku: 'credit-model',
        sonnet: 'credit-model',
        opus: 'credit-model',
      },
    })
    const paid = await service.addProvider({
      presetId: 'openrouter',
      name: 'OpenRouter paid',
      apiKey: 'paid-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiFormat: 'openai_chat',
      models: {
        main: 'anthropic/claude-sonnet-4.6',
        haiku: 'anthropic/claude-sonnet-4.6',
        sonnet: 'anthropic/claude-sonnet-4.6',
        opus: 'anthropic/claude-sonnet-4.6',
      },
    })
    const free = await service.addProvider({
      presetId: 'openrouter',
      name: 'OpenRouter free',
      apiKey: 'free-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiFormat: 'openai_chat',
      models: {
        main: 'openrouter/free',
        haiku: 'openrouter/free',
        sonnet: 'openrouter/free',
        opus: 'openrouter/free',
      },
    })

    const plan = await routingService.resolveAttempts('free-first', 'strict-free', {
      model: 'cybercode-route-free-first',
      messages: [{ role: 'user', content: 'use a free model' }],
    })
    expect(plan.targets.map((target) => target.provider.id)).toEqual([free.id])
    expect(plan.targets.some((target) => target.provider.id === paid.id)).toBe(false)
    expect(plan.targets.some((target) => target.provider.id === signupCredit.id)).toBe(false)

    const dashboard = await routingService.getDashboard()
    expect(dashboard.sources.find((source) => source.providerId === free.id)?.cost).toBe('mixed')
    expect(dashboard.routeAvailability['free-first']?.candidateCount).toBe(1)
  })

  test('retries source-specific model errors on another route target', async () => {
    const seenKeys: string[] = []
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const authorization = request.headers.get('authorization') ?? ''
        seenKeys.push(authorization)
        if (authorization === 'Bearer missing-model') {
          return Response.json({ error: { message: 'model not found' } }, { status: 404 })
        }
        return Response.json({
          id: 'chatcmpl-model-fallback',
          object: 'chat.completion',
          created: 1,
          model: 'fallback-model',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'fallback worked' },
            finish_reason: 'stop',
          }],
        })
      },
    })

    const service = new ProviderService()
    for (const [name, apiKey] of [
      ['Missing model', 'missing-model'],
      ['Fallback model', 'fallback-model'],
    ] as const) {
      await service.addProvider({
        presetId: 'custom',
        name,
        apiKey,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        apiFormat: 'openai_chat',
        models: { main: name, haiku: name, sonnet: name, opus: name },
      })
    }

    const response = await routeRequest('balanced', 'model-error-fallback', {
      model: 'cybercode-route-balanced',
      messages: [{ role: 'user', content: 'route this request' }],
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('fallback worked')
    expect(seenKeys).toEqual(['Bearer missing-model', 'Bearer fallback-model'])
  })

  test('stops routing immediately when the client cancels without penalizing a source', async () => {
    const seenKeys: string[] = []
    let markStarted!: () => void
    let releaseUpstream!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const upstreamGate = new Promise<void>((resolve) => { releaseUpstream = resolve })
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const authorization = request.headers.get('authorization') ?? ''
        seenKeys.push(authorization)
        markStarted()
        await upstreamGate
        return Response.json({
          id: 'chatcmpl-cancelled',
          object: 'chat.completion',
          created: 1,
          model: 'cancelled-model',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'too late' },
            finish_reason: 'stop',
          }],
        })
      },
    })

    const service = new ProviderService()
    for (const [name, apiKey] of [
      ['Slow source', 'slow-source'],
      ['Unused fallback', 'unused-fallback'],
    ] as const) {
      await service.addProvider({
        presetId: 'custom',
        name,
        apiKey,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        apiFormat: 'openai_chat',
        models: { main: name, haiku: name, sonnet: name, opus: name },
      })
    }

    const controller = new AbortController()
    const responsePromise = routeRequest('balanced', 'cancelled-route', {
      model: 'cybercode-route-balanced',
      messages: [{ role: 'user', content: 'cancel this request' }],
    }, controller.signal)
    await started
    controller.abort()
    releaseUpstream()

    const response = await responsePromise
    expect(response.status).toBe(499)
    expect(seenKeys).toEqual(['Bearer slow-source'])
    const dashboard = await routingService.getDashboard()
    expect(dashboard.health).toEqual([])
    expect(dashboard.events).toEqual([])
  })

  test('removes deleted providers from routing health snapshots', async () => {
    const service = new ProviderService()
    const provider = await service.addProvider({
      presetId: 'custom',
      name: 'Temporary source',
      apiKey: 'temporary-key',
      baseUrl: 'https://models.example.com',
      apiFormat: 'openai_chat',
      models: { main: 'temporary-model', haiku: 'temporary-model', sonnet: 'temporary-model', opus: 'temporary-model' },
    })
    const plan = await routingService.resolveAttempts('balanced', 'deleted-health', {
      messages: [{ role: 'user', content: 'record health' }],
    })
    routingService.recordFailure({
      routeId: 'balanced',
      sessionId: 'deleted-health',
      fingerprint: plan.fingerprint,
      target: plan.targets[0]!,
      latencyMs: 10,
      attempt: 1,
      error: 'temporary failure',
      retryable: true,
    })
    expect((await routingService.getDashboard()).health).toHaveLength(1)

    await service.deleteProvider(provider.id)
    expect((await routingService.getDashboard()).health).toEqual([])
  })

  test('fails over when a non-streaming source returns an empty successful response', async () => {
    const seenKeys: string[] = []
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const authorization = request.headers.get('authorization') ?? ''
        const body = await request.json() as { model?: string }
        seenKeys.push(authorization)
        return Response.json({
          id: 'chatcmpl-empty-failover',
          object: 'chat.completion',
          created: 1,
          model: body.model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: authorization === 'Bearer empty-success' ? '' : 'healthy reply',
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        })
      },
    })

    const service = new ProviderService()
    for (const [name, apiKey] of [
      ['Empty success', 'empty-success'],
      ['Healthy success', 'healthy-success'],
    ] as const) {
      await service.addProvider({
        presetId: 'custom',
        name,
        apiKey,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        apiFormat: 'openai_chat',
        models: { main: name, haiku: name, sonnet: name, opus: name },
      })
    }

    const response = await routeRequest('balanced', 'empty-non-stream', {
      model: 'cybercode-route-balanced',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'reply with text' }],
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('healthy reply')
    expect(seenKeys).toEqual(['Bearer empty-success', 'Bearer healthy-success'])
  })

  test('fails over when a streaming source returns headers but no output', async () => {
    const seenKeys: string[] = []
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const authorization = request.headers.get('authorization') ?? ''
        seenKeys.push(authorization)
        if (authorization === 'Bearer empty-stream') {
          return new Response(new ReadableStream({
            start(controller) {
              controller.close()
            },
          }), {
            headers: { 'content-type': 'text/event-stream' },
          })
        }
        if (authorization === 'Bearer metadata-stream') {
          return new Response(': keep-alive\n\ndata: [DONE]\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          })
        }
        const chunks = [
          'data: {"id":"route-stream","object":"chat.completion.chunk","created":1,"model":"healthy-stream","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
          'data: {"id":"route-stream","object":"chat.completion.chunk","created":1,"model":"healthy-stream","choices":[{"index":0,"delta":{"content":"text_delta"},"finish_reason":null}]}\n\n',
          'data: {"id":"route-stream","object":"chat.completion.chunk","created":1,"model":"healthy-stream","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]
        return new Response(chunks.join(''), {
          headers: { 'content-type': 'text/event-stream' },
        })
      },
    })

    const service = new ProviderService()
    await service.addProvider({
      presetId: 'custom',
      name: 'Empty stream',
      apiKey: 'empty-stream',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiFormat: 'openai_chat',
      models: { main: 'empty', haiku: 'empty', sonnet: 'empty', opus: 'empty' },
    })
    await service.addProvider({
      presetId: 'custom',
      name: 'Metadata-only stream',
      apiKey: 'metadata-stream',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiFormat: 'openai_chat',
      models: { main: 'metadata', haiku: 'metadata', sonnet: 'metadata', opus: 'metadata' },
    })
    const healthy = await service.addProvider({
      presetId: 'custom',
      name: 'Healthy stream',
      apiKey: 'healthy-stream',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiFormat: 'openai_chat',
      models: { main: 'healthy', haiku: 'healthy', sonnet: 'healthy', opus: 'healthy' },
    })

    const response = await routeRequest('balanced', 'stream-failover', {
      model: 'cybercode-route-balanced',
      stream: true,
      max_tokens: 64,
      messages: [{ role: 'user', content: 'stream a reply' }],
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('x-cybercode-route-provider')).toBe(healthy.id)
    expect(await response.text()).toContain('text_delta')
    expect(seenKeys).toEqual([
      'Bearer empty-stream',
      'Bearer metadata-stream',
      'Bearer healthy-stream',
    ])
  })
})

function routeRequest(
  routeId: string,
  sessionId: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const url = new URL(
    `http://127.0.0.1/proxy/routes/${routeId}/sessions/${sessionId}/v1/messages`,
  )
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  return handleProxyRequest(request, url)
}
