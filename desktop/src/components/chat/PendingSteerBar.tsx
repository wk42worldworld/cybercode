import { Clock3, CornerDownRight, Loader2, PencilLine, X } from 'lucide-react'

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

  const actionableSteers = visibleSteers.filter((steer) => steer.status === 'draft' || steer.status === 'failed')
  const queuedSteers = visibleSteers.filter((steer) => steer.status === 'queued' || steer.status === 'processing')
  const failedSteer = visibleSteers.find((steer) => steer.status === 'failed')
  const firstVisible = visibleSteers[0]!
  const preview = previewSteer(firstVisible)
  const count = visibleSteers.length
  const canSend = actionableSteers.length > 0
  const editTarget = actionableSteers[0]
  const statusText = failedSteer
    ? failedSteer.error ?? t('chat.pendingSteerFailed')
    : canSend
      ? t('chat.pendingSteerSaved', { count })
      : t('chat.pendingSteerQueued', { count })

  const cancelAll = () => {
    for (const steer of visibleSteers) {
      cancelPendingSteer(sessionId, steer.id)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[896px] px-[24px] pb-[8px]">
      <div className="flex min-w-0 flex-col gap-[8px] rounded-[18px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] px-[12px] py-[10px] shadow-[0_10px_32px_rgba(15,23,42,0.10)] sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-[10px]">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]">
            {canSend ? <Clock3 size={15} strokeWidth={2.25} /> : <Loader2 size={15} strokeWidth={2.25} className="animate-spin" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-[var(--color-text-primary)]">
              {statusText}
            </div>
            {preview && (
              <div className="mt-[2px] truncate text-[11px] font-medium text-[var(--color-text-tertiary)]">
                {preview}
                {count > 1 ? ` +${count - 1}` : ''}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-[6px]">
          {canSend && (
            <>
              {editTarget && (
                <button
                  type="button"
                  onClick={() => editPendingSteer(sessionId, editTarget.id)}
                  aria-label={t('chat.pendingSteerEdit')}
                  title={t('chat.pendingSteerEdit')}
                  className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-[var(--color-border-separator)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                >
                  <PencilLine size={13} strokeWidth={2.35} />
                </button>
              )}
              <button
                type="button"
                onClick={() => sendPendingSteers(sessionId, 'next')}
                className="inline-flex h-[30px] items-center gap-[6px] rounded-full bg-[var(--color-inverse-surface)] px-[10px] text-[11px] font-semibold text-[var(--color-inverse-on-surface)] transition-opacity hover:opacity-90"
              >
                <CornerDownRight size={13} strokeWidth={2.4} />
                {t('chat.pendingSteerJoin')}
              </button>
              <button
                type="button"
                onClick={() => sendPendingSteers(sessionId, 'later')}
                className="inline-flex h-[30px] items-center rounded-full border border-[var(--color-border-separator)] px-[10px] text-[11px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                {t('chat.pendingSteerLater')}
              </button>
            </>
          )}
          {(canSend || queuedSteers.length > 0) && (
            <button
              type="button"
              onClick={cancelAll}
              aria-label={t('chat.pendingSteerCancel')}
              className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              <X size={14} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
