import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { IconRail, getVisibleRailItemCount } from './IconRail'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'

describe('IconRail floating panel navigation', () => {
  const renderIconRail = (topRailHeight: number | null = null) => render(<IconRail __testTopRailHeight={topRailHeight} />)

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
    renderIconRail()

    fireEvent.click(screen.getByRole('button', { name: '定时任务' }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('scheduled')
    expect(useTabStore.getState().tabs).toEqual([])
  })

  it('opens terminal in the shared floating panel instead of creating a terminal tab', () => {
    renderIconRail()

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '终端' }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('terminal')
    expect(useTabStore.getState().tabs).toEqual([])
  })

  it('groups MCP, plugins, and memory inside the more rail menu', () => {
    renderIconRail()

    expect(screen.queryByRole('button', { name: 'MCP' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '插件' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '记忆' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '权限' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agents' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'MCP' }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('mcp')

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '插件' }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('plugins')

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '记忆' }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('memory')
  })

  it('opens permissions and agents from the more rail menu', () => {
    renderIconRail()

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '权限' }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('permissions')

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Agents' }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('agents')
  })

  it('toggles direct rail pages through the same floating panel state', () => {
    renderIconRail()

    fireEvent.click(screen.getByRole('button', { name: '大模型' }))
    expect(useUIStore.getState().settingsPanelView).toBe('providers')
    expect(useUIStore.getState().settingsOpen).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '大模型' }))
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })

  it('moves direct rail icons into More when the top rail height is tight', () => {
    const directItems = 6
    const pinnedMoreItems = 6

    expect(getVisibleRailItemCount(null, directItems, pinnedMoreItems, false)).toBe(6)
    expect(getVisibleRailItemCount(256, directItems, pinnedMoreItems, false)).toBe(3)
    expect(getVisibleRailItemCount(255, directItems, pinnedMoreItems, false)).toBe(2)
    expect(getVisibleRailItemCount(46, directItems, pinnedMoreItems, false)).toBe(0)
  })

  it('keeps Settings and GitHub pinned while overflowing upper rail icons into More', () => {
    renderIconRail(256)

    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '点赞收藏项目' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '大模型' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'IM 接入' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '定时任务' }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('scheduled')
  })
})
