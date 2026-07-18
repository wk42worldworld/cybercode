import { useState, useEffect } from 'react'
import { Icon } from '../shared/Icon'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)

/** Whether to render custom window controls (Windows + Tauri only) */
export const showWindowControls = isTauri && isWindows

const windowControlClass = 'flex h-full w-[52px] items-center justify-center text-[var(--color-text-secondary)] transition-colors duration-100 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-border-focus)]'

export function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  const [win, setWin] = useState<{
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onResized: (handler: () => void) => Promise<() => void>
  } | null>(null)

  useEffect(() => {
    if (!showWindowControls) return
    let unlisten: (() => void) | undefined

    import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const w = getCurrentWindow()
        setWin(w as any)
        setMaximized(await w.isMaximized())
        unlisten = await w.onResized(async () => {
          setMaximized(await w.isMaximized())
        })
      })
      .catch(() => {})

    return () => { unlisten?.() }
  }, [])

  const runWindowAction = (action: () => Promise<void>) => {
    void action().catch((error) => {
      console.error('Window control action failed', error)
    })
  }

  if (!showWindowControls || !win) return null

  return (
    <div
      data-testid="window-controls"
      className="flex h-[42px] shrink-0 items-stretch overflow-hidden rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
    >
      {/* Minimize */}
      <button
        type="button"
        onClick={() => runWindowAction(() => win.minimize())}
        aria-label="Minimize window"
        className={`${windowControlClass} border-r border-[var(--color-border-separator)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]`}
      >
        <Icon name="window_minimize" size={14} />
      </button>

      {/* Maximize / Restore */}
      <button
        type="button"
        onClick={() => runWindowAction(() => win.toggleMaximize())}
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
        className={`${windowControlClass} border-r border-[var(--color-border-separator)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]`}
      >
        <Icon name={maximized ? 'window_restore' : 'window_maximize'} size={14} />
      </button>

      {/* Close */}
      <button
        type="button"
        onClick={() => runWindowAction(() => win.close())}
        aria-label="Close window"
        className={`${windowControlClass} hover:bg-[var(--color-window-close-hover)] hover:text-white`}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
