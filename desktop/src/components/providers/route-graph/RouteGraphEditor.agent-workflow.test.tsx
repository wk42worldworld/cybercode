import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection, Edge } from '@xyflow/react'

const flowHarness = vi.hoisted(() => ({ current: null as any }))

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    Background: () => null,
    Controls: () => null,
    ReactFlow: (props: {
      nodes: any[]
      edges: Edge[]
      children?: ReactNode
      onConnect?: (connection: Connection) => void
      isValidConnection?: (connection: Connection | Edge) => boolean
      onNodeClick?: (event: React.MouseEvent, node: any) => void
    }) => {
      flowHarness.current = props
      return (
        <div data-testid="mock-route-flow" data-edge-count={props.edges.length}>
          {props.nodes.map((node) => (
            <button
              type="button"
              key={node.id}
              aria-label={`Select ${node.data.kind} ${node.id}`}
              onClick={(event) => props.onNodeClick?.(event, node)}
            >
              {node.data.kind}
            </button>
          ))}
          {props.children}
        </div>
      )
    },
  }
})

vi.mock('./RouteGraphLibrary', () => ({
  RouteGraphLibrary: ({
    open,
    onAddNode,
  }: {
    open: boolean
    onAddNode: (kind: 'agent') => void
  }) => (
    <aside data-testid="route-graph-library" data-open={String(open)}>
      <div className="route-graph-node-palette">
        <button
          type="button"
          data-route-node-kind="agent"
          onClick={() => onAddNode('agent')}
        >
          Agent
        </button>
      </div>
    </aside>
  ),
}))

import { useSettingsStore } from '../../../stores/settingsStore'
import type {
  RouteGraph,
  RouteGraphNode,
  RouteProfile,
  RoutingSource,
} from '../../../types/routing'
import {
  createEmptyRouteGraph,
  createRouteGraphEdge,
  createRouteGraphNode,
} from '../../../utils/routeGraph'
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

function configuredModel(
  modelId: string,
  position: { x: number; y: number },
  usedIds: string[],
): RouteGraphNode {
  const model = createRouteGraphNode('model', position, usedIds)
  model.data.config = {
    ...model.data.config,
    providerId: source.providerId,
    modelId,
  }
  return model
}

function editableGraph(): RouteGraph {
  const empty = createEmptyRouteGraph()
  const usedIds = empty.nodes.map((node) => node.id)
  const firstModel = configuredModel('model-a', { x: 500, y: 80 }, usedIds)
  const secondModel = configuredModel(
    'model-b',
    { x: 500, y: 280 },
    [...usedIds, firstModel.id],
  )
  return {
    version: 1,
    nodes: [empty.nodes[0]!, firstModel, secondModel, empty.nodes[1]!],
    edges: [],
  }
}

function profile(graph: RouteGraph): RouteProfile {
  return {
    id: 'agent-workflow',
    name: 'Agent workflow',
    enabled: false,
    strategy: 'priority',
    strictFree: false,
    allowExperimental: false,
    maxAttempts: 4,
    targets: [],
    draftGraph: graph,
  }
}

function editorProps(graph = editableGraph()) {
  return {
    profile: profile(graph),
    sources: [source],
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

function currentNode(kind: RouteGraphNode['data']['kind'], index = 0): RouteGraphNode {
  return flowHarness.current.nodes.filter((node: RouteGraphNode) => (
    node.data.kind === kind
  ))[index]
}

function currentAgent(): RouteGraphNode {
  return currentNode('agent')
}

function connect(connection: Connection) {
  expect(flowHarness.current.isValidConnection?.(connection)).toBe(true)
  act(() => flowHarness.current.onConnect?.(connection))
}

function selectInspectorOption(label: string, value: string) {
  const trigger = document.querySelector<HTMLButtonElement>(
    `button[data-route-select-label="${label}"]`,
  )
  expect(trigger).not.toBeNull()
  fireEvent.click(trigger!)
  const option = document.body.querySelector<HTMLElement>(
    `[role="option"][data-value="${value}"]`,
  )
  expect(option).not.toBeNull()
  fireEvent.click(option!)
}

function portRegion(regionName: 'Input ports' | 'Output ports'): HTMLElement {
  const region = document.querySelector<HTMLElement>(
    `.route-graph-agent-ports[aria-label="${regionName}"]`,
  )
  expect(region).not.toBeNull()
  return region!
}

function addPort(regionName: 'Input ports' | 'Output ports') {
  fireEvent.click(portRegion(regionName).querySelector<HTMLButtonElement>(
    '.route-graph-agent-port-add',
  )!)
}

function removeLastPort(regionName: 'Input ports' | 'Output ports') {
  const removeButtons = portRegion(regionName).querySelectorAll<HTMLButtonElement>(
    '.route-graph-agent-port-remove',
  )
  fireEvent.click(removeButtons[removeButtons.length - 1]!)
}

function inspectorField(ariaLabel: string): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>(
    `.route-graph-inspector [aria-label="${ariaLabel}"]`,
  )
  expect(field).not.toBeNull()
  return field!
}

function toolbarButton(ariaLabel: 'Undo' | 'Redo'): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `.route-graph-toolbar button[aria-label="${ariaLabel}"]`,
  )
  expect(button).not.toBeNull()
  return button!
}

function agentGraph(instructions: string): RouteGraph {
  const graph = editableGraph()
  const usedIds = graph.nodes.map((node) => node.id)
  const agent = createRouteGraphNode('agent', { x: 280, y: 180 }, usedIds)
  agent.data.config = {
    ...agent.data.config,
    instructions,
  }
  const start = graph.nodes.find((node) => node.data.kind === 'start')!
  const output = graph.nodes.find((node) => node.data.kind === 'output')!
  const models = graph.nodes.filter((node) => node.data.kind === 'model')
  const edges: RouteGraph['edges'] = []
  const appendEdge = (
    sourceId: string,
    targetId: string,
    sourceHandle: string,
    targetHandle: string,
  ) => {
    edges.push(createRouteGraphEdge(
      sourceId,
      targetId,
      sourceHandle,
      targetHandle,
      edges.map((edge) => edge.id),
    ))
  }
  appendEdge(start.id, agent.id, 'flow', 'input:input')
  appendEdge(agent.id, models[0]!.id, 'output:output-1', 'input')
  appendEdge(agent.id, models[1]!.id, 'output:output-2', 'input')
  appendEdge(models[0]!.id, output.id, 'success', 'input')
  appendEdge(models[1]!.id, output.id, 'success', 'input')
  return { version: 3, nodes: [start, agent, ...models, output], edges }
}

describe('RouteGraphEditor agent workflow', () => {
  beforeEach(() => {
    flowHarness.current = null
    useSettingsStore.setState({ locale: 'en' })
  })

  it('keeps a user-created dynamic agent runnable through editing, wiring and publishing', async () => {
    const props = editorProps()
    render(<RouteGraphEditor {...props} />)

    fireEvent.click(document.querySelector<HTMLButtonElement>(
      '.route-graph-node-palette [data-route-node-kind="agent"]',
    )!)

    expect(currentAgent().data.config.inputPorts).toHaveLength(1)
    expect(currentAgent().data.config.outputPorts).toHaveLength(2)

    for (let count = 1; count < 6; count += 1) {
      addPort('Input ports')
    }
    expect(currentAgent().data.config.inputPorts?.map((port) => port.id)).toEqual([
      'input', 'input-2', 'input-3', 'input-4', 'input-5', 'input-6',
    ])
    expect(portRegion('Input ports').querySelector('.route-graph-agent-port-add'))
      .toBeDisabled()
    for (let count = 6; count > 1; count -= 1) removeLastPort('Input ports')
    expect(portRegion('Input ports').querySelector('.route-graph-agent-port-remove'))
      .toBeDisabled()

    for (let count = 2; count < 6; count += 1) {
      addPort('Output ports')
    }
    expect(currentAgent().data.config.outputPorts?.map((port) => port.id)).toEqual([
      'output-1', 'output-2', 'output-3', 'output-4', 'output-5', 'output-6',
    ])
    expect(portRegion('Output ports').querySelector('.route-graph-agent-port-add'))
      .toBeDisabled()
    for (let count = 6; count > 2; count -= 1) removeLastPort('Output ports')
    expect(Array.from(portRegion('Output ports').querySelectorAll<HTMLButtonElement>(
      '.route-graph-agent-port-remove',
    )).every((button) => button.disabled)).toBe(true)

    fireEvent.change(inspectorField('Input ports 1 Port name'), {
      target: { value: 'User task' },
    })
    fireEvent.change(inspectorField('Input ports 1 Optional description'), {
      target: { value: 'The request to classify' },
    })
    fireEvent.change(inspectorField('Output ports 1 Port name'), {
      target: { value: 'Quick model' },
    })
    fireEvent.change(inspectorField('Output ports 2 Port name'), {
      target: { value: 'Deep model' },
    })
    fireEvent.change(document.querySelector<HTMLTextAreaElement>(
      '.route-graph-inspector textarea',
    )!, {
      target: { value: 'Choose the best model for the task difficulty.' },
    })

    const start = currentNode('start')
    const output = currentNode('output')
    const models = [currentNode('model', 0), currentNode('model', 1)]
    let agent = currentAgent()
    const primaryInput: Connection = {
      source: start.id,
      target: agent.id,
      sourceHandle: 'flow',
      targetHandle: 'input:input',
    }
    connect(primaryInput)

    addPort('Input ports')
    agent = currentAgent()
    connect({
      source: start.id,
      target: agent.id,
      sourceHandle: 'flow',
      targetHandle: 'input:input-2',
    })
    expect(flowHarness.current.edges.filter((edge: Edge) => edge.target === agent.id)).toHaveLength(2)
    removeLastPort('Input ports')
    expect(flowHarness.current.edges.filter((edge: Edge) => edge.target === agent.id)).toHaveLength(1)

    fireEvent.click(toolbarButton('Undo'))
    expect(currentAgent().data.config.inputPorts).toHaveLength(2)
    expect(flowHarness.current.edges.filter((edge: Edge) => edge.target === agent.id)).toHaveLength(2)
    fireEvent.click(toolbarButton('Redo'))
    expect(currentAgent().data.config.inputPorts).toHaveLength(1)
    expect(flowHarness.current.edges.filter((edge: Edge) => edge.target === agent.id)).toHaveLength(1)

    fireEvent.click(document.querySelector<HTMLButtonElement>(
      `[aria-label="Select agent ${agent.id}"]`,
    )!)
    addPort('Output ports')
    selectInspectorOption('Fallback output', 'output-3')
    connect({
      source: agent.id,
      target: output.id,
      sourceHandle: 'output:output-3',
      targetHandle: 'input',
    })
    expect(currentAgent().data.config.fallbackOutputPortId).toBe('output-3')
    fireEvent.click(document.querySelector<HTMLButtonElement>(
      '[aria-label="Remove “Output 3” port"]',
    )!)
    expect(currentAgent().data.config.fallbackOutputPortId).toBe('output-1')
    expect(flowHarness.current.edges.some((edge: Edge) => (
      edge.data?.sourcePortId === 'output-3'
    ))).toBe(false)

    const firstChoice: Connection = {
      source: agent.id,
      target: models[0]!.id,
      sourceHandle: 'output:output-1',
      targetHandle: 'input',
    }
    connect(firstChoice)
    expect(flowHarness.current.isValidConnection?.(firstChoice)).toBe(false)
    const edgeCount = flowHarness.current.edges.length
    act(() => flowHarness.current.onConnect?.(firstChoice))
    expect(flowHarness.current.edges).toHaveLength(edgeCount)

    connect({
      source: agent.id,
      target: models[1]!.id,
      sourceHandle: 'output:output-2',
      targetHandle: 'input',
    })
    for (const model of models) {
      connect({
        source: model.id,
        target: output.id,
        sourceHandle: 'success',
        targetHandle: 'input',
      })
    }

    await waitFor(() => {
      const saved = props.onSaveDraft.mock.calls.at(-1)?.[0] as RouteGraph | undefined
      expect(saved?.version).toBe(3)
      expect(saved?.nodes.find((node) => node.id === agent.id)?.data.config.instructions)
        .toBe('Choose the best model for the task difficulty.')
      expect(saved?.edges).toHaveLength(5)
    }, { timeout: 3_000 })

    fireEvent.click(document.querySelector<HTMLButtonElement>('.route-graph-publish-button')!)
    await waitFor(() => expect(props.onPublish).toHaveBeenCalledWith(
      expect.objectContaining({ version: 3 }),
      'Agent workflow',
    ))
  }, 15_000)

  it('explains a missing agent prompt before publishing and never calls the API', () => {
    const props = editorProps(agentGraph(''))
    render(<RouteGraphEditor {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(props.onPublish).not.toHaveBeenCalled()
    expect(screen.getByText('Publishing blocked')).toBeInTheDocument()
    expect(screen.getByText(
      'Add instructions that tell this agent what to do and how to select an output.',
    )).toBeInTheDocument()
  }, 15_000)
})
