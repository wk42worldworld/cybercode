import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'

export function TitleBar() {
  const { activeView, setActiveView } = useUIStore()
  const t = useTranslation()

  return (
    <div
      className="h-[var(--titlebar-height)] flex items-center border-b border-[var(--color-border)] bg-[var(--color-surface)] select-none"
      data-tauri-drag-region
    >
      {/* macOS traffic light spacer */}
      <div className="w-[78px] flex-shrink-0" data-tauri-drag-region />

      {/* Logo */}
      <div className="flex items-center gap-2 mr-4" data-tauri-drag-region>
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-text-primary)]">CYBERCODE</span>
      </div>

      {/* Navigation arrows */}
      <div className="flex items-center gap-1 mr-4">
        <button className="p-1 rounded-full text-[var(--color-text-primary)] opacity-50 hover:opacity-100 transition-opacity duration-150">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button className="p-1 rounded-full text-[var(--color-text-primary)] opacity-50 hover:opacity-100 transition-opacity duration-150">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Center tabs */}
      <div className="flex-1 flex items-center justify-center gap-1" data-tauri-drag-region>
        <TabButton
          active={activeView === 'code'}
          onClick={() => setActiveView('code')}
          icon="code"
        >
          {t('titlebar.code')}
        </TabButton>
        <TabButton
          active={activeView === 'terminal'}
          onClick={() => setActiveView('terminal')}
          icon="terminal"
        >
          {t('titlebar.terminal')}
        </TabButton>
        <TabButton
          active={activeView === 'history'}
          onClick={() => setActiveView('history')}
          icon="history"
        >
          {t('titlebar.history')}
        </TabButton>
      </div>

      {/* Right: Settings */}
      <div className="flex items-center gap-2 mr-4">
        <button className="p-1.5 rounded-full text-[var(--color-text-primary)] opacity-50 hover:opacity-100 transition-opacity duration-150">
          <span className="material-symbols-outlined text-[16px]">settings</span>
        </button>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.10em] rounded-full transition-all duration-150
        ${active
          ? 'bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-primary)] opacity-50 hover:opacity-100'
        }
      `}
    >
      <span className="material-symbols-outlined text-[14px]">{icon}</span>
      {children}
    </button>
  )
}
