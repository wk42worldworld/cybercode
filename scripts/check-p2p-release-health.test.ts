import { describe, expect, test } from 'bun:test'
import { checkP2PReleaseHealth } from './check-p2p-release-health'

describe('release P2P health check', () => {
  test('checks the health route of the configured HTTPS endpoint', async () => {
    const result = await checkP2PReleaseHealth('https://signal.example.com/p2p/', async (url, options) => {
      expect(url).toBe('https://signal.example.com/p2p/health')
      expect(options.signal).toBeInstanceOf(AbortSignal)
      return Response.json({ status: 'ok', transport: 'webrtc-signaling' })
    })
    expect(result.available).toBe(true)
  })

  test.each([undefined, '', 'not a URL', 'http://signal.example.com', 'https://user:password@signal.example.com', 'https://signal.example.com?wrong=1'])(
    'rejects invalid configuration: %s', async endpoint => {
      let fetched = false
      await expect(checkP2PReleaseHealth(endpoint, async () => {
        fetched = true
        return new Response()
      })).rejects.toThrow()
      expect(fetched).toBe(false)
    },
  )

  test('reports a connection outage without blocking a desktop hotfix', async () => {
    const result = await checkP2PReleaseHealth('https://signal.example.com', async () => {
      throw new Error('Connection timed out')
    })
    expect(result.available).toBe(false)
    expect(result.message).toContain('P2P model sharing needs this service')
  })

  test.each([429, 500, 503])('reports service unavailability for HTTP %i', async status => {
    const result = await checkP2PReleaseHealth('https://signal.example.com', async () => new Response('', { status }))
    expect(result.available).toBe(false)
    expect(result.message).toContain(`HTTP ${status}`)
  })

  test.each([401, 403, 404])('still rejects an incorrect endpoint returning HTTP %i', async status => {
    await expect(checkP2PReleaseHealth('https://signal.example.com', async () => new Response('', { status }))).rejects.toThrow(`HTTP ${status}`)
  })

  test('still rejects an unrelated service or invalid response', async () => {
    for (const response of [Response.json({ status: 'ok', transport: 'other' }), new Response('<html>wrong service</html>')]) {
      await expect(checkP2PReleaseHealth('https://signal.example.com', async () => response)).rejects.toThrow()
    }
  })
})
