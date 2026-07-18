import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../pages/ActiveSession', () => ({
  ActiveSession: ({ sessionId, isActive }: { sessionId: string; isActive: boolean }) => (
    <div
      data-testid="active-session"
      data-session-id={sessionId}
      data-active={isActive ? 'true' : 'false'}
    />
  ),
}))

vi.mock('../../pages/EmptySession', () => ({
  EmptySession: () => <div data-testid="empty-session" />,
}))

vi.mock('../../pages/ScheduledTasks', () => ({
  ScheduledTasks: () => <div data-testid="scheduled-tasks" />,
}))

vi.mock('../../pages/Settings', () => ({
  Settings: () => <div data-testid="settings-page" />,
  ProviderSettings: () => <div data-testid="settings-page" />,
  PermissionSettings: () => <div data-testid="settings-page" />,
  GeneralSettings: () => <div data-testid="settings-page" />,
  SkillSettings: () => <div data-testid="settings-page" />,
  PluginSettings: () => <div data-testid="settings-page" />,
  AgentsSettings: () => <div data-testid="settings-page" />,
  AboutSettings: () => <div data-testid="settings-page" />,
}))

vi.mock('../../pages/TerminalSettings', () => ({
  TerminalSettings: ({ active, onNewTerminal, testId }: { active: boolean; onNewTerminal: () => void; testId: string }) => (
    <div data-active={active ? 'true' : 'false'} data-testid={testId}>
      <button type="button" onClick={onNewTerminal}>New Terminal</button>
    </div>
  ),
}))

import { ContentRouter } from './ContentRouter'
import { useTabStore } from '../../stores/tabStore'

describe('ContentRouter terminal tabs', () => {
  afterEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null })
  })

  it('renders the empty session page when no tab is active', () => {
    useTabStore.setState({ tabs: [], activeTabId: null, recentSessionIds: [] })

    render(<ContentRouter />)

    expect(screen.getByTestId('empty-session')).toBeInTheDocument()
  })

  it('renders the active terminal tab as main content', () => {
    useTabStore.setState({
      tabs: [{ sessionId: '__terminal__1', title: 'Terminal 1', type: 'terminal', status: 'idle' }],
      activeTabId: '__terminal__1',
    })

    render(<ContentRouter />)

    expect(screen.getByTestId('terminal-host-__terminal__1')).toHaveAttribute('data-active', 'true')
    expect(screen.queryByTestId('active-session')).not.toBeInTheDocument()
  })

  it('keeps terminal tabs mounted while chat content is active', () => {
    useTabStore.setState({
      tabs: [
        { sessionId: '__terminal__1', title: 'Terminal 1', type: 'terminal', status: 'idle' },
        { sessionId: 'session-1', title: 'Chat', type: 'session', status: 'idle' },
      ],
      activeTabId: 'session-1',
      recentSessionIds: ['session-1'],
    })

    render(<ContentRouter />)

    expect(screen.getByTestId('terminal-host-__terminal__1')).toHaveAttribute('data-active', 'false')
    expect(screen.getByTestId('active-session')).toBeInTheDocument()
  })

  it('keeps only the current and previous chat panels warm across switches', () => {
    useTabStore.setState({
      tabs: [
        { sessionId: 'session-1', title: 'One', type: 'session', status: 'idle' },
        { sessionId: 'session-2', title: 'Two', type: 'session', status: 'idle' },
        { sessionId: 'session-3', title: 'Three', type: 'session', status: 'idle' },
      ],
      activeTabId: 'session-1',
      recentSessionIds: ['session-1', 'session-2', 'session-3'],
    })

    render(<ContentRouter />)

    const sessionOne = document.querySelector('[data-session-panel="session-1"]')
    const sessionTwo = document.querySelector('[data-session-panel="session-2"]')
    expect(sessionOne).toBeInTheDocument()
    expect(sessionTwo).toBeInTheDocument()
    expect(document.querySelector('[data-session-panel="session-3"]')).toBeNull()
    expect(sessionOne).not.toHaveClass('invisible')
    expect(sessionOne).not.toHaveAttribute('aria-hidden', 'true')
    expect(sessionTwo).toHaveClass('invisible', 'pointer-events-none')
    expect(sessionTwo).toHaveAttribute('aria-hidden', 'true')

    act(() => {
      useTabStore.getState().switchToSession('session-2', 'Two')
    })

    expect(document.querySelector('[data-session-panel="session-1"]')).toBe(sessionOne)
    expect(document.querySelector('[data-session-panel="session-2"]')).toBe(sessionTwo)
    expect(sessionOne).toHaveClass('invisible', 'pointer-events-none')
    expect(sessionOne).toHaveAttribute('aria-hidden', 'true')
    expect(sessionTwo).not.toHaveClass('invisible')
    expect(sessionTwo).not.toHaveAttribute('aria-hidden', 'true')
  })

  it('can open another terminal tab from a terminal page', () => {
    useTabStore.setState({
      tabs: [{ sessionId: '__terminal__1', title: 'Terminal 1', type: 'terminal', status: 'idle' }],
      activeTabId: '__terminal__1',
    })

    render(<ContentRouter />)
    fireEvent.click(screen.getByRole('button', { name: 'New Terminal' }))

    expect(useTabStore.getState().tabs.filter((tab) => tab.type === 'terminal')).toHaveLength(2)
    expect(useTabStore.getState().activeTabId).not.toBe('__terminal__1')
  })
})
