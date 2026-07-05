import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { adaptersApi } from '../api/adapters'
import { useSettingsStore } from '../stores/settingsStore'
import { useAdapterStore } from '../stores/adapterStore'
import { AdapterSettings } from './AdapterSettings'

vi.mock('../api/adapters', () => ({
  adaptersApi: {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
  },
}))

describe('AdapterSettings', () => {
  beforeEach(() => {
    vi.mocked(adaptersApi.getConfig).mockResolvedValue({})
    vi.mocked(adaptersApi.updateConfig).mockResolvedValue({})
    useSettingsStore.setState({ locale: 'zh' })
    useAdapterStore.setState({
      config: {},
      isLoading: false,
      error: null,
    })
  })

  it('shows prominent full setup guide buttons for IM adapters', async () => {
    render(<AdapterSettings />)

    expect((await screen.findAllByText('飞书接入教程')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Telegram 接入教程').length).toBeGreaterThanOrEqual(1)
    expect(
      screen.getAllByRole('button', { name: '查看完整接入教程' }).length,
    ).toBeGreaterThanOrEqual(2)
  })

  it('opens the Telegram full setup guide from the visible button', async () => {
    render(<AdapterSettings />)

    await screen.findByText('Telegram 接入教程')
    const buttons = screen.getAllByRole('button', { name: '查看完整接入教程' })
    fireEvent.click(buttons[1]!)

    expect(
      screen.getByRole('dialog', { name: 'Telegram 连接教程' }),
    ).toBeInTheDocument()
  })
})
