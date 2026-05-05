
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

function formatTime(value: Props['timestamp']) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })
}

export function UserMessage({ content, attachments, timestamp, onRewind, rewindLabel }: Props) {
  const hasText = content.trim().length > 0
  const time = formatTime(timestamp)

  return (
    <div className="group/msg">
      <div className="flex justify-end w-full">
        <div
          data-message-shell="user"
          className="flex flex-col items-end max-w-[72%] min-w-0"
        >
          {time && (
            <span className="text-[10px] font-mono text-black/45 dark:text-white/55 tabular-nums mb-1 pr-1">
              {time}
            </span>
          )}

          {attachments && attachments.length > 0 && (
            <div className="mb-2 self-stretch">
              <AttachmentGallery attachments={attachments} variant="message" />
            </div>
          )}

          {hasText && (
            <div className="bg-black/[0.06] dark:bg-white/[0.08] rounded-[10px] rounded-tr-[3px] px-4 py-2.5 text-[14px] leading-[1.7] font-medium text-black/85 dark:text-white/85 whitespace-pre-wrap break-words tracking-[-0.005em]">
              {content}
            </div>
          )}

          {hasText && (
            <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity mt-1.5">
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
    </div>
  )
}
