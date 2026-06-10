import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

vi.mock('./WindowControls', () => ({
  WindowControls: () => null,
  showWindowControls: false,
}))

describe('TabBar', () => {
  beforeEach(() => {
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: {},
    })
    vi.resetModules()
  })

  afterEach(async () => {
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({ tabs: [], activeTabId: null, recentSessionIds: [] })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    delete (window as typeof window & { __TAURI__?: unknown }).__TAURI__
  })

  it('renders the active session title without tab close controls', async () => {
    const { TabBar } = await import('./TabBar')
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({
      tabs: [{ sessionId: 'tab-1', title: 'My Session', type: 'session', status: 'idle' }],
      activeTabId: 'tab-1',
    })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    await act(async () => {
      render(<TabBar />)
    })

    expect(screen.getByText('My Session')).toBeInTheDocument()
    expect(screen.queryByLabelText('Close My Session')).not.toBeInTheDocument()
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument()
  })

  it('renders only the active session label in the top bar', async () => {
    const { TabBar } = await import('./TabBar')
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({
      tabs: [
        { sessionId: 'tab-1', title: 'Inactive Session', type: 'session', status: 'idle' },
        { sessionId: 'tab-2', title: 'Active Session', type: 'session', status: 'idle' },
      ],
      activeTabId: 'tab-2',
    })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    await act(async () => {
      render(<TabBar />)
    })

    expect(screen.getByText('Active Session')).toBeInTheDocument()
    expect(screen.queryByText('Inactive Session')).not.toBeInTheDocument()
  })

  it('marks drag gutters with data-tauri-drag-region', async () => {
    const { TabBar } = await import('./TabBar')
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({
      tabs: [{ sessionId: 'tab-1', title: 'My Session', type: 'session', status: 'idle' }],
      activeTabId: 'tab-1',
    })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    await act(async () => {
      render(<TabBar />)
    })

    // Outer container should not have the attribute
    expect(screen.getByTestId('tab-bar')).not.toHaveAttribute('data-tauri-drag-region')
    // Gutter should have it
    expect(screen.getByTestId('tab-bar-drag-gutter')).toHaveAttribute('data-tauri-drag-region')
    expect(screen.getByTestId('tab-bar-drag-gutter')).toHaveClass('h-full')
  })

  it('does not render terminal labels or close controls in the top bar', async () => {
    const { TabBar } = await import('./TabBar')
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({
      tabs: [{ sessionId: '__terminal__1', title: 'Terminal 1', type: 'terminal', status: 'idle' }],
      activeTabId: '__terminal__1',
    })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    await act(async () => {
      render(<TabBar />)
    })

    expect(screen.queryByText('Terminal 1')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Close Terminal 1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument()
  })

  it('renders an empty drag surface when no tabs exist', async () => {
    const { TabBar } = await import('./TabBar')
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({
      tabs: [],
      activeTabId: null,
    })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    await act(async () => {
      render(<TabBar />)
    })

    expect(screen.getByTestId('tab-bar')).toBeInTheDocument()
    expect(screen.queryByText('CyberCode')).not.toBeInTheDocument()
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument()
  })

  it('keeps the model selector out of the top bar', async () => {
    const { TabBar } = await import('./TabBar')
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({
      tabs: [{ sessionId: 'tab-1', title: 'My Session', type: 'session', status: 'idle' }],
      activeTabId: 'tab-1',
    })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    const { unmount } = render(<TabBar />)

    await act(async () => {})

    expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument()

    unmount()

    useTabStore.setState({
      tabs: [{ sessionId: '__terminal__1', title: 'Terminal', type: 'terminal', status: 'idle' }],
      activeTabId: '__terminal__1',
    })

    await act(async () => {
      render(<TabBar />)
    })

    expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument()
  })
})
