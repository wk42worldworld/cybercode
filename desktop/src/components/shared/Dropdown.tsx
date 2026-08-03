import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { subscribeToViewportChanges } from '../../lib/viewportEvents'

export type DropdownItem<T extends string> = {
  value: T
  label: string
  description?: string
  badge?: string
  icon?: ReactNode
}

export type DropdownTriggerState = {
  open: boolean
  menuId: string
}

type DropdownProps<T extends string> = {
  items: readonly DropdownItem<T>[]
  value: T
  onChange: (value: T) => void
  trigger: ReactNode | ((state: DropdownTriggerState) => ReactNode)
  width?: CSSProperties['width']
  align?: 'left' | 'right'
  className?: string
  disabled?: boolean
  ariaLabel?: string
  density?: 'default' | 'compact'
}

type DropdownPosition = {
  top: number
  left: number
  width: number
  maxHeight: number
  direction: 'up' | 'down'
}

const VIEWPORT_MARGIN = 12
const MENU_GAP = 6
const MENU_MAX_HEIGHT = 360

function resolveMenuWidth(width: CSSProperties['width'], triggerWidth: number): number {
  if (typeof width === 'number') return width
  if (typeof width === 'string' && width.trim().endsWith('px')) {
    const parsed = Number.parseFloat(width)
    if (Number.isFinite(parsed)) return parsed
  }
  return triggerWidth
}

export function Dropdown<T extends string>({
  items,
  value,
  onChange,
  trigger,
  width = 320,
  align = 'left',
  className = '',
  disabled = false,
  ariaLabel,
  density = 'default',
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<DropdownPosition | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const focusMenuOnOpenRef = useRef(false)
  const generatedMenuId = useId()
  const menuId = `dropdown-${generatedMenuId.replace(/[^a-zA-Z0-9_-]/g, '')}`

  const focusTrigger = useCallback(() => {
    ref.current
      ?.querySelector<HTMLElement>(
        'button:not([disabled]), [role="button"]:not([aria-disabled="true"]), input:not([disabled])',
      )
      ?.focus()
  }, [])

  const closeAndFocusTrigger = useCallback(() => {
    setOpen(false)
    focusTrigger()
  }, [focusTrigger])

  const focusOption = useCallback((index: number) => {
    if (items.length === 0) return
    const normalizedIndex = (index + items.length) % items.length
    optionRefs.current[normalizedIndex]?.focus()
  }, [items.length])

  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  )

  const updatePosition = useCallback(() => {
    const trigger = ref.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const availableWidth = Math.max(1, window.innerWidth - VIEWPORT_MARGIN * 2)
    const menuWidth = Math.min(
      Math.max(1, resolveMenuWidth(width, rect.width)),
      availableWidth,
    )
    const maxLeft = Math.max(
      VIEWPORT_MARGIN,
      window.innerWidth - menuWidth - VIEWPORT_MARGIN,
    )
    const desiredLeft = align === 'right' ? rect.right - menuWidth : rect.left
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN
    const spaceAbove = rect.top - MENU_GAP - VIEWPORT_MARGIN
    const itemEstimate = density === 'compact' ? 40 : 58
    const estimatedHeight = Math.min(MENU_MAX_HEIGHT, Math.max(96, items.length * itemEstimate))
    const direction = (
      spaceBelow >= estimatedHeight ||
      spaceBelow >= spaceAbove
    ) ? 'down' : 'up'
    const availableHeight = direction === 'down' ? spaceBelow : spaceAbove

    setPosition({
      top: direction === 'down' ? rect.bottom + MENU_GAP : rect.top - MENU_GAP,
      left: Math.min(Math.max(desiredLeft, VIEWPORT_MARGIN), maxLeft),
      width: menuWidth,
      maxHeight: Math.max(48, Math.min(MENU_MAX_HEIGHT, availableHeight)),
      direction,
    })
  }, [align, density, items.length, width])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      closeAndFocusTrigger()
    }
    // Capture phase: canvases like React Flow (d3-zoom) call
    // stopImmediatePropagation() on bubbled mousedown, which would otherwise
    // prevent this listener from ever seeing clicks on the pane.
    document.addEventListener('mousedown', handleClick, true)
    document.addEventListener('keydown', handleEscape, true)
    return () => {
      document.removeEventListener('mousedown', handleClick, true)
      document.removeEventListener('keydown', handleEscape, true)
    }
  }, [closeAndFocusTrigger, open])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    updatePosition()
    return subscribeToViewportChanges(updatePosition)
  }, [open, updatePosition])

  useEffect(() => {
    if (!open || !position || !focusMenuOnOpenRef.current) return
    focusMenuOnOpenRef.current = false
    focusOption(selectedIndex)
  }, [focusOption, open, position, selectedIndex])

  const handleTriggerClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (disabled || menuRef.current?.contains(event.target as Node)) return
    focusMenuOnOpenRef.current = event.detail === 0
    setOpen((current) => !current)
  }

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      closeAndFocusTrigger()
      return
    }
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      focusMenuOnOpenRef.current = true
      setOpen(true)
    }
  }

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const focusedIndex = optionRefs.current.findIndex(
      (option) => option === document.activeElement,
    )
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      focusOption(focusedIndex < 0 ? selectedIndex : focusedIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      focusOption(focusedIndex < 0 ? selectedIndex : focusedIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      event.stopPropagation()
      focusOption(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      focusOption(items.length - 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeAndFocusTrigger()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  const renderedTrigger = typeof trigger === 'function'
    ? trigger({ open, menuId })
    : trigger

  return (
    <div ref={ref} className={`relative ${className || 'inline-block'}`}>
      <div
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className={disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
      >
        {renderedTrigger}
      </div>

      {open && position && createPortal(
        <div
          id={menuId}
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleMenuKeyDown}
          className={`
            settings-ui native-ui-text fixed z-[10050] overflow-y-auto overscroll-contain
            border border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)]
            shadow-[var(--shadow-dropdown)] animate-slide-down
            ${density === 'compact' ? 'rounded-[7px] p-[4px]' : 'rounded-[8px] p-[5px]'}
          `}
          style={{
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
            ...(position.direction === 'down'
              ? { top: position.top }
              : { bottom: window.innerHeight - position.top }),
          }}
        >
          {items.map((item, i) => (
            <button
              key={item.value}
              type="button"
              role="option"
              aria-selected={item.value === value}
              data-value={item.value}
              tabIndex={-1}
              ref={(option) => {
                optionRefs.current[i] = option
              }}
              onClick={() => {
                onChange(item.value)
                closeAndFocusTrigger()
              }}
              className={`
                flex w-full items-center text-left
                transition-colors hover:bg-[var(--color-surface-hover)]
                focus-visible:bg-[var(--color-surface-hover)] focus-visible:outline-none
                ${density === 'compact'
                  ? 'min-h-[34px] gap-[8px] rounded-[5px] px-[8px] py-[5px]'
                  : 'min-h-[42px] gap-[10px] rounded-[6px] px-[10px] py-[7px]'
                }
                ${item.value === value ? 'bg-[var(--color-surface-selected)]' : ''}
              `}
            >
              {item.icon && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--color-text-secondary)]">
                  {item.icon}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div
                  title={item.label}
                  className={`truncate font-semibold tracking-normal text-[var(--color-text-primary)] ${density === 'compact' ? 'text-[11px]' : 'text-[13px]'}`}
                >
                  {item.label}
                </div>
                {item.description && (
                  <div
                    title={item.description}
                    className={`mt-0.5 truncate text-[var(--color-text-tertiary)] ${density === 'compact' ? 'text-[9px]' : 'text-[11px]'}`}
                  >
                    {item.description}
                  </div>
                )}
              </div>
              {item.badge && (
                <span
                  title={item.badge}
                  className={`settings-dropdown-item-badge max-w-[44%] shrink-0 truncate rounded-[4px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-high)] px-[6px] py-[2px] font-bold leading-none text-[var(--color-text-secondary)] ${density === 'compact' ? 'text-[8px]' : 'text-[10px]'}`}
                >
                  {item.badge}
                </span>
              )}
              {item.value === value && (
                <Check
                  size={density === 'compact' ? 13 : 15}
                  strokeWidth={2.25}
                  className="shrink-0 text-[#1473e6] dark:text-[#68adff]"
                  aria-hidden="true"
                />
              )}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
