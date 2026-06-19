import { Icon } from '../shared/Icon'

type ChatModeSidebarProps = {
  label: string
  ariaLabel: string
}

export function ChatModeSidebar({ label, ariaLabel }: ChatModeSidebarProps) {
  return (
    <aside
      aria-label={ariaLabel}
      className="native-ui-text relative z-20 flex h-full w-[var(--sidebar-rail-width)] shrink-0 select-none flex-col items-center border-l border-[var(--color-border-separator)] bg-[var(--color-surface-sidebar)] py-[20px] text-[var(--color-text-tertiary)]"
    >
      <button
        type="button"
        aria-label={label}
        data-active="false"
        className="group relative flex h-[46px] w-[46px] items-center justify-center overflow-visible rounded-full text-[var(--color-text-tertiary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
      >
        <Icon name="code" size={22} />
        <span className="pointer-events-none absolute right-[calc(100%+10px)] top-1/2 z-[100] min-w-max max-w-[calc(100vw-96px)] -translate-y-1/2 whitespace-nowrap rounded-[10px] bg-[var(--color-inverse-surface)] px-[10px] py-[6px] text-[12px] font-semibold leading-none text-[var(--color-inverse-on-surface)] opacity-0 shadow-[0_8px_20px_rgba(0,0,0,0.12)] transition-[opacity,transform] duration-100 group-hover:-translate-x-[2px] group-hover:opacity-100 group-focus-visible:-translate-x-[2px] group-focus-visible:opacity-100">
          {label}
        </span>
      </button>
    </aside>
  )
}
