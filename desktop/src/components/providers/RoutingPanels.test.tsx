import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRoutingStore } from '../../stores/routingStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { RouteGraph, RouteProfile, RoutingDashboard, RoutingSource } from '../../types/routing'
import {
  RoutingStatusPanel,
  SmartRoutingPanel,
  summarizeRoutingHealth,
} from './RoutingPanels'

const publishedRouteGraph: RouteGraph = {
  version: 1,
  source: 'legacy',
  nodes: [
    {
      id: 'start',
      type: 'routeGraphNode',
      position: { x: 0, y: 0 },
      data: { kind: 'start', config: {} },
    },
    {
      id: 'model',
      type: 'routeGraphNode',
      position: { x: 200, y: 0 },
      data: {
        kind: 'model',
        config: { providerId: 'provider-1', modelId: 'model-a' },
      },
    },
    {
      id: 'output',
      type: 'routeGraphNode',
      position: { x: 400, y: 0 },
      data: { kind: 'output', config: {} },
    },
  ],
  edges: [
    {
      id: 'start-model',
      source: 'start',
      target: 'model',
      type: 'smoothstep',
      data: { kind: 'flow' },
    },
    {
      id: 'model-output',
      source: 'model',
      target: 'output',
      type: 'smoothstep',
      data: { kind: 'success' },
    },
  ],
}

const balancedRoute: RouteProfile = {
  id: 'balanced',
  name: 'Balanced',
  description: 'Balanced route',
  enabled: true,
  strategy: 'auto',
  strictFree: false,
  allowExperimental: false,
  maxAttempts: 3,
  targets: [],
  graph: publishedRouteGraph,
  draftGraph: publishedRouteGraph,
  publishedAt: '2026-08-02T08:09:19.672Z',
}

const connectedSource: RoutingSource = {
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

function makeDashboard(overrides: Partial<RoutingDashboard> = {}): RoutingDashboard {
  return {
    config: {
      version: 1,
      enabled: false,
      profiles: [balancedRoute],
    },
    sources: [],
    health: [],
    events: [],
    routeAvailability: {
      balanced: { candidateCount: 0, available: false, reason: 'routing-disabled' },
    },
    ...overrides,
  }
}

describe('SmartRoutingPanel', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useRoutingStore.setState({
      dashboard: makeDashboard(),
      isLoading: false,
      isSaving: false,
      isPreviewing: false,
      isPublishing: false,
      previews: {},
      error: null,
      fetchDashboard: vi.fn(),
      updateConfig: vi.fn(),
      updateProfile: vi.fn(),
      updateProfileDraft: vi.fn(),
      previewProfile: vi.fn(),
      publishProfile: vi.fn(),
      rollbackProfile: vi.fn(),
      resetHealth: vi.fn(),
    })
  })

  async function openRouteManager() {
    await screen.findByTestId('route-graph-editor', {}, { timeout: 5000 })
    fireEvent.click(screen.getByRole('button', { name: 'Back to routes' }))
    await screen.findByText('My routes')
  }

  it('opens the enabled published route as the agent-routing home and controls usage there', async () => {
    const updateConfig = vi.fn()
    useRoutingStore.setState({
      updateConfig,
      dashboard: makeDashboard({
        config: {
          version: 1,
          enabled: true,
          profiles: [
            { ...balancedRoute, id: 'standby', name: 'Standby', enabled: false },
            { ...balancedRoute, id: 'primary', name: 'Primary', enabled: true },
          ],
        },
      }),
    })

    render(<SmartRoutingPanel />)

    expect(await screen.findByTestId('route-graph-editor', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByLabelText('Route name')).toHaveValue('Primary')
    expect(screen.queryByText('My routes')).not.toBeInTheDocument()

    const usageSwitch = screen.getByRole('switch', { name: 'Use this route' })
    expect(usageSwitch).toBeChecked()
    await act(async () => {
      fireEvent.click(usageSwitch)
      await Promise.resolve()
    })

    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      profiles: expect.arrayContaining([
        expect.objectContaining({ id: 'primary', enabled: false }),
      ]),
    }))
  }, 15_000)

  it('lists usable default and user-created routes beside templates and switches safely', async () => {
    const updateProfileDraft = vi.fn().mockResolvedValue(undefined)
    useRoutingStore.setState({
      updateProfileDraft,
      dashboard: makeDashboard({
        config: {
          version: 2,
          enabled: true,
          profiles: [
            balancedRoute,
            { ...balancedRoute, id: 'team-route', name: 'Team route', enabled: false },
            { ...balancedRoute, id: 'empty-route', name: 'Empty route', enabled: false },
            {
              ...balancedRoute,
              id: 'draft-route',
              name: 'Draft route',
              graph: undefined,
              publishedAt: undefined,
              enabled: false,
            },
          ],
        },
        routeAvailability: {
          balanced: { candidateCount: 2, available: true },
          'team-route': { candidateCount: 1, available: false, reason: 'profile-disabled' },
          'empty-route': { candidateCount: 0, available: false, reason: 'no-candidates' },
          'draft-route': { candidateCount: 1, available: false, reason: 'unpublished' },
        },
      }),
    })

    render(<SmartRoutingPanel />)

    expect(await screen.findByTestId('route-graph-editor', {}, { timeout: 5000 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Usable routes' }))

    expect(screen.getByText('Default routes')).toBeInTheDocument()
    expect(screen.getByText('User-created')).toBeInTheDocument()
    expect(screen.getByTitle('Balanced')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTitle('Team route')).toBeInTheDocument()
    expect(screen.queryByTitle('Empty route')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Draft route')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Route name'), {
      target: { value: 'Balanced edited' },
    })
    fireEvent.click(screen.getByTitle('Team route'))

    await waitFor(() => expect(updateProfileDraft).toHaveBeenCalledWith(
      'balanced',
      expect.any(Object),
      { name: 'Balanced edited' },
    ))
    await waitFor(() => expect(screen.getByLabelText('Route name')).toHaveValue('Team route'))
  }, 15_000)

  it('deletes the current usable route after confirmation and switches to the remaining route', async () => {
    const updateConfig = vi.fn().mockImplementation(async (config) => {
      const current = useRoutingStore.getState().dashboard!
      useRoutingStore.setState({ dashboard: { ...current, config } })
    })
    const updateProfileDraft = vi.fn().mockResolvedValue(undefined)
    useRoutingStore.setState({
      updateConfig,
      updateProfileDraft,
      dashboard: makeDashboard({
        config: {
          version: 2,
          enabled: true,
          profiles: [
            balancedRoute,
            { ...balancedRoute, id: 'team-route', name: 'Team route', enabled: false },
          ],
        },
        routeAvailability: {
          balanced: { candidateCount: 2, available: true },
          'team-route': { candidateCount: 1, available: false, reason: 'profile-disabled' },
        },
      }),
    })

    render(<SmartRoutingPanel />)

    expect(await screen.findByTestId('route-graph-editor', {}, { timeout: 5000 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Usable routes' }))
    fireEvent.change(screen.getByLabelText('Route name'), {
      target: { value: 'Unsaved route name' },
    })
    const deleteRouteButton = screen.getByRole('button', { name: 'Delete route: Balanced' })
    expect(deleteRouteButton.querySelector('.lucide-x')).toBeInTheDocument()
    expect(deleteRouteButton.querySelector('.lucide-trash-2')).not.toBeInTheDocument()
    fireEvent.click(deleteRouteButton)

    expect(screen.getByRole('dialog', { name: 'Delete this route?' })).toHaveStyle({ width: '300px' })
    expect(updateConfig).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      profiles: [expect.objectContaining({ id: 'team-route' })],
    })))
    await waitFor(() => expect(screen.getByLabelText('Route name')).toHaveValue('Team route'))
    await new Promise((resolve) => setTimeout(resolve, 650))
    expect(updateProfileDraft).not.toHaveBeenCalled()
  }, 15_000)

  it('deletes the final usable route without auto-restoring it from an unmount draft save', async () => {
    const updateConfig = vi.fn().mockImplementation(async (config) => {
      const current = useRoutingStore.getState().dashboard!
      useRoutingStore.setState({ dashboard: { ...current, config } })
    })
    const updateProfileDraft = vi.fn().mockResolvedValue(undefined)
    useRoutingStore.setState({
      updateConfig,
      updateProfileDraft,
      dashboard: makeDashboard({
        config: { version: 2, enabled: true, profiles: [balancedRoute] },
        sources: [connectedSource],
        routeAvailability: {
          balanced: { candidateCount: 1, available: true },
        },
      }),
    })

    render(<SmartRoutingPanel />)

    expect(await screen.findByTestId('route-graph-editor', {}, { timeout: 5000 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Usable routes' }))
    fireEvent.change(screen.getByLabelText('Route name'), {
      target: { value: 'Unsaved route name' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete route: Balanced' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await screen.findByText('My routes')
    await new Promise((resolve) => setTimeout(resolve, 650))
    expect(updateConfig).toHaveBeenCalledTimes(1)
    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({ profiles: [] }))
    expect(updateProfileDraft).not.toHaveBeenCalled()
  }, 15_000)

  it('separates unpublished drafts and prevents enabling them', async () => {
    useRoutingStore.setState({
      dashboard: makeDashboard({
        config: {
          version: 2,
          enabled: true,
          profiles: [
            balancedRoute,
            {
              ...balancedRoute,
              id: 'draft-route',
              name: 'Draft route',
              graph: undefined,
              publishedAt: undefined,
              enabled: true,
            },
          ],
        },
        routeAvailability: {
          balanced: { candidateCount: 1, available: true },
          'draft-route': { candidateCount: 1, available: false, reason: 'unpublished' },
        },
      }),
    })

    render(<SmartRoutingPanel />)
    await openRouteManager()

    expect(screen.getByTestId('published-routes')).toHaveTextContent('1')
    expect(screen.getByTestId('draft-routes')).toHaveTextContent('1')
    const draftRoute = screen.getByText('Draft route', { selector: 'h4' }).closest('article')!
    expect(within(draftRoute).getByText('Publish before using this route in chat')).toBeInTheDocument()
    expect(within(draftRoute).getByRole('switch', { name: 'Draft route' })).toBeDisabled()
  })

  it('turns on global routing when a published blueprint is used', async () => {
    const updateConfig = vi.fn()
    useRoutingStore.setState({ updateConfig })
    render(<SmartRoutingPanel />)

    const usageSwitch = await screen.findByRole('switch', { name: 'Use this route' })
    expect(usageSwitch).not.toBeChecked()
    await act(async () => {
      fireEvent.click(usageSwitch)
      await Promise.resolve()
    })

    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      profiles: [expect.objectContaining({ id: 'balanced', enabled: true })],
    }))
  })

  it('uses a custom route name as the route switch label', async () => {
    useRoutingStore.setState({
      dashboard: makeDashboard({
        config: {
          version: 1,
          enabled: true,
          profiles: [{ ...balancedRoute, id: 'team-route', name: 'Team route' }],
        },
        routeAvailability: {
          'team-route': { candidateCount: 1, available: true },
        },
      }),
    })

    render(<SmartRoutingPanel />)
    await openRouteManager()

    expect(screen.getByRole('switch', { name: 'Team route' })).toBeChecked()
  })

  it('keeps legacy route names and behavior descriptions aligned', async () => {
    useRoutingStore.setState({
      dashboard: makeDashboard({
        config: {
          version: 1,
          enabled: true,
          profiles: [
            {
              ...balancedRoute,
              id: 'coding-first',
              name: 'Coding first',
              strategy: 'headroom',
              targets: [{ providerId: 'provider-1', modelId: 'model-a', priority: 0 }],
            },
            {
              ...balancedRoute,
              id: 'free-first',
              name: 'Free first',
              strategy: 'cost-optimized',
              strictFree: true,
              targets: [{ providerId: 'provider-1', modelId: 'model-b', priority: 0 }],
            },
          ],
        },
        sources: [connectedSource],
        routeAvailability: {
          'coding-first': { candidateCount: 1, available: true },
          'free-first': { candidateCount: 1, available: true },
        },
      }),
    })

    render(<SmartRoutingPanel />)
    await openRouteManager()

    expect(screen.getByText('Context headroom')).toBeInTheDocument()
    expect(screen.getByText('Cost optimized')).toBeInTheDocument()
    expect(screen.getByText('Prefers healthy models with more context headroom.')).toBeInTheDocument()
    expect(screen.getByText('Uses only recurring-free or local sources.')).toBeInTheDocument()
  })

  it('uses the actual mode for an explicitly edited legacy route', async () => {
    useRoutingStore.setState({
      dashboard: makeDashboard({
        config: {
          version: 1,
          enabled: true,
          profiles: [{
            ...balancedRoute,
            name: 'My balanced route',
            strategy: 'cost-optimized',
            targets: [{ providerId: 'provider-1', modelId: 'model-a' }],
          }],
        },
        sources: [connectedSource],
        routeAvailability: {
          balanced: { candidateCount: 1, available: true },
        },
      }),
    })

    render(<SmartRoutingPanel />)
    await openRouteManager()

    expect(screen.getByRole('switch', { name: 'My balanced route' })).toBeChecked()
    expect(screen.getByText('Prefer free or lower-cost models, then use other fallbacks only when needed.')).toBeInTheDocument()
    expect(screen.queryByText('Balances health, latency, cost and context.')).not.toBeInTheDocument()
  })

  it('shows the source default model for a legacy provider-only target', async () => {
    useRoutingStore.setState({
      dashboard: makeDashboard({
        config: {
          version: 1,
          enabled: true,
          profiles: [{
            ...balancedRoute,
            targets: [{ providerId: 'provider-1', priority: 0 }],
          }],
        },
        sources: [connectedSource],
        routeAvailability: {
          balanced: { candidateCount: 1, available: true },
        },
      }),
    })

    render(<SmartRoutingPanel />)
    await openRouteManager()

    expect(screen.getByText('model-a')).toBeInTheDocument()
  })

  it('opens a legacy route from the formal route list in the full blueprint editor', async () => {
    useRoutingStore.setState({
      dashboard: makeDashboard({
        config: {
          version: 1,
          enabled: true,
          profiles: [{
            ...balancedRoute,
            strictFree: true,
            targets: [{ providerId: 'provider-1', modelId: 'model-a', priority: 0 }],
          }],
        },
        sources: [connectedSource],
      }),
    })

    render(<SmartRoutingPanel />)

    await openRouteManager()
    fireEvent.click(screen.getByRole('button', { name: 'Edit route' }))
    await waitFor(
      () => expect(screen.getByTestId('route-graph-editor')).toBeInTheDocument(),
      { timeout: 5000 },
    )
    expect(screen.getByLabelText('Route name')).toHaveValue('Balanced')
    expect(screen.getByRole('complementary', { name: 'Node library' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test run' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Edit route' })).not.toBeInTheDocument()
  }, 15_000)

  it('creates the first disabled route draft directly as the blueprint home', async () => {
    const updateConfig = vi.fn().mockImplementation(async (config) => {
      const current = useRoutingStore.getState().dashboard!
      useRoutingStore.setState({ dashboard: { ...current, config } })
    })
    useRoutingStore.setState({
      updateConfig,
      dashboard: makeDashboard({
        config: { version: 1, enabled: true, profiles: [] },
        sources: [connectedSource],
        routeAvailability: {},
      }),
    })

    render(<SmartRoutingPanel />)

    await waitFor(() => expect(screen.getByTestId('route-graph-editor')).toBeInTheDocument())
    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      version: 1,
      enabled: true,
      profiles: [expect.objectContaining({
        id: 'untitled-route',
        name: 'Untitled route',
        enabled: false,
        draftGraph: expect.objectContaining({
          version: 1,
          nodes: expect.arrayContaining([
            expect.objectContaining({ id: 'start' }),
            expect.objectContaining({ id: 'output' }),
          ]),
        }),
      })],
    }))
    expect(screen.getByRole('button', { name: 'Stable fallback' })).toBeInTheDocument()
  })

  it('duplicates a route as a disabled user-owned copy', async () => {
    const updateConfig = vi.fn()
    useRoutingStore.setState({ updateConfig })

    render(<SmartRoutingPanel />)
    await openRouteManager()
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate route' }))

    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      profiles: [
        balancedRoute,
        expect.objectContaining({
          id: 'balanced-copy',
          name: 'Balanced copy',
          enabled: false,
        }),
      ],
    }))
  })

  it('replaces the native route-card menu with localized route actions', async () => {
    render(<SmartRoutingPanel />)
    await openRouteManager()
    const routeCard = screen.getByText('Balanced', { selector: 'h4' }).closest('article')!
    const nativeMenuAllowed = fireEvent.contextMenu(routeCard, {
      clientX: 220,
      clientY: 140,
    })

    expect(nativeMenuAllowed).toBe(false)
    expect(screen.getByTestId('route-context-menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Edit route' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Duplicate route' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete route' }))
    expect(screen.getByRole('dialog', { name: 'Delete this route?' })).toBeInTheDocument()
  })

  it('deletes a route only after confirmation', async () => {
    const updateConfig = vi.fn().mockResolvedValue(undefined)
    useRoutingStore.setState({ updateConfig })

    render(<SmartRoutingPanel />)
    await openRouteManager()
    fireEvent.click(screen.getByRole('button', { name: 'Delete route' }))

    expect(screen.getByRole('dialog', { name: 'Delete this route?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      profiles: [],
    })))
  })

  it('links an empty setup to model sources when no provider is routable', () => {
    const onOpenSources = vi.fn()
    useRoutingStore.setState({
      dashboard: makeDashboard({
        config: { version: 1, enabled: true, profiles: [] },
        sources: [{
          ...connectedSource,
          id: 'preset:github-models',
          providerId: undefined,
          presetId: 'github-models',
          name: 'GitHub Models',
          configured: false,
          routable: false,
          auth: 'oauth',
        }],
        routeAvailability: {},
      }),
    })

    render(<SmartRoutingPanel onOpenSources={onOpenSources} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add model sources' }))
    expect(onOpenSources).toHaveBeenCalledTimes(1)
  })
})

describe('RoutingStatusPanel', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('weights latency by successful requests and ignores expired cooldowns', () => {
    const now = Date.parse('2026-07-21T12:00:00.000Z')
    const summary = summarizeRoutingHealth([
      {
        providerId: 'provider-a',
        providerName: 'Provider A',
        modelId: 'model-a',
        requests: 9,
        successes: 9,
        failures: 0,
        averageLatencyMs: 100,
        consecutiveFailures: 0,
        cooldownUntil: '2026-07-21T11:59:00.000Z',
      },
      {
        providerId: 'provider-b',
        providerName: 'Provider B',
        modelId: 'model-b',
        requests: 1,
        successes: 1,
        failures: 0,
        averageLatencyMs: 1_000,
        consecutiveFailures: 0,
        cooldownUntil: '2026-07-21T12:01:00.000Z',
      },
    ], now)

    expect(summary).toEqual({
      requests: 10,
      successRate: 100,
      active: 1,
      latency: 190,
    })
  })

  it('renders an expired cooldown as healthy', () => {
    useRoutingStore.setState({
      dashboard: {
        config: { version: 1, enabled: true, profiles: [] },
        sources: [],
        health: [{
          providerId: 'provider-a',
          providerName: 'Provider A',
          modelId: 'model-a',
          requests: 2,
          successes: 1,
          failures: 1,
          averageLatencyMs: 100,
          consecutiveFailures: 0,
          cooldownUntil: new Date(Date.now() - 60_000).toISOString(),
        }],
        events: [],
        routeAvailability: {},
      },
      isLoading: false,
      isSaving: false,
      error: null,
      fetchDashboard: vi.fn(),
      updateConfig: vi.fn(),
      updateProfile: vi.fn(),
      resetHealth: vi.fn(),
    })

    render(<RoutingStatusPanel />)

    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.queryByText('Cooling down')).not.toBeInTheDocument()
  })

  it('disables health reset while a routing update is in progress', () => {
    useRoutingStore.setState({
      dashboard: {
        config: { version: 1, enabled: true, profiles: [] },
        sources: [],
        health: [],
        events: [],
        routeAvailability: {},
      },
      isLoading: false,
      isSaving: true,
      error: null,
      fetchDashboard: vi.fn(),
      resetHealth: vi.fn(),
    })

    render(<RoutingStatusPanel />)

    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  })
})
