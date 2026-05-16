import { useUIStore, type Toast as ToastType } from '../../stores/uiStore'

const typeStyles: Record<ToastType['type'], string> = {
  success: 'border-l-[3px] border-l-[var(--color-success)]',
  error: 'border-l-[3px] border-l-[var(--color-error)]',
  warning: 'border-l-[3px] border-l-[var(--color-warning)]',
  info: 'border-l-[3px] border-l-[var(--color-brand)]',
}

function ToastItem({ toast }: { toast: ToastType }) {
  const removeToast = useUIStore((s) => s.removeToast)

  return (
    <div
      className={`
        bg-[var(--color-background)] rounded-xl
        px-4 py-3 text-[12px]
        text-[var(--color-text-primary)]
        border border-[var(--color-border-separator)]
        shadow-[var(--shadow-dropdown)]
        ${typeStyles[toast.type]}
        animate-slide-down
      `}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="leading-relaxed">{toast.message}</span>
        <button
          onClick={() => removeToast(toast.id)}
          className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-[18px] leading-none transition-colors"
        >
          ×
        </button>
      </div>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
