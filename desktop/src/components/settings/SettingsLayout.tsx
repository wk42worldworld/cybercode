import type { ReactNode } from 'react'

export function SettingsPage({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">{title}</h1>
        {description && <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">{description}</p>}
      </header>
      {children}
    </div>
  )
}

export function SettingsSection({ title, description, action, children }: { title?: string; description?: string; action?: ReactNode; children: ReactNode }) {
  const hasHeader = !!(title || description || action)
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)]/60">
      {hasHeader && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">{description}</p>}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </header>
      )}
      <div className={`px-5 ${hasHeader ? 'pb-2' : 'py-2'}`}>{children}</div>
    </section>
  )
}

export function SettingsRow({ label, hint, children, align = 'center' }: { label?: string; hint?: string; children: ReactNode; align?: 'center' | 'start' }) {
  const hasLabel = !!(label || hint)
  return (
    <div className={`flex gap-4 border-b border-[var(--color-border)]/40 py-3 last:border-b-0 ${align === 'start' ? 'items-start' : 'items-center'} ${hasLabel ? '' : 'justify-end'}`}>
      {hasLabel && (
        <div className="min-w-0 flex-1">
          {label && <div className="text-sm text-[var(--color-text-primary)]">{label}</div>}
          {hint && <p className="mt-0.5 text-[11px] leading-5 text-[var(--color-text-tertiary)]">{hint}</p>}
        </div>
      )}
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

export function SegmentedControl<T extends string>({ items, value, onChange }: { items: Array<{ value: T; label: string }>; value: T; onChange: (next: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container)] p-0.5">
      {items.map((item) => {
        const isActive = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`min-w-[52px] cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export function Switch({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (next: boolean) => void; ariaLabel?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${
        checked ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-border)]'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
