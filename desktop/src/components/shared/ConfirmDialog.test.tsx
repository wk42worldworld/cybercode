import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

const commonProps = {
  open: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  title: 'Delete item?',
  body: 'This cannot be undone.',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
}

describe('ConfirmDialog', () => {
  it('uses the regular width by default', () => {
    render(<ConfirmDialog {...commonProps} />)

    expect(screen.getByRole('dialog', { name: 'Delete item?' })).toHaveStyle({ width: '360px' })
  })

  it('uses a compact width for short destructive confirmations', () => {
    render(<ConfirmDialog {...commonProps} size="compact" />)

    expect(screen.getByRole('dialog', { name: 'Delete item?' })).toHaveStyle({ width: '300px' })
  })
})
