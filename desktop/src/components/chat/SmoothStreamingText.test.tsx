import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  advanceCodePointIndex,
  getStreamingRevealCount,
  SmoothStreamingText,
} from './SmoothStreamingText'

describe('SmoothStreamingText', () => {
  let callbacks: Map<number, FrameRequestCallback>
  let nextFrameId: number
  let frameTime: number

  beforeEach(() => {
    callbacks = new Map()
    nextFrameId = 1
    frameTime = 0

    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId
      nextFrameId += 1
      callbacks.set(id, callback)
      return id
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
      callbacks.delete(id)
    }))
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function runFrame(elapsedMs = 1000 / 60) {
    const pending = Array.from(callbacks.values())
    callbacks.clear()
    frameTime += elapsedMs
    act(() => {
      pending.forEach((callback) => callback(frameTime))
    })
  }

  it('reveals a network chunk progressively and catches up to the source text', () => {
    const content = 'A response arriving in one uneven chunk'
    const { getByTestId } = render(<SmoothStreamingText content={content} />)
    const text = getByTestId('smooth-streaming-text')

    expect(text.textContent).toBe('')
    runFrame()
    expect(text.textContent?.length).toBeGreaterThan(0)
    expect(text.textContent).not.toBe(content)

    for (let frame = 0; frame < 20 && callbacks.size > 0; frame += 1) runFrame()
    expect(text.textContent).toBe(content)
  })

  it('clears stale text when the stream target is replaced', () => {
    const { getByTestId, rerender } = render(<SmoothStreamingText content="old response" />)
    const text = getByTestId('smooth-streaming-text')
    runFrame()
    expect(text.textContent).not.toBe('')

    rerender(<SmoothStreamingText content="new answer" />)
    expect(text.textContent).toBe('')
    runFrame()
    expect('new answer'.startsWith(text.textContent ?? '')).toBe(true)
  })

  it('keeps the visible prefix when another stream chunk is appended', () => {
    const { getByTestId, rerender } = render(<SmoothStreamingText content="first chunk" />)
    const text = getByTestId('smooth-streaming-text')
    runFrame()
    const visiblePrefix = text.textContent ?? ''

    rerender(<SmoothStreamingText content="first chunk and the rest" />)
    expect(text.textContent).toBe(visiblePrefix)
    runFrame()
    expect(text.textContent?.startsWith(visiblePrefix)).toBe(true)
  })

  it('renders immediately when reduced motion is enabled', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))

    const { getByTestId } = render(<SmoothStreamingText content="full response" />)
    expect(getByTestId('smooth-streaming-text').textContent).toBe('full response')
    expect(callbacks.size).toBe(0)
  })

  it('never splits a Unicode code point while advancing', () => {
    expect(advanceCodePointIndex('🚀abc', 0, 1)).toBe(2)
    expect('🚀abc'.slice(0, advanceCodePointIndex('🚀abc', 0, 1))).toBe('🚀')
  })

  it('adapts reveal speed to backlog while keeping a per-frame bound', () => {
    expect(getStreamingRevealCount(8)).toBe(1)
    expect(getStreamingRevealCount(200)).toBeGreaterThan(getStreamingRevealCount(20))
    expect(getStreamingRevealCount(10_000)).toBe(96)
  })
})
