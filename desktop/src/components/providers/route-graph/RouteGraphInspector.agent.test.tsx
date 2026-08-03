import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '../../../stores/settingsStore'
import type { RouteGraphNode } from '../../../types/routing'
import { RouteGraphInspector } from './RouteGraphInspector'

const initialNode: RouteGraphNode = {
  id: 'agent',
  type: 'routeGraphNode',
  position: { x: 0, y: 0 },
  data: {
    kind: 'agent',
    config: {
      inputPorts: [{ id: 'input', label: 'Input 1', description: '' }],
      outputPorts: [
        { id: 'output-1', label: 'Output 1', description: '' },
        { id: 'output-2', label: 'Output 2', description: '' },
      ],
      instructions: '',
      fallbackOutputPortId: 'output-1',
    },
  },
}

function InspectorHarness({ onNodeChange }: { onNodeChange: (node: RouteGraphNode) => void }) {
  const [node, setNode] = useState(initialNode)
  return (
    <RouteGraphInspector
      node={node}
      sources={[]}
      onClose={vi.fn()}
      onDelete={vi.fn()}
      onChange={(next) => {
        setNode(next)
        onNodeChange(next)
      }}
    />
  )
}

describe('RouteGraphInspector V3 agent ports', () => {
  beforeEach(() => useSettingsStore.setState({ locale: 'en' }))

  it('adds, renames and removes ports without changing surviving ids', () => {
    const onNodeChange = vi.fn()
    render(<InspectorHarness onNodeChange={onNodeChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add input' }))
    let next = onNodeChange.mock.calls.at(-1)?.[0] as RouteGraphNode
    expect(next.data.config.inputPorts?.map((port) => port.id)).toEqual(['input', 'input-2'])

    fireEvent.change(screen.getByRole('textbox', { name: 'Input ports 1 Port name' }), {
      target: { value: 'Task' },
    })
    next = onNodeChange.mock.calls.at(-1)?.[0] as RouteGraphNode
    expect(next.data.config.inputPorts?.[0]).toMatchObject({ id: 'input', label: 'Task' })

    fireEvent.click(screen.getByRole('button', { name: 'Add output' }))
    expect(screen.getByRole('button', { name: 'Remove “Output 1” port' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove “Output 1” port' }))
    next = onNodeChange.mock.calls.at(-1)?.[0] as RouteGraphNode

    expect(next.data.config.outputPorts?.map((port) => port.id)).toEqual([
      'output-2',
      'output-3',
    ])
    expect(next.data.config.fallbackOutputPortId).toBe('output-2')
  })
})
