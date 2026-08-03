import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  diffViewer: vi.fn((_props: {
    compareMethod: string
    renderContent?: unknown
    oldValue: string
    newValue: string
  }) => null),
  highlight: vi.fn(() => null),
}))

vi.mock('react-diff-viewer-continued', () => ({
  default: mocks.diffViewer,
  DiffMethod: { WORDS: 'WORDS', LINES: 'LINES' },
}))

vi.mock('prism-react-renderer', () => ({
  Highlight: mocks.highlight,
}))

vi.mock('../shared/CopyButton', () => ({
  CopyButton: () => null,
}))

import { DiffViewer } from './DiffViewer'

describe('DiffViewer performance mode', () => {
  beforeEach(() => {
    mocks.diffViewer.mockClear()
    mocks.highlight.mockClear()
  })

  it('keeps word diff and syntax rendering for small changes', () => {
    render(<DiffViewer filePath="src/a.ts" oldString="const a = 1" newString="const a = 2" />)

    const props = mocks.diffViewer.mock.calls.at(-1)![0]
    expect(props.compareMethod).toBe('WORDS')
    expect(props.renderContent).toEqual(expect.any(Function))
  })

  it('uses bounded line diff without syntax rendering for large changes', async () => {
    const oldString = Array.from({ length: 2100 }, (_, index) => `old ${index}`).join('\n')
    const newString = Array.from({ length: 2100 }, (_, index) => `new ${index}`).join('\n')
    const { container } = render(
      <DiffViewer filePath="src/a.ts" oldString={oldString} newString={newString} />,
    )

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    await waitFor(() => expect(mocks.diffViewer).toHaveBeenCalled())
    const props = mocks.diffViewer.mock.calls.at(-1)![0]
    expect(props.compareMethod).toBe('LINES')
    expect(props.renderContent).toBeUndefined()
    expect(props.oldValue.split('\n').length).toBeLessThanOrEqual(601)
    expect(props.newValue.split('\n').length).toBeLessThanOrEqual(601)
    expect(mocks.highlight).not.toHaveBeenCalled()
    expect(container.textContent).toContain('[...] [-] 600/2100 [+] 600/2100')
  })
})
