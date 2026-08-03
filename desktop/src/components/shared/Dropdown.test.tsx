import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dropdown } from './Dropdown'

const originalInnerWidth = window.innerWidth
const originalInnerHeight = window.innerHeight

describe('Dropdown viewport positioning', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 })
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
  })

  it('portals and clamps a menu that opens near the bottom-right corner', () => {
    const onChange = vi.fn()
    const { container } = render(
      <Dropdown
        items={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
          { value: 'c', label: 'Gamma' },
        ]}
        value="a"
        onChange={onChange}
        trigger={<button type="button">Choose format</button>}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Choose format' })
    const root = trigger.parentElement?.parentElement
    expect(root).not.toBeNull()
    vi.spyOn(root!, 'getBoundingClientRect').mockReturnValue({
      x: 300,
      y: 180,
      top: 180,
      right: 340,
      bottom: 220,
      left: 300,
      width: 40,
      height: 40,
      toJSON: () => ({}),
    })

    fireEvent.click(trigger)

    const menu = screen.getByRole('listbox')
    expect(container.contains(menu)).toBe(false)
    expect(document.body.contains(menu)).toBe(true)
    expect(menu).toHaveClass('z-[10050]')
    expect(menu).toHaveStyle({
      left: '28px',
      width: '320px',
      maxHeight: '162px',
      bottom: '66px',
    })

    fireEvent.click(screen.getByRole('option', { name: 'Beta' }))
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('supports arrow, Home, End, and Escape keyboard navigation', async () => {
    const parentEscapeHandler = vi.fn()
    const handleParentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') parentEscapeHandler()
    }
    document.addEventListener('keydown', handleParentKeyDown)
    render(
      <Dropdown
        items={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
          { value: 'c', label: 'Gamma' },
        ]}
        value="b"
        onChange={vi.fn()}
        trigger={({ open, menuId }) => (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
          >
            Choose model
          </button>
        )}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Choose model' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    const beta = await screen.findByRole('option', { name: 'Beta' })
    await waitFor(() => expect(beta).toHaveFocus())

    fireEvent.keyDown(beta, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Gamma' })).toHaveFocus()

    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveFocus()

    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    const gamma = screen.getByRole('option', { name: 'Gamma' })
    expect(gamma).toHaveFocus()

    fireEvent.keyDown(gamma, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(parentEscapeHandler).not.toHaveBeenCalled()
    document.removeEventListener('keydown', handleParentKeyDown)
  })

  it('closes on outside mousedown even when propagation is stopped (e.g. React Flow pane)', () => {
    render(
      <Dropdown
        items={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
        value="a"
        onChange={vi.fn()}
        trigger={<button type="button">Choose format</button>}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose format' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    // Simulate React Flow's pane: d3-zoom calls stopImmediatePropagation on
    // bubbled mousedown, so document-level bubble listeners never fire.
    const pane = document.createElement('div')
    pane.addEventListener('mousedown', (event) => event.stopImmediatePropagation())
    document.body.appendChild(pane)
    try {
      fireEvent.mouseDown(pane)
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    } finally {
      pane.remove()
    }
  })

  it('renders an explicit option badge without changing selection behavior', () => {    const onChange = vi.fn()
    render(
      <Dropdown
        items={[
          { value: 'deepseek', label: 'DeepSeek', badge: 'Official API' },
          { value: 'openrouter', label: 'OpenRouter', badge: 'Aggregator' },
        ]}
        value="deepseek"
        onChange={onChange}
        trigger={<button type="button">Choose provider</button>}
        density="compact"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose provider' }))
    const option = screen.getByRole('option', { name: 'OpenRouter Aggregator' })
    expect(option.querySelector('.settings-dropdown-item-badge')).toHaveTextContent('Aggregator')

    fireEvent.click(option)
    expect(onChange).toHaveBeenCalledWith('openrouter')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
