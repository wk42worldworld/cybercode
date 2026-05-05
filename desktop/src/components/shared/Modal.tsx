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
      {/* Backdrop with subtle blur */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal content — iOS-style dialog */}
      <div
        className="relative bg-white dark:bg-[#1A1A1A] border-2 border-black/[0.18] dark:border-white/[0.14] rounded-[18px] max-h-[85vh] flex flex-col overflow-hidden animate-modal-in"
        style={{ width, maxWidth: 'calc(100vw - 48px)', boxShadow: '0 20px 60px -10px rgba(0,0,0,0.30), 0 8px 20px -8px rgba(0,0,0,0.18)' }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {title && (
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 border-b border-black/[0.10] dark:border-white/[0.10]">
            <h2 className="text-[15px] font-semibold tracking-tight text-black/90 dark:text-white/90">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-black/60 dark:text-white/60 hover:text-black/90 dark:hover:text-white/90 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-all duration-200"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}

        <div className="px-6 py-5 overflow-y-auto flex-1">
          {children}
        </div>

        {footer && (
          <div className="px-6 py-4 border-t border-black/[0.10] dark:border-white/[0.10] flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

