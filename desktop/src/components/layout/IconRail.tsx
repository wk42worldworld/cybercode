import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  ChevronRight,
  Clock,
  Columns2,
  Download,
  Ellipsis,
  Github,
  Grid,
  MessageSquare,
  Monitor,
  Settings,
  ShieldCheck,
  TerminalSquare,
  Workflow,
  RefreshCw,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useUIStore, type SettingsPanelView } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { useUpdateStore, type UpdateStatus } from '../../stores/updateStore'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)
const RAIL_BUTTON_SIZE = 46
const RAIL_BUTTON_GAP = 24
const RAIL_DRAG_SPACER_HEIGHT = 32

type RailActionItem = {
  key: string
  label: string
  icon: LucideIcon
  active: boolean
  onClick: () => void
}

type IconRailProps = {
  /** jsdom does not do flex layout, so tests can pin the measured top area height. */
  __testTopRailHeight?: number | null
}

export function getVisibleRailItemCount(
  availableHeight: number | null,
  directItemCount: number,
  overflowItemCount: number,
  hasDragSpacer: boolean,
) {
  if (availableHeight === null || availableHeight <= 0) return directItemCount

  const requiresMoreButton = overflowItemCount > 0
  for (let visibleCount = directItemCount; visibleCount >= 0; visibleCount -= 1) {
    const hiddenDirectCount = directItemCount - visibleCount
    const hasMoreButton = requiresMoreButton || hiddenDirectCount > 0
    if (getRailStackHeight(visibleCount, hasMoreButton, hasDragSpacer) <= availableHeight) {
      return visibleCount
    }
  }

  return 0
}

function getRailStackHeight(visibleDirectCount: number, hasMoreButton: boolean, hasDragSpacer: boolean) {
  const childCount = visibleDirectCount + (hasMoreButton ? 1 : 0) + (hasDragSpacer ? 1 : 0)
  if (childCount <= 0) return 0

  return (
    visibleDirectCount * RAIL_BUTTON_SIZE
    + (hasMoreButton ? RAIL_BUTTON_SIZE : 0)
    + (hasDragSpacer ? RAIL_DRAG_SPACER_HEIGHT : 0)
    + (childCount - 1) * RAIL_BUTTON_GAP
  )
}

export function IconRail({ __testTopRailHeight }: IconRailProps = {}) {
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const settingsPanelView = useUIStore((s) => s.settingsPanelView)
  const openSettings = useUIStore((s) => s.openSettings)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const updateStatus = useUpdateStore((s) => s.status)
  const availableVersion = useUpdateStore((s) => s.availableVersion)
  const initializeUpdates = useUpdateStore((s) => s.initialize)
  const installUpdate = useUpdateStore((s) => s.installUpdate)
  const t = useTranslation()
  const [topRailRef, topRailHeight] = useMeasuredElementHeight<HTMLDivElement>()
  const hasDragSpacer = isTauri && !isWindows

  useEffect(() => {
    void initializeUpdates()
  }, [initializeUpdates])

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

  const directItems = useMemo<RailActionItem[]>(() => [
    {
      key: 'sidebar',
      active: sidebarOpen,
      label: sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand'),
      onClick: toggleSidebar,
      icon: Columns2,
    },
    {
      key: 'providers',
      active: isPanelActive('providers'),
      label: t('settings.tab.providers'),
      onClick: () => handlePanelView('providers'),
      icon: Bot,
    },
    {
      key: 'skills',
      active: isPanelActive('skills'),
      label: t('settings.tab.skills'),
      onClick: () => handlePanelView('skills'),
      icon: Wrench,
    },
    {
      key: 'adapters',
      active: isPanelActive('adapters'),
      label: t('settings.tab.adapters'),
      onClick: () => handlePanelView('adapters'),
      icon: MessageSquare,
    },
    {
      key: 'scheduled',
      active: isPanelActive('scheduled'),
      label: t('sidebar.scheduled'),
      onClick: () => handlePanelView('scheduled'),
      icon: Clock,
    },
    {
      key: 'computerUse',
      active: isPanelActive('computerUse'),
      label: t('settings.tab.computerUse'),
      onClick: () => handlePanelView('computerUse'),
      icon: Monitor,
    },
  ], [handlePanelView, isPanelActive, sidebarOpen, t, toggleSidebar])

  const pinnedMoreItems = useMemo<RailActionItem[]>(() => [
    {
      key: 'permissions',
      active: isPanelActive('permissions'),
      label: t('settings.tab.permissions'),
      onClick: () => handlePanelView('permissions'),
      icon: ShieldCheck,
    },
    {
      key: 'agents',
      active: isPanelActive('agents'),
      label: t('settings.tab.agents'),
      onClick: () => handlePanelView('agents'),
      icon: Workflow,
    },
    {
      key: 'terminal',
      active: isPanelActive('terminal'),
      label: t('sidebar.terminal'),
      onClick: () => handlePanelView('terminal'),
      icon: TerminalSquare,
    },
    {
      key: 'mcp',
      active: isPanelActive('mcp'),
      label: t('settings.tab.mcp'),
      onClick: () => handlePanelView('mcp'),
      icon: ChevronRight,
    },
    {
      key: 'plugins',
      active: isPanelActive('plugins'),
      label: t('settings.tab.plugins'),
      onClick: () => handlePanelView('plugins'),
      icon: Grid,
    },
  ], [handlePanelView, isPanelActive, t])

  const visibleDirectCount = getVisibleRailItemCount(
    __testTopRailHeight === undefined ? topRailHeight : __testTopRailHeight,
    directItems.length,
    pinnedMoreItems.length,
    hasDragSpacer,
  )
  const visibleDirectItems = directItems.slice(0, visibleDirectCount)
  const overflowDirectItems = directItems.slice(visibleDirectCount)
  const moreItems = [...overflowDirectItems, ...pinnedMoreItems]

  return (
    <div
      className="icon-rail-glass relative z-[80] flex h-full shrink-0 select-none flex-col items-center overflow-visible border-r border-[var(--color-border-separator)] py-[20px] text-[var(--color-text-tertiary)]"
      style={{ width: 'var(--sidebar-rail-width)' }}
      data-tauri-drag-region
    >
      <div ref={topRailRef} className="flex min-h-0 w-full flex-1 flex-col items-center gap-[24px] overflow-visible">
        {hasDragSpacer && (
          <div className="h-[32px] w-full shrink-0" data-tauri-drag-region />
        )}

        {visibleDirectItems.map((item) => (
          <RailButton key={item.key} active={item.active} label={item.label} onClick={item.onClick} icon={item.icon} />
        ))}

        {moreItems.length > 0 && (
          <MoreRailMenu
            active={moreItems.some((item) => item.active)}
            items={moreItems}
          />
        )}
      </div>

      <div className="mt-[24px] flex shrink-0 flex-col items-center gap-[24px]">
        <RailUpdateButton
          status={updateStatus}
          version={availableVersion}
          onClick={() => void installUpdate()}
        />
        <RailButton active={isPanelActive('settings')} label={t('sidebar.settings')} onClick={handleGeneralSettings} icon={Settings} />
        <a
          href="https://github.com/login?return_to=%2Fwk42worldworld%2Fcybercode"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('sidebar.githubTooltip')}
          className="group relative flex h-[46px] w-[46px] items-center justify-center overflow-visible rounded-full text-[var(--color-text-tertiary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <Github size={22} strokeWidth={1.5} />
          <RailTooltip label={t('sidebar.githubTooltip')} />
        </a>
      </div>
    </div>
  )
}

function RailUpdateButton({
  status,
  version,
  onClick,
}: {
  status: UpdateStatus
  version: string | null
  onClick: () => void
}) {
  const t = useTranslation()
  const visible = !!version && ['downloaded', 'restarting'].includes(status)
  if (!visible) return null

  const busy = status === 'restarting'
  const label = status === 'restarting'
    ? t('update.railRestarting')
    : t('update.railAvailable', { version })
  const IconComponent = busy ? RefreshCw : Download

  return (
    <button
      type="button"
      onClick={busy ? undefined : onClick}
      aria-label={label}
      data-testid="rail-update-button"
      disabled={busy}
      className="group relative flex h-[38px] w-[38px] items-center justify-center overflow-visible rounded-full border border-[#1f7aff]/25 bg-[#0a84ff] text-white shadow-[0_7px_18px_rgba(10,132,255,0.24)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-[#0072f0] hover:shadow-[0_9px_24px_rgba(10,132,255,0.30)] active:scale-95 disabled:cursor-default disabled:opacity-95"
    >
      <IconComponent size={18} strokeWidth={1.8} className={busy ? 'animate-spin' : ''} />
      <span className="absolute right-[6px] top-[6px] h-[5px] w-[5px] rounded-full border border-white/80 bg-white shadow-[0_0_0_2px_rgba(255,255,255,0.20)]" />
      <RailTooltip label={label} />
    </button>
  )
}

function MoreRailMenu({
  active,
  items,
}: {
  active: boolean
  items: RailActionItem[]
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const t = useTranslation()

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t('sidebar.more')}
        aria-expanded={open}
        data-active={active ? 'true' : 'false'}
        className={`group relative flex h-[46px] w-[46px] items-center justify-center overflow-visible rounded-full transition-colors duration-100 ${
          active || open
            ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-selected)]'
            : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        <Ellipsis size={22} strokeWidth={1.8} />
        {!open && <RailTooltip label={t('sidebar.more')} />}
      </button>

      {open && (
        <div
          className="absolute left-[calc(100%+10px)] top-1/2 z-[110] max-h-[calc(100vh-24px)] w-[168px] -translate-y-1/2 overflow-y-auto rounded-[12px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]"
          role="menu"
        >
          {items.map((item) => {
            const IconComponent = item.icon
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
                className={`flex h-[36px] w-full items-center gap-2.5 rounded-[9px] px-3 text-left text-[13px] font-medium transition-colors duration-100 ${
                  item.active
                    ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <IconComponent size={16} strokeWidth={1.7} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function useMeasuredElementHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const measure = () => {
      const rect = element.getBoundingClientRect()
      const nextHeight = rect.height || element.clientHeight
      if (nextHeight <= 0) return

      setHeight((current) => {
        if (current !== null && Math.abs(current - nextHeight) < 0.5) return current
        return nextHeight
      })
    }

    measure()

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(measure)
      : null
    resizeObserver?.observe(element)
    window.addEventListener('resize', measure)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return [ref, height] as const
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
