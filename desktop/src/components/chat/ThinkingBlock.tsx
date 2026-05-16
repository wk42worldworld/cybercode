import { useState, useEffect, useRef } from 'react'
import { useTranslation } from '../../i18n'

export function ThinkingBlock({ content, isActive = false }: { content: string; isActive?: boolean }) {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (expanded && isActive && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [content, expanded, isActive])

  // Preview: take first meaningful line, not first 140 chars
  const lines = content.split('\n').filter((l) => l.trim())
  const firstLine = lines[0]?.replace(/\s+/g, ' ').trim() || ''
  const preview = firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine

  // Left accent line: gray when idle, accent pulse when active
  const lineClass = isActive
    ? 'w-0.5 shrink-0 bg-[var(--color-brand)] animate-accent-pulse-line'
    : 'w-0.5 shrink-0 bg-[var(--color-text-tertiary)]/40'

  return (
    <div className="mb-1">
      <div className="flex items-stretch gap-0">
        {/* Left vertical line indicator */}
        <div className={lineClass} />

        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-left text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)]"
        >
          <span className="text-[10px] text-[var(--color-outline)]">
            {expanded ? '\u25BE' : '\u25B8'}
          </span>
          <span className="shrink-0 font-[var(--font-mono)] font-medium italic">
            {t('thinking.label')}
            {isActive && <span className="thinking-dots" />}
          </span>
          {!expanded && preview && (
            <span className="min-w-0 flex-1 truncate font-[var(--font-mono)] text-[11px] text-[var(--color-text-tertiary)]">
              {preview}
              {isActive && <span className="thinking-inline-cursor" />}
            </span>
          )}
        </button>
      </div>

      {expanded && (
        <div className="flex items-stretch gap-0">
          {/* Left vertical line continues into content area */}
          <div className={lineClass} />

          <div
            ref={contentRef}
            className="mt-1 max-h-[300px] overflow-y-auto rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] p-2.5 font-[var(--font-mono)] text-[11px] leading-[1.35] text-[var(--color-text-secondary)] whitespace-pre-wrap break-words"
            style={{ animation: 'fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1)' }}
          >
            {content}
            {isActive && expanded && <span className="thinking-cursor" />}
          </div>
        </div>
      )}

      <style>{thinkingStyles}</style>
    </div>
  )
}

const thinkingStyles = `
@keyframes thinking-cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes thinking-dots {
  0%, 20% { content: ''; }
  40% { content: '.'; }
  60% { content: '..'; }
  80%, 100% { content: '...'; }
}
.thinking-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--color-brand);
  vertical-align: middle;
  margin-left: 1px;
  animation: thinking-cursor-blink 1s step-end infinite;
}
.thinking-inline-cursor {
  display: inline-block;
  width: 1px;
  height: 0.95em;
  margin-left: 3px;
  vertical-align: text-bottom;
  background: var(--color-brand);
  animation: thinking-cursor-blink 1s step-end infinite;
}
.thinking-dots::after {
  content: '';
  animation: thinking-dots 1.4s steps(1, end) infinite;
}
`
