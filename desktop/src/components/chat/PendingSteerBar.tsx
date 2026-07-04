import { AlertCircle, Clock3, CornerDownRight, Loader2, PencilLine, X } from 'lucide-react'

import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import type { PendingSteer } from '../../stores/chatStore'

type PendingSteerBarProps = {
  sessionId: string
}

const EMPTY_PENDING_STEERS: PendingSteer[] = []

function previewSteer(steer: PendingSteer): string {
  const text = steer.content.trim()
  if (text) return text
  const firstAttachment = steer.attachments?.[0]
  return firstAttachment?.name ?? firstAttachment?.path ?? ''
}

export function PendingSteerBar({ sessionId }: PendingSteerBarProps) {
  const t = useTranslation()
  const pendingSteers = useChatStore((s) => s.sessions[sessionId]?.pendingSteers ?? EMPTY_PENDING_STEERS)
  const sendPendingSteers = useChatStore((s) => s.sendPendingSteers)
  const editPendingSteer = useChatStore((s) => s.editPendingSteer)
  const cancelPendingSteer = useChatStore((s) => s.cancelPendingSteer)

  const visibleSteers = pendingSteers.filter((steer) => steer.status !== 'cancelled' && steer.status !== 'processed')
  if (visibleSteers.length === 0) return null

  return (
    <div className="mx-auto w-full max-w-[896px] px-[24px] pb-[8px]">
      <div className="flex min-w-0 flex-col gap-[6px] rounded-[14px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] p-[6px] shadow-[0_10px_32px_rgba(15,23,42,0.10)]">
        {visibleSteers.map((steer) => {
          const canAct = steer.status === 'draft' || steer.status === 'failed'
          const isRunning = steer.status === 'queued' || steer.status === 'processing'
          const preview = previewSteer(steer)

          return (
            <div
              key={steer.id}
              className="flex h-[36px] min-w-0 items-center gap-[8px] rounded-[10px] bg-[var(--color-surface-container-low)] px-[8px] text-[var(--color-text-secondary)]"
            >
              <span className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-[8px] text-[var(--color-text-tertiary)]">
                {steer.status === 'failed' ? (
                  <AlertCircle size={14} strokeWidth={2.35} className="text-[var(--color-error)]" />
                ) : isRunning ? (
                  <Loader2 size={14} strokeWidth={2.35} className="animate-spin" />
                ) : (
                  <Clock3 size={14} strokeWidth={2.35} />
                )}
              </span>
              <div
                className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--color-text-primary)]"
                title={preview}
              >
                {preview}
              </div>
              <div className="flex shrink-0 items-center gap-[4px]">
                {canAct && (
                  <>
                    <button
                      type="button"
                      onClick={() => sendPendingSteers(sessionId, 'next', [steer.id])}
                      aria-label={t('chat.pendingSteerJoin')}
                      title={t('chat.pendingSteerJoin')}
                      className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    >
                      <CornerDownRight size={14} strokeWidth={2.4} />
                    </button>
                    <button
                      type="button"
                      onClick={() => editPendingSteer(sessionId, steer.id)}
                      aria-label={t('chat.pendingSteerEdit')}
                      title={t('chat.pendingSteerEdit')}
                      className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    >
                      <PencilLine size={14} strokeWidth={2.35} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => cancelPendingSteer(sessionId, steer.id)}
                  aria-label={t('chat.pendingSteerCancel')}
                  title={t('chat.pendingSteerCancel')}
                  className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                >
                  <X size={14} strokeWidth={2.4} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
