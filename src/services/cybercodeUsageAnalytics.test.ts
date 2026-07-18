import { afterEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { reportCybercodeUsage } from './cybercodeUsageAnalytics.js'

const testRoots: string[] = []

afterEach(() => {
  for (const root of testRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('CyberCode anonymous usage analytics', () => {
  test('sends only anonymous product metadata and reports at most once per day', async () => {
    const configDir = temporaryConfig()
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      return new Response(null, { status: 204 })
    }
    const options = {
      configDir,
      endpoint: 'https://stats.example.test/heartbeat',
      fetchImpl,
      getUserId: () => 'local-random-user-id',
      isDisabled: () => false,
      now: () => new Date(2026, 6, 18, 10, 0, 0),
      version: '1.2.3',
      platform: 'win32',
      arch: 'x64',
    }

    expect(await reportCybercodeUsage('desktop', options)).toBe('sent')
    expect(await reportCybercodeUsage('desktop', options)).toBe('skipped')
    expect(requests).toHaveLength(1)

    const payload = JSON.parse(String(requests[0]?.init?.body)) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual([
      'arch',
      'installationId',
      'platform',
      'schemaVersion',
      'surface',
      'version',
    ])
    expect(payload).toMatchObject({
      schemaVersion: 1,
      version: '1.2.3',
      platform: 'win32',
      arch: 'x64',
      surface: 'desktop',
    })
    expect(payload.installationId).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(payload)).not.toContain('local-random-user-id')

    const state = JSON.parse(
      fs.readFileSync(
        path.join(configDir, 'cybercode', 'usage-analytics.json'),
        'utf8',
      ),
    )
    expect(state).toEqual({ version: 1, lastReportedDay: '2026-07-18' })
  })

  test('does no work when telemetry is disabled', async () => {
    const configDir = temporaryConfig()
    let fetchCalls = 0
    let userIdCalls = 0

    const result = await reportCybercodeUsage('cli', {
      configDir,
      isDisabled: () => true,
      fetchImpl: async () => {
        fetchCalls += 1
        return new Response(null, { status: 204 })
      },
      getUserId: () => {
        userIdCalls += 1
        return 'unused'
      },
    })

    expect(result).toBe('skipped')
    expect(fetchCalls).toBe(0)
    expect(userIdCalls).toBe(0)
    expect(fs.existsSync(path.join(configDir, 'cybercode'))).toBe(false)
  })

  test('retries after network failures and rejects insecure remote endpoints', async () => {
    const configDir = temporaryConfig()
    let fetchCalls = 0
    const common = {
      configDir,
      getUserId: () => 'retry-user',
      isDisabled: () => false,
      now: () => new Date(2026, 6, 18, 12, 0, 0),
      version: '1.2.3',
    }

    expect(
      await reportCybercodeUsage('cli', {
        ...common,
        endpoint: 'https://stats.example.test/heartbeat',
        fetchImpl: async () => {
          fetchCalls += 1
          return new Response(null, { status: 503 })
        },
      }),
    ).toBe('failed')

    expect(
      await reportCybercodeUsage('cli', {
        ...common,
        endpoint: 'https://stats.example.test/heartbeat',
        fetchImpl: async () => {
          fetchCalls += 1
          return new Response(null, { status: 204 })
        },
      }),
    ).toBe('sent')
    expect(fetchCalls).toBe(2)

    expect(
      await reportCybercodeUsage('cli', {
        ...common,
        configDir: temporaryConfig(),
        endpoint: 'http://stats.example.test/heartbeat',
        fetchImpl: async () => {
          throw new Error('must not be called')
        },
      }),
    ).toBe('failed')
  })

  test('contains unexpected local configuration failures', async () => {
    const result = await reportCybercodeUsage('desktop', {
      configDir: temporaryConfig(),
      endpoint: 'https://stats.example.test/heartbeat',
      isDisabled: () => false,
      getUserId: () => {
        throw new Error('config is temporarily unavailable')
      },
      fetchImpl: async () => {
        throw new Error('must not be called')
      },
    })

    expect(result).toBe('failed')
  })
})

function temporaryConfig(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-usage-test-'))
  testRoots.push(root)
  return root
}
