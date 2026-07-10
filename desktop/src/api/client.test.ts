import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, getDefaultBaseUrl, setAuthToken, setBaseUrl } from './client'

afterEach(() => {
  setAuthToken('')
  setBaseUrl(getDefaultBaseUrl())
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
})
