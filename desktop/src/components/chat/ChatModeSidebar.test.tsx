import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ChatModeSidebar } from './ChatModeSidebar'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'

describe('ChatModeSidebar', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'zh' })
    useUIStore.setState({
      settingsOpen: false,
      settingsPanelView: 'settings',
      pendingSettingsTab: null,
    })
  })

  it('renders the programming mode action', () => {
    render(<ChatModeSidebar label="编程模式" ariaLabel="聊天侧边栏" />)

    expect(screen.getByLabelText('聊天侧边栏')).toHaveClass('z-[95]')
    expect(screen.getByRole('button', { name: '编程模式' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '记忆与进化' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Token 优化' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '项目图谱' })).toBeInTheDocument()
  })

  it.each([
    ['zh', '项目图谱'],
    ['en', 'Project Graph'],
    ['ja', 'プロジェクトグラフ'],
    ['ko', '프로젝트 그래프'],
  ] as const)('localizes the Project Graph action for %s', (locale, graphLabel) => {
    useSettingsStore.setState({ locale })

    render(<ChatModeSidebar label="编程模式" ariaLabel="聊天侧边栏" />)

    expect(screen.getByRole('button', { name: graphLabel })).toBeInTheDocument()
  })

  it('opens and closes memory settings from the right rail', () => {
    render(<ChatModeSidebar label="编程模式" ariaLabel="聊天侧边栏" />)

    const memoryButton = screen.getByRole('button', { name: '记忆与进化' })
    fireEvent.click(memoryButton)

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('memory')
    expect(memoryButton).toHaveAttribute('data-active', 'true')

    fireEvent.click(memoryButton)
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })

  it('opens and closes token optimization from the right rail', () => {
    render(<ChatModeSidebar label="编程模式" ariaLabel="聊天侧边栏" />)

    const tokenButton = screen.getByRole('button', { name: 'Token 优化' })
    fireEvent.click(tokenButton)

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('tokenOptimization')
    expect(tokenButton).toHaveAttribute('data-active', 'true')

    fireEvent.click(tokenButton)
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })

  it('opens and closes the current Project Graph from the right rail', () => {
    render(<ChatModeSidebar label="编程模式" ariaLabel="聊天侧边栏" />)

    const graphButton = screen.getByRole('button', { name: '项目图谱' })
    fireEvent.click(graphButton)

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('codeGraph')
    expect(graphButton).toHaveAttribute('data-active', 'true')

    fireEvent.click(graphButton)
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })
})
