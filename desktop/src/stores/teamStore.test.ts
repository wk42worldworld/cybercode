import { describe, expect, it, beforeEach } from 'vitest'
import { useTeamStore } from './teamStore'

describe('teamStore collaboration updates', () => {
  beforeEach(() => {
    useTeamStore.setState({
      teams: [],
      activeTeam: null,
      memberColors: new Map(),
      error: null,
    })
  })

  it('removes members that disappear from a full team update', () => {
    useTeamStore.setState({
      teams: [{ name: 'test-team', memberCount: 2 }],
      activeTeam: {
        name: 'test-team',
        leadAgentId: 'lead@test-team',
        members: [
          { agentId: 'lead@test-team', role: 'lead', status: 'running' },
          { agentId: 'worker@test-team', role: 'worker', status: 'running' },
        ],
      },
    })

    useTeamStore.getState().handleTeamUpdate('test-team', [
      { agentId: 'lead@test-team', role: 'lead', status: 'running' },
    ])

    expect(useTeamStore.getState().activeTeam?.members.map((member) => member.agentId))
      .toEqual(['lead@test-team'])
    expect(useTeamStore.getState().teams).toEqual([{ name: 'test-team', memberCount: 1 }])
  })

  it('clears the visible team when the last member leaves', () => {
    useTeamStore.setState({
      activeTeam: {
        name: 'test-team',
        leadAgentId: 'lead@test-team',
        members: [
          { agentId: 'lead@test-team', role: 'lead', status: 'idle' },
        ],
      },
    })

    useTeamStore.getState().handleTeamUpdate('test-team', [])

    expect(useTeamStore.getState().activeTeam?.members).toEqual([])
  })
})
