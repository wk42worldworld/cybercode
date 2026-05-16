import type { InputHTMLAttributes } from 'react'

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  error?: string
  required?: boolean
}

export function Input({ label, error, required, className = '', id, ...props }: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-label)' }}>
          {label}
          {required && <span className="text-[var(--color-error)] ml-0.5">*</span>}
        </label>
      )}
      <input
        id={inputId}
        className={`
          h-10 px-4 rounded-[var(--radius-md)] border text-[13px]
          bg-[var(--color-surface-container-low)] text-[var(--color-text-primary)]
          placeholder:text-[var(--color-text-tertiary)]
          transition-all duration-200
          ${error
            ? 'border-[var(--color-error)] focus:shadow-[var(--shadow-error-ring)]'
            : 'border-[var(--color-border)] focus:border-[var(--color-brand)] focus:shadow-[var(--shadow-accent-glow)]'
          }
          outline-none
          ${className}
        `}
        {...props}
      />
      {error && <p className="text-[11px] text-[var(--color-error)]">{error}</p>}
    </div>
  )
}
