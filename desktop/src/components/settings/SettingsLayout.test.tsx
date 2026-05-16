import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'
import { SettingsPage } from './SettingsLayout'

describe('SettingsPage', () => {
  it('renders text-only page headers even when an icon prop is provided', () => {
    const { container } = render(
      <SettingsPage icon="dns" title="大模型" description="配置模型供应商">
        <div>content</div>
      </SettingsPage>,
    )

    expect(screen.getByRole('heading', { name: '大模型' })).toBeInTheDocument()
    expect(screen.getByText('配置模型供应商')).toBeInTheDocument()
    expect(container.querySelector('.codicon')).toBeNull()
  })
})
