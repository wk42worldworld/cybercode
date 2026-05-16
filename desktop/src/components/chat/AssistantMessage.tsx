
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
}

export function AssistantMessage({ content, isStreaming, toolCalls, resultMap }: Props) {
  return (
    <div className="flex justify-start w-full px-8 py-1 group/msg">
      <div className="flex flex-col w-fit max-w-[75%]">
        <div className="relative">
          <div
            data-message-shell="assistant"
            className="w-fit max-w-full bg-[var(--color-message-assistant-bg)] text-[var(--color-text-primary)] rounded-[20px] rounded-bl-[6px] px-4 py-2.5 border border-[var(--color-border-separator)] shadow-sm shadow-black/[0.03] dark:shadow-black/20"
          >
            <div className="text-[15px] leading-[1.7] tracking-[0.01em]">
              {isStreaming ? (
                <span className="whitespace-pre-wrap">{content}</span>
              ) : (
                <>
                  <MarkdownRenderer content={content} variant="default" />
                  <InlineImageGallery text={content} />
                </>
              )}
              {isStreaming && (
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-shimmer bg-[var(--color-brand)] align-text-bottom" />
              )}
            </div>
          </div>
        </div>

        {toolCalls && resultMap && (
          <MessageExecutionLog toolCalls={toolCalls} resultMap={resultMap} />
        )}

        <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity mt-0.5">
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
