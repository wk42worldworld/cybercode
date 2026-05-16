import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { Icon } from '../shared/Icon'

export function TitleBar() {
  const { activeView, setActiveView } = useUIStore()
  const t = useTranslation()

  return (
    <div
      className="h-[var(--titlebar-height)] flex items-center border-b border-[var(--color-border-separator)] bg-transparent select-none"
      data-tauri-drag-region
    >
      {/* macOS traffic light spacer */}
      <div className="w-[78px] flex-shrink-0" data-tauri-drag-region />

      {/* Logo */}
      <div className="flex items-center gap-2 mr-4" data-tauri-drag-region>
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-brand)]">CYBERCODE</span>
      </div>

      {/* Navigation arrows */}
      <div className="flex items-center gap-1 mr-4">
        <button className="p-1 rounded-full text-[var(--color-text-tertiary)] opacity-60 hover:opacity-100 hover:text-[var(--color-brand)] transition-opacity duration-150">
          <Icon name="chevron_left" size={14} />
        </button>
        <button className="p-1 rounded-full text-[var(--color-text-tertiary)] opacity-60 hover:opacity-100 hover:text-[var(--color-brand)] transition-opacity duration-150">
          <Icon name="chevron_right" size={14} />
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
        <button className="p-1.5 rounded-full text-[var(--color-text-tertiary)] opacity-60 hover:opacity-100 hover:text-[var(--color-brand)] transition-opacity duration-150">
          <Icon name="settings" size={16} />
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
        flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.10em] rounded-full transition-colors duration-100
        ${active
          ? 'bg-[var(--color-accent-glow)] text-[var(--color-brand)]'
          : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-brand)]'
        }
      `}
    >
      <Icon name={icon} size={14} />
      {children}
    </button>
  )
}
