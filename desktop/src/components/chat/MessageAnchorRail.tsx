import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../../i18n'

export type MessageAnchor = {
  /** Global question index across the whole session (defines layout order). */
  seq: number
  id: string
  preview: string
  answerPreview?: string
  /** Index within renderItems (not the Virtuoso index); null while the
   *  message is outside the loaded window. */
  itemIndex: number | null
  /** Whether the message is currently loaded in the sliding window. */
  loaded: boolean
}

type Props = {
  anchors: MessageAnchor[]
  /** Currently visible range in renderItems coordinates. */
  visibleRange: { start: number; end: number } | null
  /** Anchor whose history is currently being loaded for a jump. */
  loadingAnchorId?: string | null
  /** Keep every hit target above the floating composer and status bars. */
  bottomInset?: number
  onJump: (anchor: MessageAnchor) => void
}

const RAIL_LEFT_INSET = 10
const RAIL_WIDTH = 20
const BAR_BASE_WIDTH = 7
const BAR_PEAK_WIDTH = 15
const BAR_HEIGHT = 3
const PITCH_STANDARD = 12
const PITCH_MIN = 8
const RAIL_VERTICAL_INSET = 16
const MIN_RAIL_HEIGHT = 120
const MAX_BARS = 60
const OPACITY_OUT_OF_VIEW = 0.4
const OPACITY_IN_VIEW = 0.64
/** Unloaded anchors (outside the sliding window) render dimmer still. */
const OPACITY_UNLOADED = 0.22
const SELECTED_BAR_COLOR = '#000000'
const WAVE_SIGMA = 1.8
const WAVE_CUTOFF = 6
const SETTLE_FACTOR = 0.18
const SETTLE_EPSILON = 0.5
const TOOLTIP_LEFT = RAIL_WIDTH + 8
const TOOLTIP_CLAMP = 4

const CLASS_BAR_BASE = 'bg-[var(--color-outline)]'
const CLASS_BAR_PEAK = 'bg-[var(--color-text-secondary)]'

type TooltipPreview = {
  question: string
  answer?: string
}

type RailLayout = {
  pitch: number
  /** Indices into the anchors array that actually get rendered. */
  indices: number[]
  /** Px offset of the first row's top edge within the rail. */
  top: number
}

export function computeAnchorRailLayout(anchorCount: number, containerHeight: number): RailLayout | null {
  if (anchorCount === 0 || containerHeight < MIN_RAIL_HEIGHT) return null
  const available = containerHeight - RAIL_VERTICAL_INSET
  let pitch = PITCH_STANDARD
  let maxBars = Math.floor(available / pitch)
  if (maxBars < anchorCount) {
    pitch = PITCH_MIN
    maxBars = Math.floor(available / pitch)
  }
  maxBars = Math.min(maxBars, MAX_BARS)
  if (maxBars < 1) return null

  let indices: number[]
  if (anchorCount <= maxBars) {
    indices = Array.from({ length: anchorCount }, (_, i) => i)
  } else {
    const step = anchorCount / maxBars
    indices = Array.from({ length: maxBars }, (_, i) => Math.floor(i * step))
    indices[0] = 0
    indices[indices.length - 1] = anchorCount - 1
  }

  const groupHeight = indices.length * pitch
  const top = Math.max(RAIL_VERTICAL_INSET / 2, (containerHeight - groupHeight) / 2)
  return { pitch, indices, top }
}

function isCoarsePointer(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches
}

/**
 * Vertical dock-style rail on the left edge of the chat transcript: one small
 * horizontal bar per user message, evenly pitched and vertically centered as a
 * group. A macOS-Dock-like magnification wave follows the pointer (pure rAF +
 * direct style writes, zero React re-renders). Clicking a bar jumps to that
 * message.
 */
export function MessageAnchorRail({
  anchors,
  visibleRange,
  loadingAnchorId = null,
  bottomInset = 0,
  onJump,
}: Props) {
  const t = useTranslation()
  const railRef = useRef<HTMLDivElement | null>(null)
  const [railHeight, setRailHeight] = useState(0)
  const [tooltip, setTooltip] = useState<{ row: number; preview: TooltipPreview } | null>(null)
  const [focusedRow, setFocusedRow] = useState<number | null>(null)
  const [selectedAnchorKey, setSelectedAnchorKey] = useState<string | null>(null)

  const coarseRef = useRef(false)
  const barRefs = useRef<Array<HTMLSpanElement | null>>([])
  const weightsRef = useRef<number[]>([])
  const baseOpacityRef = useRef<number[]>([])
  const layoutRef = useRef<RailLayout | null>(null)
  const rafRef = useRef<number | null>(null)
  const pointerRowRef = useRef<number | null>(null)
  const lastAppliedRowRef = useRef(Number.NaN)
  const peakRowRef = useRef(-1)

  // Measure the rail. Below MIN_RAIL_HEIGHT the whole rail stays empty.
  useLayoutEffect(() => {
    coarseRef.current = isCoarsePointer()
    const el = railRef.current
    if (!el) return
    const measure = () => setRailHeight(el.getBoundingClientRect().height)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const layout = useMemo(
    () => computeAnchorRailLayout(anchors.length, railHeight),
    [anchors.length, railHeight],
  )
  layoutRef.current = layout

  // Keep an already-visible preview in sync with click-to-load state. The
  // pointer remains over the bar while history is fetched, so this provides
  // immediate, explicit feedback even on a cold desktop cache.
  useEffect(() => {
    if (!layout) return
    setTooltip((current) => {
      if (!current) return current
      const anchorIdx = layout.indices[current.row]
      const anchor = anchorIdx === undefined ? undefined : anchors[anchorIdx]
      if (!anchor) return null
      const preview = loadingAnchorId === anchor.id
        ? { question: t('chat.anchorLoadingHistory') }
        : { question: anchor.preview, answer: anchor.answerPreview }
      if (
        current.preview.question === preview.question
        && current.preview.answer === preview.answer
      ) {
        return current
      }
      return { row: current.row, preview }
    })
  }, [anchors, layout, loadingAnchorId, t])

  const baseOpacities = useMemo(() => {
    if (!layout) return []
    return layout.indices.map((anchorIdx) => {
      const anchor = anchors[anchorIdx]!
      if (`${anchor.seq}:${anchor.id}` === selectedAnchorKey) return 1
      if (!anchor.loaded || anchor.itemIndex === null) return OPACITY_UNLOADED
      const inView = visibleRange != null
        && anchor.itemIndex >= visibleRange.start
        && anchor.itemIndex <= visibleRange.end
      return inView ? OPACITY_IN_VIEW : OPACITY_OUT_OF_VIEW
    })
  }, [layout, anchors, selectedAnchorKey, visibleRange])
  baseOpacityRef.current = baseOpacities

  const setPeakRow = useCallback((row: number) => {
    if (peakRowRef.current === row) return
    const bars = barRefs.current
    const prev = peakRowRef.current
    if (prev >= 0 && bars[prev]) {
      bars[prev]!.classList.remove(CLASS_BAR_PEAK)
      bars[prev]!.classList.add(CLASS_BAR_BASE)
    }
    if (row >= 0 && bars[row]) {
      bars[row]!.classList.remove(CLASS_BAR_BASE)
      bars[row]!.classList.add(CLASS_BAR_PEAK)
    }
    peakRowRef.current = row
  }, [])

  const runFrame = useCallback(() => {
    rafRef.current = null
    const currentLayout = layoutRef.current
    if (!currentLayout) return
    const bars = barRefs.current
    const weights = weightsRef.current
    const base = baseOpacityRef.current
    const m = pointerRowRef.current
    const count = currentLayout.indices.length

    if (m !== null && m === lastAppliedRowRef.current) return
    if (m !== null) lastAppliedRowRef.current = m

    let settling = false
    for (let i = 0; i < count; i++) {
      const el = bars[i]
      if (!el) continue
      let w: number
      if (m !== null) {
        const d = Math.abs(i - m)
        w = d >= WAVE_CUTOFF ? 0 : Math.exp(-(d * d) / (2 * WAVE_SIGMA * WAVE_SIGMA))
      } else {
        const prev = weights[i] ?? 0
        w = prev + (0 - prev) * SETTLE_FACTOR
        if (Math.abs(w * (BAR_PEAK_WIDTH - BAR_BASE_WIDTH)) < SETTLE_EPSILON) w = 0
      }
      weights[i] = w
      const width = BAR_BASE_WIDTH + (BAR_PEAK_WIDTH - BAR_BASE_WIDTH) * w
      const baseOp = base[i] ?? OPACITY_OUT_OF_VIEW
      el.style.width = `${width}px`
      el.style.opacity = `${baseOp + (1 - baseOp) * w}`
      if (m === null && w !== 0) settling = true
    }

    if (m !== null) {
      const r = Math.round(m)
      setPeakRow(r >= 0 && r < count && Math.abs(r - m) < 0.5 ? r : -1)
      rafRef.current = requestAnimationFrame(runFrame)
    } else {
      setPeakRow(-1)
      if (settling) rafRef.current = requestAnimationFrame(runFrame)
    }
  }, [setPeakRow])

  const startWave = useCallback(() => {
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(runFrame)
  }, [runFrame])

  const handleRailPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (coarseRef.current) return
    const currentLayout = layoutRef.current
    const rail = railRef.current
    if (!currentLayout || !rail) return
    const rect = rail.getBoundingClientRect()
    const firstCenter = rect.top + currentLayout.top + currentLayout.pitch / 2
    pointerRowRef.current = (event.clientY - firstCenter) / currentLayout.pitch
    startWave()
  }, [startWave])

  const handleRailPointerLeave = useCallback(() => {
    pointerRowRef.current = null
    lastAppliedRowRef.current = Number.NaN
    setTooltip(null)
    startWave()
  }, [startWave])

  const handleRowPointerEnter = useCallback((row: number, preview: TooltipPreview) => {
    if (coarseRef.current) return
    setTooltip({ row, preview })
  }, [])

  const handleRowPointerLeave = useCallback(() => {
    setTooltip(null)
  }, [])

  const handleRowFocus = useCallback((row: number, preview: TooltipPreview) => {
    setFocusedRow(row)
    setTooltip({ row, preview })
  }, [])

  const handleRowBlur = useCallback(() => {
    setFocusedRow(null)
    setTooltip(null)
  }, [])

  useEffect(() => () => {
    if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // Always keep an invisible, non-landmark container mounted for measurement:
  // anchors can grow past the threshold later (history loads in chunks) and the
  // rail must be able to appear without remounting.
  if (anchors.length < 3 || !layout) {
    return (
      <div
        ref={railRef}
        className="absolute top-0 z-20"
        style={{ left: RAIL_LEFT_INSET, width: RAIL_WIDTH, bottom: Math.max(0, bottomInset) }}
        aria-hidden="true"
        data-testid="message-anchor-rail-hidden"
      />
    )
  }

  let tooltipStyle: React.CSSProperties | undefined
  if (tooltip && layout) {
    const centerY = layout.top + tooltip.row * layout.pitch + layout.pitch / 2
    const clampedY = Math.min(Math.max(centerY, TOOLTIP_CLAMP), railHeight - TOOLTIP_CLAMP)
    tooltipStyle = centerY > railHeight / 2
      ? { left: TOOLTIP_LEFT, bottom: railHeight - clampedY, transform: 'translateY(50%)' }
      : { left: TOOLTIP_LEFT, top: clampedY, transform: 'translateY(-50%)' }
  }

  return (
    <div
      ref={railRef}
      className="absolute top-0 z-20"
      style={{ left: RAIL_LEFT_INSET, width: RAIL_WIDTH, bottom: Math.max(0, bottomInset) }}
      role="navigation"
      aria-label={t('chat.anchorRailLabel')}
      data-testid="message-anchor-rail"
      onPointerMove={handleRailPointerMove}
      onPointerLeave={handleRailPointerLeave}
    >
      {layout && layout.indices.map((anchorIdx, row) => {
        const anchor = anchors[anchorIdx]!
        const anchorKey = `${anchor.seq}:${anchor.id}`
        const isSelected = selectedAnchorKey === anchorKey
        const isFocused = focusedRow === row
        const isLoading = loadingAnchorId === anchor.id
        const preview = isLoading
          ? { question: t('chat.anchorLoadingHistory') }
          : { question: anchor.preview, answer: anchor.answerPreview }
        return (
          <div
            key={anchorKey}
            data-testid={`message-anchor-row-${anchor.id}`}
            className="absolute left-0"
            style={{ top: layout.top + row * layout.pitch, height: layout.pitch, width: RAIL_WIDTH }}
            onPointerEnter={() => handleRowPointerEnter(row, preview)}
            onPointerLeave={handleRowPointerLeave}
          >
            <button
              type="button"
              aria-label={t('chat.anchorJumpToMessage')}
              aria-busy={isLoading}
              aria-current={isSelected ? 'location' : undefined}
              data-testid={`message-anchor-${anchor.id}`}
              onClick={() => {
                setSelectedAnchorKey(anchorKey)
                onJump(anchor)
              }}
              onFocus={() => handleRowFocus(row, preview)}
              onBlur={handleRowBlur}
              className="flex h-full w-full cursor-pointer items-center justify-start outline-none"
            >
              <span
                ref={(el) => { barRefs.current[row] = el }}
                data-testid={`message-anchor-bar-${anchor.id}`}
                data-loaded={anchor.loaded}
                className={`${isFocused ? CLASS_BAR_PEAK : CLASS_BAR_BASE}${isLoading ? ' anchor-bar-loading' : ''}`}
                style={{
                  width: isFocused ? BAR_PEAK_WIDTH : BAR_BASE_WIDTH,
                  height: BAR_HEIGHT,
                  borderRadius: BAR_HEIGHT / 2,
                  opacity: baseOpacities[row] ?? OPACITY_OUT_OF_VIEW,
                  backgroundColor: isSelected ? SELECTED_BAR_COLOR : undefined,
                }}
              />
            </button>
          </div>
        )
      })}

      {tooltip && layout && tooltipStyle && (
        <div
          data-testid="message-anchor-preview"
          className="pointer-events-none absolute z-30 w-[260px] max-w-[min(260px,calc(100vw-48px))]"
          style={tooltipStyle}
        >
          <div className="anchor-tooltip-enter rounded-[8px] border border-[var(--color-border)] bg-[var(--color-background)] px-[11px] py-[8px] shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
            <div
              data-testid="message-anchor-question-preview"
              className="line-clamp-2 text-[12px] font-semibold leading-[17px] text-[var(--color-text-primary)]"
            >
              {tooltip.preview.question}
            </div>
            {tooltip.preview.answer && (
              <div
                data-testid="message-anchor-answer-preview"
                className="mt-[4px] line-clamp-2 text-[11px] font-normal leading-[16px] text-[var(--color-text-tertiary)]"
              >
                {tooltip.preview.answer}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
