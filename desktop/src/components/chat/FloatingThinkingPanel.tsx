import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from '../../i18n'

type FloatingThinkingPanelProps = {
  content?: string
  isActive?: boolean
  identityKey?: string
}

const THINKING_PANEL_GRACE_MS = 3200
const THINKING_PANEL_FADE_MS = 180
const AUTO_FOLLOW_THRESHOLD = 12

function formatThinkingContent(content: string) {
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()

  if (!normalized) return ''

  return normalized.replace(/\n{3,}/g, '\n\n')
}

export function FloatingThinkingPanel({
  content = '',
  isActive = false,
  identityKey,
}: FloatingThinkingPanelProps) {
  const t = useTranslation()
  const [visibleContent, setVisibleContent] = useState('')
  const [isShown, setIsShown] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const shouldAutoFollowRef = useRef(true)
  const hideTimerRef = useRef<number | null>(null)
  const removeTimerRef = useRef<number | null>(null)

  const displayContent = formatThinkingContent(content)

  const clearTimers = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    if (removeTimerRef.current !== null) {
      window.clearTimeout(removeTimerRef.current)
      removeTimerRef.current = null
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    const body = bodyRef.current
    if (!body) return
    body.scrollTop = Math.max(0, body.scrollHeight - body.clientHeight)
  }, [])

  const scheduleHide = useCallback(() => {
    if (!visibleContent || hideTimerRef.current !== null) return

    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      setIsShown(false)

      removeTimerRef.current = window.setTimeout(() => {
        removeTimerRef.current = null
        setVisibleContent('')
      }, THINKING_PANEL_FADE_MS)
    }, THINKING_PANEL_GRACE_MS)
  }, [visibleContent])

  useEffect(() => {
    clearTimers()
    shouldAutoFollowRef.current = true
    setVisibleContent('')
    setIsShown(false)
  }, [identityKey, clearTimers])

  useEffect(() => {
    if (!displayContent) {
      if (!isActive) {
        clearTimers()
        setVisibleContent('')
        setIsShown(false)
      }
      return
    }

    clearTimers()
    shouldAutoFollowRef.current = true
    setVisibleContent(displayContent)
    setIsShown(true)
  }, [displayContent, isActive, clearTimers])

  useEffect(() => {
    if (isActive) return
    scheduleHide()
  }, [isActive, scheduleHide])

  useEffect(() => {
    if (!visibleContent || !shouldAutoFollowRef.current) return
    requestAnimationFrame(scrollToBottom)
  }, [visibleContent, scrollToBottom])

  useEffect(() => () => clearTimers(), [clearTimers])

  const handleScroll = () => {
    const body = bodyRef.current
    if (!body) return

    const distanceFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight
    shouldAutoFollowRef.current = distanceFromBottom <= AUTO_FOLLOW_THRESHOLD
  }

  if (!visibleContent) return null

  return (
    <div className="pointer-events-none absolute left-0 right-0 top-[20px] z-30 flex justify-center px-[24px]">
      <div
        className={`pointer-events-auto w-full max-w-[720px] translate-y-0 overflow-hidden rounded-[18px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] text-[var(--color-text-primary)] shadow-[var(--shadow-dropdown)] transition-[opacity,transform] duration-[150ms] ease-out ${
          isShown ? 'opacity-100' : '-translate-y-1 opacity-0'
        }`}
        data-testid="floating-thinking-panel"
      >
        <div className="flex h-[38px] items-center gap-[8px] border-b border-[var(--color-border-separator)] px-[16px]">
          <span className="relative flex h-[7px] w-[7px] shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-text-tertiary)] opacity-40" />
            <span className="relative inline-flex h-[7px] w-[7px] rounded-full bg-[var(--color-text-secondary)]" />
          </span>
          <span
            className="ai-shimmer-text ai-shimmer-thinking text-[12px] font-semibold leading-none"
            data-testid="floating-thinking-panel-title"
          >
            {t('thinking.label')}
          </span>
        </div>

        <div
          ref={bodyRef}
          className="scrollbar-no-track max-h-[142px] overflow-y-auto px-[16px] py-[12px]"
          onScroll={handleScroll}
          data-testid="floating-thinking-panel-body"
        >
          <div
            className="whitespace-pre-wrap break-words text-[12.5px] font-normal leading-[1.5] tracking-normal text-[var(--color-text-secondary)]"
            data-testid="floating-thinking-panel-content"
          >
            {visibleContent}
          </div>
        </div>
      </div>
    </div>
  )
}
