import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

vi.mock('./WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls" />,
  showWindowControls: true,
}))

vi.mock('../controls/ModelSelector', () => ({
  ModelSelector: ({ runtimeKey, disabled }: { runtimeKey: string; disabled?: boolean }) => (
    <div data-testid="model-selector" data-runtime-key={runtimeKey} data-disabled={String(disabled)} />
  ),
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

  it('does not render the active session as a top-bar tab', async () => {
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

    expect(screen.queryByText('My Session')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Close My Session')).not.toBeInTheDocument()
    expect(screen.getByTestId('window-controls')).toBeInTheDocument()
  })

  it('does not render any session labels in the top bar', async () => {
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

    expect(screen.queryByText('Active Session')).not.toBeInTheDocument()
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
    expect(screen.getByTestId('tab-bar-drag-gutter-right')).toHaveAttribute('data-tauri-drag-region')
    expect(screen.getByTestId('tab-bar-drag-gutter-right')).toHaveClass('h-full')
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
    expect(screen.getByTestId('window-controls')).toBeInTheDocument()
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
    expect(screen.getByTestId('window-controls')).toBeInTheDocument()
  })

  it('renders ModelSelector for session tabs and hides it for terminal tabs', async () => {
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

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-runtime-key', 'tab-1')

    unmount()

    useTabStore.setState({
      tabs: [{ sessionId: '__terminal__1', title: 'Terminal', type: 'terminal', status: 'idle' }],
      activeTabId: '__terminal__1',
    })

    await act(async () => {
      render(<TabBar />)
    })

    expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    expect(screen.getByTestId('window-controls')).toBeInTheDocument()
  })
})
