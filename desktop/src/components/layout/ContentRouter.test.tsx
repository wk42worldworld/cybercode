import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../pages/EmptySession', () => ({
  EmptySession: () => <div data-testid="empty-session" />,
}))

vi.mock('../../pages/ActiveSession', () => ({
  ActiveSession: () => <div data-testid="active-session" />,
}))

vi.mock('../../pages/ScheduledTasks', () => ({
  ScheduledTasks: () => <div data-testid="scheduled-tasks" />,
}))

vi.mock('../../pages/Settings', () => ({
  Settings: () => <div data-testid="settings-page" />,
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
    })

    render(<ContentRouter />)

    expect(screen.getByTestId('terminal-host-__terminal__1')).toHaveAttribute('data-active', 'false')
    expect(screen.getByTestId('active-session')).toBeInTheDocument()
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
