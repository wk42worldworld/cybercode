import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node, ReactFlowInstance } from '@xyflow/react'

const flowMocks = vi.hoisted(() => ({
  fitView: vi.fn(),
  screenToFlowPosition: vi.fn(({ x, y }: { x: number; y: number }) => ({
    x: x - 100,
    y: y - 50,
  })),
}))

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    Background: () => null,
    Controls: () => null,
    ReactFlow: ({
      nodes,
      onInit,
      children,
    }: {
      nodes: Node[]
      onInit?: (instance: ReactFlowInstance) => void
      children?: ReactNode
    }) => {
      onInit?.({
        fitView: flowMocks.fitView,
        screenToFlowPosition: flowMocks.screenToFlowPosition,
      } as unknown as ReactFlowInstance)
      return (
        <div data-testid="mock-route-flow" data-node-count={nodes.length}>
          {children}
        </div>
      )
    },
  }
})

import { useSettingsStore } from '../../../stores/settingsStore'
import type { RouteProfile, RoutingSource } from '../../../types/routing'
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
  models: [{ id: 'model-a' }],
}

function testProfile(): RouteProfile {
  return {
    id: 'drag-drop-route',
    name: 'Drag drop route',
    enabled: false,
    strategy: 'priority',
    strictFree: false,
    allowExperimental: false,
    maxAttempts: 2,
    targets: [],
    draftGraph: { version: 1, nodes: [], edges: [] },
  }
}

function editorProps() {
  return {
    profile: testProfile(),
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

function canvasBounds(): DOMRect {
  return {
    x: 100,
    y: 100,
    left: 100,
    top: 100,
    right: 900,
    bottom: 700,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  }
}

describe('RouteGraphEditor palette drag and drop', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    flowMocks.fitView.mockClear()
    flowMocks.screenToFlowPosition.mockClear()
  })

  it('drops a palette node at the converted canvas position without also clicking it in', async () => {
    const props = editorProps()
    render(<RouteGraphEditor {...props} />)

    const canvas = screen.getByTestId('route-graph-canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(canvasBounds())
    const modelButton = document.querySelector<HTMLButtonElement>(
      '.route-graph-node-palette [data-route-node-kind="model"]',
    )!

    fireEvent.mouseDown(modelButton, {
      button: 0,
      clientX: 40,
      clientY: 40,
    })
    fireEvent.mouseMove(window, {
      clientX: 420,
      clientY: 360,
    })

    expect(screen.getByTestId('route-graph-node-drag-preview')).toHaveAttribute(
      'data-can-drop',
      'true',
    )
    expect(canvas).toHaveClass('is-palette-drag-over')

    fireEvent.mouseUp(window, {
      button: 0,
      clientX: 420,
      clientY: 360,
    })
    fireEvent.click(modelButton)

    expect(screen.queryByTestId('route-graph-node-drag-preview')).not.toBeInTheDocument()
    expect(canvas).not.toHaveClass('is-palette-drag-over')
    expect(flowMocks.screenToFlowPosition).toHaveBeenCalledWith({ x: 420, y: 360 })

    await waitFor(() => expect(props.onSaveDraft).toHaveBeenCalled(), { timeout: 6000 })
    const [savedGraph] = props.onSaveDraft.mock.calls.at(-1)!
    expect(savedGraph.nodes).toHaveLength(1)
    expect(savedGraph.nodes[0]).toMatchObject({
      position: { x: 320, y: 310 },
      data: { kind: 'model' },
    })
    await new Promise((resolve) => window.setTimeout(resolve, 220))
    expect(flowMocks.fitView).not.toHaveBeenCalled()
  }, 15_000)

  it('keeps single-click node creation available', async () => {
    const props = editorProps()
    render(<RouteGraphEditor {...props} />)

    const conditionButton = document.querySelector<HTMLButtonElement>(
      '.route-graph-node-palette [data-route-node-kind="condition"]',
    )!
    fireEvent.click(conditionButton)

    await waitFor(() => expect(props.onSaveDraft).toHaveBeenCalled(), { timeout: 6000 })
    const [savedGraph] = props.onSaveDraft.mock.calls.at(-1)!
    expect(savedGraph.nodes).toHaveLength(1)
    expect(savedGraph.nodes[0].data.kind).toBe('condition')
  }, 15_000)

  it('creates a generic V3 agent with editable stable ports from the palette', async () => {
    const props = editorProps()
    render(<RouteGraphEditor {...props} />)

    const agentButton = document.querySelector<HTMLButtonElement>(
      '.route-graph-node-palette [data-route-node-kind="agent"]',
    )!
    fireEvent.click(agentButton)

    await waitFor(() => expect(props.onSaveDraft).toHaveBeenCalled(), { timeout: 6000 })
    const [savedGraph] = props.onSaveDraft.mock.calls.at(-1)!
    expect(savedGraph.version).toBe(3)
    expect(savedGraph.nodes[0]).toMatchObject({
      data: {
        kind: 'agent',
        config: {
          fallbackOutputPortId: 'output-1',
          instructions: '',
          inputPorts: [{ id: 'input', label: 'Input 1' }],
          outputPorts: [
            { id: 'output-1', label: 'Output 1' },
            { id: 'output-2', label: 'Output 2' },
          ],
        },
      },
    })
  }, 15_000)

  it('does not create a node when a drag is released outside the canvas', () => {
    const props = editorProps()
    render(<RouteGraphEditor {...props} />)

    const canvas = screen.getByTestId('route-graph-canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(canvasBounds())
    const modelButton = document.querySelector<HTMLButtonElement>(
      '.route-graph-node-palette [data-route-node-kind="model"]',
    )!

    fireEvent.mouseDown(modelButton, {
      button: 0,
      clientX: 40,
      clientY: 40,
    })
    fireEvent.mouseMove(window, {
      clientX: 70,
      clientY: 70,
    })

    expect(screen.getByTestId('route-graph-node-drag-preview')).toHaveAttribute(
      'data-can-drop',
      'false',
    )
    expect(canvas).not.toHaveClass('is-palette-drag-over')

    fireEvent.mouseUp(window, {
      button: 0,
      clientX: 70,
      clientY: 70,
    })
    fireEvent.click(modelButton)

    expect(screen.queryByTestId('route-graph-node-drag-preview')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-route-flow')).toHaveAttribute('data-node-count', '0')
    expect(flowMocks.screenToFlowPosition).not.toHaveBeenCalled()
  })
})
