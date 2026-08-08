import type { UIAttachment } from '../../types/chat'
import { useTranslation } from '../../i18n'
import { AttachmentGallery } from './AttachmentGallery'
import { MessageActionBar } from './MessageActionBar'
import { useMessageActionVisibility } from './useMessageActionVisibility'

type Props = {
  content: string
  timestamp?: number | string | Date
  attachments?: UIAttachment[]
  onRewind?: () => void
  rewindLabel?: string
  anchorHighlightToken?: number
}

export function UserMessage({
  content,
  attachments,
  onRewind,
  rewindLabel,
  anchorHighlightToken,
}: Props) {
  const t = useTranslation()
  const {
    actionsVisible,
    showActions,
    scheduleHideActions,
  } = useMessageActionVisibility()
  const hasText = content.trim().length > 0
  const hasAttachments = Boolean(attachments && attachments.length > 0)
  const anchorHighlightClass = typeof anchorHighlightToken === 'number'
    ? anchorHighlightToken % 2 === 0
      ? ' anchor-user-bubble-highlight anchor-user-bubble-highlight-even'
      : ' anchor-user-bubble-highlight anchor-user-bubble-highlight-odd'
    : ''

  return (
    <div
      data-message-hover-group
      className="flex w-full justify-center px-[24px] py-[8px]"
    >
      <div
        data-chat-content-column
        data-message-shell="user"
        className="flex w-full max-w-[878px] flex-col items-end"
      >
        {(hasText || hasAttachments) && (
          <div
            data-message-row="user"
            onPointerEnter={showActions}
            onPointerLeave={scheduleHideActions}
            className="flex w-full items-end justify-end gap-[8px]"
          >
            <div
              data-actions-visible={actionsVisible ? 'true' : 'false'}
              className="message-action-visibility flex shrink-0 items-center"
            >
              <MessageActionBar
                copyText={content}
                copyLabel={t('chat.copyPrompt')}
                onRewind={onRewind}
                rewindLabel={rewindLabel}
                align="end"
                onPointerEnter={showActions}
                onPointerLeave={scheduleHideActions}
              />
            </div>
            <div
              data-message-hover-trigger
              data-message-bubble="user"
              onPointerEnter={showActions}
              onPointerLeave={scheduleHideActions}
              className={`user-message-bubble flex max-w-[85%] flex-col gap-[10px] rounded-[24px] rounded-tr-[8px] px-[18px] py-[12px]${anchorHighlightClass}`}
            >
              {hasAttachments && (
                <AttachmentGallery attachments={attachments!} variant="message" />
              )}
              {hasText && (
                <div className="chat-bubble-text whitespace-pre-wrap break-words text-[14px] font-normal leading-relaxed tracking-normal">
                  {content}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
