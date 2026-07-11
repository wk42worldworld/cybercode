import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

type ModalProps = {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  width?: number
  footer?: ReactNode
}

export function Modal({ open, onClose, title, children, width = 560, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="settings-ui native-ui-text fixed inset-0 z-[200] flex items-center justify-center animate-fade-in">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[var(--color-overlay-scrim)]"
        onClick={onClose}
      />

      {/* Modal content */}
      <div
        className="relative flex max-h-[85vh] flex-col overflow-hidden rounded-[14px] border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-window)] animate-modal-in"
        style={{
          width,
          maxWidth: 'calc(100vw - 48px)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {title && (
          <div className="flex min-h-[64px] items-center justify-between gap-4 border-b border-[var(--color-border-separator)] px-6 py-4">
            <h2 className="text-[15px] font-bold tracking-[-0.01em] text-[var(--color-text-primary)]">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors duration-200 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>

        {footer && (
          <div className="flex justify-end gap-2 border-t border-[var(--color-border-separator)] px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
