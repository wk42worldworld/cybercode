import { StrictMode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FloatingThinkingPanel } from './FloatingThinkingPanel'
import { useSettingsStore } from '../../stores/settingsStore'

describe('FloatingThinkingPanel', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('renders streamed thinking content expanded inside the shared chat column', () => {
    const { rerender } = render(
      <FloatingThinkingPanel content="Reading context" isActive identityKey="thinking-a" />,
    )

    const panel = screen.getByTestId('thinking-message-panel')
    expect(panel).toHaveClass('w-full', 'max-w-[878px]')
    expect(panel.className).toContain('rounded-[24px]')
    expect(panel.className).not.toContain('shadow-')
    expect(panel).toHaveAttribute('data-active', 'true')
    expect(panel.parentElement).toHaveAttribute('data-thinking-message-shell')
    expect(panel.parentElement).not.toHaveClass('absolute')
    const header = screen.getByRole('button')
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(header.className).toContain('h-[44px]')
    expect(header.className).toContain('text-center')
    expect(header.className).not.toContain('border-b')
    expect(header.firstElementChild).toHaveAttribute('data-thinking-status')
    expect(header.lastElementChild).toHaveAttribute('data-thinking-disclosure')
    const statusIcon = header.querySelector('[data-thinking-status-icon]')
    expect(statusIcon).toHaveClass('h-4', 'w-4')
    expect(statusIcon?.querySelector('[data-thinking-status-dot]')).toHaveClass('h-2', 'w-2')
    expect(screen.getByTestId('thinking-message-panel-body').className).toContain('border-t')
    expect(screen.getByTestId('thinking-message-panel-title')).not.toHaveClass('ai-shimmer-text')
    expect(screen.getByText('Thinking')).toHaveClass('ai-thinking-sweep-label')
    expect(screen.getByText('Thinking')).toHaveAttribute('data-label', 'Thinking')
    expect(screen.getByText('Reading context')).toBeInTheDocument()

    rerender(
      <FloatingThinkingPanel
        content={"Reading context\nPlanning edits"}
        isActive
        identityKey="thinking-a"
      />,
    )

    expect(screen.getByText(/Planning edits/)).toBeInTheDocument()
  })

  it('coalesces streamed auto-scroll work into one animation frame', () => {
    const animationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation(() => 17)

    const { rerender, unmount } = render(
      <FloatingThinkingPanel content="Reading" isActive identityKey="thinking-scroll" />,
    )

    rerender(
      <FloatingThinkingPanel content="Reading more" isActive identityKey="thinking-scroll" />,
    )
    rerender(
      <FloatingThinkingPanel content="Reading even more" isActive identityKey="thinking-scroll" />,
    )

    expect(animationFrame).toHaveBeenCalledTimes(1)
    unmount()
    animationFrame.mockRestore()
  })

  it('keeps auto-follow scheduled after StrictMode replays effect cleanup', () => {
    const frameCallbacks = new Map<number, FrameRequestCallback>()
    let nextFrameId = 0
    const animationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        nextFrameId += 1
        frameCallbacks.set(nextFrameId, callback)
        return nextFrameId
      })
    const cancelFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((frameId) => {
        frameCallbacks.delete(frameId)
      })

    const { rerender } = render(
      <StrictMode>
        <FloatingThinkingPanel content="Reading" isActive identityKey="thinking-strict" />
      </StrictMode>,
    )
    const body = screen.getByTestId('thinking-message-panel-body')
    let scrollHeight = 220
    Object.defineProperty(body, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })
    Object.defineProperty(body, 'clientHeight', {
      configurable: true,
      value: 100,
    })

    expect(cancelFrame).toHaveBeenCalled()
    expect(frameCallbacks.size).toBe(1)
    const initialFrame = [...frameCallbacks.entries()][0]
    frameCallbacks.delete(initialFrame![0])
    initialFrame![1](0)
    expect(body.scrollTop).toBe(220)

    scrollHeight = 360
    rerender(
      <StrictMode>
        <FloatingThinkingPanel
          content={"Reading\nPlanning\nEditing"}
          isActive
          identityKey="thinking-strict"
        />
      </StrictMode>,
    )

    expect(frameCallbacks.size).toBe(1)
    const updateFrame = [...frameCallbacks.entries()][0]
    frameCallbacks.delete(updateFrame![0])
    updateFrame![1](16)
    expect(body.scrollTop).toBe(360)

    animationFrame.mockRestore()
    cancelFrame.mockRestore()
  })

  it('keeps following appended content after layout-driven scroll events', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })

    const { rerender } = render(
      <FloatingThinkingPanel content="Reading" isActive identityKey="thinking-follow" />,
    )
    const body = screen.getByTestId('thinking-message-panel-body')
    let scrollHeight = 220
    Object.defineProperty(body, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })
    Object.defineProperty(body, 'clientHeight', {
      configurable: true,
      value: 100,
    })

    frameCallbacks.shift()?.(0)
    expect(body.scrollTop).toBe(220)

    scrollHeight = 360
    fireEvent.scroll(body)
    rerender(
      <FloatingThinkingPanel
        content={"Reading\nPlanning\nEditing"}
        isActive
        identityKey="thinking-follow"
      />,
    )

    expect(frameCallbacks).toHaveLength(1)
    frameCallbacks.shift()?.(16)
    expect(body.scrollTop).toBe(360)
    animationFrame.mockRestore()
  })

  it('pauses auto-follow when the user deliberately scrolls upward', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })

    const { rerender } = render(
      <FloatingThinkingPanel content="Reading" isActive identityKey="thinking-manual-scroll" />,
    )
    const body = screen.getByTestId('thinking-message-panel-body')
    Object.defineProperty(body, 'scrollHeight', {
      configurable: true,
      value: 300,
    })
    Object.defineProperty(body, 'clientHeight', {
      configurable: true,
      value: 100,
    })
    frameCallbacks.shift()?.(0)

    fireEvent.wheel(body, { deltaY: -24 })
    body.scrollTop = 120
    fireEvent.scroll(body)
    rerender(
      <FloatingThinkingPanel
        content={"Reading\nPlanning"}
        isActive
        identityKey="thinking-manual-scroll"
      />,
    )

    expect(frameCallbacks).toHaveLength(0)
    expect(body.scrollTop).toBe(120)
    animationFrame.mockRestore()
  })

  it('collapses in place when thinking ends and can be reopened', () => {
    const { rerender } = render(
      <FloatingThinkingPanel content="Short reasoning burst" isActive identityKey="thinking-a" />,
    )

    rerender(
      <FloatingThinkingPanel
        content="Short reasoning burst"
        isActive={false}
        identityKey="thinking-a"
      />,
    )

    const panel = screen.getByTestId('thinking-message-panel')
    expect(panel).toBeInTheDocument()
    expect(panel.className).not.toContain('shadow-')
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('thinking-message-panel-title')).toHaveTextContent('Thinking complete')
    expect(screen.getByRole('button').querySelector('.codicon-pass-filled')).toHaveStyle({
      width: '15px',
      height: '15px',
    })
    expect(screen.queryByTestId('thinking-message-panel-content')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    expect(panel.className).not.toContain('shadow-')
    expect(screen.getByRole('button').className).not.toContain('border-b')
    expect(screen.getByTestId('thinking-message-panel-body').className).toContain('border-t')
    expect(screen.getByText('Short reasoning burst')).toBeInTheDocument()
  })

  it('keeps historical thinking collapsed without animating the title', () => {
    render(
      <FloatingThinkingPanel content="Historical reasoning" isActive={false} identityKey="thinking-old" />,
    )

    expect(screen.getByTestId('thinking-message-panel')).toBeInTheDocument()
    expect(screen.getByTestId('thinking-message-panel').className).not.toContain('shadow-')
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('thinking-message-panel-title')).not.toHaveClass('ai-shimmer-text')
    expect(screen.getByTestId('thinking-message-panel-title')).toHaveTextContent('Thinking complete')
    expect(screen.queryByText('Historical reasoning')).not.toBeInTheDocument()
  })

  it('keeps paragraph breaks while collapsing excessive empty space', () => {
    render(
      <FloatingThinkingPanel
        content={"Read context\n\nCheck files\n\n\n\nPlan edits"}
        isActive
        identityKey="thinking-a"
      />,
    )

    expect(screen.getByTestId('thinking-message-panel-content').textContent).toBe(
      "Read context\n\nCheck files\n\nPlan edits",
    )
  })
})
