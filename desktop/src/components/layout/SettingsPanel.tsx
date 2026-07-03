import { useEffect, memo, type ReactNode } from 'react'
import {
  AboutSettings,
  AgentsSettings,
  GeneralSettings,
  MemorySettings,
  PermissionSettings,
  PluginSettings,
  ProviderSettings,
  Settings,
  SkillSettings,
} from '../../pages/Settings'
import { AdapterSettings } from '../../pages/AdapterSettings'
import { ComputerUseSettings } from '../../pages/ComputerUseSettings'
import { McpSettings } from '../../pages/McpSettings'
import { ScheduledTasks } from '../../pages/ScheduledTasks'
import { TerminalSettings } from '../../pages/TerminalSettings'
import { useUIStore, type SettingsPanelView } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { Icon } from '../shared/Icon'

const MemoSettings = memo(Settings)

type Props = {
  visible: boolean
}

export function SettingsPanel({ visible }: Props) {
  const closeSettings = useUIStore((s) => s.closeSettings)
  const panelView = useUIStore((s) => s.settingsPanelView)
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

  if (!visible) return null
  const isSettingsHome = panelView === 'settings'

  return (
    <section
      role="region"
      aria-label={getPanelLabel(panelView, t)}
      data-testid="settings-panel"
      className="settings-ui settings-panel-overlay native-ui-text absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/10 p-[16px] dark:bg-black/45"
    >
      <div className="settings-panel-card flex h-[88vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-[14px] border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-window)]">
        <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
          {isSettingsHome ? (
            <div key="settings-home" className="settings-panel-content min-h-0 flex flex-1 flex-col overflow-hidden">
              <MemoSettings />
            </div>
          ) : (
            <>
              <PanelHeader onClose={closeSettings} />
              <PanelBody key={panelView} view={panelView}>
                {renderPanelContent(panelView)}
              </PanelBody>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <header className="flex h-[76px] shrink-0 items-center justify-end bg-[var(--color-background)] px-[24px] md:px-[32px]">
      <button
        onClick={onClose}
        className="flex h-[36px] w-[36px] items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        aria-label="Close"
        title="Esc"
      >
        <Icon name="close" size={18} />
      </button>
    </header>
  )
}

function PanelBody({ view, children }: { view: SettingsPanelView; children: ReactNode }) {
  if (view === 'terminal' || view === 'scheduled') {
    return (
      <div className="settings-panel-content min-h-0 flex-1 flex flex-col overflow-hidden bg-[var(--color-background)] pt-[10px]">
        {children}
      </div>
    )
  }

  return (
    <div className="settings-panel-content min-h-0 flex-1 overflow-y-auto bg-[var(--color-background)] px-[24px] pb-[24px] pt-[34px] md:px-[32px]">
      {children}
    </div>
  )
}

function renderPanelContent(view: SettingsPanelView): ReactNode {
  switch (view) {
    case 'providers':
      return <ProviderSettings />
    case 'permissions':
      return <PermissionSettings />
    case 'general':
      return <GeneralSettings />
    case 'adapters':
      return <AdapterSettings />
    case 'terminal':
      return <TerminalSettings active workspace />
    case 'mcp':
      return <McpSettings />
    case 'agents':
      return <AgentsSettings />
    case 'memory':
      return <MemorySettings />
    case 'skills':
      return <SkillSettings />
    case 'plugins':
      return <PluginSettings />
    case 'computerUse':
      return <ComputerUseSettings />
    case 'about':
      return <AboutSettings />
    case 'scheduled':
      return <ScheduledTasks />
    case 'settings':
    default:
      return <MemoSettings />
  }
}

function getPanelLabel(view: SettingsPanelView, t: ReturnType<typeof useTranslation>) {
  if (view === 'settings') return t('sidebar.settings')
  if (view === 'scheduled') return t('sidebar.scheduled')
  return t(`settings.tab.${view}` as never)
}
