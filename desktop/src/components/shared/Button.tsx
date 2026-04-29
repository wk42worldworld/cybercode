import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-85 active:opacity-95',
  secondary:
    'bg-transparent text-[var(--color-text-primary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]',
  danger:
    'bg-[var(--color-error)] text-white hover:opacity-85',
  ghost:
    'bg-transparent text-[var(--color-text-primary)] opacity-60 hover:opacity-100 hover:bg-[var(--color-surface-hover)]',
}

const sizeStyles = {
  sm: 'px-3 py-1 text-xs',
  md: 'px-4 py-1.5 text-sm',
  lg: 'px-5 py-2 text-sm',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center gap-1.5 rounded-full
        font-medium transition-all duration-150 cursor-pointer
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
