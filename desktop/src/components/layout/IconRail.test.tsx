import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IconRail, getVisibleRailItemCount } from './IconRail'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { useUpdateStore } from '../../stores/updateStore'

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
    useUpdateStore.setState({
      status: 'idle',
      availableVersion: null,
      releaseNotes: null,
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: false,
      initialize: vi.fn().mockResolvedValue(undefined),
      installUpdate: vi.fn().mockResolvedValue(undefined),
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

  it('groups MCP and plugins inside the more rail menu without memory', () => {
    renderIconRail()

    expect(screen.queryByRole('button', { name: 'MCP' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '插件' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '记忆' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '权限' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agents' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.queryByRole('menuitem', { name: '记忆' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'MCP' }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('mcp')

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '插件' }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('plugins')

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

  it('keeps agent migration visible as a direct rail button', () => {
    renderIconRail()

    const migrationButton = screen.getByRole('button', { name: 'Agent 数据迁移' })
    expect(migrationButton).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.queryByRole('menuitem', { name: 'Agent 数据迁移' })).not.toBeInTheDocument()
    fireEvent.click(migrationButton)

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('agentMigration')
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
    const pinnedMoreItems = 5

    expect(getVisibleRailItemCount(null, directItems, pinnedMoreItems, false)).toBe(6)
    expect(getVisibleRailItemCount(256, directItems, pinnedMoreItems, false)).toBe(3)
    expect(getVisibleRailItemCount(255, directItems, pinnedMoreItems, false)).toBe(2)
    expect(getVisibleRailItemCount(46, directItems, pinnedMoreItems, false)).toBe(0)
  })

  it('keeps Settings and GitHub pinned while overflowing upper rail icons into More', () => {
    renderIconRail(256)

    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agent 数据迁移' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '点赞收藏项目' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '大模型' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'IM 接入' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '定时任务' }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('scheduled')
  })

  it('shows a smaller blue update button above Settings only after an update is downloaded', () => {
    const { rerender } = renderIconRail()

    expect(screen.queryByTestId('rail-update-button')).not.toBeInTheDocument()

    const installUpdate = vi.fn().mockResolvedValue(undefined)
    act(() => {
      useUpdateStore.setState({
        status: 'downloading',
        availableVersion: '1.0.4',
        installUpdate,
      })
    })

    rerender(<IconRail />)
    expect(screen.queryByTestId('rail-update-button')).not.toBeInTheDocument()

    act(() => {
      useUpdateStore.setState({
        status: 'downloaded',
      })
    })

    rerender(<IconRail />)

    const updateButton = screen.getByRole('button', { name: '更新到 v1.0.4' })
    expect(updateButton).toBeInTheDocument()
    expect(updateButton).toHaveClass('bg-[#0a84ff]')
    expect(updateButton).toHaveClass('h-[38px]', 'w-[38px]')

    fireEvent.click(updateButton)
    expect(installUpdate).toHaveBeenCalledTimes(1)
  })
})
