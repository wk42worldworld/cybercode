import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '../../../stores/settingsStore'
import type { RouteGraphNode } from '../../../types/routing'
import { RouteGraphInspector } from './RouteGraphInspector'

function conditionNode(condition: 'task' | 'modality', value: string): RouteGraphNode {
  return {
    id: 'condition',
    type: 'routeGraphNode',
    position: { x: 0, y: 0 },
    data: {
      kind: 'condition',
      config: { condition, operator: 'is', value },
    },
  }
}

describe('RouteGraphInspector condition values', () => {
  beforeEach(() => useSettingsStore.setState({ locale: 'en' }))

  it('uses localized choices for image routing instead of a free-form field', async () => {
    const onChange = vi.fn()
    render(<RouteGraphInspector
      node={conditionNode('modality', 'image')}
      sources={[]}
      onChange={onChange}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: 'Value: Image' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Value' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Value: Image' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Audio' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        config: expect.objectContaining({ value: 'audio' }),
      }),
    }))
  })

  it('resets an incompatible value when the condition kind changes', async () => {
    const onChange = vi.fn()
    render(<RouteGraphInspector
      node={conditionNode('task', 'coding')}
      sources={[]}
      onChange={onChange}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Condition: Task type' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Modality' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        config: expect.objectContaining({
          condition: 'modality',
          value: 'image',
        }),
      }),
    }))
  })
})
