import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import { LongRunningNotice, formatRunningDuration } from './LongRunningNotice'

describe('LongRunningNotice', () => {
  afterEach(() => {
    vi.useRealTimers()
    useSettingsStore.setState({ locale: 'en' })
  })

  it('formats long running durations compactly', () => {
    expect(formatRunningDuration(42)).toBe('42s')
    expect(formatRunningDuration(125)).toBe('2m 5s')
    expect(formatRunningDuration(3600)).toBe('1h')
  })

  it('stays hidden before a quiet turn reaches the notice threshold', () => {
    render(
      <LongRunningNotice
        chatState="thinking"
        elapsedSeconds={30}
        hasVisibleResponse={false}
      />,
    )

    expect(screen.queryByTestId('long-running-notice')).not.toBeInTheDocument()
  })

  it('shows a waiting notice when a turn has no visible response', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-19T00:00:00.000Z'))

    render(
      <LongRunningNotice
        chatState="thinking"
        elapsedSeconds={60}
        hasVisibleResponse={false}
        lastConnectionActivityAt={Date.now()}
      />,
    )

    const notice = screen.getByTestId('long-running-notice')
    expect(notice).toHaveTextContent('Still waiting for the model')
    expect(notice).toHaveTextContent('1m')
    expect(notice).toHaveClass('px-[24px]')
    expect(notice.querySelector('[data-chat-content-column]')).toHaveClass('w-full', 'max-w-[878px]')
  })

  it('shows stale connection copy when the server has stopped sending events', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-19T00:05:00.000Z'))

    render(
      <LongRunningNotice
        chatState="thinking"
        elapsedSeconds={300}
        hasVisibleResponse={true}
        lastConnectionActivityAt={Date.now() - 120_000}
      />,
    )

    expect(screen.getByTestId('long-running-notice')).toHaveTextContent('Connection may be stalled')
    expect(screen.getByTestId('long-running-notice')).toHaveTextContent('2m')
  })

  it('stays hidden while a permission prompt is waiting for the user', () => {
    render(
      <LongRunningNotice
        chatState="permission_pending"
        elapsedSeconds={300}
        hasVisibleResponse={false}
      />,
    )

    expect(screen.queryByTestId('long-running-notice')).not.toBeInTheDocument()
  })
})
