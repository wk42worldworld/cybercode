import type { ReactNode } from 'react'
import { useTabStore } from '../../stores/tabStore'
import { EmptySession } from '../../pages/EmptySession'
import { ActiveSession } from '../../pages/ActiveSession'
import { ScheduledTasks } from '../../pages/ScheduledTasks'
import { TerminalSettings } from '../../pages/TerminalSettings'

export function ContentRouter() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const recentSessionIds = useTabStore((s) => s.recentSessionIds)
  const activeTabType = tabs.find((t) => t.sessionId === activeTabId)?.type
  const terminalTabs = tabs.filter((tab) => tab.type === 'terminal')

  // Non-session pages (EmptySession / ScheduledTasks)
  let nonSessionPage: ReactNode = null
  if (!activeTabId || !activeTabType) {
    nonSessionPage = <EmptySession />
  } else if (activeTabType === 'scheduled') {
    nonSessionPage = <ScheduledTasks />
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {/* Keep the last N session panels mounted — only toggle CSS visibility.
          This makes switching back to a cached session instant (no re-render). */}
      {recentSessionIds.map((sessionId) => {
        const isActive = sessionId === activeTabId && activeTabType === 'session'
        return (
          <div
            key={sessionId}
            aria-hidden={!isActive}
            style={{ display: isActive ? 'flex' : 'none' }}
            className="absolute inset-0 flex-col min-h-0 overflow-hidden"
          >
            <ActiveSession sessionId={sessionId} isActive={isActive} />
          </div>
        )
      })}

      {/* Non-session pages sit above session panels */}
      {nonSessionPage && (
        <div className="absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden">
          {nonSessionPage}
        </div>
      )}

      {/* Terminal tabs — kept alive via opacity (existing behaviour) */}
      {terminalTabs.map((tab) => {
        const active = tab.sessionId === activeTabId
        const visible = activeTabType === 'terminal' && active
        return (
          <div
            key={tab.sessionId}
            aria-hidden={!visible}
            data-testid={`terminal-tab-panel-${tab.sessionId}`}
            className={`absolute inset-0 flex min-h-0 flex-col overflow-hidden ${
              visible ? 'z-20 opacity-100' : 'pointer-events-none z-0 opacity-0'
            }`}
          >
            <TerminalSettings
              active={active}
              workspace
              testId={`terminal-host-${tab.sessionId}`}
              onNewTerminal={() => useTabStore.getState().openTerminalTab()}
            />
          </div>
        )
      })}
    </div>
  )
}
