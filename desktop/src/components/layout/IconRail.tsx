import { useCallback } from 'react'
import {
  Bot,
  ChevronRight,
  Clock,
  Columns2,
  Github,
  Grid,
  MessageSquare,
  Monitor,
  Settings,
  TerminalSquare,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useUIStore, type SettingsPanelView } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'

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
      className="relative z-[80] flex h-full shrink-0 select-none flex-col items-center justify-between overflow-visible border-r border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] py-[20px] text-[var(--color-text-tertiary)]"
      style={{ width: 'var(--sidebar-rail-width)' }}
      data-tauri-drag-region
    >
      <div className="flex w-full flex-col items-center gap-[24px]">
        <div
          className={isTauri && !isWindows ? 'h-[32px] w-full shrink-0' : 'h-0 w-full shrink-0'}
          data-tauri-drag-region
        />

        <RailButton
          active={sidebarOpen}
          label={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
          onClick={toggleSidebar}
          icon={Columns2}
        />
        <RailButton active={isPanelActive('providers')} label={t('settings.tab.providers')} onClick={() => handlePanelView('providers')} icon={Bot} />
        <RailButton active={isPanelActive('skills')} label={t('settings.tab.skills')} onClick={() => handlePanelView('skills')} icon={Wrench} />
        <RailButton active={isPanelActive('adapters')} label={t('settings.tab.adapters')} onClick={() => handlePanelView('adapters')} icon={MessageSquare} />
        <RailButton active={isPanelActive('scheduled')} label={t('sidebar.scheduled')} onClick={() => handlePanelView('scheduled')} icon={Clock} />
        <RailButton active={isPanelActive('terminal')} label={t('sidebar.terminal')} onClick={() => handlePanelView('terminal')} icon={TerminalSquare} />
        <RailButton active={isPanelActive('mcp')} label={t('settings.tab.mcp')} onClick={() => handlePanelView('mcp')} icon={ChevronRight} />
        <RailButton active={isPanelActive('plugins')} label={t('settings.tab.plugins')} onClick={() => handlePanelView('plugins')} icon={Grid} />
        <RailButton active={isPanelActive('computerUse')} label={t('settings.tab.computerUse')} onClick={() => handlePanelView('computerUse')} icon={Monitor} />
      </div>

      <div className="flex flex-col items-center gap-[24px]">
        <RailButton active={isPanelActive('settings')} label={t('sidebar.settings')} onClick={handleGeneralSettings} icon={Settings} />
        <a
          href="https://github.com/login?return_to=%2Fwk42worldworld%2Fcybercode"
          target="_blank"
          rel="noopener noreferrer"
          className="group relative flex h-[46px] w-[46px] items-center justify-center overflow-visible rounded-full text-[var(--color-text-tertiary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <Github size={22} strokeWidth={1.5} />
          <RailTooltip label={t('sidebar.githubTooltip')} />
        </a>
      </div>
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
  icon: LucideIcon
}) {
  const IconComponent = icon

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-active={active ? 'true' : 'false'}
      className={`group relative flex h-[46px] w-[46px] items-center justify-center overflow-visible rounded-full transition-colors duration-100 ${
        active
          ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-selected)]'
          : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      <IconComponent size={22} strokeWidth={1.5} />
      <RailTooltip label={label} />
    </button>
  )
}

function RailTooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-[100] min-w-max max-w-[calc(100vw-96px)] -translate-y-1/2 whitespace-nowrap rounded-[10px] bg-[var(--color-inverse-surface)] px-[10px] py-[6px] text-[12px] font-semibold leading-none text-[var(--color-inverse-on-surface)] opacity-0 shadow-[0_8px_20px_rgba(0,0,0,0.12)] transition-[opacity,transform] duration-100 group-hover:translate-x-[2px] group-hover:opacity-100 group-focus-visible:translate-x-[2px] group-focus-visible:opacity-100">
      {label}
    </span>
  )
}
