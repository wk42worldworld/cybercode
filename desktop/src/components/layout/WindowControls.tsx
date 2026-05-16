import { useState, useEffect } from 'react'
import { Icon } from '../shared/Icon'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)

/** Whether to render custom window controls (Windows + Tauri only) */
export const showWindowControls = isTauri && isWindows

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
    <div data-testid="window-controls" className="flex items-stretch flex-shrink-0 -my-px">
      {/* Minimize */}
      <button
        onClick={() => runWindowAction(() => win.minimize())}
        aria-label="Minimize window"
        className="w-[46px] h-full flex items-center justify-center text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <Icon name="window_minimize" size={10} />
      </button>

      {/* Maximize / Restore */}
      <button
        onClick={() => runWindowAction(() => win.toggleMaximize())}
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
        className="w-[46px] h-full flex items-center justify-center text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <Icon name={maximized ? 'window_restore' : 'window_maximize'} size={10} />
      </button>

      {/* Close */}
      <button
        onClick={() => runWindowAction(() => win.close())}
        aria-label="Close window"
        className="w-[46px] h-full flex items-center justify-center text-[var(--color-text-secondary)] hover:bg-[var(--color-window-close-hover)] hover:text-white transition-colors"
      >
        <Icon name="close" size={10} />
      </button>
    </div>
  )
}
