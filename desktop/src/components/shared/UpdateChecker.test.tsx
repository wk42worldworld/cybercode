import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { UpdateChecker } from './UpdateChecker'
import { useUpdateStore } from '../../stores/updateStore'

describe('UpdateChecker', () => {
  beforeEach(() => {
    Object.defineProperty(window, '__TAURI__', {
      value: {},
      configurable: true,
    })

    useUpdateStore.setState({
      status: 'downloaded',
      availableVersion: '0.1.5',
      releaseNotes: '# CyberCode v0.1.5\n\n[Release notes](https://example.com/releases/v0.1.5)',
      progressPercent: 100,
      downloadedBytes: 2048,
      totalBytes: 2048,
      error: null,
      checkedAt: null,
      shouldPrompt: false,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })
  })

  it('initializes background update checks without rendering a popup', () => {
    const initialize = vi.fn().mockResolvedValue(undefined)
    useUpdateStore.setState({ initialize })

    render(<UpdateChecker />)

    expect(initialize).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/v0\.1\.5/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /update/i })).not.toBeInTheDocument()
  })
})
