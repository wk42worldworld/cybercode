import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { get3PModelCapabilityOverride } from '../model/modelSupportOverrides.js'
import { modelSupportsAdaptiveThinking, modelSupportsThinking } from '../thinking.js'

describe('provider-aware thinking support', () => {
  let originalBaseUrl: string | undefined
  let originalSonnetModel: string | undefined
  let originalSonnetCapabilities: string | undefined
  let originalBedrock: string | undefined
  let originalVertex: string | undefined
  let originalFoundry: string | undefined

  beforeEach(() => {
    originalBaseUrl = process.env.ANTHROPIC_BASE_URL
    originalSonnetModel = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
    originalSonnetCapabilities = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES
    originalBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
    originalVertex = process.env.CLAUDE_CODE_USE_VERTEX
    originalFoundry = process.env.CLAUDE_CODE_USE_FOUNDRY

    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
  })

  afterEach(() => {
    restoreEnv('ANTHROPIC_BASE_URL', originalBaseUrl)
    restoreEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', originalSonnetModel)
    restoreEnv('ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES', originalSonnetCapabilities)
    restoreEnv('CLAUDE_CODE_USE_BEDROCK', originalBedrock)
    restoreEnv('CLAUDE_CODE_USE_VERTEX', originalVertex)
    restoreEnv('CLAUDE_CODE_USE_FOUNDRY', originalFoundry)
    clearCapabilityCache()
  })

  test('does not assume adaptive thinking for Anthropic-compatible third-party base URLs', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES
    clearCapabilityCache()

    expect(modelSupportsAdaptiveThinking('claude-sonnet-4-6')).toBe(false)
  })

  test('honors explicit provider capability overrides with no supported capabilities', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'claude-sonnet-4-6'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES = 'none'
    clearCapabilityCache()

    expect(get3PModelCapabilityOverride('claude-sonnet-4-6', 'thinking')).toBe(false)
    expect(modelSupportsThinking('claude-sonnet-4-6')).toBe(false)
    expect(modelSupportsAdaptiveThinking('claude-sonnet-4-6')).toBe(false)
  })

  test('keeps first-party Anthropic Sonnet adaptive thinking enabled', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES
    clearCapabilityCache()

    expect(modelSupportsThinking('claude-sonnet-4-6')).toBe(true)
    expect(modelSupportsAdaptiveThinking('claude-sonnet-4-6')).toBe(true)
  })
})

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function clearCapabilityCache() {
  ;(get3PModelCapabilityOverride as typeof get3PModelCapabilityOverride & {
    cache?: { clear?: () => void }
  }).cache?.clear?.()
}
