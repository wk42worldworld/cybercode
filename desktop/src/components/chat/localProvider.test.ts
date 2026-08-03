import { describe, expect, it } from 'vitest'
import {
  isLocalProvider,
  isLocalProviderBaseUrl,
} from './localProvider'

describe('isLocalProviderBaseUrl', () => {
  it('treats loopback and docker bridge hosts as local', () => {
    expect(isLocalProviderBaseUrl('http://localhost:11434/v1')).toBe(true)
    expect(isLocalProviderBaseUrl('http://127.0.0.1:1234/v1')).toBe(true)
    expect(isLocalProviderBaseUrl('http://127.20.0.9:8080')).toBe(true)
    expect(isLocalProviderBaseUrl('http://[::1]:11434')).toBe(true)
    expect(isLocalProviderBaseUrl('http://host.docker.internal:11434')).toBe(true)
  })

  it('treats RFC1918 LAN addresses as local self-hosted inference', () => {
    expect(isLocalProviderBaseUrl('http://192.168.1.10:11434')).toBe(true)
    expect(isLocalProviderBaseUrl('http://10.0.0.5:11434')).toBe(true)
    expect(isLocalProviderBaseUrl('http://172.16.3.9:1234/v1')).toBe(true)
    expect(isLocalProviderBaseUrl('http://172.32.3.9:1234/v1')).toBe(false)
  })

  it('rejects remote hosts and invalid values', () => {
    expect(isLocalProviderBaseUrl('https://api.anthropic.com')).toBe(false)
    expect(isLocalProviderBaseUrl('')).toBe(false)
    expect(isLocalProviderBaseUrl(null)).toBe(false)
    expect(isLocalProviderBaseUrl('not a url')).toBe(false)
  })
})

describe('isLocalProvider', () => {
  it('matches known local presets regardless of base URL', () => {
    expect(isLocalProvider({ presetId: 'ollama', baseUrl: 'http://ollama.internal:11434' })).toBe(true)
    expect(isLocalProvider({ presetId: 'LMStudio', baseUrl: 'http://10.0.0.2:1234' })).toBe(true)
    expect(isLocalProvider({ presetId: 'llama.cpp', baseUrl: 'http://example.com' })).toBe(true)
    expect(isLocalProvider({ presetId: 'llamacpp', baseUrl: 'http://example.com' })).toBe(true)
  })

  it('matches custom presets only when the base URL is local', () => {
    expect(isLocalProvider({ presetId: 'custom', baseUrl: 'http://127.0.0.1:8080/v1' })).toBe(true)
    expect(isLocalProvider({ presetId: 'custom', baseUrl: 'http://192.168.1.20:11434' })).toBe(true)
    expect(isLocalProvider({ presetId: 'custom', baseUrl: 'https://api.openai.com' })).toBe(false)
  })

  it('rejects cloud presets even behind a loopback gateway', () => {
    expect(isLocalProvider({ presetId: 'openai', baseUrl: 'http://127.0.0.1:8080' })).toBe(false)
    expect(isLocalProvider({ presetId: 'deepseek', baseUrl: 'http://localhost:4000/v1' })).toBe(false)
    expect(isLocalProvider({ presetId: 'ollama-cloud', baseUrl: 'https://ollama.com' })).toBe(false)
  })
})
