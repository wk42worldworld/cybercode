import { useUIStore, type Toast as ToastType } from '../../stores/uiStore'
import { Icon } from './Icon'

const typeMeta: Record<ToastType['type'], { icon: string; className: string }> = {
  success: { icon: 'check_circle', className: 'bg-[var(--color-success)]/10 text-[var(--color-success)]' },
  error: { icon: 'error', className: 'bg-[var(--color-error)]/10 text-[var(--color-error)]' },
  warning: { icon: 'warning', className: 'bg-[var(--color-warning)]/12 text-[var(--color-warning)]' },
  info: { icon: 'info', className: 'bg-[var(--color-brand)]/10 text-[var(--color-brand)]' },
}

function ToastItem({ toast }: { toast: ToastType }) {
  const removeToast = useUIStore((s) => s.removeToast)
  const meta = typeMeta[toast.type]

  return (
    <div
      className={`
        bg-[var(--color-background)] rounded-xl
        px-4 py-3 text-[12px]
        text-[var(--color-text-primary)]
        border border-[var(--color-border-separator)]
        shadow-[var(--shadow-dropdown)]
        animate-slide-down
      `}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] ${meta.className}`}>
          <Icon name={meta.icon} size={14} />
        </span>
        <span className="min-w-0 flex-1 leading-relaxed">{toast.message}</span>
        <button
          onClick={() => removeToast(toast.id)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <Icon name="close" size={14} />
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
