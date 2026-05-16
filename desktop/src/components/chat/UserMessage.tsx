
import type { UIAttachment } from '../../types/chat';
import { AttachmentGallery } from './AttachmentGallery';
import { MessageActionBar } from './MessageActionBar';

type Props = {
  content: string;
  timestamp?: number | string | Date;
  attachments?: UIAttachment[];
  onRewind?: () => void;
  rewindLabel?: string;
};

export function UserMessage({ content, attachments, onRewind, rewindLabel }: Props) {
  const hasText = content.trim().length > 0;

  return (
    <div className="flex justify-end w-full px-8 py-1 group/msg">
      <div className="flex flex-col items-end max-w-[75%]">
        {attachments && attachments.length > 0 && (
          <div className="mb-2">
            <AttachmentGallery attachments={attachments} variant="message" />
          </div>
        )}

        {hasText && (
          <div className="bg-[var(--color-message-user-bg)] text-[var(--color-message-user-fg)] rounded-[20px] rounded-br-[6px] px-4 py-2.5 shadow-sm shadow-black/20">
            <div className="text-[16px] font-semibold leading-[1.55] tracking-[0.01em] whitespace-pre-wrap break-words">
              {content}
            </div>
          </div>
        )}

        {hasText && (
          <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity mt-0.5">
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
  );
}
