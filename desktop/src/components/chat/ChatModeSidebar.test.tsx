import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'

import { ChatModeSidebar } from './ChatModeSidebar'

describe('ChatModeSidebar', () => {
  it('renders the programming mode action', () => {
    render(<ChatModeSidebar label="编程模式" ariaLabel="聊天侧边栏" />)

    expect(screen.getByLabelText('聊天侧边栏')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编程模式' })).toBeInTheDocument()
  })
})
