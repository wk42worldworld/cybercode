import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
  /** Whether to apply uppercase + letter-spacing (SpaceX-style stencil) */
  stencil?: boolean
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-85 active:opacity-95',
  secondary:
    'bg-transparent text-[var(--color-text-primary)] border border-[var(--color-border)] hover:border-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]',
  danger:
    'bg-[var(--color-error)] text-white hover:opacity-85',
  // SpaceX-inspired ghost: translucent surface + spectral border
  ghost:
    'btn-ghost',
}

const sizeStyles = {
  sm: 'px-3 py-1 text-[11px]',
  md: 'px-4 py-1.5 text-xs',
  lg: 'px-6 py-2 text-xs',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  stencil = true,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const stencilClass = stencil
    ? 'uppercase tracking-[0.08em] font-semibold'
    : 'font-medium'
  return (
    <button
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center gap-1.5 rounded-full
        ${stencilClass} transition-all duration-150 cursor-pointer
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
