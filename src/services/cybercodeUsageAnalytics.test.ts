import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  _resetCybercodeUsageReportersForTesting,
  reportCybercodeUsage,
  startCybercodeUsageReporter,
} from './cybercodeUsageAnalytics.js'

const testRoots: string[] = []

afterEach(() => {
  _resetCybercodeUsageReportersForTesting()
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
    expect(
      fs.readFileSync(
        path.join(configDir, 'cybercode', 'installation-id'),
        'utf8',
      ).trim(),
    ).toBe(payload.installationId)

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
    const installationIds: string[] = []
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
        fetchImpl: async (_input: string | URL | Request, init?: RequestInit) => {
          fetchCalls += 1
          installationIds.push(
            String(
              (JSON.parse(String(init?.body)) as { installationId: string })
                .installationId,
            ),
          )
          return new Response(null, { status: 503 })
        },
      }),
    ).toBe('failed')

    expect(
      await reportCybercodeUsage('cli', {
        ...common,
        endpoint: 'https://stats.example.test/heartbeat',
        fetchImpl: async (_input: string | URL | Request, init?: RequestInit) => {
          fetchCalls += 1
          installationIds.push(
            String(
              (JSON.parse(String(init?.body)) as { installationId: string })
                .installationId,
            ),
          )
          return new Response(null, { status: 204 })
        },
      }),
    ).toBe('sent')
    expect(fetchCalls).toBe(2)
    expect(new Set(installationIds).size).toBe(1)

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

  test('reports without reading initialized global configuration', async () => {
    let payload: { installationId: string } | undefined
    const result = await reportCybercodeUsage('desktop', {
      configDir: temporaryConfig(),
      endpoint: 'https://stats.example.test/heartbeat',
      isDisabled: () => false,
      getUserId: () => {
        throw new Error('config is temporarily unavailable')
      },
      fetchImpl: async (_input, init) => {
        payload = JSON.parse(String(init?.body)) as { installationId: string }
        return new Response(null, { status: 204 })
      },
    })

    expect(result).toBe('sent')
    expect(payload?.installationId).toMatch(/^[a-f0-9]{64}$/)
  })

  test('migrates the legacy anonymous user ID without changing identity', async () => {
    const configDir = temporaryConfig()
    const globalConfigPath = path.join(configDir, '.config.json')
    const legacyUserId = 'existing-anonymous-user'
    fs.writeFileSync(globalConfigPath, JSON.stringify({ userID: legacyUserId }))
    let installationId = ''

    expect(
      await reportCybercodeUsage('desktop', {
        configDir,
        globalConfigPath,
        endpoint: 'https://stats.example.test/heartbeat',
        isDisabled: () => false,
        fetchImpl: async (_input, init) => {
          installationId = (
            JSON.parse(String(init?.body)) as { installationId: string }
          ).installationId
          return new Response(null, { status: 204 })
        },
      }),
    ).toBe('sent')

    const expected = createHash('sha256')
      .update('cybercode-usage-v1\0')
      .update(legacyUserId)
      .digest('hex')
    expect(installationId).toBe(expected)
    expect(
      fs.readFileSync(
        path.join(configDir, 'cybercode', 'installation-id'),
        'utf8',
      ).trim(),
    ).toBe(expected)
  })

  test('uses one installation ID when desktop and CLI report concurrently', async () => {
    const configDir = temporaryConfig()
    const installationIds: string[] = []
    const options = {
      configDir,
      endpoint: 'https://stats.example.test/heartbeat',
      isDisabled: () => false,
      getUserId: () => {
        throw new Error('configuration is still locked')
      },
      fetchImpl: async (_input: string | URL | Request, init?: RequestInit) => {
        installationIds.push(
          (JSON.parse(String(init?.body)) as { installationId: string })
            .installationId,
        )
        return new Response(null, { status: 204 })
      },
    }

    const results = await Promise.all([
      reportCybercodeUsage('desktop', options),
      reportCybercodeUsage('cli', options),
    ])

    expect(results).toEqual(['sent', 'sent'])
    expect(installationIds).toHaveLength(2)
    expect(new Set(installationIds).size).toBe(1)
  })

  test('retries startup failures without waiting for the periodic interval', async () => {
    const configDir = temporaryConfig()
    const statePath = path.join(
      configDir,
      'cybercode',
      'usage-analytics.json',
    )
    let fetchCalls = 0

    startCybercodeUsageReporter('desktop', {
      configDir,
      endpoint: 'https://stats.example.test/heartbeat',
      isDisabled: () => false,
      getUserId: () => 'retry-schedule-user',
      retryDelaysMs: [5],
      reportIntervalMs: 60_000,
      fetchImpl: async () => {
        fetchCalls += 1
        return new Response(null, { status: fetchCalls === 1 ? 503 : 204 })
      },
    })

    await waitFor(() => fs.existsSync(statePath))
    expect(fetchCalls).toBe(2)
    expect(
      JSON.parse(fs.readFileSync(statePath, 'utf8')),
    ).toMatchObject({ lastReportedDay: localDay(new Date()) })
  })
})

function temporaryConfig(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-usage-test-'))
  testRoots.push(root)
  return root
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function localDay(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
