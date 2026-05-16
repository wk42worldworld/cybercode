import { useEffect, memo, type ReactNode } from 'react'
import {
  AboutSettings,
  AgentsSettings,
  GeneralSettings,
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
      className="absolute inset-0 z-30 flex flex-col items-center justify-center p-4 bg-black/10 dark:bg-black/30 animate-fade-in"
    >
      <div className="w-full max-w-[1100px] h-[88vh] rounded-[10px] shadow-2xl border border-black/10 dark:border-white/30 overflow-hidden bg-[var(--color-background)] flex flex-col">
        <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
          {isSettingsHome ? (
            <MemoSettings />
          ) : (
            <>
              <PanelHeader onClose={closeSettings} />
              <PanelBody view={panelView}>
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
    <header className="flex shrink-0 items-center justify-end px-[18px] py-[14px] bg-[var(--color-background)]">
      <button
        onClick={onClose}
        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
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
      <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
        {children}
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
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
