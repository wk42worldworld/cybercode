import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const minimize = vi.fn().mockResolvedValue(undefined)
const toggleMaximize = vi.fn().mockResolvedValue(undefined)
const close = vi.fn().mockResolvedValue(undefined)
const isMaximized = vi.fn().mockResolvedValue(false)
const onResized = vi.fn().mockResolvedValue(() => {})

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize,
    toggleMaximize,
    close,
    isMaximized,
    onResized,
  }),
}))

describe('WindowControls', () => {
  const originalPlatform = navigator.platform

  beforeEach(async () => {
    minimize.mockClear()
    toggleMaximize.mockClear()
    close.mockClear()
    isMaximized.mockClear()
    onResized.mockClear()

    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    })
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    })
    vi.resetModules()
  })

  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: originalPlatform,
    })
  })

  it('invokes Tauri window APIs for custom controls on Windows', async () => {
    const { WindowControls } = await import('./WindowControls')

    render(<WindowControls />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Minimize window' })).toBeInTheDocument()
    })

    const controls = screen.getByTestId('window-controls')
    const minimizeButton = screen.getByRole('button', { name: 'Minimize window' })
    const maximizeButton = screen.getByRole('button', { name: 'Maximize window' })
    const closeButton = screen.getByRole('button', { name: 'Close window' })

    expect(controls).toHaveClass('h-[42px]', 'rounded-[8px]')
    expect(minimizeButton).toHaveClass('h-full', 'w-[52px]')
    expect(maximizeButton).toHaveClass('h-full', 'w-[52px]')
    expect(closeButton).toHaveClass('h-full', 'w-[52px]')

    fireEvent.click(minimizeButton)
    fireEvent.click(maximizeButton)
    fireEvent.click(closeButton)

    await waitFor(() => {
      expect(minimize).toHaveBeenCalledTimes(1)
      expect(toggleMaximize).toHaveBeenCalledTimes(1)
      expect(close).toHaveBeenCalledTimes(1)
    })
  })
})
