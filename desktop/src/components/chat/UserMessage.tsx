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
}

export function UserMessage({ content, attachments, onRewind, rewindLabel }: Props) {
  const t = useTranslation()
  const {
    actionsVisible,
    showActions,
    scheduleHideActions,
    hideActions,
  } = useMessageActionVisibility()
  const hasText = content.trim().length > 0
  const hasAttachments = Boolean(attachments && attachments.length > 0)

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
            data-message-hover-trigger
            data-message-bubble="user"
            onPointerEnter={showActions}
            onPointerLeave={scheduleHideActions}
            className="flex max-w-[85%] flex-col gap-[10px] rounded-[24px] rounded-tr-[8px] bg-[var(--color-message-user-bg)] px-[18px] py-[12px] text-[var(--color-message-user-fg)]"
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
        )}

        {(hasText || hasAttachments) && (
          <div
            data-actions-visible={actionsVisible ? 'true' : 'false'}
            className="message-action-visibility mr-[16px]"
          >
            <MessageActionBar
              copyText={content}
              copyLabel={t('chat.copyPrompt')}
              onRewind={onRewind}
              rewindLabel={rewindLabel}
              align="end"
              onPointerEnter={showActions}
              onPointerLeave={hideActions}
            />
          </div>
        )}
      </div>
    </div>
  )
}
