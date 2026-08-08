import type { PointerEventHandler } from 'react'
import { CopyButton } from '../shared/CopyButton'
import { Icon } from '../shared/Icon'
import { useTranslation } from '../../i18n'

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
  onPointerEnter?: PointerEventHandler<HTMLDivElement>
  onPointerLeave?: PointerEventHandler<HTMLDivElement>
}

const messageActionButtonClassName = [
  'message-action-button inline-flex h-[24px] w-[24px] shrink-0 items-center justify-center',
  'rounded-[8px] border-0 bg-[var(--color-surface-container-low)] bg-clip-padding',
  'text-[var(--color-text-tertiary)] shadow-[inset_0_0_0_1px_var(--color-border)]',
  'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-brand)]',
  'hover:shadow-[inset_0_0_0_1px_var(--color-brand)]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/20',
].join(' ')

export function MessageActionBar({
  copyText,
  copyLabel,
  onRewind,
  rewindLabel,
  onBranch,
  branchLabel,
  branchDisabledLabel,
  branching = false,
  branchDisabled = false,
  align = 'start',
  onPointerEnter,
  onPointerLeave,
}: Props) {
  const t = useTranslation()
  const resolvedRewindLabel = rewindLabel ?? t('chat.rewindAction')
  const resolvedBranchLabel = branchLabel ?? t('chat.branchAction')
  const hasCopy = Boolean(copyText?.trim())
  const hasRewind = Boolean(onRewind)
  const hasBranch = Boolean(onBranch)

  if (!hasCopy && !hasRewind && !hasBranch) return null

  return (
    <div
      data-message-actions
      data-align={align}
      className="pointer-events-none inline-flex w-auto shrink-0"
    >
      <div
        data-message-action-cluster
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        className="pointer-events-auto flex items-center gap-[6px]"
      >
        {hasRewind && (
          <button
            type="button"
            onClick={onRewind}
            aria-label={resolvedRewindLabel}
            title={resolvedRewindLabel}
            className={messageActionButtonClassName}
          >
            <Icon name="undo" size={12} />
          </button>
        )}
        {hasBranch && (
          <button
            type="button"
            data-message-branch
            onClick={onBranch}
            disabled={branchDisabled || branching}
            aria-label={resolvedBranchLabel}
            aria-busy={branching || undefined}
            title={branchDisabled ? branchDisabledLabel ?? resolvedBranchLabel : resolvedBranchLabel}
            className={`${messageActionButtonClassName} disabled:cursor-not-allowed disabled:opacity-45`}
          >
            <Icon name={branching ? 'loading' : 'account_tree'} size={12} />
          </button>
        )}
        {hasCopy && (
          <CopyButton
            text={copyText!}
            label={copyLabel}
            copiedLabel={t('chat.copySuccess')}
            iconOnly
            className={messageActionButtonClassName}
          />
        )}
      </div>
    </div>
  )
}
