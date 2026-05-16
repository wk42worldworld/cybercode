import { useEffect, useMemo, useRef, useState } from 'react'

type Props = {
  content: string
  showDot?: boolean
}

const LINE_HOLD_MS = 1200
const FADE_MS = 160
const MAX_LINE_LENGTH = 64
const MAX_BALANCED_LINE_LENGTH = 76
const MIN_STANDALONE_LINE_LENGTH = 10

const normalizeThinkingLine = (line: string) =>
  line
    .replace(/\s+/g, ' ')
    .trim()

const splitLongLine = (line: string) => {
  const chunks: string[] = []
  let remaining = line

  const pushBalancedChunk = (chunk: string) => {
    const next = chunk.trim()
    if (!next) return

    const previous = chunks[chunks.length - 1]
    const merged = previous ? `${previous} ${next}` : next
    if (previous && next.length < MIN_STANDALONE_LINE_LENGTH && merged.length <= MAX_BALANCED_LINE_LENGTH) {
      chunks[chunks.length - 1] = merged
      return
    }

    chunks.push(next)
  }

  while (remaining.length > MAX_LINE_LENGTH) {
    const windowText = remaining.slice(0, MAX_LINE_LENGTH)
    const punctuationIndex = Math.max(
      windowText.lastIndexOf('.'),
      windowText.lastIndexOf(','),
      windowText.lastIndexOf(';'),
      windowText.lastIndexOf(':'),
      windowText.lastIndexOf('!'),
      windowText.lastIndexOf('?'),
      windowText.lastIndexOf('。'),
      windowText.lastIndexOf('，'),
      windowText.lastIndexOf('；'),
      windowText.lastIndexOf('：'),
      windowText.lastIndexOf('！'),
      windowText.lastIndexOf('？'),
      windowText.lastIndexOf('、'),
    )
    const whitespaceIndex = windowText.lastIndexOf(' ')
    const splitAt = Math.max(punctuationIndex + 1, whitespaceIndex)
    const safeSplitAt = splitAt > Math.floor(MAX_LINE_LENGTH * 0.55) ? splitAt : MAX_LINE_LENGTH

    pushBalancedChunk(remaining.slice(0, safeSplitAt))
    remaining = remaining.slice(safeSplitAt).trim()
  }

  pushBalancedChunk(remaining)
  return chunks
}

const buildThinkingLines = (content: string) => {
  const lines: string[] = []
  const pushBalancedLine = (line: string) => {
    const previous = lines[lines.length - 1]
    const merged = previous ? `${previous} ${line}` : line
    if (previous && line.length < MIN_STANDALONE_LINE_LENGTH && merged.length <= MAX_BALANCED_LINE_LENGTH) {
      lines[lines.length - 1] = merged
      return
    }
    lines.push(line)
  }

  content
    .split('\n')
    .map(normalizeThinkingLine)
    .filter(Boolean)
    .flatMap(splitLongLine)
    .forEach(pushBalancedLine)

  return lines
}

export function ThinkingIndicator({ content, showDot = true }: Props) {
  const [displayIndex, setDisplayIndex] = useState(0)
  const [isVisible, setIsVisible] = useState(true)
  const previousFirstLineRef = useRef('')
  const previousLineCountRef = useRef(0)
  const fadeTimerRef = useRef<number | null>(null)

  const lines = useMemo(() => buildThinkingLines(content), [content])

  const clearFadeTimer = () => {
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current)
      fadeTimerRef.current = null
    }
  }

  useEffect(() => {
    const previousFirstLine = previousFirstLineRef.current
    const previousLineCount = previousLineCountRef.current
    const nextFirstLine = lines[0] ?? ''
    const isSameStream =
      previousFirstLine === '' ||
      lines.length === 0 ||
      nextFirstLine.startsWith(previousFirstLine) ||
      previousFirstLine.startsWith(nextFirstLine)

    previousFirstLineRef.current = nextFirstLine
    previousLineCountRef.current = lines.length

    if (lines.length === 0) {
      clearFadeTimer()
      setDisplayIndex(0)
      setIsVisible(false)
      return
    }

    if (!isSameStream || previousLineCount === 0) {
      clearFadeTimer()
      setDisplayIndex(0)
      setIsVisible(true)
      return
    }

    setDisplayIndex((index) => Math.min(index, lines.length - 1))
  }, [lines])

  useEffect(() => {
    if (lines.length === 0 || displayIndex >= lines.length - 1) return

    const holdTimer = window.setTimeout(() => {
      setIsVisible(false)
      fadeTimerRef.current = window.setTimeout(() => {
        fadeTimerRef.current = null
        setDisplayIndex((index) => Math.min(index + 1, lines.length - 1))
        setIsVisible(true)
      }, FADE_MS)
    }, LINE_HOLD_MS)

    return () => {
      window.clearTimeout(holdTimer)
      clearFadeTimer()
    }
  }, [displayIndex, lines.length])

  useEffect(() => clearFadeTimer, [])

  if (lines.length === 0) return null
  const displayLine = lines[Math.min(displayIndex, lines.length - 1)] || ''

  return (
    <div className="flex w-full max-w-[560px] min-w-0 items-center gap-1.5 overflow-hidden">
      {showDot !== false && (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-brand)] opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--color-brand)]" />
        </span>
      )}

      <div
        className="min-w-0 flex-1 overflow-hidden"
        title={lines.join('\n')}
        data-testid="thinking-line-viewport"
        style={{
          WebkitMaskImage: 'linear-gradient(90deg, #000, #000 calc(100% - 22px), transparent)',
          maskImage: 'linear-gradient(90deg, #000, #000 calc(100% - 22px), transparent)',
        }}
      >
        <span
          className={`ai-shimmer-text ai-shimmer-thinking block max-w-full truncate whitespace-nowrap pr-8 text-[12px] leading-relaxed transition-opacity duration-150 ease-out ${isVisible ? 'opacity-100' : 'opacity-0'}`}
          data-testid="thinking-line-content"
        >
          {displayLine}
        </span>
      </div>
    </div>
  )
}
