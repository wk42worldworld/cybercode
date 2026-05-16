import { useState, useRef, useEffect, type CSSProperties, type ReactNode } from 'react'
import { Icon } from './Icon'

type DropdownItem<T extends string> = {
  value: T
  label: string
  description?: string
  icon?: ReactNode
}

type DropdownProps<T extends string> = {
  items: DropdownItem<T>[]
  value: T
  onChange: (value: T) => void
  trigger: ReactNode
  width?: CSSProperties['width']
  align?: 'left' | 'right'
  className?: string
}

export function Dropdown<T extends string>({
  items,
  value,
  onChange,
  trigger,
  width = 320,
  align = 'left',
  className = '',
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  return (
    <div ref={ref} className={`relative ${className || 'inline-block'}`}>
      <div onClick={() => setOpen(!open)} className="cursor-pointer">
        {trigger}
      </div>

      {open && (
        <div
          className={`
            absolute z-50 mt-1.5 overflow-hidden rounded-xl
            bg-[var(--color-background)] border border-[var(--color-border-separator)]
            shadow-[var(--shadow-dropdown)] animate-slide-down
            ${align === 'right' ? 'right-0' : 'left-0'}
          `}
          style={{ width }}
        >
          {items.map((item, i) => (
            <button
              key={item.value}
              onClick={() => { onChange(item.value); setOpen(false) }}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
                hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:bg-[var(--color-surface-hover)]
                ${item.value === value ? 'bg-[var(--color-surface-selected)]' : ''}
                ${i > 0 ? 'border-t border-[var(--color-border-separator)]' : ''}
              `}
            >
              {item.icon && <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-[var(--color-text-tertiary)]">{item.icon}</span>}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--color-text-primary)]">{item.label}</div>
                {item.description && (
                  <div className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">{item.description}</div>
                )}
              </div>
              {item.value === value && (
                <Icon name="check" size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
