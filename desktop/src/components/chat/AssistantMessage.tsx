import type { UIMessage } from '../../types/chat'
import { useTranslation } from '../../i18n'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { MessageActionBar } from './MessageActionBar'
import { InlineImageGallery } from './InlineImageGallery'
import { MessageExecutionLog } from './MessageExecutionLog'
import { SmoothStreamingText } from './SmoothStreamingText'
import { useMessageActionVisibility } from './useMessageActionVisibility'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>

type Props = {
  content: string
  timestamp?: number | string | Date
  isStreaming?: boolean
  onStreamingSettled?: () => void
  agentLabel?: string
  toolCalls?: ToolCall[]
  resultMap?: Map<string, ToolResult>
  childToolCallsByParent?: Map<string, ToolCall[]>
  isToolExecutionActive?: boolean
  onBranch?: () => void
  branchLabel?: string
  branchDisabledLabel?: string
  isBranching?: boolean
  branchDisabled?: boolean
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
  onStreamingSettled,
  toolCalls,
  resultMap,
  childToolCallsByParent,
  isToolExecutionActive = true,
  onBranch,
  branchLabel,
  branchDisabledLabel,
  isBranching = false,
  branchDisabled = false,
}: Props) {
  const t = useTranslation()
  const {
    actionsVisible,
    showActions,
    scheduleHideActions,
    hideActions,
  } = useMessageActionVisibility()
  const layout = !isStreaming && isDocumentLike(content) ? 'document' : 'bubble'
  const useStableBubbleWidth = layout === 'document' || content.length >= 48

  return (
    <div
      data-message-hover-group
      className="flex w-full justify-center px-[24px] py-[8px]"
    >
      <div
        data-chat-content-column
        data-message-shell="assistant"
        data-layout={layout}
        className="flex w-full max-w-[878px] flex-col items-start"
      >
        <div
          className="pointer-events-none relative w-full"
        >
          <div
            data-message-hover-trigger
            data-message-bubble="assistant"
            onPointerEnter={showActions}
            onPointerLeave={scheduleHideActions}
            className={
              layout === 'document'
                ? 'pointer-events-auto w-full rounded-[24px] rounded-bl-[8px] border border-[var(--color-border)] bg-[var(--color-message-assistant-bg)] px-[18px] py-[12px] text-[var(--color-text-primary)]'
                : useStableBubbleWidth
                  ? 'pointer-events-auto w-full max-w-[85%] rounded-[24px] rounded-bl-[8px] border border-[var(--color-border)] bg-[var(--color-message-assistant-bg)] px-[18px] py-[12px] text-[var(--color-text-primary)]'
                  : 'pointer-events-auto w-fit max-w-[85%] rounded-[24px] rounded-bl-[8px] border border-[var(--color-border)] bg-[var(--color-message-assistant-bg)] px-[18px] py-[12px] text-[var(--color-text-primary)]'
            }
          >
            <div className="chat-bubble-text text-[14px] font-normal leading-relaxed tracking-normal text-[var(--color-text-primary)]">
              {isStreaming ? (
                <SmoothStreamingText
                  content={content}
                  onCaughtUp={onStreamingSettled}
                />
              ) : (
                <>
                  <MarkdownRenderer content={content} variant="chat" />
                  <InlineImageGallery text={content} />
                </>
              )}
              {isStreaming && (
                <span
                  aria-hidden="true"
                  className="streaming-type-caret ml-[2px] inline-block h-[19px] w-[2px] align-text-bottom"
                />
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
            onPointerEnter={showActions}
            onPointerLeave={scheduleHideActions}
          />
        )}

        <div
          data-actions-visible={actionsVisible ? 'true' : 'false'}
          className="message-action-visibility ml-[16px] min-h-6"
        >
          <MessageActionBar
            copyText={isStreaming ? undefined : content}
            copyLabel={t('chat.copyReply')}
            onBranch={isStreaming ? undefined : onBranch}
            branchLabel={branchLabel}
            branchDisabledLabel={branchDisabledLabel}
            branching={isBranching}
            branchDisabled={branchDisabled}
            align="start"
            onPointerEnter={showActions}
            onPointerLeave={hideActions}
          />
        </div>
      </div>
    </div>
  )
}
