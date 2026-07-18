import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemorySettings } from '../pages/Settings'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'

const userEntry = '用户给 CyberCode/AI 取名为「零」。'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function memoryFile(target: 'soul' | 'brief' | 'user', content = '') {
  return {
    target,
    filename: `${target.toUpperCase()}.md`,
    path: `/tmp/${target.toUpperCase()}.md`,
    exists: Boolean(content),
    content,
    entries: content ? [content] : [],
    format: content ? 'plain' : 'empty',
    charCount: content.length,
    limit: 3000,
    overLimit: false,
  }
}

describe('MemorySettings evolution profile', () => {
  let removed: boolean
  let injectionEnabled: boolean
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    removed = false
    injectionEnabled = true
    useSettingsStore.setState({ locale: 'en' })
    useUIStore.setState({ toasts: [] })
    fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      const url = new URL(input)
      if (url.pathname === '/api/prompt-memory/insights') {
        return Promise.resolve(jsonResponse({
          insights: removed ? [] : [
            {
              id: 'identity-1',
              target: 'user',
              category: 'identity',
              content: userEntry,
              raw: userEntry,
              source: 'manual',
            },
          ],
          stats: {
            total: removed ? 0 : 1,
            user: removed ? 0 : 1,
            methods: 0,
            dimensions: removed ? 0 : 1,
            automaticUpdates: 0,
          },
        }))
      }
      if (url.pathname === '/api/prompt-memory/logs') {
        return Promise.resolve(jsonResponse([]))
      }
      if (
        url.pathname === '/api/prompt-memory/user/entries' &&
        init?.method === 'POST'
      ) {
        removed = true
        return Promise.resolve(jsonResponse({ changed: true }))
      }
      if (
        url.pathname === '/api/prompt-memory/config' &&
        init?.method === 'PATCH'
      ) {
        injectionEnabled = JSON.parse(String(init.body)).injectEvolutionMemory
        return Promise.resolve(jsonResponse({
          version: 1,
          injectEvolutionMemory: injectionEnabled,
        }))
      }
      if (url.pathname === '/api/prompt-memory') {
        return Promise.resolve(jsonResponse({
          config: {
            version: 1,
            injectEvolutionMemory: injectionEnabled,
          },
          files: {
            soul: memoryFile('soul', 'You are CyberCode.'),
            brief: memoryFile('brief'),
            user: memoryFile('user', removed ? '' : userEntry),
          },
        }))
      }
      return Promise.reject(new Error(`Unexpected request: ${input}`))
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('locates a visible profile insight in the USER editor', async () => {
    render(<MemorySettings />)
    await screen.findByText(userEntry)

    fireEvent.click(screen.getByRole('button', { name: 'Correct in editor' }))

    expect(screen.getByRole('textbox', { name: 'Prompt memory editor' })).toHaveValue(
      userEntry,
    )
  })

  it('requires confirmation before removing a learned user memory', async () => {
    render(<MemorySettings />)
    await screen.findByText(userEntry)

    fireEvent.click(screen.getByRole('button', { name: 'Remove memory' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove this memory?' })
    expect(dialog).toHaveTextContent(userEntry)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:3456/api/prompt-memory/user/entries',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'remove', oldText: userEntry }),
        }),
      )
    })
    await waitFor(() => {
      expect(screen.queryByText(userEntry)).not.toBeInTheDocument()
    })
  })

  it('can pause self-evolution memory injection without removing the profile', async () => {
    render(<MemorySettings />)
    await screen.findByText(userEntry)

    const toggle = screen.getByRole('switch', {
      name: 'Use self-evolution memory in new conversations',
    })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:3456/api/prompt-memory/config',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ injectEvolutionMemory: false }),
        }),
      )
    })
    await waitFor(() => expect(toggle).not.toBeChecked())
    expect(screen.getByText(userEntry)).toBeInTheDocument()
  })
})
