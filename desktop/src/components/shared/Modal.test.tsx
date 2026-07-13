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
    expect(dialog.parentElement?.classList.contains('z-[200]')).toBe(true)
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

  it('consumes Escape so a parent panel does not close from the same key press', () => {
    const onClose = vi.fn()
    const onWindowKeyDown = vi.fn()
    window.addEventListener('keydown', onWindowKeyDown)
    render(
      <Modal open onClose={onClose} title="Preview">
        <span>Preview content</span>
      </Modal>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onWindowKeyDown).not.toHaveBeenCalled()
    window.removeEventListener('keydown', onWindowKeyDown)
  })
})
