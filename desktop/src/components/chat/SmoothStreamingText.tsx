import { useEffect, useRef } from 'react'

const FRAME_MS = 1000 / 60
const MAX_CODE_POINTS_PER_FRAME = 96

export function getStreamingRevealCount(backlog: number, elapsedMs = FRAME_MS): number {
  if (backlog <= 0) return 0

  const catchUpFrames = backlog > 400
    ? 4
    : backlog > 120
      ? 5
      : backlog > 24
        ? 6
        : 8
  const elapsedScale = Math.min(4, Math.max(1, elapsedMs / FRAME_MS))
  const revealCount = Math.ceil((backlog / catchUpFrames) * elapsedScale)

  return Math.min(MAX_CODE_POINTS_PER_FRAME, Math.max(1, revealCount))
}

export function advanceCodePointIndex(text: string, start: number, count: number): number {
  let index = start
  let remaining = count

  while (index < text.length && remaining > 0) {
    const codePoint = text.codePointAt(index)
    index += codePoint !== undefined && codePoint > 0xffff ? 2 : 1
    remaining -= 1
  }

  return index
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
}

type Props = {
  content: string
}

/** Smooths uneven network chunks without changing the stored assistant response. */
export function SmoothStreamingText({ content }: Props) {
  const textRef = useRef<HTMLSpanElement>(null)
  const targetRef = useRef(content)
  const displayedIndexRef = useRef(0)
  const frameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const reducedMotionRef = useRef(prefersReducedMotion())

  const cancelFrame = () => {
    if (frameRef.current === null) return
    cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }

  const showAll = () => {
    cancelFrame()
    displayedIndexRef.current = targetRef.current.length
    lastFrameAtRef.current = null
    if (textRef.current) textRef.current.textContent = targetRef.current
  }

  const scheduleFrame = () => {
    if (frameRef.current !== null || displayedIndexRef.current >= targetRef.current.length) return

    frameRef.current = requestAnimationFrame((now) => {
      frameRef.current = null
      const target = targetRef.current
      const currentIndex = displayedIndexRef.current
      if (!textRef.current || currentIndex >= target.length) return

      const elapsedMs = lastFrameAtRef.current === null ? FRAME_MS : now - lastFrameAtRef.current
      lastFrameAtRef.current = now
      const revealCount = getStreamingRevealCount(target.length - currentIndex, elapsedMs)
      const nextIndex = advanceCodePointIndex(target, currentIndex, revealCount)
      displayedIndexRef.current = nextIndex
      textRef.current.textContent = target.slice(0, nextIndex)
      scheduleFrame()
    })
  }

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mediaQuery) return

    const handleChange = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches
      if (event.matches) showAll()
    }

    mediaQuery.addEventListener?.('change', handleChange)
    return () => mediaQuery.removeEventListener?.('change', handleChange)
  }, [])

  useEffect(() => {
    const displayedText = textRef.current?.textContent ?? ''
    targetRef.current = content

    if (reducedMotionRef.current) {
      showAll()
      return
    }

    if (!content.startsWith(displayedText)) {
      cancelFrame()
      displayedIndexRef.current = 0
      lastFrameAtRef.current = null
      if (textRef.current) textRef.current.textContent = ''
    }

    scheduleFrame()
  }, [content])

  useEffect(() => () => cancelFrame(), [])

  return (
    <span
      ref={textRef}
      data-testid="smooth-streaming-text"
      className="whitespace-pre-wrap"
      aria-live="off"
    />
  )
}
