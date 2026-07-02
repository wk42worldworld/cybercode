import { afterEach, describe, expect, test } from 'bun:test'
import { getContextWindowForModel } from './context.js'
import {
  CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV,
  inferContextWindowFromModelName,
  parseContextWindowTokenValue,
} from './modelContextWindows.js'

const originalContextWindows = process.env[CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV]

afterEach(() => {
  if (originalContextWindows === undefined) {
    delete process.env[CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV]
  } else {
    process.env[CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV] = originalContextWindows
  }
})

describe('model context window helpers', () => {
  test('parses compact context window values', () => {
    expect(parseContextWindowTokenValue('200k')).toBe(200_000)
    expect(parseContextWindowTokenValue('1m')).toBe(1_000_000)
    expect(parseContextWindowTokenValue('128000')).toBe(128_000)
    expect(parseContextWindowTokenValue('bad')).toBeUndefined()
  })

  test('infers context window from model id suffixes', () => {
    expect(inferContextWindowFromModelName('deepseek-v4-pro[1m]')).toBe(1_000_000)
    expect(inferContextWindowFromModelName('example-model-128k')).toBe(128_000)
    expect(inferContextWindowFromModelName('glm-5.1')).toBeUndefined()
  })

  test('getContextWindowForModel honors CyberCode per-model overrides', () => {
    process.env[CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV] = JSON.stringify({
      'kimi-k2.6': 1_000_000,
    })

    expect(getContextWindowForModel('kimi-k2.6')).toBe(1_000_000)
  })
})
