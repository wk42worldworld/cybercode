import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handlePluginsApi } from '../api/plugins.js'

let tmpDir: string
let originalConfigDir: string | undefined

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
  return {
    req,
    url,
    segments: url.pathname.split('/').filter(Boolean),
  }
}

describe('Plugins API', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-plugins-api-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('GET /api/plugins returns an empty plugin list for a clean config', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/plugins')
    const res = await handlePluginsApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as {
      plugins: unknown[]
      marketplaces: unknown[]
      summary: { total: number; enabled: number; errorCount: number }
    }

    expect(body.plugins).toEqual([])
    expect(Array.isArray(body.marketplaces)).toBe(true)
    expect(body.summary.total).toBe(0)
    expect(body.summary.enabled).toBe(0)
    expect(body.summary.errorCount).toBe(0)
  })

  it('POST /api/plugins/reload returns numeric counters', async () => {
    const { req, url, segments } = makeRequest('POST', '/api/plugins/reload', {})
    const res = await handlePluginsApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as {
      ok: boolean
      summary: Record<string, number>
    }

    expect(body.ok).toBe(true)
    expect(typeof body.summary.enabled).toBe('number')
    expect(typeof body.summary.skills).toBe('number')
    expect(typeof body.summary.errors).toBe('number')
  })
})
