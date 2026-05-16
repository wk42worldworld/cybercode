import { CodeViewer } from './CodeViewer'
import { useState } from 'react'
import { useTranslation } from '../../i18n'
import { InlineImageGallery } from './InlineImageGallery'
import { Icon } from '../shared/Icon'

type Props = {
  content: unknown
  isError: boolean
  toolName?: string
  standalone?: boolean
}

/**
 * Standalone tool result block — only shown when not already rendered
 * inline within ToolCallBlock (i.e., when the tool_use and tool_result
 * are NOT grouped together by MessageList).
 */
export function ToolResultBlock({ content, isError, toolName, standalone = true }: Props) {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslation()

  // Don't render standalone if this result is already rendered inline
  if (!standalone) return null

  const text = extractText(content)
  const preview = text.slice(0, 200)
  const hasMore = text.length > 200

  return (
    <div className={`mb-1.5 overflow-hidden rounded-[10px] ${
      isError
        ? 'bg-red-500/[0.06] dark:bg-red-500/[0.08]'
        : 'bg-black/[0.03] dark:bg-white/[0.04]'
    }`}>
      <div className="min-w-0">
        {/* Status header */}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className={`flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors ${
            isError
              ? 'text-[var(--color-error)]'
              : 'text-[var(--color-text-tertiary)]'
          }`}
        >
          <span className="flex items-center gap-1.5 text-[11px] font-medium">
            <Icon name={isError ? 'error' : 'check_circle'} size={12} />
            {toolName ? t('tool.result', { toolName }) : t('tool.resultGeneric')}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
            isError
              ? 'bg-red-500/10 text-[var(--color-error)]'
              : 'bg-black/5 dark:bg-white/10 text-black/40 dark:text-white/40'
          }`}>
            {isError ? t('tool.error') : t('tool.success')}
          </span>
        </button>

        {/* Inline image gallery from detected paths */}
        <InlineImageGallery text={text} />

        {/* Content */}
        {expanded ? (
          isError ? (
            <div className="px-3 pb-2 font-[var(--font-mono)] text-[11px] leading-[1.5] whitespace-pre-wrap break-words text-[var(--color-error)]">
              {text}
            </div>
          ) : (
            <CodeViewer
              code={text}
              language="plaintext"
              maxLines={12}
            />
          )
        ) : (
          <div className="px-3 pb-2 font-[var(--font-mono)] text-[10px] leading-[1.35] text-[var(--color-text-tertiary)]">
            {preview}
            {hasMore ? '...' : ''}
          </div>
        )}

        {hasMore && (
          <button
            onClick={() => setExpanded((value) => !value)}
            className="w-full py-1 text-[10px] font-medium text-black/30 dark:text-white/30 hover:text-black/50 dark:hover:text-white/50 transition-colors"
          >
            {expanded ? t('tool.showLess') : t('tool.showMore', { count: text.length - 200 })}
          </button>
        )}
      </div>
    </div>
  )
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === 'string' ? c : c?.text || ''))
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object') {
    return JSON.stringify(content, null, 2)
  }
  return String(content ?? '')
}
