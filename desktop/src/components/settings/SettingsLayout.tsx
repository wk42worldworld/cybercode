import type { ReactNode } from 'react'

/* ── Settings primitives ──────────────────────────────────────────────
 * Cyberpunk-Refined: deep space black + electric cyan (#00f0ff) accent.
 * Terminal / space-capsule console feel. Geist font. No Inter.
 * No backdrop-blur. CSS variables throughout. */

export function SettingsPage({
  title,
  description,
  children,
}: {
  title?: string
  description?: string
  /** Kept for existing callsites; settings page headers intentionally render text only. */
  icon?: string
  children: ReactNode
}) {
  const hasHeader = !!(title || description)
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
      {hasHeader && (
        <header className="flex flex-col gap-1.5 pb-2">
          <div className="flex items-center">
            {title && (
              <h1 className="text-[24px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                {title}
              </h1>
            )}
          </div>
          {description && (
            <p className="text-[13px] leading-[1.6] text-[var(--color-text-secondary)]">
              {description}
            </p>
          )}
        </header>
      )}
      {children}
    </div>
  )
}

export function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title?: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  const hasHeader = !!(title || description || action)
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container)]">
      {hasHeader && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-[var(--color-border-separator)]">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[13px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 text-[12px] leading-[1.5] text-[var(--color-text-tertiary)]">
                {description}
              </p>
            )}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </header>
      )}
      <div className="divide-y divide-[var(--color-border-separator)]">
        {children}
      </div>
    </section>
  )
}

export function SettingsRow({
  label,
  hint,
  children,
  align = 'center',
}: {
  label?: string
  hint?: string
  children: ReactNode
  align?: 'center' | 'start'
}) {
  const hasLabel = !!(label || hint)
  return (
    <div
      className={`flex gap-4 px-5 py-3.5 ${align === 'start' ? 'items-start' : 'items-center'} ${hasLabel ? '' : 'justify-end'}`}
    >
      {hasLabel && (
        <div className="min-w-0 flex-1">
          {label && (
            <div className="text-[13px] font-medium tracking-tight text-[var(--color-text-primary)]">
              {label}
            </div>
          )}
          {hint && (
            <p className="mt-1 text-[11px] leading-[1.6] text-[var(--color-text-tertiary)]">
              {hint}
            </p>
          )}
        </div>
      )}
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<{ value: T; label: string }>
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg bg-[var(--color-surface-container-low)] p-0.5">
      {items.map((item) => {
        const isActive = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`min-w-[56px] cursor-pointer rounded-[7px] px-3.5 py-1 text-[12px] font-medium tracking-tight transition-all duration-150 ${
              isActive
                ? 'bg-[var(--color-surface-container-high)] text-[var(--color-brand)] shadow-[var(--shadow-focus-ring)]'
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

export function Switch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[26px] w-[44px] cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${
        checked ? 'bg-[var(--color-brand)]' : 'bg-black/25 dark:bg-white/25'
      }`}
    >
      <span
        className={`inline-block h-[22px] w-[22px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.20),0_1px_1px_rgba(0,0,0,0.04)] transition-transform duration-200 ${
          checked ? 'translate-x-[20px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  )
}
