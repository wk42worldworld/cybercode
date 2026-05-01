import { useEffect } from 'react'
import { Settings } from '../../pages/Settings'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'

type Props = {
  visible: boolean
}

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)
const isMacTauri = isTauri && !isWindows

export function SettingsPanel({ visible }: Props) {
  const closeSettings = useUIStore((s) => s.closeSettings)
  const t = useTranslation()

  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Defer to any open modal dialog so ESC closes the modal first
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, closeSettings])

  return (
    <section
      role="region"
      aria-label={t('sidebar.settings')}
      data-testid="settings-panel"
      aria-hidden={!visible}
      className="fixed inset-0 z-30 flex flex-col bg-[var(--color-surface)]"
      style={{ display: visible ? 'flex' : 'none' }}
    >
      {isMacTauri && (
        <div
          data-tauri-drag-region
          aria-hidden="true"
          className="h-[28px] flex-shrink-0"
        />
      )}
      <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
        <Settings />
      </div>
    </section>
  )
}
