import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'

import { UserMessage } from './UserMessage'

describe('UserMessage', () => {
  it('uses the theme-safe semantic bubble colors', () => {
    render(<UserMessage content="Readable in every theme" />)

    const bubble = screen.getByText('Readable in every theme').parentElement
    expect(bubble).toHaveClass('user-message-bubble')
    expect(bubble?.className).not.toContain('text-[var(--color-message-user-fg)]')
  })
})
