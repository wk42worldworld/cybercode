import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { initializeDesktopServerUrl } from '../../lib/desktopRuntime'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { AppShell } from './AppShell'

vi.mock('../../lib/desktopRuntime', () => ({
  initializeDesktopServerUrl: vi.fn(),
}))

vi.mock('../../hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}))

vi.mock('./IconRail', () => ({
  IconRail: () => <div data-testid="icon-rail" />,
}))

vi.mock('./Sidebar', () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}))

vi.mock('./ContentRouter', () => ({
  ContentRouter: () => <main data-testid="content-router" />,
}))

vi.mock('./TabBar', () => ({
  TabBar: () => <div data-testid="tab-bar" />,
}))

vi.mock('./SettingsPanel', () => ({
  SettingsPanel: () => <div data-testid="settings-panel" />,
}))

vi.mock('../chat/ChatModeSidebar', () => ({
  ChatModeSidebar: () => <div data-testid="chat-mode-sidebar" />,
}))

vi.mock('../shared/Toast', () => ({
  ToastContainer: () => <div data-testid="toast-container" />,
}))

describe('AppShell bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    useSettingsStore.setState({
      fetchAll: vi.fn(async () => {}),
      locale: 'en',
    } as Partial<ReturnType<typeof useSettingsStore.getState>>)
    useTabStore.setState({
      tabs: [],
      activeTabId: null,
      recentSessionIds: [],
      restoreTabs: vi.fn(async () => {}),
    } as Partial<ReturnType<typeof useTabStore.getState>>)
    useChatStore.setState({
      sessions: {},
      ensureSessionReady: vi.fn(async () => {}),
    } as Partial<ReturnType<typeof useChatStore.getState>>)
    useUIStore.setState({
      sidebarOpen: true,
      settingsOpen: false,
      activeView: 'code',
      settingsPanelView: 'settings',
      railSettingsView: null,
      activeModal: null,
      toasts: [],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('continues into the app when startup settings load times out', async () => {
    vi.mocked(initializeDesktopServerUrl).mockResolvedValue('http://127.0.0.1:3456')
    const fetchAll = vi.fn(async () => {
      throw new Error('Request timed out after 30s')
    })
    useSettingsStore.setState({
      fetchAll,
    } as Partial<ReturnType<typeof useSettingsStore.getState>>)

    render(<AppShell />)

    expect(await screen.findByTestId('content-router')).toBeInTheDocument()
    expect(screen.queryByText('Local server failed to start')).not.toBeInTheDocument()
    await waitFor(() => expect(fetchAll).toHaveBeenCalled())
    expect(console.warn).toHaveBeenCalledWith(
      '[desktop] Failed to load startup settings:',
      expect.any(Error),
    )
  })

  it('shows the startup error view when the local server cannot initialize', async () => {
    vi.mocked(initializeDesktopServerUrl).mockRejectedValue(new Error('sidecar missing'))

    render(<AppShell />)

    expect(await screen.findByText('Local server failed to start')).toBeInTheDocument()
    expect(screen.getByText('sidecar missing')).toBeInTheDocument()
  })
})
