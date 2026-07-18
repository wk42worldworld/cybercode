import type { ReactNode } from 'react'
import { BookOpenText, Gauge, Network } from 'lucide-react'
import { Icon } from '../shared/Icon'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'

type ChatModeSidebarProps = {
  label: string
  ariaLabel: string
}

export function ChatModeSidebar({ label, ariaLabel }: ChatModeSidebarProps) {
  const settingsOpen = useUIStore((state) => state.settingsOpen)
  const settingsPanelView = useUIStore((state) => state.settingsPanelView)
  const openSettings = useUIStore((state) => state.openSettings)
  const closeSettings = useUIStore((state) => state.closeSettings)
  const t = useTranslation()
  const memoryActive = settingsOpen && settingsPanelView === 'memory'
  const tokenOptimizationActive = settingsOpen && settingsPanelView === 'tokenOptimization'
  const codeGraphActive = settingsOpen && settingsPanelView === 'codeGraph'

  const handleMemoryClick = () => {
    if (memoryActive) {
      closeSettings()
    } else {
      openSettings('memory')
    }
  }

  const handleTokenOptimizationClick = () => {
    if (tokenOptimizationActive) {
      closeSettings()
    } else {
      openSettings('tokenOptimization')
    }
  }

  const handleCodeGraphClick = () => {
    if (codeGraphActive) {
      closeSettings()
    } else {
      openSettings('codeGraph')
    }
  }

  return (
    <aside
      aria-label={ariaLabel}
      className="chat-mode-sidebar native-ui-text relative z-[95] flex h-full w-[var(--sidebar-rail-width)] shrink-0 select-none flex-col items-center border-l border-[var(--color-border-separator)] bg-[var(--color-surface-sidebar)] py-[20px] text-[var(--color-text-tertiary)]"
    >
      <div className="flex w-full flex-col items-center gap-[24px]">
        <SideRailButton label={label}>
          <Icon name="code" size={22} />
        </SideRailButton>
        <SideRailButton
          active={memoryActive}
          label={t('settings.memory.title')}
          onClick={handleMemoryClick}
        >
          <BookOpenText size={22} strokeWidth={1.5} />
        </SideRailButton>
        <SideRailButton
          active={tokenOptimizationActive}
          label={t('tokenOptimization.title')}
          onClick={handleTokenOptimizationClick}
        >
          <Gauge size={22} strokeWidth={1.5} />
        </SideRailButton>
        <SideRailButton
          active={codeGraphActive}
          label={t('sidebar.projectGraph')}
          onClick={handleCodeGraphClick}
        >
          <Network size={22} strokeWidth={1.5} />
        </SideRailButton>
      </div>
    </aside>
  )
}

function SideRailButton({
  active = false,
  children,
  label,
  onClick,
}: {
  active?: boolean
  children: ReactNode
  label: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-active={active ? 'true' : 'false'}
      onClick={onClick}
      className={`group relative flex h-[46px] w-[46px] items-center justify-center overflow-visible rounded-full transition-colors duration-100 ${
        active
          ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {children}
      <span className="pointer-events-none absolute right-[calc(100%+10px)] top-1/2 z-[100] min-w-max max-w-[calc(100vw-96px)] -translate-y-1/2 whitespace-nowrap rounded-[10px] bg-[var(--color-inverse-surface)] px-[10px] py-[6px] text-[12px] font-semibold leading-none text-[var(--color-inverse-on-surface)] opacity-0 shadow-[0_8px_20px_rgba(0,0,0,0.12)] transition-[opacity,transform] duration-100 group-hover:-translate-x-[2px] group-hover:opacity-100 group-focus-visible:-translate-x-[2px] group-focus-visible:opacity-100">
        {label}
      </span>
    </button>
  )
}
