import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection, Edge } from '@xyflow/react'

const existingConnection: Connection = {
  source: 'start',
  target: 'model-primary',
  sourceHandle: 'flow',
  targetHandle: 'input',
}

const newConnection: Connection = {
  source: 'start',
  target: 'model-fallback',
  sourceHandle: 'flow',
  targetHandle: 'input',
}

const agentReplacementConnection: Connection = {
  source: 'agent-router',
  target: 'model-standard',
  sourceHandle: 'output:simple',
  targetHandle: 'input',
}

const spareConnection: Connection = {
  source: 'agent-router',
  target: 'model-simple',
  sourceHandle: 'output:__spare__',
  targetHandle: 'input',
}

const distributionThirdConnection: Connection = {
  source: 'distribution',
  target: 'output',
  sourceHandle: 'dist:3',
  targetHandle: 'input',
}

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    Background: () => null,
    Controls: () => null,
    ReactFlow: ({
      nodes,
      edges,
      onConnect,
      onReconnect,
      onEdgesChange,
      edgesReconnectable,
      isValidConnection,
      children,
    }: {
      nodes: Array<{
        id: string
        data: {
          config: { distributionOutputCount?: number }
          onConfigChange?: (patch: { distributionOutputCount: number }) => void
        }
      }>
      edges: Edge[]
      onConnect?: (connection: Connection) => void
      onReconnect?: (oldEdge: Edge, connection: Connection) => void
      onEdgesChange?: (changes: Array<{ type: 'remove'; id: string }>) => void
      edgesReconnectable?: boolean
      isValidConnection?: (connection: Connection | Edge) => boolean
      children?: ReactNode
    }) => {
      const simpleEdge = edges.find((edge) => (
        edge.source === 'agent-router' && edge.sourceHandle === 'output:simple'
      ))
      const complexEdge = edges.find((edge) => (
        edge.source === 'agent-router' && edge.sourceHandle === 'output:complex'
      ))
      const distributionNode = nodes.find((node) => node.id === 'distribution')
      const distributionOutputCount = distributionNode?.data.config.distributionOutputCount ?? 2
      return (
        <div
          data-testid="mock-route-flow"
          data-edge-count={edges.length}
          data-edges-reconnectable={String(edgesReconnectable)}
        >
          <span data-testid="existing-connection-valid">
            {String(isValidConnection?.(existingConnection))}
          </span>
          <span data-testid="new-connection-valid">
            {String(isValidConnection?.(newConnection))}
          </span>
          <span data-testid="agent-replacement-valid">
            {String(isValidConnection?.(agentReplacementConnection))}
          </span>
          <button
            type="button"
            onClick={() => onConnect?.(existingConnection)}
          >
            Connect existing
          </button>
          <button
            type="button"
            onClick={() => onConnect?.(newConnection)}
          >
            Connect new
          </button>
          <button
            type="button"
            onClick={() => onConnect?.(agentReplacementConnection)}
          >
            Replace agent output
          </button>
          <button
            type="button"
            onClick={() => onConnect?.(spareConnection)}
          >
            Connect spare
          </button>
          <button
            type="button"
            onClick={() => distributionNode?.data.onConfigChange?.({
              distributionOutputCount: distributionOutputCount + 1,
            })}
          >
            Add distribution output
          </button>
          <button
            type="button"
            onClick={() => distributionNode?.data.onConfigChange?.({
              distributionOutputCount: distributionOutputCount - 1,
            })}
          >
            Remove distribution output
          </button>
          <span data-testid="distribution-output-count">{distributionOutputCount}</span>
          <button
            type="button"
            onClick={() => onConnect?.(distributionThirdConnection)}
          >
            Connect distribution third output
          </button>
          <button
            type="button"
            disabled={!complexEdge}
            onClick={() => {
              if (complexEdge) onEdgesChange?.([{ type: 'remove', id: complexEdge.id }])
            }}
          >
            Remove complex edge
          </button>
          <button
            type="button"
            disabled={!simpleEdge}
            onClick={() => {
              if (simpleEdge) onReconnect?.(simpleEdge, agentReplacementConnection)
            }}
          >
            Reconnect agent edge
          </button>
          {children}
        </div>
      )
    },
  }
})

import { useSettingsStore } from '../../../stores/settingsStore'
import type { RouteGraph, RouteProfile, RoutingSource } from '../../../types/routing'
import { buildRouteGraphTemplate } from '../../../utils/routeGraph'
import { RouteGraphEditor } from './RouteGraphEditor'

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
  models: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-c' }],
}

function profile(): RouteProfile {
  return {
    id: 'connection-route',
    name: 'Connection route',
    enabled: false,
    strategy: 'priority',
    strictFree: false,
    allowExperimental: false,
    maxAttempts: 2,
    targets: [],
    draftGraph: buildRouteGraphTemplate('stable-fallback', [source]),
  }
}

function agentProfile(): RouteProfile {
  return {
    ...profile(),
    id: 'agent-connection-route',
    name: 'Agent connection route',
    draftGraph: buildRouteGraphTemplate('agent-difficulty', [source]),
  }
}

function distributionProfile(): RouteProfile {
  return {
    ...profile(),
    id: 'distribution-connection-route',
    name: 'Distribution connection route',
    draftGraph: buildRouteGraphTemplate('quota-balance', [source]),
  }
}

function distributionProfileWithThirdBranch(): RouteProfile {
  const routeProfile = distributionProfile()
  const draftGraph = routeProfile.draftGraph!
  return {
    ...routeProfile,
    id: 'distribution-three-branch-route',
    draftGraph: {
      ...draftGraph,
      nodes: [
        ...draftGraph.nodes,
        {
          id: 'model-c',
          type: 'routeGraphNode',
          position: { x: 450, y: 440 },
          data: {
            kind: 'model',
            config: { providerId: 'provider-1', modelId: 'model-c' },
          },
        },
      ],
      edges: [
        ...draftGraph.edges,
        {
          id: 'distribution-flow-model-c',
          source: 'distribution',
          target: 'model-c',
          sourceHandle: 'dist:3',
          targetHandle: 'input',
          type: 'smoothstep',
          data: { kind: 'flow' },
        },
        {
          id: 'model-c-success-output',
          source: 'model-c',
          target: 'output',
          sourceHandle: 'success',
          targetHandle: 'input',
          type: 'smoothstep',
          data: { kind: 'success' },
        },
      ],
    },
  }
}

describe('RouteGraphEditor connections', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('blocks repeated connections before and during graph updates', async () => {
    const routeProfile = profile()
    const onSaveDraft = vi.fn().mockResolvedValue(undefined)
    render(<RouteGraphEditor
      profile={routeProfile}
      sources={[source]}
      isSaving={false}
      isPreviewing={false}
      isPublishing={false}
      error={null}
      onBack={vi.fn()}
      onSaveDraft={onSaveDraft}
      onPreview={vi.fn().mockResolvedValue(null)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onRollback={vi.fn().mockResolvedValue(true)}
    />)

    expect(screen.getByTestId('existing-connection-valid')).toHaveTextContent('false')
    expect(screen.getByTestId('new-connection-valid')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'Connect existing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect new' }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect new' }))

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalled(), { timeout: 6000 })
    const savedGraph = onSaveDraft.mock.calls.at(-1)?.[0] as RouteGraph
    expect(savedGraph.edges.filter((entry) => (
      entry.source === newConnection.source
      && entry.target === newConnection.target
      && entry.data.kind === 'flow'
    ))).toHaveLength(1)
    expect(screen.getByTestId('new-connection-valid')).toHaveTextContent('false')
  }, 15_000)

  it('moves an occupied agent output to a new target when the user draws another line', async () => {
    const onSaveDraft = vi.fn().mockResolvedValue(undefined)
    render(<RouteGraphEditor
      profile={agentProfile()}
      sources={[source]}
      isSaving={false}
      isPreviewing={false}
      isPublishing={false}
      error={null}
      onBack={vi.fn()}
      onSaveDraft={onSaveDraft}
      onPreview={vi.fn().mockResolvedValue(null)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onRollback={vi.fn().mockResolvedValue(true)}
    />)

    expect(screen.getByTestId('agent-replacement-valid')).toHaveTextContent('true')
    fireEvent.click(screen.getByRole('button', { name: 'Replace agent output' }))

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalled(), { timeout: 6000 })
    const savedGraph = onSaveDraft.mock.calls.at(-1)?.[0] as RouteGraph
    expect(savedGraph.edges).not.toContainEqual(expect.objectContaining({
      source: 'agent-router',
      target: 'model-simple',
      data: expect.objectContaining({ sourcePortId: 'simple' }),
    }))
    expect(savedGraph.edges).toContainEqual(expect.objectContaining({
      source: 'agent-router',
      target: 'model-standard',
      data: expect.objectContaining({ sourcePortId: 'simple' }),
    }))
    expect(savedGraph.edges.filter((edge) => (
      edge.source === 'agent-router' && edge.data.sourcePortId === 'simple'
    ))).toHaveLength(1)
    expect(screen.getByTestId('agent-replacement-valid')).toHaveTextContent('false')
  }, 15_000)

  it('supports dragging an existing edge endpoint to replace its target', async () => {
    const onSaveDraft = vi.fn().mockResolvedValue(undefined)
    render(<RouteGraphEditor
      profile={agentProfile()}
      sources={[source]}
      isSaving={false}
      isPreviewing={false}
      isPublishing={false}
      error={null}
      onBack={vi.fn()}
      onSaveDraft={onSaveDraft}
      onPreview={vi.fn().mockResolvedValue(null)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onRollback={vi.fn().mockResolvedValue(true)}
    />)

    expect(screen.getByTestId('mock-route-flow'))
      .toHaveAttribute('data-edges-reconnectable', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect agent edge' }))

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalled(), { timeout: 6000 })
    const savedGraph = onSaveDraft.mock.calls.at(-1)?.[0] as RouteGraph
    expect(savedGraph.edges.filter((edge) => (
      edge.source === 'agent-router' && edge.data.sourcePortId === 'simple'
    ))).toEqual([
      expect.objectContaining({ target: 'model-standard' }),
    ])
  }, 15_000)

  it('grows a new output port when drawing from the spare pin', async () => {
    const onSaveDraft = vi.fn().mockResolvedValue(undefined)
    render(<RouteGraphEditor
      profile={agentProfile()}
      sources={[source]}
      isSaving={false}
      isPreviewing={false}
      isPublishing={false}
      error={null}
      onBack={vi.fn()}
      onSaveDraft={onSaveDraft}
      onPreview={vi.fn().mockResolvedValue(null)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onRollback={vi.fn().mockResolvedValue(true)}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Connect spare' }))

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalled(), { timeout: 6000 })
    const savedGraph = onSaveDraft.mock.calls.at(-1)?.[0] as RouteGraph
    const agent = savedGraph.nodes.find((node) => node.id === 'agent-router')!
    const portIds = agent.data.config.outputPorts?.map((port) => port.id) ?? []

    expect(portIds).toHaveLength(4)
    expect(portIds.slice(0, 3)).toEqual(['simple', 'standard', 'complex'])
    const newPortId = portIds[3]!
    expect(newPortId).not.toBe('__spare__')
    expect(savedGraph.edges).toContainEqual(expect.objectContaining({
      source: 'agent-router',
      target: 'model-simple',
      data: expect.objectContaining({ kind: 'choice', sourcePortId: newPortId }),
    }))
  }, 15_000)

  it('prunes an agent output port when its last edge is removed', async () => {
    const onSaveDraft = vi.fn().mockResolvedValue(undefined)
    render(<RouteGraphEditor
      profile={agentProfile()}
      sources={[source]}
      isSaving={false}
      isPreviewing={false}
      isPublishing={false}
      error={null}
      onBack={vi.fn()}
      onSaveDraft={onSaveDraft}
      onPreview={vi.fn().mockResolvedValue(null)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onRollback={vi.fn().mockResolvedValue(true)}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove complex edge' }))

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalled(), { timeout: 6000 })
    const savedGraph = onSaveDraft.mock.calls.at(-1)?.[0] as RouteGraph
    const agent = savedGraph.nodes.find((node) => node.id === 'agent-router')!

    expect(agent.data.config.outputPorts?.map((port) => port.id))
      .toEqual(['simple', 'standard'])
    expect(savedGraph.edges.filter((edge) => edge.source === 'agent-router'))
      .toHaveLength(2)
  }, 15_000)

  it('adds a numbered distribution pin before connecting the new branch', async () => {
    const onSaveDraft = vi.fn().mockResolvedValue(undefined)
    render(<RouteGraphEditor
      profile={distributionProfile()}
      sources={[source]}
      isSaving={false}
      isPreviewing={false}
      isPublishing={false}
      error={null}
      onBack={vi.fn()}
      onSaveDraft={onSaveDraft}
      onPreview={vi.fn().mockResolvedValue(null)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onRollback={vi.fn().mockResolvedValue(true)}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Add distribution output' }))
    await waitFor(() => expect(screen.getByTestId('distribution-output-count')).toHaveTextContent('3'))
    fireEvent.click(screen.getByRole('button', { name: 'Connect distribution third output' }))

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalled(), { timeout: 6000 })
    const savedGraph = onSaveDraft.mock.calls.at(-1)?.[0] as RouteGraph
    const distributionEdges = savedGraph.edges.filter((edge) => edge.source === 'distribution')

    expect(distributionEdges).toHaveLength(3)
    expect(distributionEdges.map((edge) => edge.sourceHandle))
      .toEqual(['dist:1', 'dist:2', 'dist:3'])
    expect(distributionEdges.every((edge) => edge.data.kind === 'flow')).toBe(true)
    expect(distributionEdges.some((edge) => edge.target === 'output')).toBe(true)
  }, 15_000)

  it('removes the last distribution branch without deleting its target model', async () => {
    const onSaveDraft = vi.fn().mockResolvedValue(undefined)
    render(<RouteGraphEditor
      profile={distributionProfileWithThirdBranch()}
      sources={[source]}
      isSaving={false}
      isPreviewing={false}
      isPublishing={false}
      error={null}
      onBack={vi.fn()}
      onSaveDraft={onSaveDraft}
      onPreview={vi.fn().mockResolvedValue(null)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onRollback={vi.fn().mockResolvedValue(true)}
    />)

    expect(screen.getByTestId('distribution-output-count')).toHaveTextContent('3')
    fireEvent.click(screen.getByRole('button', { name: 'Remove distribution output' }))

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalled(), { timeout: 6000 })
    const savedGraph = onSaveDraft.mock.calls.at(-1)?.[0] as RouteGraph
    expect(savedGraph.nodes.find((node) => node.id === 'distribution')?.data.config)
      .toMatchObject({ distributionOutputCount: 2 })
    expect(savedGraph.edges.filter((edge) => edge.source === 'distribution')).toHaveLength(2)
    expect(savedGraph.nodes.some((node) => node.id === 'model-c')).toBe(true)
    expect(savedGraph.edges.some((edge) => edge.id === 'model-c-success-output')).toBe(true)
  }, 15_000)
})
