import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OFFICIAL_MODELS } from '../../constants/modelCatalog'
import { useProviderStore } from '../../stores/providerStore'
import { useRoutingStore } from '../../stores/routingStore'
import { useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { SavedProvider } from '../../types/provider'
import type { RouteGraph } from '../../types/routing'
import { ModelSelector } from './ModelSelector'

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
      id: 'output',
      type: 'routeGraphNode',
      position: { x: 200, y: 0 },
      data: { kind: 'output', config: {} },
    },
  ],
  edges: [{
    id: 'start-output',
    source: 'start',
    target: 'output',
    type: 'smoothstep',
    data: { kind: 'flow' },
  }],
}

function makeProvider(overrides: Partial<SavedProvider>): SavedProvider {
  return {
    id: 'provider-id',
    presetId: 'custom',
    name: 'Custom',
    apiKey: '***',
    baseUrl: 'https://example.com',
    apiFormat: 'anthropic',
    models: {
      main: '',
      haiku: '',
      sonnet: '',
      opus: '',
    },
    ...overrides,
  }
}

describe('ModelSelector', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({
      locale: 'en',
      availableModels: OFFICIAL_MODELS,
      currentModel: OFFICIAL_MODELS[0] ?? null,
      activeProviderName: null,
      effortLevel: 'medium',
    })
    useSessionRuntimeStore.setState({ selections: {} })
    useProviderStore.setState({
      providers: [],
      activeId: null,
      hasLoadedProviders: true,
      presets: [],
      isLoading: false,
      isPresetsLoading: false,
      error: null,
      fetchProviders: vi.fn(),
    })
    useRoutingStore.setState({
      dashboard: null,
      isLoading: false,
      isSaving: false,
      error: null,
      fetchDashboard: vi.fn(),
    })
  })

  it('uses custom endpoint identities instead of mixed model IDs', () => {
    useProviderStore.setState({
      providers: [
        makeProvider({
          id: 'volcano',
          name: '火山',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
          models: {
            main: 'glm-5.1',
            haiku: 'kimi-k2.6',
            sonnet: '',
            opus: '',
          },
        }),
        makeProvider({
          id: 'qianfan',
          name: '百度千帆',
          baseUrl: 'https://qianfan.baidubce.com/anthropic/coding',
          models: {
            main: 'glm-5.1',
            haiku: 'deepseek-v4-flash',
            sonnet: '',
            opus: '',
          },
        }),
      ],
    })

    render(<ModelSelector runtimeKey="draft-session" compact variant="pill" />)

    fireEvent.click(screen.getByRole('button', { name: /Opus 4\.8/i }))

    const volcanoHeader = screen.getByRole('button', { name: /火山/ })
    const qianfanHeader = screen.getByRole('button', { name: /百度千帆/ })

    expect(volcanoHeader?.querySelector('[data-provider-logo="volcengine"]')).toBeInTheDocument()
    expect(volcanoHeader?.querySelector('[data-provider-logo="zhipuglm"]')).not.toBeInTheDocument()
    expect(volcanoHeader?.querySelector('[data-provider-logo="kimi"]')).not.toBeInTheDocument()

    expect(qianfanHeader?.querySelector('[data-provider-logo="qianfan"]')).toBeInTheDocument()
    expect(qianfanHeader?.querySelector('[data-provider-logo="deepseek"]')).not.toBeInTheDocument()
    expect(qianfanHeader?.querySelector('[data-provider-logo="zhipuglm"]')).not.toBeInTheDocument()
  })

  it('uses the selected model brand without changing the provider group brand', () => {
    useProviderStore.setState({
      providers: [
        makeProvider({
          id: 'claude-compatible',
          presetId: 'anthropic-api',
          name: 'Claude-compatible gateway',
          models: {
            main: 'deepseek-v4-pro',
            haiku: '',
            sonnet: '',
            opus: '',
          },
        }),
      ],
    })

    render(
      <ModelSelector
        runtimeValue={{ providerId: 'claude-compatible', modelId: 'deepseek-v4-pro' }}
        onRuntimeChange={vi.fn()}
        compact
        variant="pill"
      />,
    )

    const trigger = screen.getByRole('button', { name: /deepseek-v4-pro/i })
    expect(trigger.querySelector('[data-provider-logo="deepseek"]')).toBeInTheDocument()
    expect(trigger.querySelector('[data-provider-logo="anthropic-api"]')).not.toBeInTheDocument()

    fireEvent.click(trigger)

    const providerGroup = document.querySelector('[data-provider-group="claude-compatible"]')
    expect(providerGroup).toBeInTheDocument()
    expect(providerGroup?.querySelector(':scope > button [data-provider-logo="anthropic-api"]'))
      .toBeInTheDocument()

    const modelRow = Array.from(providerGroup?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('deepseek-v4-pro') && button.hasAttribute('aria-pressed'))
    expect(modelRow?.querySelector('[data-provider-logo="deepseek"]')).toBeInTheDocument()
  })

  it('supports externally controlled provider and model selection', () => {
    useProviderStore.setState({
      providers: [
        makeProvider({
          id: 'kimi',
          presetId: 'kimi',
          name: 'Kimi',
          models: {
            main: 'kimi-k2.6',
            haiku: '',
            sonnet: '',
            opus: '',
          },
        }),
      ],
    })
    const onRuntimeChange = vi.fn()

    render(
      <ModelSelector
        runtimeValue={{ providerId: null, modelId: 'claude-opus-4-8' }}
        onRuntimeChange={onRuntimeChange}
        compact
        variant="pill"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Opus 4\.8/i }))
    fireEvent.click(screen.getByRole('button', { name: /Kimi/ }))
    fireEvent.click(screen.getByText('kimi-k2.6').closest('button')!)

    expect(onRuntimeChange).toHaveBeenCalledWith({
      providerId: 'kimi',
      modelId: 'kimi-k2.6',
      contextWindow: undefined,
    })
  })

  it('offers available route profiles without replacing direct model choices', () => {
    useRoutingStore.setState({
      dashboard: {
        config: {
          version: 1,
          enabled: true,
          profiles: [{
            id: 'team-route',
            name: 'Team route',
            description: 'Custom route',
            enabled: true,
            strategy: 'priority',
            strictFree: false,
            allowExperimental: false,
            maxAttempts: 2,
            targets: [],
            graph: publishedRouteGraph,
          }],
        },
        sources: [],
        health: [],
        events: [],
        routeAvailability: {
          'team-route': { candidateCount: 2, available: true, contextWindow: 262_144 },
        },
      },
    })
    const onRuntimeChange = vi.fn()

    render(
      <ModelSelector
        runtimeValue={{ providerId: null, modelId: 'claude-opus-4-8' }}
        onRuntimeChange={onRuntimeChange}
        compact
        variant="pill"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Opus 4\.8/i }))
    expect(screen.getAllByText('Claude Official').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: /Routes/ }))
    fireEvent.click(screen.getByText('Team route').closest('button')!)

    expect(onRuntimeChange).toHaveBeenCalledWith({
      kind: 'route',
      providerId: null,
      routeId: 'team-route',
      modelId: 'cybercode-route-team-route',
      contextWindow: 262_144,
    })
  })

  it('does not offer an unpublished draft even if stale availability marks it ready', () => {
    useRoutingStore.setState({
      dashboard: {
        config: {
          version: 2,
          enabled: true,
          profiles: [{
            id: 'draft-route',
            name: 'Draft route',
            enabled: true,
            strategy: 'priority',
            strictFree: false,
            allowExperimental: false,
            maxAttempts: 2,
            targets: [],
            draftGraph: publishedRouteGraph,
          }],
        },
        sources: [],
        health: [],
        events: [],
        routeAvailability: {
          'draft-route': { candidateCount: 2, available: true },
        },
      },
    })

    render(
      <ModelSelector
        runtimeValue={{ providerId: null, modelId: 'claude-opus-4-8' }}
        onRuntimeChange={vi.fn()}
        compact
        variant="pill"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Opus 4\.8/i }))
    fireEvent.click(screen.getByRole('tab', { name: /Routes/ }))

    expect(screen.queryByText('Draft route')).not.toBeInTheDocument()
    expect(screen.getByText(/No available routes/)).toBeInTheDocument()
  })

  it('shows the real strategy for untouched legacy routes', () => {
    useRoutingStore.setState({
      dashboard: {
        config: {
          version: 1,
          enabled: true,
          profiles: [{
            id: 'coding-first',
            name: 'Coding first',
            description: 'Legacy coding route',
            enabled: true,
            strategy: 'headroom',
            strictFree: false,
            allowExperimental: false,
            maxAttempts: 3,
            targets: [{ providerId: 'legacy-provider' }],
            graph: publishedRouteGraph,
          }],
        },
        sources: [],
        health: [],
        events: [],
        routeAvailability: {
          'coding-first': { candidateCount: 2, available: true },
        },
      },
    })

    render(
      <ModelSelector
        runtimeValue={{ providerId: null, modelId: 'claude-opus-4-8' }}
        onRuntimeChange={vi.fn()}
        compact
        variant="pill"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Opus 4\.8/i }))
    fireEvent.click(screen.getByRole('tab', { name: /Routes/ }))

    expect(screen.getByText('Context headroom · 2 models ready')).toBeInTheDocument()
    expect(screen.queryByText('Reliability first · 2 models ready')).not.toBeInTheDocument()
  })

  it('filters providers and keeps unrelated model groups collapsed', () => {
    useProviderStore.setState({
      providers: [
        makeProvider({
          id: 'kimi',
          presetId: 'kimi',
          name: 'Kimi',
          models: {
            main: 'kimi-k2.6',
            haiku: '',
            sonnet: '',
            opus: '',
          },
        }),
        makeProvider({
          id: 'deepseek',
          presetId: 'deepseek',
          name: 'DeepSeek',
          models: {
            main: 'deepseek-v3',
            haiku: '',
            sonnet: '',
            opus: '',
          },
        }),
      ],
    })

    render(
      <ModelSelector
        runtimeValue={{ providerId: null, modelId: 'claude-opus-4-8' }}
        onRuntimeChange={vi.fn()}
        compact
        variant="pill"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Opus 4\.8/i }))
    expect(screen.queryByText('kimi-k2.6')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search models or providers' }), {
      target: { value: 'kimi' },
    })

    expect(screen.getByText('kimi-k2.6')).toBeInTheDocument()
    expect(screen.queryByText('deepseek-v3')).not.toBeInTheDocument()
  })

  it('warms up the selected model when choosing a local provider model', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ ok: true, started: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      useProviderStore.setState({
        providers: [
          makeProvider({
            id: 'ollama-local',
            presetId: 'ollama',
            name: 'Ollama',
            baseUrl: 'http://127.0.0.1:11434',
            models: {
              main: 'qwen3:8b',
              haiku: '',
              sonnet: '',
              opus: '',
            },
          }),
        ],
      })

      render(
        <ModelSelector
          runtimeValue={{ providerId: null, modelId: 'claude-opus-4-8' }}
          onRuntimeChange={vi.fn()}
          compact
          variant="pill"
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /Opus 4\.8/i }))
      fireEvent.click(screen.getByRole('button', { name: /Ollama/ }))
      fireEvent.click(screen.getByText('qwen3:8b').closest('button')!)

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          'http://127.0.0.1:3456/api/providers/ollama-local/warmup',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ modelId: 'qwen3:8b' }),
          }),
        )
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not warm up remote provider models on selection', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ ok: true, started: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      useProviderStore.setState({
        providers: [
          makeProvider({
            id: 'kimi',
            presetId: 'kimi',
            name: 'Kimi',
            models: {
              main: 'kimi-k2.6',
              haiku: '',
              sonnet: '',
              opus: '',
            },
          }),
        ],
      })
      const onRuntimeChange = vi.fn()

      render(
        <ModelSelector
          runtimeValue={{ providerId: null, modelId: 'claude-opus-4-8' }}
          onRuntimeChange={onRuntimeChange}
          compact
          variant="pill"
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /Opus 4\.8/i }))
      fireEvent.click(screen.getByRole('button', { name: /Kimi/ }))
      fireEvent.click(screen.getByText('kimi-k2.6').closest('button')!)

      await waitFor(() => expect(onRuntimeChange).toHaveBeenCalled())
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refreshes route availability whenever the runtime selector is reopened', async () => {
    const fetchDashboard = vi.fn().mockResolvedValue(undefined)
    useRoutingStore.setState({ fetchDashboard })

    render(
      <ModelSelector
        runtimeValue={{ providerId: null, modelId: 'claude-opus-4-8' }}
        onRuntimeChange={vi.fn()}
        compact
        variant="pill"
      />,
    )

    const trigger = screen.getByRole('button', { name: /Opus 4\.8/i })
    await waitFor(() => expect(fetchDashboard).toHaveBeenCalledTimes(1))
    fireEvent.click(trigger)
    await waitFor(() => expect(fetchDashboard).toHaveBeenCalledTimes(2))
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    await waitFor(() => expect(fetchDashboard).toHaveBeenCalledTimes(3))
  })
})
