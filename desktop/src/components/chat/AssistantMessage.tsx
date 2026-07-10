import type { UIMessage } from '../../types/chat'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { MessageActionBar } from './MessageActionBar'
import { InlineImageGallery } from './InlineImageGallery'
import { MessageExecutionLog } from './MessageExecutionLog'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>

type Props = {
  content: string
  timestamp?: number | string | Date
  isStreaming?: boolean
  agentLabel?: string
  toolCalls?: ToolCall[]
  resultMap?: Map<string, ToolResult>
  childToolCallsByParent?: Map<string, ToolCall[]>
  isToolExecutionActive?: boolean
}

function isDocumentLike(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false
  const paragraphs = trimmed.split(/\n{2,}/).filter((part) => part.trim().length > 0)
  if (/```/.test(trimmed)) return true
  if (/^#{1,4}\s+/m.test(trimmed)) return true
  if (/^\s*[-*]\s+\S/m.test(trimmed) && trimmed.length > 180) return true
  if (/^\s*\d+\.\s+\S/m.test(trimmed) && trimmed.length > 180) return true
  if (paragraphs.length >= 3 && trimmed.length > 420) return true
  return false
}

export function AssistantMessage({
  content,
  isStreaming,
  toolCalls,
  resultMap,
  childToolCallsByParent,
  isToolExecutionActive = true,
}: Props) {
  const layout = !isStreaming && isDocumentLike(content) ? 'document' : 'bubble'

  return (
    <div className="group/msg flex w-full justify-center px-[24px] py-[8px]">
      <div
        data-message-shell="assistant"
        data-layout={layout}
        className="flex w-full max-w-[878px] flex-col items-start"
      >
        <div className="relative">
          <div
            data-message-bubble="assistant"
            className={
              layout === 'document'
                ? 'w-full rounded-[24px] rounded-tl-[8px] border border-[var(--color-border)] bg-[var(--color-message-assistant-bg)] px-[24px] py-[16px] text-[var(--color-text-primary)]'
                : 'w-fit max-w-[85%] rounded-[24px] rounded-tl-[8px] border border-[var(--color-border)] bg-[var(--color-message-assistant-bg)] px-[24px] py-[16px] text-[var(--color-text-primary)]'
            }
          >
            <div className="chat-bubble-text text-[15px] font-normal leading-relaxed tracking-normal text-[var(--color-text-primary)]">
              {isStreaming ? (
                <span className="whitespace-pre-wrap">{content}</span>
              ) : (
                <>
                  <MarkdownRenderer content={content} variant="chat" />
                  <InlineImageGallery text={content} />
                </>
              )}
              {isStreaming && (
                <span className="ml-[2px] inline-block h-[20px] w-[2px] animate-shimmer bg-[var(--color-brand)] align-text-bottom" />
              )}
            </div>
          </div>
        </div>

        {toolCalls && resultMap && (
          <MessageExecutionLog
            toolCalls={toolCalls}
            resultMap={resultMap}
            childToolCallsByParent={childToolCallsByParent}
            isActive={isToolExecutionActive}
          />
        )}

        <div className="mt-[2px] opacity-0 transition-opacity group-hover/msg:opacity-100">
          <MessageActionBar
            copyText={isStreaming ? undefined : content}
            copyLabel="Copy reply"
            align="start"
          />
        </div>
      </div>
    </div>
  )
}
