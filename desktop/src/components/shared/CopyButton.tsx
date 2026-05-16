import { useEffect, useState } from 'react'
import { copyTextToClipboard } from '../chat/clipboard'

type Props = {
  text: string
  label?: string
  copiedLabel?: string
  displayLabel?: string
  displayCopiedLabel?: string
  className?: string
}

export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  displayLabel,
  displayCopiedLabel,
  className = '',
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

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`
        inline-flex items-center gap-1.5 rounded-[var(--radius-md)]
        px-2.5 py-1 text-[12px] font-semibold tracking-[-0.01em]
        bg-transparent text-[var(--color-text-secondary)]
        hover:text-[var(--color-brand)] hover:bg-[var(--color-surface-hover)]
        transition-all duration-200 cursor-pointer
        ${copied ? 'text-[var(--color-brand)] shadow-[var(--shadow-accent-glow)]' : ''}
        ${className}
      `}
      aria-label={currentLabel}
      title={currentLabel}
    >
      {buttonText}
    </button>
  )
}
