import type { MouseEvent, ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Edge, Node as FlowNode } from '@xyflow/react'

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    Background: () => null,
    Controls: () => null,
    ReactFlow: ({
      nodes,
      edges,
      onNodeContextMenu,
      onEdgeContextMenu,
      onPaneContextMenu,
      children,
    }: {
      nodes: FlowNode[]
      edges: Edge[]
      onNodeContextMenu?: (event: MouseEvent<HTMLButtonElement>, node: FlowNode) => void
      onEdgeContextMenu?: (event: MouseEvent<HTMLButtonElement>, edge: Edge) => void
      onPaneContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
      children?: ReactNode
    }) => (
      <div
        data-testid="mock-route-flow"
        onContextMenu={(event) => {
          if (event.target === event.currentTarget) onPaneContextMenu?.(event)
        }}
      >
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            data-testid={`mock-node-${node.id}`}
            onContextMenu={(event) => onNodeContextMenu?.(event, node)}
          >
            {node.id}
          </button>
        ))}
        {edges.map((edge) => (
          <button
            key={edge.id}
            type="button"
            data-testid={`mock-edge-${edge.id}`}
            onContextMenu={(event) => onEdgeContextMenu?.(event, edge)}
          >
            {edge.id}
          </button>
        ))}
        {children}
      </div>
    ),
  }
})

import { useSettingsStore } from '../../../stores/settingsStore'
import type { RouteProfile, RoutingSource } from '../../../types/routing'
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
  models: [{ id: 'model-a' }, { id: 'model-b' }],
}

function testProfile(): RouteProfile {
  const graph = buildRouteGraphTemplate('stable-fallback', [source])
  return {
    id: 'context-menu-route',
    name: 'Context menu route',
    enabled: false,
    strategy: 'priority',
    strictFree: false,
    allowExperimental: false,
    maxAttempts: 2,
    targets: [],
    draftGraph: graph,
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

describe('RouteGraphEditor context menus', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('disconnects the right-clicked edge and saves the new draft', async () => {
    const props = editorProps()
    const initialEdges = props.profile.draftGraph!.edges
    const edgeId = initialEdges[0]!.id
    render(<RouteGraphEditor {...props} />)

    fireEvent.contextMenu(screen.getByTestId(`mock-edge-${edgeId}`), {
      clientX: 180,
      clientY: 120,
    })
    expect(screen.getByTestId('route-graph-edge-context-menu')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Disconnect connection' }))

    expect(screen.queryByTestId('route-graph-edge-context-menu')).not.toBeInTheDocument()
    await waitFor(() => expect(props.onSaveDraft).toHaveBeenCalled(), { timeout: 6000 })
    const [savedGraph] = props.onSaveDraft.mock.calls.at(-1)!
    expect(savedGraph.edges).toHaveLength(initialEdges.length - 1)
    expect(savedGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: edgeId }),
    ]))
  }, 15_000)

  it('closes with Escape without disconnecting the edge', () => {
    const props = editorProps()
    const edgeId = props.profile.draftGraph!.edges[0]!.id
    render(<RouteGraphEditor {...props} />)

    fireEvent.contextMenu(screen.getByTestId(`mock-edge-${edgeId}`), {
      clientX: 180,
      clientY: 120,
    })
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Disconnect connection' }), {
      key: 'Escape',
    })

    expect(screen.queryByTestId('route-graph-edge-context-menu')).not.toBeInTheDocument()
    expect(props.onSaveDraft).not.toHaveBeenCalled()
  })

  it('uses the selected app language and duplicates a regular node', async () => {
    useSettingsStore.setState({ locale: 'zh' })
    const props = editorProps()
    const initialNodes = props.profile.draftGraph!.nodes
    const modelNode = initialNodes.find((entry) => entry.data.kind === 'model')!
    render(<RouteGraphEditor {...props} />)

    fireEvent.contextMenu(screen.getByTestId(`mock-node-${modelNode.id}`), {
      clientX: 200,
      clientY: 130,
    })

    expect(screen.getByTestId('route-graph-node-context-menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '节点属性' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '复制节点' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '删除节点' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: '复制节点' }))

    await waitFor(() => expect(props.onSaveDraft).toHaveBeenCalled(), { timeout: 6000 })
    const [savedGraph] = props.onSaveDraft.mock.calls.at(-1)!
    expect(savedGraph.nodes).toHaveLength(initialNodes.length + 1)
    expect(savedGraph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: expect.not.stringMatching(new RegExp(`^${modelNode.id}$`)),
        data: expect.objectContaining({
          kind: modelNode.data.kind,
          config: modelNode.data.config,
        }),
      }),
    ]))
  }, 15_000)

  it('protects start and output nodes from destructive menu actions', () => {
    const props = editorProps()
    const startNode = props.profile.draftGraph!.nodes.find((entry) => entry.data.kind === 'start')!
    render(<RouteGraphEditor {...props} />)

    fireEvent.contextMenu(screen.getByTestId(`mock-node-${startNode.id}`))

    expect(screen.getByRole('menuitem', { name: 'Node properties' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Duplicate node' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete node' })).not.toBeInTheDocument()
  })

  it('shows useful canvas actions and suppresses the native WebView menu', () => {
    const props = editorProps()
    render(<RouteGraphEditor {...props} />)

    const nativeMenuEvent = new window.MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    })
    screen.getByTestId('route-graph-editor').dispatchEvent(nativeMenuEvent)
    expect(nativeMenuEvent.defaultPrevented).toBe(true)

    fireEvent.contextMenu(screen.getByTestId('mock-route-flow'), {
      clientX: 240,
      clientY: 160,
    })

    expect(screen.getByTestId('route-graph-pane-context-menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Fit graph to view' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Auto layout' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Redo' })).toBeDisabled()
  })
})
