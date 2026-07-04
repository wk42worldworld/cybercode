import { useEffect, useState } from 'react'
import { copyTextToClipboard } from '../chat/clipboard'
import { Icon } from './Icon'

type Props = {
  text: string
  label?: string
  copiedLabel?: string
  displayLabel?: string
  displayCopiedLabel?: string
  className?: string
  iconOnly?: boolean
}

export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  displayLabel,
  displayCopiedLabel,
  className = '',
  iconOnly = false,
}: Props) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    try {
      const ok = await copyTextToClipboard(text)
      if (!ok) {
        setCopied(false)
        return
      }
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const currentLabel = copied ? copiedLabel : label
  const buttonText = copied
    ? (displayCopiedLabel ?? copiedLabel)
    : (displayLabel ?? label)
  const shapeClassName = iconOnly
    ? 'h-6 w-6 justify-center p-0 text-[12px] bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-brand)]'
    : 'gap-1.5 px-2.5 py-1 text-[12px] font-semibold tracking-[-0.01em] bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-brand)] hover:bg-[var(--color-surface-hover)]'

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`
        inline-flex items-center rounded-[var(--radius-md)]
        transition-all duration-200 cursor-pointer
        focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-brand)]/30
        ${shapeClassName}
        ${copied ? 'text-[var(--color-brand)] shadow-[var(--shadow-accent-glow)]' : ''}
        ${className}
      `}
      aria-label={currentLabel}
      title={currentLabel}
    >
      {iconOnly ? (
        <Icon name={copied ? 'check' : 'content_copy'} size={12} />
      ) : (
        buttonText
      )}
    </button>
  )
}
