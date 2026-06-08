import { useCallback, useEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../../i18n'
import { NewSessionChooser, type CurrentProject } from './NewSessionChooser'

type MenuPosition = {
  top: number
  left: number
  width: number
  maxHeight: number
}

type NewSessionMenuProps = {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  currentProject?: CurrentProject
  onClose: () => void
  onCreate: (workDir?: string) => Promise<boolean>
}

const MENU_WIDTH = 336
const MENU_MAX_HEIGHT = 460
const MENU_MIN_HEIGHT = 220
const VIEWPORT_MARGIN = 12

function cssPixelVar(name: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name)
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function NewSessionMenu({
  open,
  anchorRef,
  currentProject,
  onClose,
  onCreate,
}: NewSessionMenuProps) {
  const t = useTranslation()
  const [position, setPosition] = useState<MenuPosition | null>(null)

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const railWidth = cssPixelVar('--sidebar-rail-width', 72)
    const width = Math.min(MENU_WIDTH, Math.max(260, window.innerWidth - VIEWPORT_MARGIN * 2))
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
    const minLeft = Math.min(railWidth + VIEWPORT_MARGIN, maxLeft)
    const top = rect.bottom + 8
    const availableBelow = window.innerHeight - top - VIEWPORT_MARGIN
    const maxHeight = Math.min(
      MENU_MAX_HEIGHT,
      Math.max(MENU_MIN_HEIGHT, availableBelow),
    )

    setPosition({
      top,
      left: Math.min(Math.max(rect.right - width, minLeft), maxLeft),
      width,
      maxHeight,
    })
  }, [anchorRef])

  useEffect(() => {
    if (!open) return
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (anchorRef.current?.contains(target)) return
      if ((target as HTMLElement).closest('[data-new-session-menu="true"]')) return
      onClose()
    }
    const closeOnEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEsc)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEsc)
    }
  }, [anchorRef, onClose, open])

  if (!open || !position) return null

  return createPortal(
    <div
      data-new-session-menu="true"
      role="menu"
      aria-label={t('newSession.title')}
      className="fixed z-[9999] flex flex-col overflow-hidden rounded-[12px] border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-dropdown)]"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      }}
    >
      <NewSessionChooser currentProject={currentProject} onClose={onClose} onCreate={onCreate} />
    </div>,
    document.body,
  )
}
