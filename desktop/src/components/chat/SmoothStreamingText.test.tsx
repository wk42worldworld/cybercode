import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  advanceCodePointIndex,
  getGraphemeBoundaries,
  getStreamingRevealCount,
  getStreamingRevealRate,
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
    const { getByTestId, rerender } = render(<SmoothStreamingText content={content} />)
    const text = getByTestId('smooth-streaming-text')

    expect(text.textContent).toBe('')
    runFrame()
    expect(text.textContent?.length).toBeGreaterThan(0)
    expect(text.textContent).not.toBe(content)

    rerender(<SmoothStreamingText content={content} onCaughtUp={() => {}} />)
    for (let frame = 0; frame < 120 && callbacks.size > 0; frame += 1) runFrame()
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

  it('never splits a joined emoji or combining grapheme', () => {
    const family = '👨‍👩‍👧‍👦'
    expect(`${family}abc`.slice(0, advanceCodePointIndex(`${family}abc`, 0, 1))).toBe(family)
    expect(getGraphemeBoundaries('éx')).toEqual([0, 2, 3])
  })

  it('holds an unfinished grapheme until a following grapheme makes it stable', () => {
    const { getByTestId, rerender } = render(<SmoothStreamingText content="e" />)
    const text = getByTestId('smooth-streaming-text')

    expect(callbacks.size).toBe(0)
    expect(text.textContent).toBe('')

    rerender(<SmoothStreamingText content={'éx'} />)
    runFrame()
    expect(text.textContent).toBe('é')

    rerender(<SmoothStreamingText content={'éx'} onCaughtUp={() => {}} />)
    for (let frame = 0; frame < 20 && callbacks.size > 0; frame += 1) runFrame()
    expect(text.textContent).toBe('éx')
  })

  it('keeps one text node alive while appending every visible suffix', () => {
    const content = 'A stable prefix should never be replaced while this tail keeps growing.'
    const { getByTestId } = render(
      <SmoothStreamingText content={content} onCaughtUp={() => {}} />,
    )
    const text = getByTestId('smooth-streaming-text')

    runFrame()
    const stableTextNode = text.firstChild
    expect(stableTextNode?.nodeType).toBe(Node.TEXT_NODE)

    for (let frame = 0; frame < 30 && callbacks.size > 0; frame += 1) {
      runFrame()
      expect(text.firstChild).toBe(stableTextNode)
    }
  })

  it('adapts reveal speed without dumping a network chunk into one frame', () => {
    expect(getStreamingRevealCount(8)).toBe(1)
    expect(getStreamingRevealCount(200)).toBeGreaterThan(getStreamingRevealCount(20))
    expect(getStreamingRevealCount(10_000)).toBe(6)
    expect(getStreamingRevealCount(10_000, 1000, true)).toBe(8)
    expect(getStreamingRevealRate(200)).toBeGreaterThan(getStreamingRevealRate(20))
  })

  it('only appends a monotonic prefix even when the source arrives all at once', () => {
    const content = '0123456789'.repeat(40)
    const { getByTestId } = render(<SmoothStreamingText content={content} />)
    const text = getByTestId('smooth-streaming-text')
    let previous = ''

    for (let frame = 0; frame < 18; frame += 1) {
      runFrame()
      const visible = text.textContent ?? ''
      expect(content.startsWith(visible)).toBe(true)
      expect(visible.startsWith(previous)).toBe(true)
      expect(visible.length - previous.length).toBeLessThanOrEqual(6)
      previous = visible
    }
  })

  it('notifies completion only after the visible cursor reaches the target', () => {
    const onCaughtUp = vi.fn()
    const content = 'ordered reveal'
    const { getByTestId } = render(
      <SmoothStreamingText content={content} onCaughtUp={onCaughtUp} />,
    )

    runFrame()
    expect(getByTestId('smooth-streaming-text').textContent).not.toBe(content)
    expect(onCaughtUp).not.toHaveBeenCalled()

    for (let frame = 0; frame < 60 && callbacks.size > 0; frame += 1) runFrame()
    expect(getByTestId('smooth-streaming-text').textContent).toBe(content)
    expect(onCaughtUp).toHaveBeenCalledTimes(1)
  })
})
