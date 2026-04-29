import { create } from 'zustand'
import { agentsApi, type AgentDefinition } from '../api/agents'

export type AgentDetailReturnTab = 'agents' | 'plugins'

type AgentStore = {
  activeAgents: AgentDefinition[]
  allAgents: AgentDefinition[]
  isLoading: boolean
  error: string | null
  selectedAgent: AgentDefinition | null
  selectedAgentReturnTab: AgentDetailReturnTab

  fetchAgents: (cwd?: string) => Promise<void>
  selectAgent: (
    agent: AgentDefinition | null,
    returnTab?: AgentDetailReturnTab,
  ) => void
}

export const useAgentStore = create<AgentStore>((set) => ({
  activeAgents: [],
  allAgents: [],
  isLoading: false,
  error: null,
  selectedAgent: null,
  selectedAgentReturnTab: 'agents',

  fetchAgents: async (cwd) => {
    set({ isLoading: true, error: null })
    try {
      const { activeAgents, allAgents } = await agentsApi.list(cwd)
      set({ activeAgents, allAgents, isLoading: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load agents'
      set({ isLoading: false, error: message })
    }
  },

  selectAgent: (agent, returnTab = 'agents') =>
    set({
      selectedAgent: agent,
      selectedAgentReturnTab: agent ? returnTab : 'agents',
    }),
}))
