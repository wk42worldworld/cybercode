import type { TextareaHTMLAttributes } from 'react'

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string
  error?: string
  required?: boolean
}

export function Textarea({ label, error, required, className = '', id, ...props }: TextareaProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-label)' }}>
          {label}
          {required && <span className="text-[var(--color-error)] ml-0.5">*</span>}
        </label>
      )}
      <textarea
        id={inputId}
        className={`
          min-h-[120px] px-3 py-2 rounded-[var(--radius-md)] border text-[14px] resize-y
          bg-[var(--color-surface-container-low)] text-[var(--color-text-primary)]
          placeholder:text-[var(--color-text-tertiary)]
          transition-all duration-200
          ${error
            ? 'border-[var(--color-error)]'
            : 'border-[var(--color-border)] focus:shadow-[var(--shadow-focus-ring)] focus:border-[var(--color-border-focus)]'
          }
          outline-none
          ${className}
        `}
        style={{ resize: 'vertical', scrollbarColor: 'var(--color-accent-glow) transparent' }}
        {...props}
      />
      {error && <p className="text-[11px] text-[var(--color-error)]">{error}</p>}
    </div>
  )
}
