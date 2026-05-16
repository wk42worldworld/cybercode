import type { ReactNode } from 'react'

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
    <div className="mx-auto flex w-full max-w-[896px] flex-col gap-[24px]">
      {hasHeader && (
        <header className="flex min-h-[72px] flex-col justify-center gap-[6px] pb-[4px]">
          <div className="flex items-center">
            {title && (
              <h1 className="text-[22px] font-bold tracking-normal text-[var(--color-text-primary)]">
                {title}
              </h1>
            )}
          </div>
          {description && (
            <p className="max-w-[680px] text-[13px] leading-[20px] text-[var(--color-text-secondary)]">
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
    <section className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
      {hasHeader && (
        <header className="flex min-h-[64px] items-center justify-between gap-[16px] border-b border-[var(--color-border-separator)] px-[20px] py-[12px]">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[13px] font-bold tracking-normal text-[var(--color-text-primary)]">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-[4px] text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">
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
      className={`flex min-h-[64px] gap-[16px] px-[20px] py-[12px] ${align === 'start' ? 'items-start' : 'items-center'} ${hasLabel ? '' : 'justify-end'}`}
    >
      {hasLabel && (
        <div className="min-w-0 flex-1">
          {label && (
            <div className="text-[13px] font-bold tracking-normal text-[var(--color-text-primary)]">
              {label}
            </div>
          )}
          {hint && (
            <p className="mt-[4px] text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
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
    <div className="inline-flex h-[36px] items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-[3px]">
      {items.map((item) => {
        const isActive = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`flex h-[28px] min-w-[60px] cursor-pointer items-center justify-center rounded-full px-[12px] text-[13px] font-bold tracking-normal transition-colors duration-150 ${
              isActive
                ? 'bg-black text-white shadow-[0_3px_10px_rgba(0,0,0,0.10)] dark:bg-white dark:text-black'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
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
        checked ? 'bg-black dark:bg-white' : 'bg-black/15 dark:bg-white/20'
      }`}
    >
      <span
        className={`inline-block h-[22px] w-[22px] rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.20),0_1px_1px_rgba(0,0,0,0.04)] transition-transform duration-200 ${
          checked ? 'translate-x-[20px]' : 'translate-x-[2px]'
        } ${checked ? 'bg-white dark:bg-black' : 'bg-white'}`}
      />
    </button>
  )
}
