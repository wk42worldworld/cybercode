import { useEffect, useRef } from 'react'

const FRAME_MS = 1000 / 60
const MIN_GRAPHEMES_PER_SECOND = 44
const MAX_STREAMING_GRAPHEMES_PER_SECOND = 360
const MAX_SETTLING_GRAPHEMES_PER_SECOND = 480
const STREAMING_CATCH_UP_MS = 650
const SETTLING_CATCH_UP_MS = 420
const RATE_EASING_MS = 85
const MAX_ELAPSED_MS = 50
const MAX_STREAMING_GRAPHEMES_PER_FRAME = 6
const MAX_SETTLING_GRAPHEMES_PER_FRAME = 8
const STREAMING_GRAPHEME_HOLDBACK = 1
const STREAMING_GRAPHEME_HOLDBACK_MS = 120

type SegmenterLike = {
  segment: (text: string) => Iterable<{ index: number; segment: string }>
}

let graphemeSegmenter: SegmenterLike | null | undefined

function getGraphemeSegmenter(): SegmenterLike | null {
  if (graphemeSegmenter !== undefined) return graphemeSegmenter

  const Segmenter = typeof Intl !== 'undefined'
    ? (Intl as typeof Intl & {
        Segmenter?: new (
          locales?: string | string[],
          options?: { granularity: 'grapheme' },
        ) => SegmenterLike
      }).Segmenter
    : undefined
  graphemeSegmenter = Segmenter
    ? new Segmenter(undefined, { granularity: 'grapheme' })
    : null
  return graphemeSegmenter
}

export function getGraphemeBoundaries(text: string): number[] {
  const boundaries = [0]
  const segmenter = getGraphemeSegmenter()

  if (segmenter) {
    for (const item of segmenter.segment(text)) {
      boundaries.push(item.index + item.segment.length)
    }
    return boundaries
  }

  let offset = 0
  for (const codePoint of text) {
    offset += codePoint.length
    boundaries.push(offset)
  }
  return boundaries
}

function boundaryIndexAtOrAfter(boundaries: number[], offset: number): number {
  let low = 0
  let high = boundaries.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((boundaries[middle] ?? 0) < offset) low = middle + 1
    else high = middle
  }
  return low
}

export function advanceGraphemeIndex(text: string, start: number, count: number): number {
  if (count <= 0 || start >= text.length) return start
  const boundaries = getGraphemeBoundaries(text)
  const startBoundary = boundaryIndexAtOrAfter(boundaries, start)
  return boundaries[Math.min(boundaries.length - 1, startBoundary + count)] ?? text.length
}

// Kept for callers from the first implementation. It now advances complete
// graphemes, which also protects joined emoji and combining marks.
export const advanceCodePointIndex = advanceGraphemeIndex

export function getStreamingRevealRate(backlog: number, isSettling = false): number {
  if (backlog <= 0) return 0
  const catchUpMs = isSettling ? SETTLING_CATCH_UP_MS : STREAMING_CATCH_UP_MS
  const maximum = isSettling
    ? MAX_SETTLING_GRAPHEMES_PER_SECOND
    : MAX_STREAMING_GRAPHEMES_PER_SECOND
  return Math.min(
    maximum,
    Math.max(MIN_GRAPHEMES_PER_SECOND, (backlog * 1000) / catchUpMs),
  )
}

export function getStreamingRevealCount(
  backlog: number,
  elapsedMs = FRAME_MS,
  isSettling = false,
): number {
  if (backlog <= 0) return 0
  const maximum = isSettling
    ? MAX_SETTLING_GRAPHEMES_PER_FRAME
    : MAX_STREAMING_GRAPHEMES_PER_FRAME
  const budget = getStreamingRevealRate(backlog, isSettling)
    * Math.min(MAX_ELAPSED_MS, Math.max(0, elapsedMs))
    / 1000
  return Math.min(backlog, maximum, Math.max(1, Math.floor(budget)))
}

function revealPauseMs(segment: string, backlog: number): number {
  if (/\r?\n/.test(segment)) return backlog > 180 ? 18 : 34
  if (/[.!?。！？]/.test(segment)) return backlog > 180 ? 18 : 42
  if (backlog <= 180 && /[,;:，、；：]/.test(segment)) return 18
  return 0
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
}

type Props = {
  content: string
  onCaughtUp?: () => void
}

/** Plays uneven network chunks through one ordered, refresh-rate-independent cursor. */
export function SmoothStreamingText({ content, onCaughtUp }: Props) {
  const textRef = useRef<HTMLSpanElement>(null)
  const textNodeRef = useRef<Text | null>(null)
  const targetRef = useRef(content)
  const boundariesRef = useRef(getGraphemeBoundaries(content))
  const displayedGraphemeRef = useRef(0)
  const frameRef = useRef<number | null>(null)
  const holdbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const releasedHoldbackTargetRef = useRef<string | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const revealBudgetRef = useRef(0)
  const revealRateRef = useRef(MIN_GRAPHEMES_PER_SECOND)
  const pauseUntilRef = useRef(0)
  const reducedMotionRef = useRef(prefersReducedMotion())
  const onCaughtUpRef = useRef(onCaughtUp)
  const notifiedTargetRef = useRef<string | null>(null)

  onCaughtUpRef.current = onCaughtUp

  const ensureTextNode = (): Text | null => {
    const container = textRef.current
    if (!container) return null
    if (textNodeRef.current?.parentNode === container) return textNodeRef.current

    const existing = container.firstChild
    if (existing?.nodeType === Node.TEXT_NODE && existing === container.lastChild) {
      textNodeRef.current = existing as Text
      return textNodeRef.current
    }

    const textNode = document.createTextNode('')
    container.replaceChildren(textNode)
    textNodeRef.current = textNode
    return textNode
  }

  const getDisplayedText = () => textNodeRef.current?.data ?? textRef.current?.textContent ?? ''

  const writeDisplayedText = (nextText: string) => {
    const textNode = ensureTextNode()
    if (!textNode) return
    const currentText = textNode.data
    if (nextText.startsWith(currentText)) {
      const suffix = nextText.slice(currentText.length)
      if (suffix) textNode.appendData(suffix)
      return
    }
    textNode.replaceData(0, textNode.length, nextText)
  }

  const getRevealableTotal = (total: number) => (
    onCaughtUpRef.current || releasedHoldbackTargetRef.current === targetRef.current
      ? total
      : Math.max(0, total - STREAMING_GRAPHEME_HOLDBACK)
  )

  const cancelFrame = () => {
    if (frameRef.current === null) return
    cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }

  const notifyCaughtUp = () => {
    const callback = onCaughtUpRef.current
    const target = targetRef.current
    if (!callback || !target || notifiedTargetRef.current === target) return
    notifiedTargetRef.current = target
    callback()
  }

  const showAll = () => {
    cancelFrame()
    const target = targetRef.current
    displayedGraphemeRef.current = Math.max(0, boundariesRef.current.length - 1)
    releasedHoldbackTargetRef.current = target
    lastFrameAtRef.current = null
    revealBudgetRef.current = 0
    writeDisplayedText(target)
    notifyCaughtUp()
  }

  const scheduleFrame = () => {
    const total = Math.max(0, boundariesRef.current.length - 1)
    const revealableTotal = getRevealableTotal(total)
    if (frameRef.current !== null || displayedGraphemeRef.current >= revealableTotal) return

    frameRef.current = requestAnimationFrame((now) => {
      frameRef.current = null
      const target = targetRef.current
      const boundaries = boundariesRef.current
      const current = displayedGraphemeRef.current
      const currentTotal = Math.max(0, boundaries.length - 1)
      const currentRevealableTotal = getRevealableTotal(currentTotal)
      if (!textRef.current || current >= currentRevealableTotal) {
        if (current >= currentTotal) notifyCaughtUp()
        return
      }

      const rawElapsed = lastFrameAtRef.current === null
        ? FRAME_MS
        : now - lastFrameAtRef.current
      const elapsedMs = Math.min(MAX_ELAPSED_MS, Math.max(0, rawElapsed))
      lastFrameAtRef.current = now

      if (now < pauseUntilRef.current) {
        scheduleFrame()
        return
      }

      const backlog = currentRevealableTotal - current
      const isSettling = Boolean(onCaughtUpRef.current)
      const desiredRate = getStreamingRevealRate(backlog, isSettling)
      const easing = 1 - Math.exp(-elapsedMs / RATE_EASING_MS)
      revealRateRef.current += (desiredRate - revealRateRef.current) * easing
      revealBudgetRef.current += revealRateRef.current * elapsedMs / 1000

      const maximumPerFrame = isSettling
        ? MAX_SETTLING_GRAPHEMES_PER_FRAME
        : MAX_STREAMING_GRAPHEMES_PER_FRAME
      let revealCount = Math.min(
        backlog,
        maximumPerFrame,
        Math.floor(revealBudgetRef.current),
      )
      if (current === 0 && revealCount === 0) revealCount = 1

      if (revealCount === 0) {
        scheduleFrame()
        return
      }

      let pauseMs = 0
      for (let step = 1; step <= revealCount; step += 1) {
        const start = boundaries[current + step - 1] ?? target.length
        const end = boundaries[current + step] ?? target.length
        const candidatePause = revealPauseMs(target.slice(start, end), backlog)
        if (candidatePause > 0) {
          revealCount = step
          pauseMs = candidatePause
          break
        }
      }

      revealBudgetRef.current = Math.max(0, revealBudgetRef.current - revealCount)
      const next = current + revealCount
      displayedGraphemeRef.current = next
      writeDisplayedText(target.slice(0, boundaries[next] ?? target.length))

      if (pauseMs > 0 && next < currentTotal) {
        pauseUntilRef.current = now + pauseMs
        revealBudgetRef.current = Math.min(revealBudgetRef.current, 1)
      }

      if (next >= currentTotal) notifyCaughtUp()
      else if (next < currentRevealableTotal) scheduleFrame()
    })
  }

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mediaQuery) return

    const handleChange = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches
      if (event.matches) showAll()
      else scheduleFrame()
    }

    mediaQuery.addEventListener?.('change', handleChange)
    return () => mediaQuery.removeEventListener?.('change', handleChange)
  }, [])

  useEffect(() => {
    const previousTarget = targetRef.current
    const displayedText = getDisplayedText()
    targetRef.current = content
    boundariesRef.current = getGraphemeBoundaries(content)
    if (previousTarget !== content) {
      notifiedTargetRef.current = null
      releasedHoldbackTargetRef.current = null
      if (holdbackTimerRef.current !== null) {
        clearTimeout(holdbackTimerRef.current)
        holdbackTimerRef.current = null
      }
    }
    if (onCaughtUpRef.current && holdbackTimerRef.current !== null) {
      clearTimeout(holdbackTimerRef.current)
      holdbackTimerRef.current = null
    }

    if (reducedMotionRef.current) {
      showAll()
      return
    }

    if (!content.startsWith(displayedText)) {
      cancelFrame()
      displayedGraphemeRef.current = 0
      lastFrameAtRef.current = null
      revealBudgetRef.current = 0
      revealRateRef.current = MIN_GRAPHEMES_PER_SECOND
      pauseUntilRef.current = 0
      writeDisplayedText('')
    } else {
      const alignedIndex = boundaryIndexAtOrAfter(
        boundariesRef.current,
        displayedText.length,
      )
      displayedGraphemeRef.current = alignedIndex
    }

    const total = Math.max(0, boundariesRef.current.length - 1)
    if (
      !onCaughtUpRef.current
      && content
      && releasedHoldbackTargetRef.current !== content
      && holdbackTimerRef.current === null
    ) {
      holdbackTimerRef.current = setTimeout(() => {
        holdbackTimerRef.current = null
        if (targetRef.current !== content || onCaughtUpRef.current) return
        releasedHoldbackTargetRef.current = content
        scheduleFrame()
      }, STREAMING_GRAPHEME_HOLDBACK_MS)
    }
    if (displayedGraphemeRef.current >= total) {
      notifyCaughtUp()
      return
    }
    if (displayedGraphemeRef.current >= getRevealableTotal(total)) return
    scheduleFrame()
  }, [content, onCaughtUp])

  useEffect(() => () => {
    cancelFrame()
    if (holdbackTimerRef.current !== null) clearTimeout(holdbackTimerRef.current)
  }, [])

  return (
    <span
      ref={textRef}
      data-testid="smooth-streaming-text"
      className="streaming-stable-text whitespace-pre-wrap"
      aria-live="off"
    />
  )
}
