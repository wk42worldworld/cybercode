import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  api,
  getDefaultBaseUrl,
  setAuthToken,
  setBaseUrl,
  setServerConnectionRefresher,
} from './client'

afterEach(() => {
  setAuthToken('')
  setBaseUrl(getDefaultBaseUrl())
  setServerConnectionRefresher(null)
  vi.restoreAllMocks()
})

describe('desktop API client authentication', () => {
  it('sends the ephemeral local server token without putting it in the URL', async () => {
    setBaseUrl('http://127.0.0.1:45678')
    setAuthToken('desktop-secret')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ ok: true }),
    )

    await api.get('/api/status')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:45678/api/status',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer desktop-secret',
        }),
      }),
    )
  })

  it('refreshes the local sidecar connection and retries a failed GET once', async () => {
    setBaseUrl('http://127.0.0.1:45678')
    setAuthToken('stale-secret')
    const refreshConnection = vi.fn().mockResolvedValue({
      url: 'http://127.0.0.1:56789',
      authToken: 'fresh-secret',
    })
    setServerConnectionRefresher(refreshConnection)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(Response.json({ ok: true }))

    await expect(api.get('/api/sessions')).resolves.toEqual({ ok: true })

    expect(refreshConnection).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:45678/api/sessions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer stale-secret' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:56789/api/sessions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-secret' }),
      }),
    )
  })

  it('does not restart the local sidecar just because one GET times out', async () => {
    vi.useFakeTimers()
    try {
      setBaseUrl('http://127.0.0.1:45678')
      setAuthToken('stale-secret')
      const refreshConnection = vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:56789',
        authToken: 'fresh-secret',
      })
      setServerConnectionRefresher(refreshConnection)
      const fetchMock = vi.spyOn(globalThis, 'fetch')
        .mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Timed out', 'AbortError')),
            { once: true },
          )
        }))

      const request = api.get<{ ok: boolean }>('/api/sessions', { timeout: 10 })
      const rejection = expect(request).rejects.toThrow('Request timed out after 0s')
      await vi.advanceTimersByTimeAsync(10)

      await rejection
      expect(refreshConnection).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not recover or replay a background GET after a timeout', async () => {
    vi.useFakeTimers()
    try {
      const refreshConnection = vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:56789',
        authToken: 'fresh-secret',
      })
      setServerConnectionRefresher(refreshConnection)
      const fetchMock = vi.spyOn(globalThis, 'fetch')
        .mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Timed out', 'AbortError')),
            { once: true },
          )
        }))

      const request = api.get('/api/sessions/background', {
        timeout: 10,
        recoverConnection: false,
      })
      const rejection = expect(request).rejects.toThrow('Request timed out after 0s')
      await vi.advanceTimersByTimeAsync(10)

      await rejection
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(refreshConnection).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not restart the recovered sidecar for a late timeout from the old port', async () => {
    vi.useFakeTimers()
    try {
      setBaseUrl('http://127.0.0.1:45678')
      setAuthToken('stale-secret')
      const refreshConnection = vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:56789',
        authToken: 'fresh-secret',
      })
      setServerConnectionRefresher(refreshConnection)
      vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        if (String(input).startsWith('http://127.0.0.1:56789')) {
          return Promise.resolve(Response.json({ ok: true }))
        }
        if (String(input).endsWith('/api/sessions')) {
          return Promise.reject(new TypeError('Load failed'))
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Timed out', 'AbortError')),
            { once: true },
          )
        })
      })

      const first = api.get<{ ok: boolean }>('/api/sessions', { timeout: 10 })
      const late = api.get<{ ok: boolean }>('/api/status', { timeout: 20 })
      await expect(first).resolves.toEqual({ ok: true })
      await vi.advanceTimersByTimeAsync(20)

      await expect(late).resolves.toEqual({ ok: true })
      expect(refreshConnection).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not restart the local sidecar for an API 503 response', async () => {
    const refreshConnection = vi.fn().mockResolvedValue({
      url: 'http://127.0.0.1:56789',
      authToken: 'fresh-secret',
    })
    setServerConnectionRefresher(refreshConnection)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ message: 'still preparing' }, { status: 503 }))

    await expect(api.get('/api/codegraph/status')).rejects.toMatchObject({ status: 503 })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(refreshConnection).not.toHaveBeenCalled()
  })

  it('does not replay mutation requests after a connection error', async () => {
    const refreshConnection = vi.fn().mockResolvedValue({
      url: 'http://127.0.0.1:56789',
      authToken: 'fresh-secret',
    })
    setServerConnectionRefresher(refreshConnection)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Load failed'))

    await expect(api.post('/api/messages', { content: 'hello' })).rejects.toThrow('Load failed')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(refreshConnection).not.toHaveBeenCalled()
  })

  it('propagates caller cancellation without retrying the request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true },
        )
      }),
    )
    const controller = new AbortController()
    const request = api.get('/api/agent-migration', {
      timeout: 120_000,
      signal: controller.signal,
    })

    controller.abort(new DOMException('User cancelled', 'AbortError'))

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects a pre-aborted legacy signal without throwIfAborted support', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const signal = {
      aborted: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal

    await expect(api.get('/api/status', { signal })).rejects.toMatchObject({
      name: 'AbortError',
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
