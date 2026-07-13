import { CopyButton } from '../shared/CopyButton'
import { Icon } from '../shared/Icon'

type Props = {
  copyText?: string
  copyLabel: string
  onRewind?: () => void
  rewindLabel?: string
  onBranch?: () => void
  branchLabel?: string
  branchDisabledLabel?: string
  branching?: boolean
  branchDisabled?: boolean
  align?: 'start' | 'end'
}

export function MessageActionBar({
  copyText,
  copyLabel,
  onRewind,
  rewindLabel = 'Rewind to here',
  onBranch,
  branchLabel = 'Branch from this reply',
  branchDisabledLabel,
  branching = false,
  branchDisabled = false,
  align = 'start',
}: Props) {
  const hasCopy = Boolean(copyText?.trim())
  const hasRewind = Boolean(onRewind)
  const hasBranch = Boolean(onBranch)

  if (!hasCopy && !hasRewind && !hasBranch) return null

  return (
    <div
      data-message-actions
      data-align={align}
      className={`flex w-full ${
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
        {hasBranch && (
          <button
            type="button"
            data-message-branch
            onClick={onBranch}
            disabled={branchDisabled || branching}
            aria-label={branchLabel}
            aria-busy={branching || undefined}
            title={branchDisabled ? branchDisabledLabel ?? branchLabel : branchLabel}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-brand)]/30 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Icon name={branching ? 'loading' : 'account_tree'} size={13} />
          </button>
        )}
        {hasCopy && (
          <CopyButton
            text={copyText!}
            label={copyLabel}
            iconOnly
            className="border border-[var(--color-border)] hover:border-[var(--color-brand)]"
          />
        )}
      </div>
    </div>
  )
}
