import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThinkingIndicator } from './ThinkingIndicator'

const LINE_HOLD_MS = 1200
const FADE_MS = 160

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

const expectClass = (element: HTMLElement, className: string) => {
  expect(element.className).toContain(className)
}

describe('ThinkingIndicator', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows one full line immediately, holds it, fades out, then fades in the next line', () => {
    vi.useFakeTimers()
    render(<ThinkingIndicator content={"First line\nSecond line"} />)

    const line = screen.getByTestId('thinking-line-content')

    expect(line.textContent).toBe('First line')
    expectClass(line, 'opacity-100')

    advance(LINE_HOLD_MS - 1)
    expect(line.textContent).toBe('First line')
    expectClass(line, 'opacity-100')

    advance(1)
    expect(line.textContent).toBe('First line')
    expectClass(line, 'opacity-0')

    advance(FADE_MS)
    expect(line.textContent).toBe('Second line')
    expectClass(line, 'opacity-100')
  })

  it('does not restart the current line timer while streamed content keeps appending', () => {
    vi.useFakeTimers()
    const { rerender } = render(<ThinkingIndicator content={"First line\nSecond line"} />)

    const line = screen.getByTestId('thinking-line-content')

    advance(400)
    rerender(<ThinkingIndicator content={"First line updated\nSecond line"} />)

    advance(400)
    rerender(<ThinkingIndicator content={"First line updated again\nSecond line"} />)

    advance(399)
    expect(line.textContent).toBe('First line updated again')
    expectClass(line, 'opacity-100')

    advance(1)
    expectClass(line, 'opacity-0')

    advance(FADE_MS)
    expect(line.textContent).toBe('Second line')
    expectClass(line, 'opacity-100')
  })

  it('keeps the last available line visible while waiting for more streamed lines', () => {
    vi.useFakeTimers()
    const { rerender } = render(<ThinkingIndicator content="Only line so far" />)

    const line = screen.getByTestId('thinking-line-content')

    expect(line.textContent).toBe('Only line so far')

    advance(LINE_HOLD_MS + 1000)
    expect(line.textContent).toBe('Only line so far')

    rerender(<ThinkingIndicator content={"Only line so far\nSecond line"} />)
    expect(line.textContent).toBe('Only line so far')

    advance(LINE_HOLD_MS)
    expectClass(line, 'opacity-0')

    advance(FADE_MS)
    expect(line.textContent).toBe('Second line')
    expectClass(line, 'opacity-100')
  })

  it('resets line playback for a new thinking message', () => {
    vi.useFakeTimers()
    const { rerender } = render(<ThinkingIndicator content="Review the current message" />)

    const line = screen.getByTestId('thinking-line-content')

    expect(line.textContent).toBe('Review the current message')

    rerender(<ThinkingIndicator content="Open a different investigation path" />)

    expect(line.textContent).toBe('Open a different investigation path')
    expectClass(line, 'opacity-100')
  })

  it('splits long single-line thinking content into readable line segments', () => {
    vi.useFakeTimers()
    const longContent = `Start with the active session ${'and keep reading '.repeat(12)}final-marker`

    render(<ThinkingIndicator content={longContent} />)

    const viewport = screen.getByTestId('thinking-line-viewport')
    const segments = viewport.getAttribute('title')?.split('\n') ?? []

    expect(segments.some((segment) => segment.includes('final-marker'))).toBe(true)
    expect(segments.every((segment) => segment.length <= 76)).toBe(true)
  })

  it('merges tiny trailing split fragments back into the previous line', () => {
    vi.useFakeTimers()
    const longContent = `${'a'.repeat(64)} tail`

    render(<ThinkingIndicator content={longContent} />)

    const viewport = screen.getByTestId('thinking-line-viewport')
    const segments = viewport.getAttribute('title')?.split('\n') ?? []

    expect(segments).toHaveLength(1)
    const segment = segments[0] ?? ''
    expect(segment).toContain('tail')
    expect(segment.length).toBeGreaterThan(64)
  })
})
