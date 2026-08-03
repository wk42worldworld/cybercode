import { describe, expect, it } from 'vitest'
import tauriConfigRaw from '../../src-tauri/tauri.conf.json?raw'

describe('plugin marketplace packaging', () => {
  it('allows official plugin logos in the production CSP', () => {
    const config = JSON.parse(tauriConfigRaw) as {
      app: { security: { csp: string } }
    }
    const imageSources = config.app.security.csp
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('img-src '))

    expect(imageSources).toBeDefined()
    expect(imageSources?.split(/\s+/)).toContain('https:')
  })
})
