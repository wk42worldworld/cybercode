import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from './SettingsPanel'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'

vi.mock('../../pages/Settings', () => ({
  Settings: () => <div data-testid="settings-home" />,
  ProviderSettings: () => <div data-testid="providers-panel" />,
  PermissionSettings: () => <div data-testid="permissions-panel" />,
  GeneralSettings: () => <div data-testid="general-panel" />,
  MemorySettings: () => <div data-testid="memory-panel" />,
  SkillSettings: () => <div data-testid="skills-panel" />,
  PluginSettings: () => <div data-testid="plugins-panel" />,
  AgentsSettings: () => <div data-testid="agents-panel" />,
  AboutSettings: () => <div data-testid="about-panel" />,
}))

vi.mock('../../pages/AdapterSettings', () => ({
  AdapterSettings: () => <div data-testid="adapters-panel" />,
}))

vi.mock('../../pages/ComputerUseSettings', () => ({
  ComputerUseSettings: () => <div data-testid="computer-use-panel" />,
}))

vi.mock('../../pages/McpSettings', () => ({
  McpSettings: () => <div data-testid="mcp-panel" />,
}))

vi.mock('../../pages/ScheduledTasks', () => ({
  ScheduledTasks: () => <div data-testid="scheduled-panel" />,
}))

vi.mock('../../pages/TerminalSettings', () => ({
  TerminalSettings: ({ active, workspace }: { active: boolean; workspace: boolean }) => (
    <div data-active={String(active)} data-workspace={String(workspace)} data-testid="terminal-panel" />
  ),
}))

describe('SettingsPanel content routing', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'zh' })
    useUIStore.setState({
      settingsOpen: true,
      settingsPanelView: 'settings',
      pendingSettingsTab: null,
      railSettingsView: null,
    })
  })

  it('renders the normal settings home for the settings button', () => {
    render(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-home')).toBeInTheDocument()
  })

  it('renders scheduled tasks inside the same floating panel shell', () => {
    useUIStore.setState({ settingsPanelView: 'scheduled' })

    render(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-panel')).toHaveAttribute('aria-label', '定时任务')
    expect(screen.getByTestId('scheduled-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-home')).not.toBeInTheDocument()
  })

  it('renders terminal as an active workspace panel', () => {
    useUIStore.setState({ settingsPanelView: 'terminal' })

    render(<SettingsPanel visible />)

    expect(screen.getByTestId('terminal-panel')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('terminal-panel')).toHaveAttribute('data-workspace', 'true')
  })

  it('closes direct panels from the shared close button', () => {
    useUIStore.setState({ settingsPanelView: 'providers' })

    render(<SettingsPanel visible />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(useUIStore.getState().settingsOpen).toBe(false)
  })

  it('renders prompt memory inside the shared floating panel', () => {
    useUIStore.setState({ settingsPanelView: 'memory' })

    render(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-panel')).toHaveAttribute('aria-label', '记忆')
    expect(screen.getByTestId('memory-panel')).toBeInTheDocument()
  })
})
