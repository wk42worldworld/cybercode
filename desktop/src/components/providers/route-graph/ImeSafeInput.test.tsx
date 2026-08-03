import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'

import { ImeSafeInput, ImeSafeTextarea } from './ImeSafeInput'

describe('ImeSafeInput', () => {
  it('echoes edits locally and forwards them', () => {
    const onChange = vi.fn()
    render(<ImeSafeInput aria-label="rule" value="" onChange={onChange} />)
    const input = screen.getByLabelText('rule')

    fireEvent.change(input, { target: { value: 'abc' } })
    expect(input).toHaveValue('abc')
    expect(onChange).toHaveBeenCalledWith('abc')
  })

  it('does not adopt a stale prop repaint during IME composition', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ImeSafeInput aria-label="rule" value="" onChange={onChange} />)
    const input = screen.getByLabelText('rule')

    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'zhong' } })
    // The graph pipeline repaints once with the pre-edit value before the new
    // value arrives; the field must keep the composing text.
    rerender(<ImeSafeInput aria-label="rule" value="" onChange={onChange} />)
    expect(input).toHaveValue('zhong')

    fireEvent.compositionEnd(input, { target: { value: '中' } })
    expect(onChange).toHaveBeenLastCalledWith('中')
    rerender(<ImeSafeInput aria-label="rule" value="中" onChange={onChange} />)
    expect(input).toHaveValue('中')
  })

  it('ignores unchanged-value repaints outside composition but adopts real external updates', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ImeSafeInput aria-label="rule" value="" onChange={onChange} />)
    const input = screen.getByLabelText('rule')

    fireEvent.change(input, { target: { value: 'typed' } })
    // Same stale value repainted — not a real external change.
    rerender(<ImeSafeInput aria-label="rule" value="" onChange={onChange} />)
    expect(input).toHaveValue('typed')

    // Parent caught up with the edit.
    rerender(<ImeSafeInput aria-label="rule" value="typed" onChange={onChange} />)
    expect(input).toHaveValue('typed')

    // A genuine external change (e.g. undo) is adopted.
    rerender(<ImeSafeInput aria-label="rule" value="external" onChange={onChange} />)
    expect(input).toHaveValue('external')
  })

  it('provides the same composition protection to textareas', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ImeSafeTextarea aria-label="rules" value="" onChange={onChange} />,
    )
    const textarea = screen.getByLabelText('rules')

    fireEvent.compositionStart(textarea)
    fireEvent.change(textarea, { target: { value: 'ni hao' } })
    rerender(<ImeSafeTextarea aria-label="rules" value="" onChange={onChange} />)
    expect(textarea).toHaveValue('ni hao')
    fireEvent.compositionEnd(textarea, { target: { value: '你好' } })
    expect(onChange).toHaveBeenLastCalledWith('你好')
  })
})
