import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const { getRecentProjectsMock } = vi.hoisted(() => ({
  getRecentProjectsMock: vi.fn(),
}))

vi.mock('../../api/sessions', async () => {
  const actual = await vi.importActual<typeof import('../../api/sessions')>('../../api/sessions')
  return {
    ...actual,
    sessionsApi: {
      ...actual.sessionsApi,
      getRecentProjects: getRecentProjectsMock,
    },
  }
})

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string) => {
    const translations: Record<string, string> = {
      'sidebar.allProjects': 'All projects',
      'sidebar.temporarySessions': 'Temporary sessions',
      'sidebar.other': 'Other',
      'sidebar.noSessions': 'No sessions',
      'common.loading': 'Loading',
    }

    return translations[key] ?? key
  },
}))

import { useSessionStore } from '../../stores/sessionStore'
import { ProjectFilter } from './ProjectFilter'

describe('ProjectFilter', () => {
  beforeEach(() => {
    getRecentProjectsMock.mockReset()
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      error: null,
      selectedProjects: [],
      selectedSessionScope: 'all',
      availableProjects: [
        'Users-dev-workspace-myself_code-OpenCutSkill',
        'Users-dev-workspace-myself_code-cybercode',
      ],
    })
  })

  it('renders recent project metadata instead of bare fallback folder names', async () => {
    getRecentProjectsMock.mockResolvedValue({
      projects: [
        {
          projectPath: 'Users-dev-workspace-myself_code-cybercode',
          realPath: '/path/to/cybercode',
          projectName: 'cybercode',
          isGit: true,
          repoName: 'wk42worldworld/cybercode',
          branch: 'main',
          modifiedAt: '2026-04-20T10:00:00.000Z',
          sessionCount: 4,
        },
        {
          projectPath: 'Users-dev-workspace-myself_code-OpenCutSkill',
          realPath: '/Users/dev/workspace/myself_code/OpenCutSkill',
          projectName: 'OpenCutSkill',
          isGit: true,
          repoName: 'wk42worldworld/OpenCutSkill',
          branch: 'main',
          modifiedAt: '2026-04-20T09:00:00.000Z',
          sessionCount: 2,
        },
      ],
    })

    render(<ProjectFilter />)

    fireEvent.click(screen.getByRole('button', { name: /All projects/i }))

    await waitFor(() => {
      expect(screen.getByText('wk42worldworld/cybercode')).toBeInTheDocument()
      expect(screen.getByText('/path/to/cybercode')).toBeInTheDocument()
      expect(screen.getByText('wk42worldworld/OpenCutSkill')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /wk42worldworld\/cybercode/i }))

    await waitFor(() => {
      expect(useSessionStore.getState().selectedProjects).toEqual(['Users-dev-workspace-myself_code-cybercode'])
      expect(useSessionStore.getState().selectedSessionScope).toBe('project')
    })

    expect(screen.getByRole('button', { name: /wk42worldworld\/cybercode/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /wk42worldworld\/cybercode/i }))
    fireEvent.click(screen.getByRole('button', { name: /wk42worldworld\/OpenCutSkill/i }))

    await waitFor(() => {
      expect(useSessionStore.getState().selectedProjects).toEqual(['Users-dev-workspace-myself_code-OpenCutSkill'])
      expect(useSessionStore.getState().selectedSessionScope).toBe('project')
    })

    fireEvent.click(screen.getByRole('button', { name: /wk42worldworld\/OpenCutSkill/i }))
    fireEvent.click(screen.getByRole('button', { name: /Temporary sessions/i }))

    await waitFor(() => {
      expect(useSessionStore.getState().selectedProjects).toEqual([])
      expect(useSessionStore.getState().selectedSessionScope).toBe('temporary')
    })

    fireEvent.click(screen.getByRole('button', { name: /Temporary sessions/i }))
    fireEvent.click(screen.getByRole('button', { name: /All projects/i }))

    await waitFor(() => {
      expect(useSessionStore.getState().selectedProjects).toEqual([])
      expect(useSessionStore.getState().selectedSessionScope).toBe('all')
    })
  })
})
