import type { UIAttachment } from '../../types/chat'
import { AttachmentGallery } from './AttachmentGallery'
import { MessageActionBar } from './MessageActionBar'

type Props = {
  content: string
  timestamp?: number | string | Date
  attachments?: UIAttachment[]
  onRewind?: () => void
  rewindLabel?: string
}

export function UserMessage({ content, attachments, onRewind, rewindLabel }: Props) {
  const hasText = content.trim().length > 0

  return (
    <div className="group/msg flex w-full justify-center px-[24px] py-[12px]">
      <div
        data-message-shell="user"
        className="flex w-full max-w-[878px] flex-col items-end gap-[8px]"
      >
        {attachments && attachments.length > 0 && (
          <div className="mb-[8px]">
            <AttachmentGallery attachments={attachments} variant="message" />
          </div>
        )}

        {hasText && (
          <div
            data-message-bubble="user"
            className="max-w-[85%] rounded-[24px] rounded-tr-[8px] bg-[var(--color-message-user-bg)] px-[24px] py-[16px] text-[var(--color-message-user-fg)]"
          >
            <div className="chat-bubble-text whitespace-pre-wrap break-words text-[15px] font-normal leading-relaxed tracking-normal">
              {content}
            </div>
          </div>
        )}

        {hasText && (
          <div className="mt-[2px] opacity-0 transition-opacity group-hover/msg:opacity-100">
            <MessageActionBar
              copyText={content}
              copyLabel="Copy prompt"
              onRewind={onRewind}
              rewindLabel={rewindLabel}
              align="end"
            />
          </div>
        )}
      </div>
    </div>
  )
}
