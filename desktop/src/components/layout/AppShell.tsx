import { useEffect, useState } from 'react'
import { IconRail } from './IconRail'
import { Sidebar } from './Sidebar'
import { ContentRouter } from './ContentRouter'
import { ToastContainer } from '../shared/Toast'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore, type SettingsTab } from '../../stores/uiStore'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { initializeDesktopServerUrl } from '../../lib/desktopRuntime'
import { TabBar } from './TabBar'
import { StartupErrorView } from './StartupErrorView'
import { SettingsPanel } from './SettingsPanel'
import { useTabStore } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { ChatModeSidebar } from '../chat/ChatModeSidebar'
import { useTranslation } from '../../i18n'

const BOOT_SPLASH_REMOVE_DELAY_MS = 16

function dismissBootSplash() {
  const splash = document.getElementById('boot-splash')
  if (!splash) return () => {}

  splash.classList.add('boot-splash-exit')
  const remove = () => splash.remove()
  const timeout = window.setTimeout(remove, BOOT_SPLASH_REMOVE_DELAY_MS)

  return () => {
    window.clearTimeout(timeout)
  }
}

export function AppShell() {
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const activeTab = tabs.find((tab) => tab.sessionId === activeTabId)
  const showChatModeSidebar = activeTab?.type === 'session'
  const t = useTranslation()
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
      } catch (error) {
        if (!cancelled) {
          setStartupError(error instanceof Error ? error.message : String(error))
        }
        return
      }

      await Promise.all([
        fetchSettings().catch((error) => {
          console.warn('[desktop] Failed to load startup settings:', error)
        }),
        useTabStore.getState().restoreTabs().catch((error) => {
          console.warn('[desktop] Failed to restore startup tabs:', error)
        }),
      ])

      const { activeTabId: activeId, tabs } = useTabStore.getState()
      const activeTab = tabs.find((tab) => tab.sessionId === activeId)
      if (activeId && activeTab?.type === 'session') {
        try {
          await useChatStore.getState().ensureSessionReady(activeTab.sessionId, activeTab.projectPath)
        } catch (error) {
          console.warn('[desktop] Failed to prepare the startup session:', error)
        }
      }

      if (!cancelled) setReady(true)
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

  useEffect(() => {
    if (!ready && !startupError) return
    return dismissBootSplash()
  }, [ready, startupError])

  useKeyboardShortcuts()

  if (startupError) {
    return <StartupErrorView error={startupError} />
  }

  if (!ready) {
    return null
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-transparent font-sans text-[var(--color-text-primary)]">
      <div className="relative flex h-full w-full overflow-hidden bg-transparent">
        <IconRail />
        <div
          className={`relative z-20 flex h-full shrink-0 overflow-hidden border-r border-[var(--color-border-separator)] bg-[var(--color-surface-sidebar)] transition-[width] duration-[var(--motion-sidebar-duration)] ease-[var(--motion-sidebar-easing)] ${sidebarOpen ? 'w-[var(--sidebar-width)]' : 'w-0'}`}
        >
          <Sidebar />
        </div>
        <main
          id="content-area"
          className="relative z-10 flex min-w-0 w-0 flex-1 flex-col overflow-hidden bg-[var(--color-background)] transition-colors duration-150"
        >
          <TabBar />
          <ContentRouter />
        </main>
        {showChatModeSidebar && (
          <ChatModeSidebar label={t('chat.programmingMode')} ariaLabel={t('chat.sideRail')} />
        )}
        <SettingsPanel visible={settingsOpen} reserveRightRail={showChatModeSidebar} />
        <ToastContainer />
      </div>
    </div>
  )
}
