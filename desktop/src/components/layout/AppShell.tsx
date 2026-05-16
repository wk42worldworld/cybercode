import { useEffect, useState } from 'react'
import { IconRail } from './IconRail'
import { Sidebar } from './Sidebar'
import { ContentRouter } from './ContentRouter'
import { ToastContainer } from '../shared/Toast'
import { UpdateChecker } from '../shared/UpdateChecker'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore, type SettingsTab } from '../../stores/uiStore'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { initializeDesktopServerUrl } from '../../lib/desktopRuntime'
import { TabBar } from './TabBar'
import { StartupErrorView } from './StartupErrorView'
import { SettingsPanel } from './SettingsPanel'
import { useTabStore } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'

export function AppShell() {
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)

  useEffect(() => {
    if (settingsOpen) closeSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        await initializeDesktopServerUrl()
        await fetchSettings()
        await useTabStore.getState().restoreTabs()

        const { activeTabId: activeId, tabs } = useTabStore.getState()
        const activeTab = tabs.find((tab) => tab.sessionId === activeId)
        if (activeId && activeTab?.type === 'session') {
          // Preload history BEFORE revealing UI. The loading screen absorbs the
          // network round-trip so the main-app tree replacement (loading → shell)
          // sees data already in the store — one controlled DOM swap, no second
          // burst that would crash the WKWebView GPU compositor.
          await useChatStore.getState().ensureSessionReady(activeTab.sessionId, activeTab.projectPath)
        }

        if (!cancelled) setReady(true)
      } catch (error) {
        if (!cancelled) {
          setStartupError(error instanceof Error ? error.message : String(error))
        }
      }
    }

    void bootstrap()
    return () => { cancelled = true }
  }, [fetchSettings])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    import(/* @vite-ignore */ '@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<string>('native-menu-navigate', (event) => {
          const target = event.payload as SettingsTab | 'settings'
          useUIStore.getState().openSettings(target === 'about' ? 'about' : undefined)
        }),
      )
      .then((fn) => { unlisten = fn })
      .catch(() => {})
    return () => { unlisten?.() }
  }, [])

  useKeyboardShortcuts()

  if (startupError) {
    return <StartupErrorView error={startupError} />
  }

  if (!ready) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#EBEBEB] dark:bg-[#111] font-sans">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 rounded-full border-[3px] border-black/10 dark:border-white/10 border-t-black/50 dark:border-t-white/50"
            style={{ animation: 'spin 0.8s linear infinite' }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[var(--color-background)] font-sans relative">
      <IconRail />
      <div
        className={`flex shrink-0 h-full relative z-20 border-r border-[var(--color-border-separator)] bg-[var(--color-surface-sidebar)] transition-[width] duration-[var(--motion-sidebar-duration)] ease-[var(--motion-sidebar-easing)] ${sidebarOpen ? 'w-[var(--sidebar-width)]' : 'w-0'} overflow-hidden`}
      >
        <Sidebar />
      </div>
      <main
        id="content-area"
        className="min-w-0 w-0 flex-1 flex flex-col overflow-hidden relative z-10 bg-transparent transition-colors duration-300"
      >
        <TabBar />
        <ContentRouter />
      </main>
      <SettingsPanel visible={settingsOpen} />
      <ToastContainer />
      <UpdateChecker />
    </div>
  )
}
