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

    expect(screen.getByLabelText('聊天侧边栏')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编程模式' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '记忆与进化' })).toBeInTheDocument()
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
})
