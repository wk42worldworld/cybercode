import { fireEvent, render, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'

import {
  moveSelection,
  resizeSelection,
  ScreenshotOverlay,
  selectionFromPoints,
} from './ScreenshotOverlay'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('screenshot selection geometry', () => {
  it('normalizes reverse drags and clamps them to the display', () => {
    expect(selectionFromPoints(
      { x: 90, y: 80 },
      { x: -10, y: 20 },
      { width: 100, height: 100 },
    )).toEqual({ x: 0, y: 20, width: 90, height: 60 })
  })

  it('keeps moved selections inside the display', () => {
    const initial = { x: 20, y: 10, width: 50, height: 40 }
    expect(moveSelection(initial, { x: 100, y: -100 }, { width: 120, height: 80 }))
      .toEqual({ x: 70, y: 0, width: 50, height: 40 })
  })

  it('resizes from every edge without collapsing the selection', () => {
    const initial = { x: 20, y: 20, width: 60, height: 50 }
    expect(resizeSelection(initial, { x: 100, y: 100 }, 'nw', { width: 120, height: 100 }))
      .toEqual({ x: 72, y: 62, width: 8, height: 8 })
    expect(resizeSelection(initial, { x: 100, y: 100 }, 'se', { width: 120, height: 100 }))
      .toEqual({ x: 20, y: 20, width: 100, height: 80 })
  })
})

describe('ScreenshotOverlay', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'read_screen_capture_source') {
        return 'data:image/png;base64,capture-source'
      }
      return null
    })
  })

  it('cancels the active capture with Escape', async () => {
    render(<ScreenshotOverlay />)

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('cancel_screen_capture')
    })
  })
})
