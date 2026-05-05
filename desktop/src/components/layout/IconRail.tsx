import type { ReactNode } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useTabStore, SCHEDULED_TAB_ID } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import { useMemo } from 'react'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)

export function IconRail() {
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const openSettings = useUIStore((s) => s.openSettings)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTabType = useMemo(
    () => useTabStore.getState().tabs.find((t) => t.sessionId === activeTabId)?.type,
    [activeTabId],
  )
  const t = useTranslation()

  return (
    <div
      className="flex flex-col items-center h-full shrink-0 select-none border-r border-black/[0.12] dark:border-white/[0.12] bg-white/80 dark:bg-black/50"
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
      >
        <PanelIcon open={sidebarOpen} />
      </RailButton>

      {/* Scheduled */}
      <RailButton
        active={activeTabId === SCHEDULED_TAB_ID}
        label={t('sidebar.scheduled')}
        onClick={() => useTabStore.getState().openTab(SCHEDULED_TAB_ID, t('sidebar.scheduled'), 'scheduled')}
      >
        <CalendarIcon />
      </RailButton>

      {/* Terminal */}
      <RailButton
        active={activeTabType === 'terminal'}
        label={t('sidebar.terminal')}
        onClick={() => useTabStore.getState().openTerminalTab()}
      >
        <TerminalIcon />
      </RailButton>

      {/* Settings */}
      <RailButton
        active={settingsOpen}
        label={t('sidebar.settings')}
        onClick={() => settingsOpen ? closeSettings() : openSettings()}
      >
        <SettingsIcon />
      </RailButton>

      {/* Grow spacer */}
      <div className="flex-1" data-tauri-drag-region />

      {/* GitHub — bottom */}
      <a
        href="https://github.com/login?return_to=%2Fwk42worldworld%2Fcybercode"
        target="_blank"
        rel="noopener noreferrer"
        title="GitHub"
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl text-black/70 dark:text-white/70 hover:bg-black/[0.05] dark:hover:bg-white/[0.05] hover:text-black/65 dark:hover:text-white/65 transition-all duration-200"
      >
        <GitHubIcon />
      </a>
    </div>
  )
}

function RailButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`relative mb-1.5 flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-200 ${
        active
          ? 'bg-[var(--color-spacex-accent)]/10 text-[var(--color-spacex-accent)]'
          : 'text-black/60 dark:text-white/60 hover:bg-black/[0.05] dark:hover:bg-white/[0.05] hover:text-black/70 dark:hover:text-white/70'
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-[var(--color-spacex-accent)]" />
      )}
      {children}
    </button>
  )
}

/* ── Icons (IconPark / ByteDance style: 2px stroke, round caps) ── */

function PanelIcon({ open }: { open: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <line x1="9" y1="3" x2="9" y2="21" />
      {open
        ? <polyline points="6 9 4 11 6 13" />
        : <polyline points="6 9 8 11 6 13" />
      }
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <circle cx="12" cy="16" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function TerminalIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <polyline points="8 9 11 12 8 15" />
      <line x1="13" y1="15" x2="16" y2="15" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="8" cy="7" r="2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}
