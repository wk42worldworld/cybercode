import { useTabStore } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { WindowControls } from './WindowControls'
import { ModelSelector } from '../controls/ModelSelector'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

export function TabBar() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTab = tabs.find((t) => t.sessionId === activeTabId)
  const isSession = activeTab?.type === 'session'
  const chatState = useChatStore((s) => (activeTabId ? s.sessions[activeTabId]?.chatState : 'idle'))
  const isActive = chatState !== 'idle'

  return (
    <div
      data-testid="tab-bar"
      className="native-ui-text flex h-[76px] w-full shrink-0 select-none items-center border-b border-[var(--color-border-separator)] bg-[var(--color-background)] px-[24px] md:px-[32px]"
    >
      {/* Left title / drag area */}
      <div
        data-testid="tab-bar-drag-gutter"
        className="flex h-full min-w-0 flex-1 items-center self-stretch"
        {...(isTauri ? { 'data-tauri-drag-region': true } : {})}
      >
        {activeTab && isSession && (
          <div className="tabbar-title max-w-[250px] truncate text-[15px] font-bold tracking-normal text-[var(--color-text-primary)] sm:max-w-[400px] md:max-w-[500px]">
            {activeTab.title}
          </div>
        )}
      </div>

      {/* Right: Model selector + Window controls */}
      <div className="flex shrink-0 items-center gap-[12px]" onMouseDown={(e) => e.stopPropagation()}>
        {isSession && activeTabId && (
          <ModelSelector runtimeKey={activeTabId} disabled={isActive} placement="bottom" align="right" compact />
        )}
        <div className="flex items-center gap-[12px] text-[13px] font-medium text-[var(--color-text-tertiary)]">
          <WindowControls />
        </div>
      </div>
    </div>
  )
}
