import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RouteProfile, RoutingDashboard, RoutingSource } from '../types/routing'
import { buildRouteGraphTemplate } from '../utils/routeGraph'

const {
  dashboardRequest,
  previewRequest,
  publishRequest,
  resetHealthRequest,
  rollbackRequest,
  updateConfigRequest,
} = vi.hoisted(() => ({
  dashboardRequest: vi.fn(),
  previewRequest: vi.fn(),
  publishRequest: vi.fn(),
  resetHealthRequest: vi.fn(),
  rollbackRequest: vi.fn(),
  updateConfigRequest: vi.fn(),
}))

vi.mock('../api/routing', () => ({
  routingApi: {
    dashboard: dashboardRequest,
    preview: previewRequest,
    publish: publishRequest,
    resetHealth: resetHealthRequest,
    rollback: rollbackRequest,
    updateConfig: updateConfigRequest,
  },
}))

import { useRoutingStore } from './routingStore'

function makeDashboard(overrides: Partial<RoutingDashboard> = {}): RoutingDashboard {
  return {
    config: { version: 1, enabled: true, profiles: [] },
    sources: [],
    health: [],
    events: [],
    routeAvailability: {},
    ...overrides,
  }
}

const source: RoutingSource = {
  id: 'provider-1',
  providerId: 'provider-1',
  presetId: 'custom',
  name: 'Acme AI',
  configured: true,
  routable: true,
  cost: 'paid',
  auth: 'api-key',
  risk: 'stable',
  models: [{ id: 'model-a' }, { id: 'model-b' }],
}

function routeProfile(): RouteProfile {
  return {
    id: 'route-1',
    name: 'Route 1',
    enabled: false,
    strategy: 'priority',
    strictFree: false,
    allowExperimental: false,
    maxAttempts: 2,
    targets: [],
  }
}

describe('routingStore', () => {
  beforeEach(() => {
    dashboardRequest.mockReset()
    previewRequest.mockReset()
    publishRequest.mockReset()
    resetHealthRequest.mockReset()
    rollbackRequest.mockReset()
    updateConfigRequest.mockReset()
    useRoutingStore.setState({
      dashboard: null,
      previews: {},
      isLoading: false,
      isSaving: false,
      isPreviewing: false,
      isPublishing: false,
      error: null,
    })
  })

  it('clears health optimistically and refreshes after reset', async () => {
    const previous = makeDashboard({
      health: [{
        providerId: 'provider-a',
        providerName: 'Provider A',
        modelId: 'model-a',
        requests: 1,
        successes: 0,
        failures: 1,
        averageLatencyMs: null,
        consecutiveFailures: 1,
      }],
    })
    const refreshed = makeDashboard()
    useRoutingStore.setState({ dashboard: previous })
    resetHealthRequest.mockResolvedValue({ ok: true })
    dashboardRequest.mockResolvedValue(refreshed)

    await useRoutingStore.getState().resetHealth()

    expect(resetHealthRequest).toHaveBeenCalledOnce()
    expect(dashboardRequest).toHaveBeenCalledOnce()
    expect(useRoutingStore.getState()).toMatchObject({
      dashboard: refreshed,
      isSaving: false,
      error: null,
    })
  })

  it('restores the previous dashboard when reset fails', async () => {
    const previous = makeDashboard()
    useRoutingStore.setState({ dashboard: previous })
    resetHealthRequest.mockRejectedValue(new Error('Desktop server unavailable'))

    await useRoutingStore.getState().resetHealth()

    expect(useRoutingStore.getState()).toMatchObject({
      dashboard: previous,
      isSaving: false,
      error: 'Desktop server unavailable',
    })
  })

  it('does not let an older dashboard poll overwrite a completed config save', async () => {
    const previous = makeDashboard({
      config: { version: 1, enabled: true, profiles: [] },
    })
    const nextConfig = { version: 1 as const, enabled: false, profiles: [] }
    const refreshed = makeDashboard({ config: nextConfig })
    let resolveStalePoll!: (dashboard: RoutingDashboard) => void
    const stalePoll = new Promise<RoutingDashboard>((resolve) => {
      resolveStalePoll = resolve
    })
    dashboardRequest
      .mockImplementationOnce(() => stalePoll)
      .mockResolvedValueOnce(refreshed)
    updateConfigRequest.mockResolvedValue({ config: nextConfig })
    useRoutingStore.setState({ dashboard: previous })

    const poll = useRoutingStore.getState().fetchDashboard({ quiet: true })
    await useRoutingStore.getState().updateConfig(nextConfig)
    resolveStalePoll(previous)
    await poll

    expect(updateConfigRequest).toHaveBeenCalledWith(nextConfig)
    expect(dashboardRequest).toHaveBeenCalledTimes(2)
    expect(useRoutingStore.getState()).toMatchObject({
      dashboard: refreshed,
      isSaving: false,
      error: null,
    })
  })

  it('keeps the saved config when the post-save dashboard refresh fails', async () => {
    const previous = makeDashboard({
      config: { version: 1, enabled: true, profiles: [] },
    })
    const nextConfig = { version: 1 as const, enabled: false, profiles: [] }
    useRoutingStore.setState({ dashboard: previous })
    updateConfigRequest.mockResolvedValue({ config: nextConfig })
    dashboardRequest.mockRejectedValue(new Error('Refresh unavailable'))

    await useRoutingStore.getState().updateConfig(nextConfig)

    expect(useRoutingStore.getState()).toMatchObject({
      dashboard: { ...previous, config: nextConfig },
      isSaving: false,
      error: 'Refresh unavailable',
    })
  })

  it('never lets an older draft save replace a newer local graph', async () => {
    const initial = makeDashboard({
      config: { version: 1, enabled: true, profiles: [routeProfile()] },
      sources: [source],
    })
    let resolveFirst!: (value: { config: RoutingDashboard['config'] }) => void
    let resolveSecond!: (value: { config: RoutingDashboard['config'] }) => void
    const firstRequest = new Promise<{ config: RoutingDashboard['config'] }>((resolve) => {
      resolveFirst = resolve
    })
    const secondRequest = new Promise<{ config: RoutingDashboard['config'] }>((resolve) => {
      resolveSecond = resolve
    })
    updateConfigRequest
      .mockImplementationOnce(() => firstRequest)
      .mockImplementationOnce(() => secondRequest)
    dashboardRequest.mockImplementation(async () => ({
      ...initial,
      config: useRoutingStore.getState().dashboard!.config,
    }))
    useRoutingStore.setState({ dashboard: initial })

    const firstGraph = buildRouteGraphTemplate('stable-fallback', [source])
    const secondGraph = buildRouteGraphTemplate('low-cost', [source])
    const firstSave = useRoutingStore.getState().updateProfileDraft(
      'route-1',
      firstGraph,
      { name: 'Draft one' },
    )
    const secondSave = useRoutingStore.getState().updateProfileDraft(
      'route-1',
      secondGraph,
      { name: 'Draft two' },
    )

    expect(useRoutingStore.getState().dashboard?.config.profiles[0]).toMatchObject({
      name: 'Route 1',
      draftName: 'Draft two',
      strategy: 'priority',
      targets: [],
      draftGraph: secondGraph,
    })
    await waitForRequestCount(updateConfigRequest, 1)
    const firstConfig = updateConfigRequest.mock.calls[0]![0]
    resolveFirst({ config: firstConfig })
    await waitForRequestCount(updateConfigRequest, 2)
    expect(useRoutingStore.getState().dashboard?.config.profiles[0]?.draftGraph)
      .toEqual(secondGraph)

    const secondConfig = updateConfigRequest.mock.calls[1]![0]
    resolveSecond({ config: secondConfig })
    await Promise.all([firstSave, secondSave])

    expect(useRoutingStore.getState().dashboard?.config.profiles[0]?.draftGraph)
      .toEqual(secondGraph)
    expect(useRoutingStore.getState().isSaving).toBe(false)
  })

  it('serializes rollback after a pending draft save', async () => {
    const initialProfile = routeProfile()
    const initial = makeDashboard({
      config: { version: 1, enabled: true, profiles: [initialProfile] },
      sources: [source],
    })
    const draftGraph = buildRouteGraphTemplate('stable-fallback', [source])
    const rolledBackProfile: RouteProfile = {
      ...initialProfile,
      graph: buildRouteGraphTemplate('low-cost', [source]),
      draftGraph: undefined,
    }
    let resolveSave!: (value: { config: RoutingDashboard['config'] }) => void
    const pendingSave = new Promise<{ config: RoutingDashboard['config'] }>((resolve) => {
      resolveSave = resolve
    })
    updateConfigRequest.mockImplementationOnce(() => pendingSave)
    dashboardRequest.mockImplementation(async () => ({
      ...initial,
      config: useRoutingStore.getState().dashboard!.config,
    }))
    rollbackRequest.mockResolvedValue({ profile: rolledBackProfile })
    useRoutingStore.setState({ dashboard: initial })

    const save = useRoutingStore.getState().updateProfileDraft('route-1', draftGraph)
    await waitForRequestCount(updateConfigRequest, 1)
    const rollback = useRoutingStore.getState().rollbackProfile('route-1')

    await Promise.resolve()
    expect(rollbackRequest).not.toHaveBeenCalled()

    resolveSave({ config: updateConfigRequest.mock.calls[0]![0] })
    await waitForRequestCount(rollbackRequest, 1)
    await Promise.all([save, rollback])

    expect(rollbackRequest).toHaveBeenCalledWith('route-1')
    expect(useRoutingStore.getState().dashboard?.config.profiles[0]).toEqual(rolledBackProfile)
  })

  it('stores preview paths and atomically replaces a published profile', async () => {
    const graph = buildRouteGraphTemplate('stable-fallback', [source])
    const initialProfile = routeProfile()
    const initial = makeDashboard({
      config: { version: 1, enabled: true, profiles: [initialProfile] },
      sources: [source],
    })
    const preview = {
      validation: { valid: true, issues: [] },
      path: ['start', 'model-primary', 'output'],
    }
    const publishedProfile: RouteProfile = {
      ...initialProfile,
      enabled: true,
      graph,
      draftGraph: undefined,
      publishedAt: '2026-08-01T12:00:00.000Z',
    }
    useRoutingStore.setState({ dashboard: initial })
    previewRequest.mockResolvedValue(preview)
    publishRequest.mockResolvedValue({
      profile: publishedProfile,
      validation: { valid: true, issues: [] },
    })

    await useRoutingStore.getState().previewProfile('route-1', graph)
    const published = await useRoutingStore.getState().publishProfile('route-1', graph, 'Route 1')

    expect(useRoutingStore.getState().previews['route-1']).toEqual(preview)
    expect(published).toBe(true)
    expect(useRoutingStore.getState().dashboard?.config.profiles[0]).toEqual(publishedProfile)
  })
})

async function waitForRequestCount(mock: ReturnType<typeof vi.fn>, count: number) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (mock.mock.calls.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`Expected ${count} requests, received ${mock.mock.calls.length}`)
}
