import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('uses semantic theme tokens for primary foreground and background', () => {
    render(<Button>保存</Button>)

    const button = screen.getByRole('button', { name: '保存' })
    expect(button.className).toContain('bg-[var(--color-btn-primary-bg)]')
    expect(button.className).toContain('text-[var(--color-btn-primary-fg)]')
    expect(button.className).not.toContain('bg-[var(--gradient-btn-primary)]')
  })
})
