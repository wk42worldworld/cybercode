import { useCallback } from 'react'
import { useUIStore, type SettingsPanelView } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { Icon } from '../shared/Icon'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)

export function IconRail() {
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const settingsPanelView = useUIStore((s) => s.settingsPanelView)
  const openSettings = useUIStore((s) => s.openSettings)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const t = useTranslation()

  const handlePanelView = useCallback((view: SettingsPanelView) => {
    if (settingsOpen && settingsPanelView === view) {
      closeSettings()
    } else {
      openSettings(view)
    }
  }, [settingsOpen, settingsPanelView, openSettings, closeSettings])

  const handleGeneralSettings = useCallback(() => {
    if (settingsOpen && settingsPanelView === 'settings') {
      closeSettings()
    } else {
      openSettings('settings')
    }
  }, [settingsOpen, settingsPanelView, openSettings, closeSettings])

  const isPanelActive = useCallback((view: SettingsPanelView) => (
    settingsOpen && settingsPanelView === view
  ), [settingsOpen, settingsPanelView])

  return (
    <div
      className="flex flex-col items-center h-full shrink-0 select-none bg-[var(--color-surface-container-lowest)] dark:bg-[#050505]"
      style={{ width: 'var(--sidebar-rail-width)' }}
      data-tauri-drag-region
    >
      {/* macOS traffic light spacer */}
      <div
        className={isTauri && !isWindows ? 'h-[52px] w-full shrink-0' : 'h-3 w-full shrink-0'}
        data-tauri-drag-region
      />

      {/* Sidebar panel toggle */}
      <RailButton
        active={false}
        label={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
        onClick={toggleSidebar}
        icon={sidebarOpen ? 'view_sidebar' : 'view_sidebar_off'}
      />

      {/* Providers / 大模型 */}
      <RailButton
        active={isPanelActive('providers')}
        label={t('settings.tab.providers')}
        onClick={() => handlePanelView('providers')}
        icon="smart_toy"
      />

      {/* Skills */}
      <RailButton
        active={isPanelActive('skills')}
        label={t('settings.tab.skills')}
        onClick={() => handlePanelView('skills')}
        icon="build"
      />

      {/* IM Adapters */}
      <RailButton
        active={isPanelActive('adapters')}
        label={t('settings.tab.adapters')}
        onClick={() => handlePanelView('adapters')}
        icon="feedback"
      />

      {/* Scheduled */}
      <RailButton
        active={isPanelActive('scheduled')}
        label={t('sidebar.scheduled')}
        onClick={() => handlePanelView('scheduled')}
        icon="schedule"
      />

      {/* Terminal */}
      <RailButton
        active={isPanelActive('terminal')}
        label={t('sidebar.terminal')}
        onClick={() => handlePanelView('terminal')}
        icon="terminal"
      />

      {/* MCP */}
      <RailButton
        active={isPanelActive('mcp')}
        label={t('settings.tab.mcp')}
        onClick={() => handlePanelView('mcp')}
        icon="hub"
      />

      {/* Plugins */}
      <RailButton
        active={isPanelActive('plugins')}
        label={t('settings.tab.plugins')}
        onClick={() => handlePanelView('plugins')}
        icon="extension"
      />

      {/* Computer Use */}
      <RailButton
        active={isPanelActive('computerUse')}
        label={t('settings.tab.computerUse')}
        onClick={() => handlePanelView('computerUse')}
        icon="desktop_windows"
      />

      {/* Grow spacer */}
      <div className="flex-1" data-tauri-drag-region />

      {/* Settings — bottom */}
      <RailButton
        active={isPanelActive('settings')}
        label={t('sidebar.settings')}
        onClick={handleGeneralSettings}
        icon="settings"
      />

      {/* GitHub — very bottom */}
      <a
        href="https://github.com/login?return_to=%2Fwk42worldworld%2Fcybercode"
        target="_blank"
        rel="noopener noreferrer"
        className="group relative mb-3 flex h-12 w-12 items-center justify-center rounded-xl text-[var(--color-text-tertiary)] hover:text-[var(--color-brand)] hover:shadow-[var(--shadow-accent-glow)] transition-all duration-200"
      >
        <Icon name="github" size={20} />
        <span className="pointer-events-none absolute left-full ml-2 z-50 rounded-md bg-black/80 px-2.5 py-1 text-[12px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100 whitespace-nowrap dark:bg-white/90 dark:text-black">
          {t('sidebar.githubTooltip')}
        </span>
      </a>
    </div>
  )
}

function RailButton({
  active,
  label,
  onClick,
  icon,
}: {
  active: boolean
  label: string
  onClick: () => void
  icon: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`group relative mb-1.5 flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-200 ${
        active
          ? 'text-[var(--color-brand)]'
          : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-brand)] hover:shadow-[var(--shadow-accent-glow)]'
      }`}
    >
      {/* Bottom accent indicator for active state */}
      {active && (
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-4 h-[2px] rounded-full bg-[var(--color-brand)] shadow-[var(--shadow-accent-glow)]" />
      )}
      <Icon name={icon} size={20} />
      {/* Instant tooltip on hover */}
      <span className="pointer-events-none absolute left-full ml-2 z-50 rounded-md bg-black/80 px-2.5 py-1 text-[12px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100 whitespace-nowrap dark:bg-white/90 dark:text-black">
        {label}
      </span>
    </button>
  )
}
