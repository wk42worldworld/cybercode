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
      className="flex items-center h-[96px] px-6 bg-transparent select-none shrink-0 w-full"
    >
      {/* Left drag gutter */}
      <div
        data-testid="tab-bar-drag-gutter"
        className="h-full flex-1 self-stretch min-w-0"
        {...(isTauri ? { 'data-tauri-drag-region': true } : {})}
      />

      {/* Right drag gutter */}
      <div
        data-testid="tab-bar-drag-gutter-right"
        className="h-full flex-1 self-stretch min-w-0"
        {...(isTauri ? { 'data-tauri-drag-region': true } : {})}
      />

      {/* Right: Model selector + Window controls */}
      <div className="flex items-center gap-3 shrink-0" onMouseDown={(e) => e.stopPropagation()}>
        {isSession && activeTabId && (
          <ModelSelector runtimeKey={activeTabId} disabled={isActive} placement="bottom" align="right" compact />
        )}
        <div className="flex items-center gap-3 text-black/40 dark:text-white/40 text-[13px] font-medium">
          <WindowControls />
        </div>
      </div>
    </div>
  )
}
