import { useTranslation } from '../../i18n'
import type { ChatState } from '../../types/chat'
import { Icon } from '../shared/Icon'

export const NO_VISIBLE_RESPONSE_NOTICE_SECONDS = 45
export const CONNECTION_STALE_NOTICE_SECONDS = 90

export function formatRunningDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  if (safeSeconds < 60) return `${safeSeconds}s`
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  if (minutes < 60) return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

type LongRunningNoticeProps = {
  chatState: ChatState
  elapsedSeconds: number
  hasVisibleResponse: boolean
  lastConnectionActivityAt?: number | null
  suppress?: boolean
  onStop?: () => void
}

export function LongRunningNotice({
  chatState,
  elapsedSeconds,
  hasVisibleResponse,
  lastConnectionActivityAt,
  suppress = false,
  onStop,
}: LongRunningNoticeProps) {
  const t = useTranslation()

  if (suppress || chatState === 'idle' || chatState === 'permission_pending') return null

  const now = Date.now()
  const connectionIdleSeconds = lastConnectionActivityAt
    ? Math.max(0, Math.floor((now - lastConnectionActivityAt) / 1000))
    : elapsedSeconds
  const connectionLooksStale = connectionIdleSeconds >= CONNECTION_STALE_NOTICE_SECONDS
  const hasNoVisibleResponse =
    !hasVisibleResponse && elapsedSeconds >= NO_VISIBLE_RESPONSE_NOTICE_SECONDS

  if (!hasNoVisibleResponse && !connectionLooksStale) return null

  const title = connectionLooksStale
    ? t('longRunning.connectionStaleTitle')
    : t('longRunning.waitingTitle')
  const detail = connectionLooksStale
    ? t('longRunning.connectionStaleBody', { idle: formatRunningDuration(connectionIdleSeconds) })
    : t('longRunning.waitingBody', { elapsed: formatRunningDuration(elapsedSeconds) })
  const iconName = connectionLooksStale ? 'warning' : 'wifi'

  return (
    <div className="shrink-0 px-[24px] pb-1" role="status" aria-live="polite" data-testid="long-running-notice">
      <div data-chat-content-column className="mx-auto flex w-full max-w-[878px] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] ${
            connectionLooksStale
              ? 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]'
              : 'bg-[var(--color-brand)]/10 text-[var(--color-brand)]'
          }`}
        >
          <Icon name={iconName} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-[var(--color-text-primary)]">
            {title}
          </div>
          <div className="truncate text-[11px] text-[var(--color-text-tertiary)]">
            {detail}
          </div>
        </div>
        {onStop && (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] px-2.5 text-[11px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-black/15 dark:focus-visible:ring-white/20"
          >
            <Icon name="stop" size={12} />
            <span>{t('longRunning.stop')}</span>
          </button>
        )}
      </div>
    </div>
  )
}
