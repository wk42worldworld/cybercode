import { afterEach, describe, expect, it, vi } from 'vitest'
import { pluginsApi } from './plugins'

describe('pluginsApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads and refreshes the plugin marketplace with an extended timeout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ catalog: { items: [], sources: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await pluginsApi.marketplace(true)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3456/api/plugins/marketplace?refresh=true',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('forwards caller cancellation to a marketplace request', async () => {
    const fetchMock = vi.fn().mockImplementation((_: string, init?: RequestInit) => (
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    ))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const request = pluginsApi.marketplace(false, controller.signal)
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.signal.aborted).toBe(true)
  })

  it('installs a marketplace plugin by its stable marketplace id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        item: {},
        updated: false,
        message: 'installed',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await pluginsApi.installMarketplaceItem('github@openai-plugins')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3456/api/plugins/marketplace/install',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ id: 'github@openai-plugins' }),
      }),
    )
  })
})
