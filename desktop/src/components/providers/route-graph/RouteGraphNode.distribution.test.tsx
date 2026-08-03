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

function distributionProps(
  outputCount: number,
  onConfigChange = vi.fn(),
) {
  return {
    id: 'distribution',
    type: 'routeGraphNode',
    selected: false,
    dragging: false,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: {
      kind: 'distribution',
      config: {
        distributionMode: 'round-robin',
        distributionOutputCount: outputCount,
      },
      connectedOutputs: outputCount,
      onConfigChange,
    },
  } as unknown as Parameters<typeof RouteGraphNodeView>[0]
}

function conditionProps(onConfigChange = vi.fn()) {
  return {
    id: 'condition',
    type: 'routeGraphNode',
    selected: false,
    dragging: false,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: {
      kind: 'condition',
      config: {
        condition: 'modality',
        operator: 'is',
        value: 'image',
      },
      onConfigChange,
    },
  } as unknown as Parameters<typeof RouteGraphNodeView>[0]
}

describe('RouteGraphNode distribution pins', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    updateNodeInternals.mockClear()
  })

  it('renders one manually configured pin per output branch', () => {
    render(<RouteGraphNodeView {...distributionProps(3)} />)

    expect(screen.getAllByTestId('source-handle').map((handle) => (
      handle.getAttribute('data-handle-id')
    ))).toEqual(['dist:1', 'dist:2', 'dist:3'])
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByLabelText('Output branches')).toHaveTextContent('3')
    expect(screen.getByRole('button', { name: 'Add output branch' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Remove last output branch' })).toBeEnabled()
  })

  it('keeps two connectable pins at the minimum', () => {
    render(<RouteGraphNodeView {...distributionProps(2)} />)

    expect(screen.getAllByTestId('source-handle').map((handle) => (
      handle.getAttribute('data-handle-id')
    ))).toEqual(['dist:1', 'dist:2'])
    expect(screen.getByRole('button', { name: 'Remove last output branch' })).toBeDisabled()
  })

  it('refreshes node internals when the pin count changes', () => {
    const { rerender } = render(<RouteGraphNodeView {...distributionProps(2)} />)
    updateNodeInternals.mockClear()

    rerender(<RouteGraphNodeView {...distributionProps(3)} />)
    expect(updateNodeInternals).toHaveBeenCalledWith('distribution')
  })

  it('requests output count changes from the visible stepper', () => {
    const onConfigChange = vi.fn()
    render(<RouteGraphNodeView {...distributionProps(3, onConfigChange)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add output branch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove last output branch' }))

    expect(onConfigChange).toHaveBeenNthCalledWith(1, { distributionOutputCount: 4 })
    expect(onConfigChange).toHaveBeenNthCalledWith(2, { distributionOutputCount: 2 })
  })
})

describe('RouteGraphNode condition values', () => {
  beforeEach(() => useSettingsStore.setState({ locale: 'en' }))

  it('offers image modality as a localized inline choice', async () => {
    const onConfigChange = vi.fn()
    render(<RouteGraphNodeView {...conditionProps(onConfigChange)} />)

    expect(screen.getByRole('button', { name: 'Value: Image' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Value: Image' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Text' }))

    expect(onConfigChange).toHaveBeenCalledWith({ value: 'text' })
  })
})
