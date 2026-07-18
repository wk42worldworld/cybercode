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

  it('uses the Skill Learning endpoints for configuration and review actions', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ ok: true, overview: {}, config: {}, candidate: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))
    vi.stubGlobal('fetch', fetchMock)

    const learning = await skillsApi.learning('/workspace/project')
    await skillsApi.updateLearningConfig({ mode: 'auto' })
    await skillsApi.approveCandidate('candidate-123')
    await skillsApi.rejectCandidate('candidate-123')

    expect(learning.overview.recentCandidates).toEqual([])

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:3456/api/skills/learning?cwd=%2Fworkspace%2Fproject',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:3456/api/skills/learning',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ mode: 'auto' }) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://127.0.0.1:3456/api/skills/learning/candidate-123/approve',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'http://127.0.0.1:3456/api/skills/learning/candidate-123/reject',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    )
  })
})
