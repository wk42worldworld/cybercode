import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

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
      {/* Backdrop with subtle blur (open-webui style) */}
      <div
        className="absolute inset-0 bg-[var(--color-overlay-scrim)] backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal content */}
      <div
        className="relative bg-[var(--color-surface-container-lowest)] border border-[var(--color-border)] rounded-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-modal-in"
        style={{ width, maxWidth: 'calc(100vw - 48px)' }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {title && (
          <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-0">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--color-text-secondary)] opacity-60 hover:opacity-100 hover:bg-[var(--color-surface-hover)] transition-all duration-150"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        )}

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {children}
        </div>

        {footer && (
          <div className="px-6 pb-6 pt-0 flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
