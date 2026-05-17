import { afterEach, describe, expect, it, vi } from 'vitest'
import { skillsApi } from './skills'

describe('skillsApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens the skills folder with a GET request for backend compatibility', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await skillsApi.openConfig()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3456/api/skills/open-config',
      expect.objectContaining({
        method: 'GET',
        body: undefined,
      }),
    )
  })
})
