import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateNodeInternals = vi.hoisted(() => vi.fn())

vi.mock('@xyflow/react', () => ({
  Handle: ({ id, type }: { id: string; type: string }) => (
    <span data-testid={`${type}-handle`} data-handle-id={id} />
  ),
  Position: { Left: 'left', Right: 'right' },
  useUpdateNodeInternals: () => updateNodeInternals,
}))

import { useSettingsStore } from '../../../stores/settingsStore'
import { RouteGraphNodeView } from './RouteGraphNode'

describe('RouteGraphNode routing agent', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    updateNodeInternals.mockClear()
  })

  it('renders stable dynamic input and output handles', () => {
    const props = {
      id: 'agent-router',
      type: 'routeGraphNode',
      selected: false,
      dragging: false,
      zIndex: 0,
      isConnectable: true,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
      data: {
        kind: 'agent',
        config: {
          inputPorts: [
            { id: 'request', label: 'Request', description: '' },
            { id: 'context', label: 'Context', description: '' },
          ],
          outputPorts: [
            { id: 'simple', label: 'Simple', description: '' },
            { id: 'standard', label: 'Standard', description: '' },
            { id: 'complex', label: 'Complex', description: '' },
          ],
          instructions: 'Choose an output.',
          fallbackOutputPortId: 'standard',
          confidenceThreshold: 0.6,
          timeoutMs: 8_000,
          maxInputChars: 4_000,
        },
      },
    } as unknown as Parameters<typeof RouteGraphNodeView>[0]

    render(<RouteGraphNodeView {...props} />)

    expect(screen.getAllByTestId('target-handle').map((handle) => (
      handle.getAttribute('data-handle-id')
    ))).toEqual(['input:request', 'input:context'])
    expect(screen.getAllByTestId('source-handle').map((handle) => (
      handle.getAttribute('data-handle-id')
    ))).toEqual(['output:simple', 'output:standard', 'output:complex', 'output:__spare__'])
    expect(screen.getByText('Request')).toBeInTheDocument()
    expect(screen.getByText('Context')).toBeInTheDocument()
    expect(screen.getByText('Simple')).toBeInTheDocument()
    expect(screen.getAllByText('Standard')).toHaveLength(2)
    expect(screen.getByText('Complex')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Instructions' }))
      .toHaveValue('Choose an output.')
    expect(updateNodeInternals).toHaveBeenCalledWith('agent-router')
  })

  it('edits instructions on the node and refreshes handles after adding an output', () => {
    const onConfigChange = vi.fn()
    const props = {
      id: 'agent-router',
      type: 'routeGraphNode',
      selected: false,
      dragging: false,
      zIndex: 0,
      isConnectable: true,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
      data: {
        kind: 'agent',
        config: {
          inputPorts: [{ id: 'request', label: 'Request', description: '' }],
          outputPorts: [
            { id: 'first', label: 'First', description: '' },
            { id: 'second', label: 'Second', description: '' },
          ],
          instructions: '',
          fallbackOutputPortId: 'first',
        },
        onConfigChange,
      },
    } as unknown as Parameters<typeof RouteGraphNodeView>[0]
    const { rerender } = render(<RouteGraphNodeView {...props} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Instructions' }), {
      target: { value: 'Choose an output according to task difficulty.' },
    })
    expect(onConfigChange).toHaveBeenCalledWith({
      instructions: 'Choose an output according to task difficulty.',
    })

    updateNodeInternals.mockClear()
    const nextProps = {
      ...props,
      data: {
        ...props.data,
        config: {
          ...props.data.config,
          outputPorts: [
            ...(props.data.config.outputPorts ?? []),
            { id: 'third', label: 'Third', description: '' },
          ],
        },
      },
    }
    rerender(<RouteGraphNodeView {...nextProps} />)

    expect(screen.getAllByTestId('source-handle').map((handle) => (
      handle.getAttribute('data-handle-id')
    ))).toEqual(['output:first', 'output:second', 'output:third', 'output:__spare__'])
    expect(updateNodeInternals).toHaveBeenCalledWith('agent-router')
  })

  it('hides the spare output handle once six ports are used', () => {
    const props = {
      id: 'agent-router',
      type: 'routeGraphNode',
      selected: false,
      dragging: false,
      zIndex: 0,
      isConnectable: true,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
      data: {
        kind: 'agent',
        config: {
          inputPorts: [{ id: 'request', label: 'Request', description: '' }],
          outputPorts: ['one', 'two', 'three', 'four', 'five', 'six'].map((id) => ({
            id,
            label: id,
            description: '',
          })),
          instructions: 'Choose an output.',
          fallbackOutputPortId: 'one',
        },
      },
    } as unknown as Parameters<typeof RouteGraphNodeView>[0]

    render(<RouteGraphNodeView {...props} />)

    expect(screen.getAllByTestId('source-handle').map((handle) => (
      handle.getAttribute('data-handle-id')
    ))).toEqual([
      'output:one',
      'output:two',
      'output:three',
      'output:four',
      'output:five',
      'output:six',
    ])
  })
})
