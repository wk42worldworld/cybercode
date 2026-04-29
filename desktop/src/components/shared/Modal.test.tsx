import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

describe('Modal', () => {
  it('portals the dialog to body so the scrim covers the full app shell', () => {
    const onClose = vi.fn()
    const { container } = render(
      <div data-testid="stacking-parent" className="relative z-10">
        <Modal open onClose={onClose} title="Provider">
          <span>Provider form</span>
        </Modal>
      </div>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Provider' })

    expect(container.contains(dialog)).toBe(false)
    expect(document.body.contains(dialog)).toBe(true)
  })

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose}>
        <span>Provider form</span>
      </Modal>,
    )

    const backdrop = screen.getByRole('dialog').previousElementSibling
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop!)

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
