import { CopyButton } from '../shared/CopyButton'
import { Icon } from '../shared/Icon'

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
            className="inline-flex min-h-6 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-2 text-[10px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-brand)]/30"
          >
            <Icon name="undo" size={12} />
            <span className="hidden min-[920px]:inline">Rewind</span>
          </button>
        )}
        {hasCopy && (
          <CopyButton
            text={copyText!}
            label={copyLabel}
            displayLabel="Copy"
            displayCopiedLabel="Copied"
            className="inline-flex min-h-6 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-2 text-[10px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-brand)]/30"
          />
        )}
      </div>
    </div>
  )
}

