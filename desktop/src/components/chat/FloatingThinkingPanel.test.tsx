import { act, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FloatingThinkingPanel } from './FloatingThinkingPanel'

const THINKING_PANEL_GRACE_MS = 3200
const THINKING_PANEL_FADE_MS = 180

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('FloatingThinkingPanel', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders streamed thinking content in a floating panel', () => {
    const { rerender } = render(
      <FloatingThinkingPanel content="Reading context" isActive identityKey="session-a" />,
    )

    expect(screen.getByTestId('floating-thinking-panel')).toBeInTheDocument()
    expect(screen.getByTestId('floating-thinking-panel-title').className).toContain('ai-shimmer-text')
    expect(screen.getByTestId('floating-thinking-panel-title').className).toContain('ai-shimmer-thinking')
    expect(screen.getByText('Reading context')).toBeInTheDocument()

    rerender(
      <FloatingThinkingPanel content={"Reading context\nPlanning edits"} isActive identityKey="session-a" />,
    )

    expect(screen.getByText(/Planning edits/)).toBeInTheDocument()
  })

  it('briefly keeps the last thinking content after the turn becomes idle, then fades out', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <FloatingThinkingPanel content="Short reasoning burst" isActive identityKey="session-a" />,
    )

    rerender(
      <FloatingThinkingPanel content="Short reasoning burst" isActive={false} identityKey="session-a" />,
    )

    advance(THINKING_PANEL_GRACE_MS - 1)
    expect(screen.getByText('Short reasoning burst')).toBeInTheDocument()

    advance(1)
    expect(screen.getByTestId('floating-thinking-panel').className).toContain('opacity-0')

    advance(THINKING_PANEL_FADE_MS)
    expect(screen.queryByTestId('floating-thinking-panel')).not.toBeInTheDocument()
  })

  it('clears immediately when thinking content is dismissed', () => {
    const { rerender } = render(
      <FloatingThinkingPanel content="Stop-sensitive reasoning" isActive identityKey="session-a" />,
    )

    expect(screen.getByText('Stop-sensitive reasoning')).toBeInTheDocument()

    rerender(
      <FloatingThinkingPanel content="" isActive={false} identityKey="session-a" />,
    )

    expect(screen.queryByTestId('floating-thinking-panel')).not.toBeInTheDocument()
  })

  it('keeps paragraph breaks while collapsing excessive empty space', () => {
    render(
      <FloatingThinkingPanel
        content={"Read context\n\nCheck files\n\n\n\nPlan edits"}
        isActive
        identityKey="session-a"
      />,
    )

    expect(screen.getByTestId('floating-thinking-panel-content').textContent).toBe(
      "Read context\n\nCheck files\n\nPlan edits",
    )
  })
})
