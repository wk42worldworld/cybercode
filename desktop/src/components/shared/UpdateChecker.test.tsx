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
      status: 'available',
      availableVersion: '0.1.5',
      releaseNotes: '# CyberCode v0.1.5\n\n[Release notes](https://example.com/releases/v0.1.5)',
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })
  })

  it('renders markdown release notes in the update prompt', () => {
    render(<UpdateChecker />)

    expect(screen.getAllByText(/v0\.1\.5/).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'CyberCode v0.1.5' })).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Release notes' })
    expect(link).toHaveAttribute('href', 'https://example.com/releases/v0.1.5')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('shows downloaded bytes when the updater does not provide total size', () => {
    useUpdateStore.setState({
      status: 'downloading',
      availableVersion: '0.1.5',
      releaseNotes: '# CyberCode v0.1.5',
      progressPercent: 0,
      downloadedBytes: 1536,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })

    render(<UpdateChecker />)

    expect(screen.getByText(/1\.5 KB/)).toBeInTheDocument()
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument()
  })
})
