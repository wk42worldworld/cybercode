import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { IconRail } from './IconRail'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'

describe('IconRail floating panel navigation', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({ locale: 'zh' })
    useTabStore.setState({ tabs: [], activeTabId: null, recentSessionIds: [] })
    useUIStore.setState({
      settingsOpen: false,
      settingsPanelView: 'settings',
      pendingSettingsTab: null,
      railSettingsView: null,
    })
  })

  it('opens scheduled tasks in the shared floating panel instead of a main tab', () => {
    render(<IconRail />)

    fireEvent.click(screen.getByRole('button', { name: '定时任务' }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('scheduled')
    expect(useTabStore.getState().tabs).toEqual([])
  })

  it('opens terminal in the shared floating panel instead of creating a terminal tab', () => {
    render(<IconRail />)

    fireEvent.click(screen.getByRole('button', { name: '终端' }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('terminal')
    expect(useTabStore.getState().tabs).toEqual([])
  })

  it('toggles direct rail pages through the same floating panel state', () => {
    render(<IconRail />)

    fireEvent.click(screen.getByRole('button', { name: '大模型' }))
    expect(useUIStore.getState().settingsPanelView).toBe('providers')
    expect(useUIStore.getState().settingsOpen).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '大模型' }))
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })
})
