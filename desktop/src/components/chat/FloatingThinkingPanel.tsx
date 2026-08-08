import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useTranslation } from '../../i18n'
import { Icon } from '../shared/Icon'

type FloatingThinkingPanelProps = {
  content?: string
  isActive?: boolean
  identityKey?: string
}

const AUTO_FOLLOW_THRESHOLD = 12

function formatThinkingContent(content: string) {
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()

  if (!normalized) return ''

  return normalized.replace(/\n{3,}/g, '\n\n')
}

/**
 * Thinking remains part of the transcript: expanded throughout the complete
 * assistant turn, then collapsed in place once the turn has fully finished.
 */
export function FloatingThinkingPanel({
  content = '',
  isActive = false,
  identityKey,
}: FloatingThinkingPanelProps) {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(isActive)
  const bodyRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const shouldAutoFollowRef = useRef(true)
  const scrollFrameRef = useRef<number | null>(null)
  const displayContent = formatThinkingContent(content)
  const titleLabel = t(isActive ? 'thinking.label' : 'thinking.completeLabel')

  const scrollToBottom = useCallback(() => {
    const body = bodyRef.current
    if (!body) return
    body.scrollTop = body.scrollHeight
  }, [])

  const scheduleScrollToBottom = useCallback(() => {
    if (scrollFrameRef.current !== null) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      scrollToBottom()
    })
  }, [scrollToBottom])

  useLayoutEffect(() => {
    shouldAutoFollowRef.current = true
    setExpanded(isActive)
  }, [identityKey, isActive])

  useEffect(() => {
    if (!displayContent || !expanded || !isActive || !shouldAutoFollowRef.current) return
    scheduleScrollToBottom()
  }, [displayContent, expanded, isActive, scheduleScrollToBottom])

  useLayoutEffect(() => {
    if (!expanded || !isActive || typeof ResizeObserver === 'undefined') return
    const contentNode = contentRef.current
    if (!contentNode) return

    const observer = new ResizeObserver(() => {
      if (shouldAutoFollowRef.current) scheduleScrollToBottom()
    })
    observer.observe(contentNode)
    return () => observer.disconnect()
  }, [expanded, isActive, scheduleScrollToBottom])

  useEffect(() => () => {
    if (scrollFrameRef.current === null) return
    cancelAnimationFrame(scrollFrameRef.current)
    scrollFrameRef.current = null
  }, [])

  const handleScroll = () => {
    const body = bodyRef.current
    if (!body) return

    const distanceFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight
    if (distanceFromBottom <= AUTO_FOLLOW_THRESHOLD) {
      shouldAutoFollowRef.current = true
    }
  }

  if (!displayContent) return null

  return (
    <div
      data-thinking-message-shell
      className="flex w-full justify-center px-[24px] py-[8px]"
    >
      <div
        data-chat-content-column
        data-active={isActive ? 'true' : 'false'}
        className="w-full max-w-[878px] overflow-hidden rounded-[24px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] text-[var(--color-text-primary)]"
        data-testid="thinking-message-panel"
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            if (!isActive) setExpanded((value) => !value)
          }}
          className="flex h-[44px] w-full items-center justify-center gap-[8px] px-[16px] text-center transition-colors hover:bg-[var(--color-surface-hover)]/45"
        >
          <span
            data-thinking-status
            className="flex h-4 w-4 shrink-0 items-center justify-center"
          >
            <span
              data-thinking-status-icon
              className="relative flex h-4 w-4 items-center justify-center"
            >
              {isActive ? (
                <>
                  <span className="absolute h-2 w-2 animate-ping rounded-full bg-[var(--color-brand)] opacity-30" />
                  <span
                    data-thinking-status-dot
                    className="relative h-2 w-2 rounded-full bg-[var(--color-brand)] animate-pulse-dot"
                  />
                </>
              ) : (
                <Icon
                  name="check_circle"
                  size={15}
                  className="text-[var(--color-success)]"
                />
              )}
            </span>
          </span>
          <span
            className="min-w-0 flex-1 truncate text-center text-[12px] font-semibold leading-none text-[var(--color-text-secondary)]"
            data-testid="thinking-message-panel-title"
          >
            <span
              className={isActive ? 'ai-thinking-sweep-label' : undefined}
              data-thinking-sweep-label={isActive ? 'true' : undefined}
              data-label={isActive ? titleLabel : undefined}
            >
              {titleLabel}
            </span>
          </span>
          <span
            data-thinking-disclosure
            className="flex h-4 w-4 shrink-0 items-center justify-center"
          >
            <Icon
              name={expanded ? 'expand_less' : 'expand_more'}
              size={16}
              className="text-[var(--color-outline)]"
            />
          </span>
        </button>

        {expanded && (
          <div
            ref={bodyRef}
            className="scrollbar-no-track max-h-[142px] overflow-y-auto border-t border-[var(--color-border-separator)]/45 px-[16px] py-[12px]"
            style={{ animation: 'fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1)' }}
            onScroll={handleScroll}
            onWheelCapture={(event) => {
              const body = bodyRef.current
              if (event.deltaY < 0 && body && body.scrollHeight > body.clientHeight) {
                shouldAutoFollowRef.current = false
              }
            }}
            onTouchMoveCapture={() => {
              const body = bodyRef.current
              if (body && body.scrollHeight > body.clientHeight) {
                shouldAutoFollowRef.current = false
              }
            }}
            data-testid="thinking-message-panel-body"
          >
            <div
              ref={contentRef}
              className="whitespace-pre-wrap break-words text-[12.5px] font-normal leading-[1.5] tracking-normal text-[var(--color-text-secondary)]"
              data-testid="thinking-message-panel-content"
            >
              {displayContent}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
