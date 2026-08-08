import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { MessageAnchorRail, type MessageAnchor } from './MessageAnchorRail'

function makeAnchors(count: number): MessageAnchor[] {
  return Array.from({ length: count }, (_, i) => ({
    seq: i,
    itemIndex: i * 3,
    id: `msg-${i}`,
    preview: `Question ${i}`,
    answerPreview: `Answer ${i}`,
    loaded: true,
  }))
}

function rectForHeight(height: number): DOMRect {
  return {
    width: 20,
    height,
    top: 0,
    left: 10,
    right: 30,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}

describe('MessageAnchorRail', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>
  let rafCallbacks: FrameRequestCallback[]

  const flushFrames = (max = 60) => {
    for (let i = 0; i < max && rafCallbacks.length > 0; i++) {
      const cbs = rafCallbacks
      rafCallbacks = []
      cbs.forEach((cb) => cb(0))
    }
  }

  beforeEach(() => {
    rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(rectForHeight(400))
    rafCallbacks = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    if (typeof window.PointerEvent !== 'function') {
      vi.stubGlobal('PointerEvent', MouseEvent)
    }
  })

  afterEach(() => {
    rectSpy.mockRestore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders only an invisible measurement container when there are fewer than 3 anchors', () => {
    render(
      <MessageAnchorRail anchors={makeAnchors(2)} visibleRange={null} onJump={() => {}} />,
    )
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByTestId('message-anchor-rail-hidden')).toBeInTheDocument()
  })

  it('keeps the rail above the floating chat composer', () => {
    render(
      <MessageAnchorRail
        anchors={makeAnchors(4)}
        visibleRange={null}
        bottomInset={112}
        onJump={() => {}}
      />,
    )

    expect(screen.getByTestId('message-anchor-rail').style.bottom).toBe('112px')
    expect(screen.getByTestId('message-anchor-rail')).toHaveStyle({ left: '10px', width: '20px' })
  })

  it('appears when anchors grow past the threshold after the initial render', () => {
    const { rerender } = render(
      <MessageAnchorRail anchors={makeAnchors(2)} visibleRange={null} onJump={() => {}} />,
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    rerender(
      <MessageAnchorRail anchors={makeAnchors(4)} visibleRange={null} onJump={() => {}} />,
    )
    expect(screen.getByRole('navigation')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(4)
  })

  it('keeps navigation rows stable when transcript anchors share a message id', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const anchors = makeAnchors(4)
    anchors[1] = { ...anchors[1]!, id: anchors[0]!.id }

    render(
      <MessageAnchorRail anchors={anchors} visibleRange={null} onJump={() => {}} />,
    )

    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('same key')
    expect(screen.getAllByRole('button')).toHaveLength(4)
    consoleError.mockRestore()
  })

  it('renders nothing when the container is shorter than 120px', () => {
    rectSpy.mockReturnValue(rectForHeight(100))
    render(
      <MessageAnchorRail anchors={makeAnchors(5)} visibleRange={null} onJump={() => {}} />,
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('renders one bar per anchor on an even 12px pitch, vertically centered', () => {
    render(
      <MessageAnchorRail anchors={makeAnchors(5)} visibleRange={null} onJump={() => {}} />,
    )
    expect(screen.getByTestId('message-anchor-rail')).toBeInTheDocument()
    const rows = Array.from({ length: 5 }, (_, i) => screen.getByTestId(`message-anchor-row-msg-${i}`))
    // group = 5 * 12 = 60, top = (400 - 60) / 2 = 170
    rows.forEach((row, i) => {
      expect(row.style.top).toBe(`${170 + i * 12}px`)
      expect(row.style.height).toBe('12px')
    })
    for (let i = 0; i < 5; i++) {
      expect(screen.getByTestId(`message-anchor-msg-${i}`)).toBeInTheDocument()
    }
  })

  it('thins out bars when anchors exceed capacity and keeps the first and last', () => {
    render(
      <MessageAnchorRail anchors={makeAnchors(80)} visibleRange={null} onJump={() => {}} />,
    )
    const buttons = screen.getAllByRole('button')
    // 400px height: floor((400-16)/12) = 32 < 80 -> pitch 8 -> floor(384/8) = 48
    expect(buttons.length).toBe(48)
    expect(buttons.length).toBeLessThanOrEqual(60)
    expect(screen.getByTestId('message-anchor-msg-0')).toBeInTheDocument()
    expect(screen.getByTestId('message-anchor-msg-79')).toBeInTheDocument()
    // rows retain an 8px compressed pitch when history exceeds capacity
    expect(screen.getByTestId('message-anchor-row-msg-0').style.height).toBe('8px')
  })

  it('keeps out-of-viewport and in-viewport bars visually subdued', () => {
    render(
      <MessageAnchorRail
        anchors={makeAnchors(4)}
        visibleRange={{ start: 3, end: 7 }}
        onJump={() => {}}
      />,
    )
    expect(screen.getByTestId('message-anchor-bar-msg-1').style.opacity).toBe('0.64') // itemIndex 3
    expect(screen.getByTestId('message-anchor-bar-msg-3').style.opacity).toBe('0.4') // itemIndex 9
    expect(screen.getByTestId('message-anchor-bar-msg-1').style.width).toBe('7px')
    expect(screen.getByTestId('message-anchor-bar-msg-1').style.height).toBe('3px')
    expect(screen.getByTestId('message-anchor-bar-msg-1').className).toContain('bg-[var(--color-outline)]')
  })

  it('calls onJump with the anchor when a bar is clicked', () => {
    const onJump = vi.fn()
    render(
      <MessageAnchorRail anchors={makeAnchors(4)} visibleRange={null} onJump={onJump} />,
    )
    const selectedButton = screen.getByTestId('message-anchor-msg-2')
    fireEvent.click(selectedButton)
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-2', itemIndex: 6 }))
    expect(selectedButton).toHaveAttribute('aria-current', 'location')
    expect(screen.getByTestId('message-anchor-bar-msg-2').style.backgroundColor).toBe('rgb(0, 0, 0)')
    expect(screen.getByTestId('message-anchor-bar-msg-2').style.opacity).toBe('1')

    fireEvent.click(screen.getByTestId('message-anchor-msg-3'))
    expect(selectedButton).not.toHaveAttribute('aria-current')
    expect(screen.getByTestId('message-anchor-bar-msg-2').style.backgroundColor).toBe('')
    expect(screen.getByTestId('message-anchor-msg-3')).toHaveAttribute('aria-current', 'location')
    expect(screen.getByTestId('message-anchor-bar-msg-3').style.backgroundColor).toBe('rgb(0, 0, 0)')
  })

  it('dims unloaded anchors below the out-of-view opacity and still emits clicks', () => {
    const onJump = vi.fn()
    const anchors = makeAnchors(4)
    anchors[1] = { ...anchors[1]!, itemIndex: null, loaded: false }
    render(
      <MessageAnchorRail anchors={anchors} visibleRange={null} onJump={onJump} />,
    )
    const unloadedBar = screen.getByTestId('message-anchor-bar-msg-1')
    expect(unloadedBar.style.opacity).toBe('0.22')
    expect(unloadedBar).toHaveAttribute('data-loaded', 'false')
    expect(screen.getByTestId('message-anchor-bar-msg-0')).toHaveAttribute('data-loaded', 'true')
    fireEvent.click(screen.getByTestId('message-anchor-msg-1'))
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-1', itemIndex: null, loaded: false }))
  })

  it('pulses the bar and swaps the tooltip while an anchor is loading', () => {
    const anchors = makeAnchors(4)
    const { rerender } = render(
      <MessageAnchorRail anchors={anchors} visibleRange={null} onJump={() => {}} />,
    )
    const row = screen.getByTestId('message-anchor-row-msg-1')
    fireEvent.pointerEnter(row)
    expect(screen.getByTestId('message-anchor-preview')).toHaveTextContent('Question 1')

    rerender(
      <MessageAnchorRail anchors={anchors} visibleRange={null} loadingAnchorId="msg-1" onJump={() => {}} />,
    )
    expect(screen.getByTestId('message-anchor-bar-msg-1').className).toContain('anchor-bar-loading')
    expect(screen.getByTestId('message-anchor-msg-1')).toHaveAttribute('aria-busy', 'true')
    // The tooltip swaps the preview for the localized loading label.
    expect(screen.getByTestId('message-anchor-preview')).not.toHaveTextContent('Question 1')
    expect(screen.queryByTestId('message-anchor-answer-preview')).not.toBeInTheDocument()
  })

  it('shows the tooltip immediately on hover and hides it on leave', () => {
    render(
      <MessageAnchorRail anchors={makeAnchors(4)} visibleRange={null} onJump={() => {}} />,
    )
    const row = screen.getByTestId('message-anchor-row-msg-1')
    fireEvent.pointerEnter(row)
    expect(screen.getByTestId('message-anchor-preview')).toHaveTextContent('Question 1')
    expect(screen.getByTestId('message-anchor-answer-preview')).toHaveTextContent('Answer 1')
    expect(screen.getByTestId('message-anchor-question-preview').className).toContain('text-[12px]')
    expect(screen.getByTestId('message-anchor-question-preview').className).toContain('font-semibold')
    expect(screen.getByTestId('message-anchor-question-preview').className).toContain('text-[var(--color-text-primary)]')
    expect(screen.getByTestId('message-anchor-answer-preview').className).toContain('text-[11px]')
    expect(screen.getByTestId('message-anchor-answer-preview').className).toContain('text-[var(--color-text-tertiary)]')
    fireEvent.pointerLeave(row)
    expect(screen.queryByTestId('message-anchor-preview')).not.toBeInTheDocument()
  })

  it('removes the tooltip immediately when the pointer sweeps through', () => {
    render(
      <MessageAnchorRail anchors={makeAnchors(4)} visibleRange={null} onJump={() => {}} />,
    )
    const row = screen.getByTestId('message-anchor-row-msg-1')
    fireEvent.pointerEnter(row)
    expect(screen.getByTestId('message-anchor-preview')).toBeInTheDocument()
    fireEvent.pointerLeave(row)
    expect(screen.queryByTestId('message-anchor-preview')).not.toBeInTheDocument()
  })

  it('runs the magnification wave via direct style writes on rAF', () => {
    render(
      <MessageAnchorRail anchors={makeAnchors(5)} visibleRange={null} onJump={() => {}} />,
    )
    const rail = screen.getByTestId('message-anchor-rail')
    // first row center = 165 + 7 = 172; row 2 center = 172 + 28 = 200
    fireEvent.pointerMove(rail, { clientY: 200 })
    expect(rafCallbacks.length).toBeGreaterThan(0)
    flushFrames(1)
    const widths = [0, 1, 2, 3, 4].map(
      (i) => parseFloat(screen.getByTestId(`message-anchor-bar-msg-${i}`).style.width),
    )
    expect(widths[2]).toBe(15) // pointer directly above
    expect(widths[1]).toBeGreaterThan(widths[0]!) // gaussian falloff
    expect(widths[1]).toBe(widths[3]) // symmetric
    expect(screen.getByTestId('message-anchor-bar-msg-2').style.opacity).toBe('1')
    expect(screen.getByTestId('message-anchor-bar-msg-2').className).toContain('bg-[var(--color-text-secondary)]')
  })

  it('settles bars back to 7px after pointerleave and stops the rAF loop', () => {
    render(
      <MessageAnchorRail anchors={makeAnchors(5)} visibleRange={null} onJump={() => {}} />,
    )
    const rail = screen.getByTestId('message-anchor-rail')
    fireEvent.pointerMove(rail, { clientY: 200 })
    flushFrames(2)
    fireEvent.pointerLeave(rail)
    flushFrames(60)
    for (let i = 0; i < 5; i++) {
      expect(screen.getByTestId(`message-anchor-bar-msg-${i}`).style.width).toBe('7px')
    }
    expect(rafCallbacks).toHaveLength(0)
  })

  it('focus shows the peak state and tooltip immediately, blur reverts', () => {
    render(
      <MessageAnchorRail anchors={makeAnchors(4)} visibleRange={null} onJump={() => {}} />,
    )
    const button = screen.getByTestId('message-anchor-msg-1')
    fireEvent.focus(button)
    const bar = screen.getByTestId('message-anchor-bar-msg-1')
    expect(bar.style.width).toBe('15px')
    expect(bar.className).toContain('bg-[var(--color-text-secondary)]')
    expect(screen.getByTestId('message-anchor-preview')).toHaveTextContent('Question 1')
    fireEvent.blur(button)
    expect(screen.getByTestId('message-anchor-bar-msg-1').style.width).toBe('7px')
    expect(screen.queryByTestId('message-anchor-preview')).not.toBeInTheDocument()
  })

  it('keeps onJump semantics for thinned-out bars', () => {
    const onJump = vi.fn()
    render(
      <MessageAnchorRail anchors={makeAnchors(80)} visibleRange={null} onJump={onJump} />,
    )
    fireEvent.click(screen.getByTestId('message-anchor-msg-79'))
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-79', itemIndex: 237 }))
  })

  it('renders no empty navigation landmark when the container is too short', () => {
    rectSpy.mockReturnValue(rectForHeight(100))
    render(
      <MessageAnchorRail anchors={makeAnchors(5)} visibleRange={null} onJump={() => {}} />,
    )
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.getByTestId('message-anchor-rail-hidden')).toBeInTheDocument()
  })

  it('disables wave and tooltip on coarse pointers but keeps tap-to-jump', () => {
    const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList)
    const onJump = vi.fn()
    render(
      <MessageAnchorRail anchors={makeAnchors(5)} visibleRange={null} onJump={onJump} />,
    )
    const rail = screen.getByTestId('message-anchor-rail')
    fireEvent.pointerMove(rail, { clientY: 200 })
    flushFrames(5)
    for (let i = 0; i < 5; i++) {
      expect(screen.getByTestId(`message-anchor-bar-msg-${i}`).style.width).toBe('7px')
    }
    const row = screen.getByTestId('message-anchor-row-msg-1')
    fireEvent.pointerEnter(row)
    expect(screen.queryByTestId('message-anchor-preview')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('message-anchor-msg-2'))
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-2', itemIndex: 6 }))
    matchMediaSpy.mockRestore()
  })
})
