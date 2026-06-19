import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatInput } from './ChatInput'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useTeamStore } from '../../stores/teamStore'
import { useUIStore } from '../../stores/uiStore'
import { OFFICIAL_MODELS } from '../../constants/modelCatalog'
import { open } from '@tauri-apps/plugin-dialog'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

describe('ChatInput composer controls', () => {
  beforeEach(() => {
    vi.mocked(open).mockReset()
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
})
