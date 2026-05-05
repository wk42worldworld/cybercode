import type { ReactNode } from 'react'
import { Icon } from '../shared/Icon'

/* ── Settings primitives ──────────────────────────────────────────────
 * Calibrated against macOS Ventura System Settings + Linear settings.
 * Density, rounded corners, hierarchy and motion all match those two refs. */

export function SettingsPage({
  title,
  description,
  icon,
  children,
}: {
  title: string
  description?: string
  icon?: string
  children: ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
      <header className="flex flex-col gap-1.5 pb-2">
        <div className="flex items-center gap-3">
          {icon && (
            <Icon name={icon} size={24} className="text-black/60 dark:text-white/60" />
          )}
          <h1 className="text-[26px] font-semibold tracking-tight text-black/90 dark:text-white/90">
            {title}
          </h1>
        </div>
        {description && (
          <p className="text-[13px] leading-[1.6] text-black/70 dark:text-white/70">
            {description}
          </p>
        )}
      </header>
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
    <section className="overflow-hidden rounded-lg border-2 border-black/30 dark:border-white/30 bg-white dark:bg-white/[0.03]">
      {hasHeader && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-black/[0.10] dark:border-white/[0.10]">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[13px] font-semibold tracking-tight text-black/90 dark:text-white/90">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 text-[12px] leading-[1.5] text-black/65 dark:text-white/65">
                {description}
              </p>
            )}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </header>
      )}
      <div className="divide-y divide-black/[0.10] dark:divide-white/[0.10]">
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
            <div className="text-[13px] font-medium tracking-tight text-black/85 dark:text-white/85">
              {label}
            </div>
          )}
          {hint && (
            <p className="mt-1 text-[11px] leading-[1.6] text-black/60 dark:text-white/60">
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
    <div className="inline-flex rounded-lg bg-black/5 dark:bg-white/[0.06] p-0.5">
      {items.map((item) => {
        const isActive = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`min-w-[56px] cursor-pointer rounded-[7px] px-3.5 py-1 text-[12px] font-medium tracking-tight transition-all duration-150 ${
              isActive
                ? 'bg-white dark:bg-white/15 text-black/90 dark:text-white/95 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                : 'text-black/70 dark:text-white/70 hover:text-black/80 dark:hover:text-white/85'
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
      className={`relative inline-flex h-[26px] w-[44px] cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-black/15 dark:focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#050505] ${
        checked ? 'bg-emerald-500' : 'bg-black/25 dark:bg-white/25'
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
