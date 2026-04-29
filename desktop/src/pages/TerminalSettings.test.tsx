import { act, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../stores/settingsStore'

const terminalMocks = vi.hoisted(() => {
  const terminalInstance = {
    cols: 80,
    rows: 24,
    loadAddon: vi.fn(),
    open: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    write: vi.fn(),
    writeln: vi.fn(),
    clear: vi.fn(),
  }
  const fitInstance = {
    fit: vi.fn(),
  }
  return {
    available: false,
    terminalInstance,
    fitInstance,
    spawn: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onOutput: vi.fn(),
    onExit: vi.fn(),
  }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(() => terminalMocks.terminalInstance),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(() => terminalMocks.fitInstance),
}))

vi.mock('../api/terminal', () => ({
  terminalApi: {
    isAvailable: () => terminalMocks.available,
    spawn: terminalMocks.spawn,
    write: terminalMocks.write,
    resize: terminalMocks.resize,
    kill: terminalMocks.kill,
    onOutput: terminalMocks.onOutput,
    onExit: terminalMocks.onExit,
  },
}))

import { TerminalSettings } from './TerminalSettings'

describe('TerminalSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    terminalMocks.available = false
    terminalMocks.spawn.mockReset()
    terminalMocks.write.mockReset()
    terminalMocks.resize.mockReset()
    terminalMocks.kill.mockReset()
    terminalMocks.onOutput.mockReset()
    terminalMocks.onExit.mockReset()
    terminalMocks.terminalInstance.loadAddon.mockClear()
    terminalMocks.terminalInstance.open.mockClear()
    terminalMocks.terminalInstance.dispose.mockClear()
    terminalMocks.terminalInstance.onData.mockClear()
    terminalMocks.terminalInstance.write.mockClear()
    terminalMocks.terminalInstance.writeln.mockClear()
    terminalMocks.terminalInstance.clear.mockClear()
    terminalMocks.fitInstance.fit.mockClear()
    terminalMocks.onOutput.mockResolvedValue(vi.fn())
    terminalMocks.onExit.mockResolvedValue(vi.fn())
    terminalMocks.write.mockResolvedValue(undefined)
    terminalMocks.resize.mockResolvedValue(undefined)
    terminalMocks.kill.mockResolvedValue(undefined)
    terminalMocks.spawn.mockResolvedValue({
      session_id: 7,
      shell: '/bin/zsh',
      cwd: '/Users/test',
    })
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn()
      disconnect = vi.fn()
    })
  })

  it('shows a desktop-runtime empty state outside Tauri', () => {
    render(<TerminalSettings />)

    expect(screen.getByText('Desktop runtime required')).toBeInTheDocument()
    expect(terminalMocks.spawn).not.toHaveBeenCalled()
  })

  it('starts a host terminal session when Tauri is available', async () => {
    terminalMocks.available = true

    render(<TerminalSettings />)

    await waitFor(() => {
      expect(terminalMocks.spawn).toHaveBeenCalledWith({ cols: 80, rows: 24 })
    })
    expect(screen.getByText('/bin/zsh')).toBeInTheDocument()
    expect(screen.getByText('/Users/test')).toBeInTheDocument()
    expect(terminalMocks.terminalInstance.open).toHaveBeenCalled()
    expect(terminalMocks.fitInstance.fit).toHaveBeenCalled()
  })

  it('writes matching terminal output events into xterm', async () => {
    terminalMocks.available = true
    let outputHandler: ((payload: { session_id: number; data: string }) => void) | undefined
    terminalMocks.onOutput.mockImplementation(async (handler) => {
      outputHandler = handler
      return vi.fn()
    })

    render(<TerminalSettings />)
    await waitFor(() => expect(terminalMocks.spawn).toHaveBeenCalled())

    act(() => {
      outputHandler?.({ session_id: 7, data: 'hello\r\n' })
      outputHandler?.({ session_id: 8, data: 'ignored\r\n' })
    })

    expect(terminalMocks.terminalInstance.write).toHaveBeenCalledWith('hello\r\n')
    expect(terminalMocks.terminalInstance.write).not.toHaveBeenCalledWith('ignored\r\n')
  })
})
