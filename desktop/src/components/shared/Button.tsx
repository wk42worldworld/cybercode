import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
  /** Whether to apply uppercase + letter-spacing (spacex-codex tracker style) */
  stencil?: boolean
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-black text-white dark:bg-white dark:text-black hover:opacity-90 active:opacity-95 shadow-md',
  secondary:
    'bg-transparent text-[var(--color-text-primary)] border-2 border-[var(--color-border)] hover:border-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]',
  danger:
    'bg-[var(--color-error)] text-white hover:opacity-90',
  // spacex-codex ghost: translucent surface + subtle border
  ghost:
    'btn-ghost',
}

const sizeStyles = {
  sm: 'h-7 px-3 text-[12px]',
  md: 'h-8 px-4 text-[13px]',
  lg: 'h-9 px-5 text-[13px]',
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
    : 'font-semibold tracking-tight'
  return (
    <button
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center gap-1.5 rounded-md
        ${stencilClass} transition-all duration-200 cursor-pointer
        disabled:opacity-40 disabled:cursor-not-allowed
        ${variantStyles[variant]} ${sizeStyles[size]} ${className}
      `}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
