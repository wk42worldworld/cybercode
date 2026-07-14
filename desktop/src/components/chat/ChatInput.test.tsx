import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatInput } from './ChatInput'
import { useChatStore, type PerSessionState } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useTeamStore } from '../../stores/teamStore'
import { useUIStore } from '../../stores/uiStore'
import { OFFICIAL_MODELS } from '../../constants/modelCatalog'
import { open } from '@tauri-apps/plugin-dialog'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((filePath: string) => `asset://localhost/${encodeURIComponent(filePath)}`),
  invoke: vi.fn(async () => 'data:image/png;base64,desktop-preview'),
}))

function makeChatSession(overrides: Partial<PerSessionState> = {}): PerSessionState {
  return {
    messages: [],
    historyBuffer: [],
    recentBuffer: [],
    historyLoadState: 'loaded',
    allMessagesLoaded: true,
    chatState: 'idle',
    connectionState: 'connected',
    streamingText: '',
    streamingToolInput: '',
    activeToolUseId: null,
    activeToolName: null,
    activeThinkingId: null,
    pendingPermission: null,
    pendingComputerUsePermission: null,
    pendingSteers: [],
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
    elapsedSeconds: 0,
    statusVerb: '',
    turnStartedAt: null,
    lastModelActivityAt: null,
    lastConnectionActivityAt: null,
    slashCommands: [],
    agentTaskNotifications: {},
    elapsedTimer: null,
    ...overrides,
  }
}

describe('ChatInput composer controls', () => {
  beforeEach(() => {
    vi.mocked(open).mockReset()
    vi.mocked(convertFileSrc).mockClear()
    vi.mocked(invoke).mockReset()
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'read_image_preview_data_url') {
        return 'data:image/png;base64,desktop-preview'
      }
      return null
    })
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    delete (window as Window & { __TAURI__?: unknown }).__TAURI__

    useSettingsStore.setState({
      locale: 'en',
      permissionMode: 'default',
      availableModels: OFFICIAL_MODELS,
      currentModel: OFFICIAL_MODELS[0] ?? null,
      activeProviderName: null,
      effortLevel: 'medium',
    })
    useTabStore.setState({ tabs: [], activeTabId: null, recentSessionIds: [] })
    useSessionStore.setState({ sessions: [], activeSessionId: null, isLoading: false, error: null })
    useTeamStore.setState({ teams: [], activeTeam: null, memberColors: new Map(), error: null })
    useChatStore.setState({ sessions: {} })
    useUIStore.setState({
      pendingSettingsTab: null,
      settingsOpen: false,
      settingsPanelView: 'settings',
      railSettingsView: null,
      toasts: [],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('matches the message column width in the active chat', () => {
    const { container } = render(<ChatInput />)

    const column = container.querySelector('[data-chat-content-column]')
    expect(column).toHaveClass('w-full', 'max-w-[878px]')
    expect(column?.parentElement).toHaveClass('p-[24px]')
  })

  it('shows permission mode as its own icon button outside the plus menu', () => {
    render(<ChatInput />)

    expect(screen.getByRole('button', { name: 'Ask permissions' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open composer tools' }))
    expect(screen.getAllByText('Slash commands').length).toBeGreaterThan(0)
    expect(screen.getByText('Add file reference')).toBeInTheDocument()
    expect(screen.queryByText('Execution Permissions')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ask permissions' }))
    expect(screen.getByText('Execution Permissions')).toBeInTheDocument()
    expect(screen.getByText('Auto accept edits')).toBeInTheDocument()
  })

  it('keeps token usage in the same runtime control row as the model selector', () => {
    useChatStore.setState({
      sessions: {
        'session-1': makeChatSession(),
      },
    })

    render(
      <ChatInput
        sessionId="session-1"
        projectPath="/tmp/project"
        runtimeKey="session-1"
      />,
    )

    const runtimeControls = screen.getByTestId('composer-runtime-controls')
    const modelSelector = runtimeControls.querySelector('.model-selector-compact')
    const tokenUsage = screen.getByTestId('token-usage-indicator')
    expect(modelSelector).toBeInTheDocument()
    expect(runtimeControls).toContainElement(tokenUsage)
    expect(tokenUsage.compareDocumentPosition(modelSelector!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('submits the highlighted slash command when send is clicked with the menu open', async () => {
    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '/rev', selectionStart: 4 } })
    expect(await screen.findByText('Review code changes')).toBeInTheDocument()

    const runButton = screen.getByRole('button', { name: 'Run' })
    fireEvent.mouseDown(runButton)
    fireEvent.click(runButton)

    expect(onSubmit).toHaveBeenCalledWith('/review', [])
  })

  it('opens the model selector for /model instead of sending it as a chat message', async () => {
    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} runtimeKey="draft-session" />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '/model', selectionStart: 6 } })
    expect(await screen.findByText('Switch AI model')).toBeInTheDocument()

    const runButton = screen.getByRole('button', { name: 'Run' })
    fireEvent.mouseDown(runButton)
    fireEvent.click(runButton)

    expect(await screen.findByText('Model Configuration')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each([
    ['/config', 'general'],
    ['/permissions', 'permissions'],
    ['/terminal-setup', 'terminal'],
    ['/login', 'providers'],
    ['/logout', 'providers'],
    ['/agents', 'agents'],
  ] as const)('opens the desktop settings panel for %s', async (command, expectedTab) => {
    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: command, selectionStart: command.length } })

    const runButton = screen.getByRole('button', { name: 'Run' })
    fireEvent.mouseDown(runButton)
    fireEvent.click(runButton)

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe(expectedTab)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('intercepts /vim with a desktop notice instead of sending it to the chat backend', () => {
    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '/vim', selectionStart: 4 } })

    const runButton = screen.getByRole('button', { name: 'Run' })
    fireEvent.mouseDown(runButton)
    fireEvent.click(runButton)

    expect(onSubmit).not.toHaveBeenCalled()
    const toasts = useUIStore.getState().toasts
    expect(toasts[toasts.length - 1]?.message).toContain('Vim mode is only available')
  })

  it('intercepts other TUI-only local commands with a generic desktop notice', () => {
    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '/theme', selectionStart: 6 } })

    const runButton = screen.getByRole('button', { name: 'Run' })
    fireEvent.mouseDown(runButton)
    fireEvent.click(runButton)

    expect(onSubmit).not.toHaveBeenCalled()
    const toasts = useUIStore.getState().toasts
    expect(toasts[toasts.length - 1]?.message).toContain('/theme is a terminal UI command')
  })

  it('rejects pathless regular files instead of reading them inline', () => {
    const readSpy = vi.spyOn(FileReader.prototype, 'readAsDataURL')
    render(<ChatInput />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['pdf'], 'report.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })

    const toasts = useUIStore.getState().toasts
    expect(toasts[toasts.length - 1]?.type).toBe('warning')
    expect(toasts[toasts.length - 1]?.message).toContain('cannot be attached without a local path')
    expect(readSpy).not.toHaveBeenCalled()
    expect(screen.queryByText('report.pdf')).not.toBeInTheDocument()
  })

  it('rejects pathless unknown file types when the OS does not provide a MIME type', () => {
    const readSpy = vi.spyOn(FileReader.prototype, 'readAsDataURL')
    render(<ChatInput />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['zip'], 'archive.zip', { type: '' })
    fireEvent.change(input, { target: { files: [file] } })

    const toasts = useUIStore.getState().toasts
    expect(toasts[toasts.length - 1]?.type).toBe('warning')
    expect(toasts[toasts.length - 1]?.message).toContain('cannot be attached without a local path')
    expect(readSpy).not.toHaveBeenCalled()
    expect(screen.queryByText('archive.zip')).not.toBeInTheDocument()
  })

  it('attaches desktop paperclip selections by path without reading file contents', async () => {
    const readSpy = vi.spyOn(FileReader.prototype, 'readAsDataURL')
    vi.mocked(open).mockResolvedValue([
      '/Users/wang/Desktop/voice.mp3',
      '/Users/wang/Documents/report.pdf',
    ])
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    })

    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add files or photos' }))

    expect(await screen.findByText('voice.mp3')).toBeInTheDocument()
    expect(await screen.findByText('report.pdf')).toBeInTheDocument()
    expect(readSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(onSubmit).toHaveBeenCalledWith('', [
      expect.objectContaining({
        type: 'file',
        name: 'voice.mp3',
        path: '/Users/wang/Desktop/voice.mp3',
      }),
      expect.objectContaining({
        type: 'file',
        name: 'report.pdf',
        path: '/Users/wang/Documents/report.pdf',
      }),
    ])
  })

  it('captures a selected screen region and adds it as an image attachment', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    })
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'capture_screen_region') {
        return '/tmp/cybercode-screenshot-test.png'
      }
      if (command === 'read_image_preview_data_url') {
        return 'data:image/png;base64,captured-preview'
      }
      return null
    })

    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: 'Capture screen region' }))

    const preview = await screen.findByRole('img', { name: 'cybercode-screenshot-test.png' })
    expect(preview).toHaveAttribute('src', 'data:image/png;base64,captured-preview')
    expect(invoke).toHaveBeenNthCalledWith(1, 'capture_screen_region')
    expect(invoke).toHaveBeenNthCalledWith(2, 'read_image_preview_data_url', {
      path: '/tmp/cybercode-screenshot-test.png',
      mimeType: 'image/png',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(onSubmit).toHaveBeenCalledWith('', [
      expect.objectContaining({
        type: 'image',
        name: 'cybercode-screenshot-test.png',
        path: '/tmp/cybercode-screenshot-test.png',
        mimeType: 'image/png',
      }),
    ])
  })

  it('treats cancelling the screen region picker as a no-op', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    })
    vi.mocked(invoke).mockResolvedValueOnce(null)

    render(<ChatInput onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture screen region' }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('capture_screen_region')
      expect(screen.getByRole('button', { name: 'Capture screen region' })).toBeEnabled()
    })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(useUIStore.getState().toasts).toEqual([])
  })

  it('reports region capture failures without adding an attachment', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    })
    vi.mocked(invoke).mockRejectedValueOnce(new Error('screen recording permission denied'))

    render(<ChatInput onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture screen region' }))

    await waitFor(() => {
      expect(useUIStore.getState().toasts).toContainEqual(expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('screen recording permission denied'),
      }))
    })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(errorSpy).toHaveBeenCalledWith(
      '[ChatInput] Failed to capture screen region:',
      expect.any(Error),
    )
  })

  it('shows actionable guidance when macOS screen recording permission is denied', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    })
    vi.mocked(invoke).mockRejectedValueOnce(new Error('SCREEN_CAPTURE_PERMISSION_REQUIRED'))

    render(<ChatInput onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture screen region' }))

    await waitFor(() => {
      expect(useUIStore.getState().toasts).toContainEqual(expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('Allow screen recording for CyberCode'),
      }))
    })
  })

  it('shows desktop-selected image paths as image thumbnails without browser file reads', async () => {
    const readSpy = vi.spyOn(FileReader.prototype, 'readAsDataURL')
    vi.mocked(open).mockResolvedValue('/Users/wang/Pictures/mockup.png')
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    })

    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add files or photos' }))

    const preview = await screen.findByRole('img', { name: 'mockup.png' })
    expect(preview).toHaveAttribute('src', 'data:image/png;base64,desktop-preview')
    expect(invoke).toHaveBeenCalledWith('read_image_preview_data_url', {
      path: '/Users/wang/Pictures/mockup.png',
      mimeType: 'image/png',
    })
    expect(convertFileSrc).not.toHaveBeenCalled()
    expect(readSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(onSubmit).toHaveBeenCalledWith('', [
      expect.objectContaining({
        type: 'image',
        name: 'mockup.png',
        path: '/Users/wang/Pictures/mockup.png',
        previewUrl: 'data:image/png;base64,desktop-preview',
        mimeType: 'image/png',
      }),
    ])
  })

  it('shows a visible drag target while files are dragged over the composer', () => {
    render(<ChatInput />)

    const textarea = screen.getByRole('textbox')
    const dataTransfer = {
      types: ['Files'],
      files: [],
      getData: vi.fn(() => ''),
      dropEffect: 'none',
    }

    fireEvent.dragEnter(textarea, { dataTransfer })

    expect(screen.getByText('Drop to attach files or photos')).toBeInTheDocument()
    expect(screen.getByText('CyberCode will add them to this message.')).toBeInTheDocument()

    fireEvent.dragLeave(textarea, { dataTransfer })

    expect(screen.queryByText('Drop to attach files or photos')).not.toBeInTheDocument()
  })

  it('attaches dropped desktop file paths without reading file contents', async () => {
    const readSpy = vi.spyOn(FileReader.prototype, 'readAsDataURL')
    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} />)

    const textarea = screen.getByRole('textbox')
    const dataTransfer = {
      types: ['text/uri-list'],
      files: [],
      getData: vi.fn((type: string) =>
        type === 'text/uri-list'
          ? [
              'file:///Users/wang/Desktop/meeting.wav',
              'file:///Users/wang/Documents/report.pdf',
            ].join('\n')
          : '',
      ),
      dropEffect: 'none',
    }

    fireEvent.drop(textarea, { dataTransfer })

    expect(await screen.findByText('meeting.wav')).toBeInTheDocument()
    expect(await screen.findByText('report.pdf')).toBeInTheDocument()
    expect(readSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(onSubmit).toHaveBeenCalledWith('', [
      expect.objectContaining({
        type: 'file',
        name: 'meeting.wav',
        path: '/Users/wang/Desktop/meeting.wav',
      }),
      expect.objectContaining({
        type: 'file',
        name: 'report.pdf',
        path: '/Users/wang/Documents/report.pdf',
      }),
    ])
  })

  it('falls back to a Tauri asset URL when desktop image preview reading fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(open).mockResolvedValue('/Users/wang/Pictures/mockup.png')
    vi.mocked(invoke).mockRejectedValueOnce(new Error('preview read failed'))
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    })

    render(<ChatInput onSubmit={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add files or photos' }))

    const preview = await screen.findByRole('img', { name: 'mockup.png' })
    expect(preview).toHaveAttribute('src', 'asset://localhost/%2FUsers%2Fwang%2FPictures%2Fmockup.png')
    expect(warnSpy).toHaveBeenCalledWith(
      '[ChatInput] Failed to read image preview data URL:',
      expect.any(Error),
    )
    expect(convertFileSrc).toHaveBeenCalledWith('/Users/wang/Pictures/mockup.png')
  })

  it('queues extra input while the assistant is active', () => {
    const onSubmit = vi.fn()
    useChatStore.setState({
      sessions: {
        'running-session': makeChatSession({ chatState: 'streaming' }),
      },
    })

    render(<ChatInput sessionId="running-session" onSubmit={onSubmit} />)

    expect(screen.queryByTestId('streaming-indicator')).not.toBeInTheDocument()

    const textarea = screen.getByRole('textbox')
    act(() => {
      fireEvent.change(textarea, { target: { value: '还有一个补充' } })
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })
    })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(textarea).toHaveValue('')
    expect(useChatStore.getState().sessions['running-session']?.pendingSteers).toMatchObject([
      {
        content: '还有一个补充',
        status: 'draft',
      },
    ])
  })
})
