import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon } from './Icon'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
  /** Whether to apply uppercase + letter-spacing (spacex-codex tracker style) */
  stencil?: boolean
}

// Cyberpunk-refined: accent gradient CTA, terminal console glow.
const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)] hover:bg-[var(--color-btn-primary-bg-hover)] hover:shadow-[var(--shadow-accent-glow)] active:opacity-90 shadow-[var(--shadow-button-primary)]',
  secondary:
    'bg-[var(--color-surface-container)] border border-[var(--color-border)] text-[var(--color-text-primary)] hover:border-[var(--color-border-focus)]',
  danger:
    'bg-[var(--color-error)] text-[var(--color-btn-danger-fg)] hover:opacity-90 shadow-[0_4px_14px_rgba(255,59,48,0.30)]',
  ghost:
    'bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
}

const sizeStyles = {
  sm: 'h-8 px-3.5 text-[12px]',
  md: 'h-9 px-5 text-[13px]',
  lg: 'h-11 px-6 text-[14px]',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  stencil = false,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const stencilClass = stencil
    ? 'uppercase tracking-[0.10em] font-bold font-mono'
    : 'font-semibold tracking-[-0.01em]'
  return (
    <button
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center gap-1.5 rounded-[8px]
        ${stencilClass} transition-all duration-200 cursor-pointer
        focus:shadow-[var(--shadow-focus-ring)]
        disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
        ${variantStyles[variant]} ${sizeStyles[size]} ${className}
      `}
      style={{ fontFamily: 'var(--font-body)' }}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  )
}

function Spinner() {
  return <Icon name="loading" size={16} className="animate-spin" />
}
