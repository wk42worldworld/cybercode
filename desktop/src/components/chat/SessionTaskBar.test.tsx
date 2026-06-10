import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { SessionTaskBar } from './SessionTaskBar'
import { useCLITaskStore } from '../../stores/cliTaskStore'

vi.mock('../../api/cliTasks', () => ({
  cliTasksApi: {
    getTasksForList: vi.fn(),
    resetTaskList: vi.fn(async () => ({ ok: true })),
  },
}))

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string) => {
    const translations: Record<string, string> = {
      'tasks.title': 'Tasks',
      'tasks.completed': 'Tasks completed',
      'tasks.dismissCompleted': 'Hide completed tasks',
    }

    return translations[key] ?? key
  },
}))

describe('SessionTaskBar', () => {
  beforeEach(() => {
    useCLITaskStore.setState({
      sessionId: 'session-1',
      tasks: [],
      expanded: false,
      completedAndDismissed: false,
      dismissedCompletionKey: null,
    })
  })

  afterEach(() => {
    useCLITaskStore.getState().clearTasks()
  })

  it('only shows the dismiss button once every task is completed', () => {
    act(() => {
      useCLITaskStore.getState().setTasksFromTodos([
        { content: 'first', status: 'completed' },
        { content: 'second', status: 'in_progress', activeForm: 'working' },
      ])
    })

    act(() => {
      render(<SessionTaskBar />)
    })

    expect(screen.getByText('second')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /隐藏已完成任务|Hide completed tasks/ })).toBeNull()
  })

  it('hides the bar after dismissing a completed task set', async () => {
    act(() => {
      useCLITaskStore.getState().setTasksFromTodos([
        { content: 'first', status: 'completed' },
        { content: 'second', status: 'completed' },
      ])
    })

    act(() => {
      render(<SessionTaskBar />)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /隐藏已完成任务|Hide completed tasks/ }))
      await Promise.resolve()
    })

    expect(screen.queryByText(/已完成的任务|Tasks completed/)).toBeNull()
    expect(useCLITaskStore.getState().tasks).toEqual([])
  })

  it('shows the bar again for a new task cycle after a previous completed set was dismissed', () => {
    act(() => {
      useCLITaskStore.getState().setTasksFromTodos([
        { content: 'first', status: 'completed' },
      ])
    })

    act(() => {
      render(<SessionTaskBar />)
    })

    fireEvent.click(screen.getByRole('button', { name: /隐藏已完成任务|Hide completed tasks/ }))
    expect(screen.queryByText(/已完成的任务|Tasks completed/)).toBeNull()

    act(() => {
      useCLITaskStore.getState().setTasksFromTodos([
        { content: 'next task', status: 'in_progress', activeForm: 'running next task' },
      ])
    })

    expect(screen.getByText('next task')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /隐藏已完成任务|Hide completed tasks/ })).toBeNull()

    act(() => {
      useCLITaskStore.getState().setTasksFromTodos([
        { content: 'next task', status: 'completed' },
      ])
    })

    expect(screen.getByText(/已完成的任务|Tasks completed/)).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /隐藏已完成任务|Hide completed tasks/ })).toBeInTheDocument()
  })
})
