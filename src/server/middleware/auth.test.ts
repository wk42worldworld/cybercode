import { afterEach, describe, expect, test } from 'bun:test'

import { validateAuth } from './auth.js'

const originalServerToken = process.env.SERVER_AUTH_TOKEN
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY

afterEach(() => {
  if (originalServerToken === undefined) delete process.env.SERVER_AUTH_TOKEN
  else process.env.SERVER_AUTH_TOKEN = originalServerToken
  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey
})

describe('local server auth', () => {
  test('prefers the ephemeral desktop token over provider API credentials', () => {
    process.env.SERVER_AUTH_TOKEN = 'desktop-token'
    process.env.ANTHROPIC_API_KEY = 'provider-key'

    expect(validateAuth(new Request('http://127.0.0.1/api/status', {
      headers: { Authorization: 'Bearer desktop-token' },
    })).valid).toBe(true)
    expect(validateAuth(new Request('http://127.0.0.1/api/status', {
      headers: { Authorization: 'Bearer provider-key' },
    })).valid).toBe(false)
  })

  test('accepts x-api-key for the internal protocol proxy', () => {
    process.env.SERVER_AUTH_TOKEN = 'desktop-token'
    expect(validateAuth(new Request('http://127.0.0.1/proxy/providers/id', {
      headers: { 'x-api-key': 'desktop-token' },
    })).valid).toBe(true)
  })

  test('accepts a query token for browser WebSocket handshakes', () => {
    process.env.SERVER_AUTH_TOKEN = 'desktop-token'
    expect(validateAuth(
      new Request('http://127.0.0.1/ws/session?token=desktop-token'),
    ).valid).toBe(true)
  })
})
