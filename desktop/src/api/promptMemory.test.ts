import { afterEach, describe, expect, it, vi } from 'vitest'
import { promptMemoryApi } from './promptMemory'

describe('promptMemoryApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the evolution profile and removes a specific entry', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ insights: [], stats: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))
    vi.stubGlobal('fetch', fetchMock)

    await promptMemoryApi.insights()
    await promptMemoryApi.removeEntry(
      'user',
      '[communication] User prefers concise replies.',
    )
    await promptMemoryApi.updateConfig(false)

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:3456/api/prompt-memory/insights',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:3456/api/prompt-memory/user/entries',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'remove',
          oldText: '[communication] User prefers concise replies.',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://127.0.0.1:3456/api/prompt-memory/config',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ injectEvolutionMemory: false }),
      }),
    )
  })

  it('supplies a safe default when an older backend omits memory config', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ files: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    const status = await promptMemoryApi.status()

    expect(status.config).toEqual({
      version: 1,
      injectEvolutionMemory: true,
    })
  })
})
