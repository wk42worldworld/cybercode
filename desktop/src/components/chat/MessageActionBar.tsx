import { CopyButton } from '../shared/CopyButton'

type Props = {
  copyText?: string
  copyLabel: string
  onRewind?: () => void
  rewindLabel?: string
  align?: 'start' | 'end'
}

export function MessageActionBar({
  copyText,
  copyLabel,
  onRewind,
  rewindLabel = 'Rewind to here',
  align = 'start',
}: Props) {
  const hasCopy = Boolean(copyText?.trim())
  const hasRewind = Boolean(onRewind)

  if (!hasCopy && !hasRewind) return null

  return (
    <div
      data-message-actions
      data-align={align}
      className={`flex w-full opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 ${
        align === 'end' ? 'justify-end' : 'justify-start'
      }`}
    >
      <div className="flex items-center gap-1.5">
        {hasRewind && (
          <button
            type="button"
            onClick={onRewind}
            aria-label={rewindLabel}
            title={rewindLabel}
            className="inline-flex min-h-7 items-center gap-1 rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-low)] px-2.5 text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-brand)]/35 hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35"
          >
            <span className="material-symbols-outlined text-[14px]">undo</span>
            <span className="hidden min-[920px]:inline">Rewind</span>
          </button>
        )}
        {hasCopy && (
          <CopyButton
            text={copyText!}
            label={copyLabel}
            displayLabel="Copy"
            displayCopiedLabel="Copied"
            className="inline-flex min-h-7 items-center rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-low)] px-2.5 text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-brand)]/35 hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35"
          />
        )}
      </div>
    </div>
  )
}
