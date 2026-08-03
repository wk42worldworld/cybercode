import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '../../../stores/settingsStore'
import type {
  RouteGraph,
  RouteGraphNodeKind,
  RoutePreviewResult,
  RouteProfile,
  RoutingSource,
} from '../../../types/routing'
import {
  buildRouteGraphTemplate,
  createEmptyRouteGraph,
  createRouteGraphNode,
} from '../../../utils/routeGraph'
import { mergeRouteGraphFlowNodes, RouteGraphEditor } from './RouteGraphEditor'
import { RouteGraphInspector } from './RouteGraphInspector'
import { ROUTE_GRAPH_NODE_COLORS, routeGraphNodeColor } from './RouteGraphNode'

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

function profile(graph = buildRouteGraphTemplate('stable-fallback', [source])): RouteProfile {
  return {
    id: 'daily-route',
    name: 'Daily route',
    enabled: false,
    strategy: 'priority',
    strictFree: false,
    allowExperimental: false,
    maxAttempts: 2,
    targets: [
      { providerId: 'provider-1', modelId: 'model-a', priority: 0 },
      { providerId: 'provider-1', modelId: 'model-b', priority: 1 },
    ],
    draftGraph: graph,
  }
}

function editorProps(routeProfile = profile()) {
  return {
    profile: routeProfile,
    sources: [source],
    preview: undefined,
    isSaving: false,
    isPreviewing: false,
    isPublishing: false,
    error: null,
    onBack: vi.fn(),
    onSaveDraft: vi.fn().mockResolvedValue(undefined),
    onPreview: vi.fn().mockResolvedValue(null),
    onPublish: vi.fn().mockResolvedValue(true),
    onRollback: vi.fn().mockResolvedValue(true),
  }
}

function graphWithEveryNodeKind(): RouteGraph {
  const kinds = Object.keys(ROUTE_GRAPH_NODE_COLORS) as RouteGraphNodeKind[]
  const nodes: RouteGraph['nodes'] = []
  for (const [index, kind] of kinds.entries()) {
    nodes.push(createRouteGraphNode(
      kind,
      { x: index * 220, y: index % 2 === 0 ? 80 : 220 },
      nodes.map((entry) => entry.id),
    ))
  }
  return { version: 1, nodes, edges: [] }
}

function routeSelectTrigger(label: string, scope: ParentNode = document): HTMLButtonElement | null {
  return Array.from(
    scope.querySelectorAll<HTMLButtonElement>('button[data-route-select-label]'),
  ).find((button) => button.dataset.routeSelectLabel === label) ?? null
}

async function chooseRouteSelect(
  label: string,
  value: string,
  scope: ParentNode = document,
) {
  await waitFor(() => {
    expect(routeSelectTrigger(label, scope)).not.toBeNull()
    expect(routeSelectTrigger(label, scope)).toBeEnabled()
  })
  fireEvent.click(routeSelectTrigger(label, scope)!)
  await waitFor(() => expect(
    document.body.querySelector(`[role="option"][data-value="${value}"]`),
  ).not.toBeNull())
  fireEvent.click(document.body.querySelector(`[role="option"][data-value="${value}"]`)!)
}

describe('RouteGraphEditor', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('uses one shared, distinct accent color for every node kind', () => {
    const props = editorProps(profile(graphWithEveryNodeKind()))
    render(<RouteGraphEditor {...props} />)

    expect(new Set(Object.values(ROUTE_GRAPH_NODE_COLORS)).size).toBe(
      Object.keys(ROUTE_GRAPH_NODE_COLORS).length,
    )
    for (const [kind, color] of Object.entries(ROUTE_GRAPH_NODE_COLORS)) {
      expect(routeGraphNodeColor(kind as RouteGraphNodeKind)).toBe(color)
      const paletteNode = document.querySelector(
        `.route-graph-node-palette [data-route-node-kind="${kind}"]`,
      ) as HTMLElement | null
      expect(paletteNode).not.toBeNull()
      expect(paletteNode?.style.getPropertyValue('--route-node-accent')).toBe(color)

      const canvasNode = document.querySelector(
        `.route-graph-canvas [data-route-node-kind="${kind}"]`,
      ) as HTMLElement | null
      expect(canvasNode).not.toBeNull()
      expect(canvasNode?.style.getPropertyValue('--route-node-accent')).toBe(color)
    }
  })

  it('preserves React Flow measurement state when graph data refreshes during a drag', () => {
    const node = buildRouteGraphTemplate('stable-fallback', [source]).nodes[0]!
    const current = [{
      ...node,
      measured: { width: 140, height: 58 },
      dragging: true,
      selected: true,
    }]
    const next = [{
      ...node,
      position: { x: node.position.x + 48, y: node.position.y + 24 },
      selected: true,
    }]

    expect(mergeRouteGraphFlowNodes(current, next)[0]).toMatchObject({
      measured: { width: 140, height: 58 },
      dragging: true,
      position: next[0]!.position,
      selected: true,
    })
  })

  it('keeps the route usage switch stable while the update is being persisted', async () => {
    const publishedGraph = buildRouteGraphTemplate('stable-fallback', [source])
    const publishedProfile = {
      ...profile(publishedGraph),
      enabled: true,
      graph: publishedGraph,
    }
    let resolveUsage!: () => void
    const usageUpdate = new Promise<void>((resolve) => {
      resolveUsage = resolve
    })
    const onUsageChange = vi.fn(() => usageUpdate)
    const props = {
      ...editorProps(publishedProfile),
      globallyEnabled: true,
      routeEnabled: true,
      isSaving: true,
      onUsageChange,
    }
    const { rerender } = render(<RouteGraphEditor {...props} />)

    const usageSwitch = screen.getByRole('switch', { name: 'Use this route' })
    expect(usageSwitch).toBeChecked()
    expect(usageSwitch).toBeEnabled()

    const usageLabels = usageSwitch.querySelectorAll('.route-graph-use-switch-label > span')
    expect(usageLabels).toHaveLength(2)
    expect(usageLabels[0]).toHaveTextContent('Active')
    expect(usageLabels[0]).toHaveClass('is-visible')
    expect(usageLabels[1]).toHaveTextContent('Use this route')
    expect(usageLabels[1]).not.toHaveClass('is-visible')

    const statusLabels = document.querySelectorAll('.route-graph-status-label > span')
    expect(statusLabels).toHaveLength(3)
    expect(statusLabels[0]).toHaveTextContent('Saving…')
    expect(statusLabels[0]).toHaveClass('is-visible')

    fireEvent.click(usageSwitch)

    expect(onUsageChange).toHaveBeenCalledWith(false)
    expect(usageSwitch).not.toBeChecked()
    expect(usageSwitch).toBeDisabled()
    expect(usageSwitch).toHaveAttribute('aria-busy', 'true')
    expect(usageSwitch).toHaveClass('is-updating')
    expect(usageLabels[0]).not.toHaveClass('is-visible')
    expect(usageLabels[1]).toHaveClass('is-visible')

    rerender(<RouteGraphEditor {...props} routeEnabled={false} />)
    expect(usageSwitch).not.toBeChecked()

    await act(async () => {
      resolveUsage()
      await usageUpdate
    })

    await waitFor(() => expect(usageSwitch).toBeEnabled())
    expect(usageSwitch).not.toBeChecked()
    expect(usageSwitch).not.toHaveClass('is-updating')
    expect(usageSwitch).not.toHaveAttribute('aria-busy')
  })

  it('edits the provider and model directly on a model node', async () => {
    const modelNode = createRouteGraphNode('model', { x: 120, y: 100 }, [])
    modelNode.data.config = {
      ...modelNode.data.config,
      providerId: source.providerId,
      modelId: 'model-a',
    }
    const props = editorProps(profile({ version: 1, nodes: [modelNode], edges: [] }))
    render(<RouteGraphEditor {...props} />)

    await waitFor(() => expect(routeSelectTrigger('Provider')).not.toBeNull())
    const providerSelect = routeSelectTrigger('Provider')!
    const modelSelect = routeSelectTrigger('Model')!
    expect(providerSelect).toHaveAttribute('aria-label', 'Provider: Acme AI, Custom')
    expect(providerSelect).toHaveTextContent('Custom')
    expect(modelSelect).toHaveAttribute('aria-label', 'Model: model-a')
    expect(providerSelect.closest('.route-graph-select-node')).toBeInTheDocument()
    expect(modelSelect.closest('.route-graph-node-model-controls')).toHaveClass('nodrag', 'nowheel')
    expect(document.querySelector('.route-graph-node select')).not.toBeInTheDocument()

    await chooseRouteSelect('Model', 'model-b')

    await waitFor(() => {
      const latestGraph = props.onSaveDraft.mock.calls.at(-1)?.[0] as RouteGraph | undefined
      const latestModel = latestGraph?.nodes.find((node) => node.data.kind === 'model')
      expect(latestModel?.data.config.modelId).toBe('model-b')
    }, { timeout: 6000 })
    const [savedGraph] = props.onSaveDraft.mock.calls.at(-1)!
    expect(savedGraph.nodes[0].data.config).toMatchObject({
      providerId: 'provider-1',
      modelId: 'model-b',
    })
  }, 15_000)

  it('uses the custom listbox treatment in the node inspector', async () => {
    const modelNode = createRouteGraphNode('model', { x: 120, y: 100 }, [])
    modelNode.data.config = {
      ...modelNode.data.config,
      providerId: source.providerId,
      modelId: 'model-a',
    }

    render(
      <RouteGraphInspector
        node={modelNode}
        sources={[source]}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const inspector = screen.getByTestId('route-graph-inspector')
    const providerSelect = routeSelectTrigger('Provider', inspector)
    const modelSelect = routeSelectTrigger('Model', inspector)
    expect(providerSelect?.closest('.route-graph-select-inspector')).toBeInTheDocument()
    expect(modelSelect?.closest('.route-graph-select-inspector')).toBeInTheDocument()
    expect(inspector.querySelector('select')).not.toBeInTheDocument()

    fireEvent.click(providerSelect!)
    const listbox = document.body.querySelector('[role="listbox"][aria-label="Provider"]')
    const selectedOption = listbox?.querySelector('[role="option"][data-value="provider-1"]')
    expect(listbox).toBeInTheDocument()
    expect(selectedOption).toHaveAttribute('aria-selected', 'true')
    expect(selectedOption).toHaveTextContent('Custom')
    expect(selectedOption?.querySelector('.settings-dropdown-item-badge')).toHaveTextContent('Custom')
    fireEvent.click(selectedOption!)
    expect(document.body.querySelector('[role="listbox"][aria-label="Provider"]'))
      .not.toBeInTheDocument()
  })

  it('edits every configurable node from controls on the node card', async () => {
    const nodes = (
      ['condition', 'distribution', 'parallel', 'result', 'relay'] as RouteGraphNodeKind[]
    ).map((kind, index, kinds) => createRouteGraphNode(
      kind,
      {
        x: (index % 3) * 250 + 40,
        y: Math.floor(index / 3) * 210 + 60,
      },
      kinds.slice(0, index),
    ))
    const props = editorProps(profile({ version: 1, nodes, edges: [] }))
    render(<RouteGraphEditor {...props} />)

    const affinitySwitch = screen.getByLabelText('Keep session affinity', {
      selector: 'button',
    })
    expect(affinitySwitch).toHaveAttribute('aria-checked', 'true')

    await chooseRouteSelect('Condition', 'cost')
    await chooseRouteSelect('Operator', 'lte')
    fireEvent.change(screen.getByLabelText('Value', { selector: 'input' }), {
      target: { value: '0.25' },
    })
    await chooseRouteSelect('Distribution rule', 'latency')
    fireEvent.change(screen.getByLabelText('Maximum parallel branches', { selector: 'input' }), {
      target: { value: '3' },
    })
    await chooseRouteSelect('Result handling', 'judge')
    await chooseRouteSelect('Judge provider', 'provider-1')
    await chooseRouteSelect('Judge model', 'model-b')

    fireEvent.click(affinitySwitch)

    const controls = document.querySelectorAll('.route-graph-node-controls')
    expect(controls).toHaveLength(5)
    for (const control of controls) {
      expect(control).toHaveClass('nodrag', 'nowheel')
    }

    await waitFor(() => {
      const latestGraph = props.onSaveDraft.mock.calls.at(-1)?.[0] as RouteGraph | undefined
      const latestResult = latestGraph?.nodes.find((node) => node.data.kind === 'result')
      expect(latestResult?.data.config.judgeModelId).toBe('model-b')
    }, { timeout: 6000 })
    const [savedGraph] = props.onSaveDraft.mock.calls.at(-1)!
    const configByKind = new Map(savedGraph.nodes.map((node: RouteGraph['nodes'][number]) => [
      node.data.kind,
      node.data.config,
    ]))
    expect(configByKind.get('condition')).toMatchObject({
      condition: 'cost',
      operator: 'lte',
      value: '0.25',
    })
    expect(configByKind.get('distribution')).toMatchObject({ distributionMode: 'latency' })
    expect(configByKind.get('parallel')).toMatchObject({ maxConcurrency: 3 })
    expect(configByKind.get('result')).toMatchObject({
      resultMode: 'judge',
      judgeProviderId: 'provider-1',
      judgeModelId: 'model-b',
    })
    expect(configByKind.get('relay')).toMatchObject({ sessionSticky: false })
  }, 15_000)

  it('flushes the latest draft before returning to route management', async () => {
    const props = editorProps()
    render(<RouteGraphEditor {...props} />)

    fireEvent.change(document.querySelector<HTMLInputElement>('.route-graph-name')!, {
      target: { value: 'Latest route name' },
    })
    fireEvent.click(document.querySelector<HTMLButtonElement>('.route-graph-back')!)

    await waitFor(() => expect(props.onSaveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1 }),
      'Latest route name',
    ))
    expect(props.onBack).toHaveBeenCalledTimes(1)
  }, 15_000)

  it('flushes an unsaved draft when the routing view is switched away', async () => {
    const props = editorProps()
    const rendered = render(<RouteGraphEditor {...props} />)

    fireEvent.change(screen.getByLabelText('Route name'), {
      target: { value: 'Keep this draft' },
    })
    rendered.unmount()

    await waitFor(() => expect(props.onSaveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1 }),
      'Keep this draft',
    ))
  })

  it('reuses the in-flight save when leaving with the same draft', async () => {
    let resolveSave!: () => void
    const pendingSave = new Promise<void>((resolve) => {
      resolveSave = resolve
    })
    const props = editorProps()
    props.onSaveDraft.mockImplementation(() => pendingSave)
    render(<RouteGraphEditor {...props} />)

    fireEvent.change(screen.getByLabelText('Route name'), {
      target: { value: 'One network save' },
    })
    await waitFor(() => expect(props.onSaveDraft).toHaveBeenCalledTimes(1), { timeout: 6000 })
    fireEvent.click(screen.getByRole('button', { name: 'Back to routes' }))

    expect(props.onBack).not.toHaveBeenCalled()
    resolveSave()
    await waitFor(() => expect(props.onBack).toHaveBeenCalledTimes(1))
    expect(props.onSaveDraft).toHaveBeenCalledTimes(1)
  }, 15_000)

  it('preserves the final draft order when the same signature returns after a newer edit', async () => {
    let resolveFirstSave!: () => void
    const firstSave = new Promise<void>((resolve) => {
      resolveFirstSave = resolve
    })
    const props = editorProps()
    props.onSaveDraft
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue(undefined)
    render(<RouteGraphEditor {...props} />)

    fireEvent.change(screen.getByLabelText('Route name'), {
      target: { value: 'Route A' },
    })
    await waitFor(() => expect(props.onSaveDraft).toHaveBeenCalledTimes(1), { timeout: 6000 })

    fireEvent.change(screen.getByLabelText('Route name'), {
      target: { value: 'Route B' },
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 650))
    })
    fireEvent.change(screen.getByLabelText('Route name'), {
      target: { value: 'Route A' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Back to routes' }))

    resolveFirstSave()
    await waitFor(() => expect(props.onSaveDraft).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(props.onBack).toHaveBeenCalledTimes(1))
    expect(props.onSaveDraft.mock.calls.map((call) => call[1])).toEqual([
      'Route A',
      'Route B',
      'Route A',
    ])
  }, 15_000)

  it('applies a template and autosaves it as a draft', async () => {
    const props = editorProps()
    render(<RouteGraphEditor {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Quota balance' }))

    await waitFor(() => expect(props.onSaveDraft).toHaveBeenCalled(), { timeout: 6000 })
    const [savedGraph, savedName] = props.onSaveDraft.mock.calls.at(-1)!
    expect(savedName).toBe('Daily route')
    expect(savedGraph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'distribution',
          config: expect.objectContaining({ distributionMode: 'quota' }),
        }),
      }),
    ]))
  }, 15_000)

  it('blocks publishing an invalid empty graph before any API call', async () => {
    const props = editorProps(profile(createEmptyRouteGraph()))
    render(<RouteGraphEditor {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(props.onPublish).not.toHaveBeenCalled()
    expect(await screen.findByText('Add at least one Model node.')).toBeInTheDocument()
    expect(screen.getByText('Publishing blocked')).toBeInTheDocument()
  })

  it('shows the server test path and execution metrics', async () => {
    const graph = buildRouteGraphTemplate('stable-fallback', [source])
    const result: RoutePreviewResult = {
      validation: { valid: true, issues: [] },
      path: ['start', 'model-primary', 'output'],
      edgePath: ['start-flow-model-primary', 'model-primary-result-output'],
      totalLatencyMs: 820,
      inputTokens: 120,
      outputTokens: 48,
    }
    const props = editorProps(profile(graph))
    props.onPreview.mockResolvedValue(result)
    const rendered = render(<RouteGraphEditor {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Test run' }))
    await waitFor(() => expect(props.onPreview).toHaveBeenCalledWith(expect.objectContaining({
      nodes: expect.any(Array),
      edges: expect.any(Array),
    })))

    rendered.rerender(<RouteGraphEditor {...props} preview={result} />)
    expect(await screen.findByText('Execution path')).toBeInTheDocument()
    expect(screen.getByText('820 ms · 120 in / 48 out')).toBeInTheDocument()
    expect(screen.getByTitle('model-primary')).toHaveTextContent('model-a')
  }, 15_000)

  it('publishes a valid graph with its edited route name', async () => {
    const props = editorProps()
    render(<RouteGraphEditor {...props} />)

    fireEvent.change(screen.getByLabelText('Route name'), {
      target: { value: 'Production route' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(props.onPublish).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1 }),
      'Production route',
    ))
  })

  it('provides an overlay node library control for narrow layouts', () => {
    const props = editorProps()
    render(<RouteGraphEditor {...props} />)

    const library = screen.getByTestId('route-graph-library')
    expect(library).toHaveAttribute('data-open', 'false')
    fireEvent.click(screen.getByTestId('route-graph-mobile-library'))
    expect(library).toHaveAttribute('data-open', 'true')
  })

  it('keeps the canvas clear of a redundant minimap', () => {
    render(<RouteGraphEditor {...editorProps()} />)

    expect(screen.queryByRole('img', { name: 'Mini Map' })).not.toBeInTheDocument()
  })

  it('keeps graph editing commands available in the compact overflow menu', () => {
    const props = editorProps()
    render(<RouteGraphEditor {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Quota balance' }))
    fireEvent.click(screen.getByTestId('route-graph-mobile-actions'))

    const menu = document.querySelector('.route-graph-mobile-actions-menu')
    expect(menu).toBeInTheDocument()
    const [undoButton, redoButton, autoLayoutButton] = Array.from(
      menu!.querySelectorAll('button'),
    ) as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement]
    expect(undoButton).toHaveTextContent('Undo')
    expect(undoButton).toBeEnabled()
    expect(redoButton).toHaveTextContent('Redo')
    expect(redoButton).toBeDisabled()
    expect(autoLayoutButton).toHaveTextContent('Auto layout')
    expect(autoLayoutButton).toBeEnabled()

    fireEvent.click(autoLayoutButton)
    expect(document.querySelector('.route-graph-mobile-actions-menu')).not.toBeInTheDocument()
  })

  it('offers rollback only when a previous published graph exists', async () => {
    const graph = buildRouteGraphTemplate('stable-fallback', [source])
    const routeProfile = {
      ...profile(graph),
      graph,
      previousGraph: buildRouteGraphTemplate('low-cost', [source]),
    }
    const props = editorProps(routeProfile)
    render(<RouteGraphEditor {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Restore previous published version' }))
    await waitFor(() => expect(props.onRollback).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(props.onBack).toHaveBeenCalledTimes(1))
  })

  it('waits for an in-flight draft save before rollback and never restores the stale draft', async () => {
    const graph = buildRouteGraphTemplate('stable-fallback', [source])
    const routeProfile = {
      ...profile(graph),
      graph,
      previousGraph: buildRouteGraphTemplate('low-cost', [source]),
    }
    let resolveSave!: () => void
    const pendingSave = new Promise<void>((resolve) => {
      resolveSave = resolve
    })
    const props = editorProps(routeProfile)
    props.onSaveDraft.mockImplementation(() => pendingSave)
    const rendered = render(<RouteGraphEditor {...props} />)

    fireEvent.change(screen.getByLabelText('Route name'), {
      target: { value: 'Draft still saving' },
    })
    await waitFor(() => expect(props.onSaveDraft).toHaveBeenCalledTimes(1), { timeout: 6000 })

    fireEvent.click(screen.getByRole('button', { name: 'Restore previous published version' }))
    expect(props.onRollback).not.toHaveBeenCalled()

    resolveSave()
    await waitFor(() => expect(props.onRollback).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(props.onBack).toHaveBeenCalledTimes(1))
    rendered.unmount()

    expect(props.onSaveDraft).toHaveBeenCalledTimes(1)
  }, 15_000)

  it('resumes draft saving when rollback fails', async () => {
    const graph = buildRouteGraphTemplate('stable-fallback', [source])
    const routeProfile = {
      ...profile(graph),
      graph,
      previousGraph: buildRouteGraphTemplate('low-cost', [source]),
    }
    const props = editorProps(routeProfile)
    props.onRollback.mockResolvedValue(false)
    render(<RouteGraphEditor {...props} />)

    fireEvent.change(screen.getByLabelText('Route name'), {
      target: { value: 'Keep after failed rollback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Restore previous published version' }))

    await waitFor(() => expect(props.onRollback).toHaveBeenCalledTimes(1))
    expect(props.onBack).not.toHaveBeenCalled()
    await waitFor(() => expect(props.onSaveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1 }),
      'Keep after failed rollback',
    ))
  })
})
