import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import type { PromptMemoryInsights } from '../../api/promptMemory'
import { EvolutionProfile } from './EvolutionProfile'

const overview: PromptMemoryInsights = {
  insights: [
    {
      id: 'identity-1',
      target: 'user',
      category: 'identity',
      content: 'The user calls CyberCode Zero.',
      raw: '[identity] The user calls CyberCode Zero.',
      source: 'explicit',
    },
    {
      id: 'method-1',
      target: 'brief',
      category: 'meta-method',
      content: 'Discuss ambiguous product behavior before implementation.',
      raw: '[meta-method] Discuss ambiguous product behavior before implementation.',
      source: 'observed',
    },
  ],
  stats: {
    total: 2,
    user: 1,
    methods: 1,
    dimensions: 2,
    automaticUpdates: 2,
  },
}

describe('EvolutionProfile', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('shows user understanding and cross-task methods with provenance', () => {
    render(
      <EvolutionProfile
        overview={overview}
        removingId={null}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    const userHeading = screen.getByRole('heading', { name: 'What CyberCode understands about you' })
    expect(userHeading).toBeInTheDocument()
    expect(userHeading.className).toContain('whitespace-normal')
    expect(userHeading.className).not.toContain('truncate')
    expect(screen.getByText('Ways of working learned')).toBeInTheDocument()
    expect(screen.getByText('Identity & names')).toBeInTheDocument()
    expect(screen.getByText('Meta method')).toBeInTheDocument()
    expect(screen.getByText('Explicit')).toBeInTheDocument()
    expect(screen.getByText('Repeated pattern')).toBeInTheDocument()
  })

  it('passes the selected memory to edit and remove actions', () => {
    const onEdit = vi.fn()
    const onRemove = vi.fn()
    render(
      <EvolutionProfile
        overview={overview}
        removingId={null}
        onEdit={onEdit}
        onRemove={onRemove}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Correct in editor' })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove memory' })[0]!)

    expect(onEdit).toHaveBeenCalledWith(overview.insights[0])
    expect(onRemove).toHaveBeenCalledWith(overview.insights[0])
  })
})
