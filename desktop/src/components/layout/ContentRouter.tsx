import type { ReactNode } from 'react'
import { useTabStore } from '../../stores/tabStore'
import { ActiveSession } from '../../pages/ActiveSession'
import { EmptySession } from '../../pages/EmptySession'
import { ScheduledTasks } from '../../pages/ScheduledTasks'
import { TerminalSettings } from '../../pages/TerminalSettings'

export function ContentRouter() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const recentSessionIds = useTabStore((s) => s.recentSessionIds)
  const activeTab = tabs.find((t) => t.sessionId === activeTabId)
  const activeTabType = activeTab?.type
  const terminalTabs = tabs.filter((tab) => tab.type === 'terminal')
  const sessionPanelIds = [
    ...(activeTabId && activeTabType === 'session' ? [activeTabId] : []),
    ...recentSessionIds,
  ].filter((sessionId, index, ids) => ids.indexOf(sessionId) === index)

  // Non-session pages (ScheduledTasks)
  const nonSessionPage: ReactNode =
    activeTabType === 'scheduled' ? <ScheduledTasks /> : null

  const showEmptySession = !activeTabId || !activeTabType

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {showEmptySession && (
        <div className="content-route-panel content-route-panel--active absolute inset-0 flex min-h-0 flex-col overflow-hidden">
          <EmptySession />
        </div>
      )}

      {/* Keep the last N session panels in the DOM for layout, but only mount
          ActiveSession for the active panel. This avoids keeping hidden
          MessageList trees alive, saving GPU/memory while chatStore preserves
          the session data so re-mounting is instant. */}
      {sessionPanelIds.map((sessionId) => {
        const tab = tabs.find((candidate) => candidate.sessionId === sessionId)
        const isActive = sessionId === activeTabId && activeTabType === 'session'
        return (
          <div
            key={sessionId}
            aria-hidden={!isActive}
            style={{ display: isActive ? 'flex' : 'none' }}
            className="content-route-panel content-route-panel--active absolute inset-0 flex-col min-h-0 overflow-hidden"
          >
            {isActive ? (
              <ActiveSession sessionId={sessionId} projectPath={tab?.projectPath} isActive={isActive} />
            ) : null}
          </div>
        )
      })}

      {/* Non-session pages sit above session panels */}
      {nonSessionPage && (
        <div
          key={activeTabId ?? activeTabType}
          className="content-route-panel content-route-panel--active absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden"
        >
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
            className={`content-route-panel absolute inset-0 flex min-h-0 flex-col overflow-hidden ${
              visible
                ? 'content-route-panel--active z-20 opacity-100'
                : 'content-route-panel--inactive pointer-events-none z-0 opacity-0'
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
