import { describe, expect, it } from 'vitest'
import type { RoutingSource } from '../../../types/routing'
import { routeGraphProviderType } from './routeGraphProviderOptions'

const source = (patch: Partial<RoutingSource>): RoutingSource => ({
  id: 'provider-1',
  providerId: 'provider-1',
  presetId: 'openai',
  name: 'Provider',
  configured: true,
  routable: true,
  cost: 'paid',
  auth: 'api-key',
  risk: 'stable',
  models: [{ id: 'model-1' }],
  ...patch,
})

describe('routeGraphProviderType', () => {
  it.each([
    [{ presetId: 'openai' }, 'apiKey'],
    [{ presetId: 'openrouter' }, 'aggregator'],
    [{ presetId: 'openai', auth: 'oauth' }, 'oauth'],
    [{ presetId: 'web-session:kimi-web', auth: 'api-key' }, 'webSession'],
    [{ presetId: 'ollama', auth: 'local' }, 'local'],
    [{ presetId: 'custom', name: '火山' }, 'aggregator'],
    [{ presetId: 'custom', name: '百度千帆' }, 'aggregator'],
    [{ presetId: 'private-compatible-endpoint' }, 'custom'],
    [{ presetId: 'opencode-free', auth: 'none' }, 'noAuth'],
  ] satisfies Array<[Partial<RoutingSource>, string]>)('classifies %o as %s', (patch, expected) => {
    expect(routeGraphProviderType(source(patch))).toBe(expected)
  })
})
