
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { MessageActionBar } from './MessageActionBar'
import { InlineImageGallery } from './InlineImageGallery'

type Props = {
  content: string
  timestamp?: number | string | Date
  isStreaming?: boolean
  agentLabel?: string
}

function formatTime(value: Props['timestamp']) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })
}

function shouldUseDocumentLayout(content: string) {
  const normalized = content.trim()
  if (!normalized) return false
  if (/```/.test(normalized)) return true
  if (/^\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.+\|)/m.test(normalized)) return true
  const paragraphs = normalized.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean)
  return paragraphs.length >= 2 || normalized.split('\n').filter((line) => line.trim()).length >= 8
}

export function AssistantMessage({ content, isStreaming, timestamp }: Props) {
  const time = formatTime(timestamp)
  const documentLayout = shouldUseDocumentLayout(content)

  return (
    <div className="group/msg">
      <div className="flex justify-start w-full">
        <div
          data-message-shell="assistant"
          data-layout={documentLayout ? 'document' : 'bubble'}
          className="flex flex-col max-w-[85%] min-w-0 w-full"
        >
          {time && (
            <span className="text-[10px] font-mono text-black/45 dark:text-white/55 tabular-nums mb-1 pl-1">
              {time}
            </span>
          )}

          <div className="w-full text-[14px] leading-[1.7] font-normal text-black/80 dark:text-white/80 tracking-[-0.005em]">
            <MarkdownRenderer content={content} variant={documentLayout ? 'document' : 'default'} />
            {!isStreaming && <InlineImageGallery text={content} />}
            {isStreaming && (
              <span className="ml-0.5 inline-block h-4 w-0.5 animate-shimmer bg-[var(--color-spacex-accent)] align-text-bottom" />
            )}
          </div>

          <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity mt-2">
            <MessageActionBar
              copyText={isStreaming ? undefined : content}
              copyLabel="Copy reply"
              align="start"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
