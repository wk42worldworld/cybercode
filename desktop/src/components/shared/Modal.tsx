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
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[var(--color-overlay-scrim)]"
        onClick={onClose}
      />

      {/* Modal content */}
      <div
        className="relative bg-[var(--color-background)] border border-[var(--color-border-separator)] rounded-2xl max-h-[85vh] flex flex-col overflow-hidden animate-modal-in shadow-[var(--shadow-window)]"
        style={{
          width,
          maxWidth: 'calc(100vw - 48px)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {title && (
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 border-b border-[var(--color-border-separator)]">
            <h2 className="text-[15px] font-bold tracking-[-0.01em] text-[var(--color-text-primary)]">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-all duration-200"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}

        <div className="px-6 py-5 overflow-y-auto flex-1">
          {children}
        </div>

        {footer && (
          <div className="px-6 py-4 border-t border-[var(--color-border-separator)] flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
