import { act, render } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { useTeamStore } from '../../stores/teamStore'
import { TeamStatusBar } from './TeamStatusBar'

describe('TeamStatusBar', () => {
  afterEach(() => {
    act(() => {
      useTeamStore.setState({ teams: [], activeTeam: null, memberColors: new Map(), error: null })
    })
  })

  it('matches the shared chat content column', () => {
    useTeamStore.setState({
      teams: [],
      activeTeam: {
        name: 'alignment-team',
        leadAgentId: 'lead',
        members: [
          { agentId: 'lead', role: 'Lead', status: 'running' },
          { agentId: 'worker', role: 'Worker', status: 'idle' },
        ],
      },
      memberColors: new Map(),
      error: null,
    })

    const { container } = render(<TeamStatusBar />)

    const column = container.querySelector('[data-chat-content-column]')
    expect(column).toHaveClass('w-full', 'max-w-[878px]')
    expect(column?.parentElement).toHaveClass('px-[24px]')
  })
})
