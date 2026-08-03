import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '../../../stores/settingsStore'
import type { RouteGraphNode } from '../../../types/routing'
import { RouteGraphInspector } from './RouteGraphInspector'

const distributionNode: RouteGraphNode = {
  id: 'distribution',
  type: 'routeGraphNode',
  position: { x: 0, y: 0 },
  data: {
    kind: 'distribution',
    config: {
      distributionMode: 'round-robin',
      distributionOutputCount: 3,
    },
  },
}

describe('RouteGraphInspector distribution outputs', () => {
  beforeEach(() => useSettingsStore.setState({ locale: 'en' }))

  it('exposes working add and remove controls in node properties', () => {
    const onChange = vi.fn()
    render(<RouteGraphInspector
      node={distributionNode}
      sources={[]}
      onChange={onChange}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />)

    expect(screen.getByRole('status', { name: 'Output branches' })).toHaveTextContent('3')
    fireEvent.click(screen.getByRole('button', { name: 'Add output branch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove last output branch' }))

    expect(onChange).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        config: expect.objectContaining({ distributionOutputCount: 4 }),
      }),
    }))
    expect(onChange).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        config: expect.objectContaining({ distributionOutputCount: 2 }),
      }),
    }))
  })
})
