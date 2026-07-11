import { afterEach, describe, expect, it, vi } from 'vitest'
import { sessionsApi } from './sessions'

describe('sessionsApi token usage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the lightweight cumulative usage endpoint with the project locator', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ usage: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await sessionsApi.getUsage('session-1', { projectPath: '/tmp/my project' })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3456/api/sessions/session-1/usage?projectPath=%2Ftmp%2Fmy%20project',
      expect.objectContaining({ method: 'GET' }),
    )
  })
})
