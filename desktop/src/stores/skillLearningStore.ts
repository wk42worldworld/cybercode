import { create } from 'zustand'
import { skillsApi } from '../api/skills'
import type {
  SkillLearningMode,
  SkillLearningOverview,
} from '../types/skill'

type SkillLearningStore = {
  overview: SkillLearningOverview | null
  isLoading: boolean
  pendingCandidateId: string | null
  error: string | null
  fetchOverview: (cwd?: string, quiet?: boolean) => Promise<void>
  setMode: (mode: SkillLearningMode, cwd?: string) => Promise<void>
  approveCandidate: (id: string, cwd?: string) => Promise<void>
  rejectCandidate: (id: string, cwd?: string) => Promise<void>
}

export const useSkillLearningStore = create<SkillLearningStore>((set, get) => ({
  overview: null,
  isLoading: false,
  pendingCandidateId: null,
  error: null,

  fetchOverview: async (cwd, quiet = false) => {
    if (!quiet) set({ isLoading: true, error: null })
    try {
      const { overview } = await skillsApi.learning(cwd)
      set({ overview, isLoading: false, error: null })
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  setMode: async (mode, cwd) => {
    const previous = get().overview
    if (previous) {
      set({
        overview: {
          ...previous,
          config: { ...previous.config, mode },
        },
        error: null,
      })
    }
    try {
      const { config } = await skillsApi.updateLearningConfig({ mode })
      const current = get().overview
      if (current) {
        set({ overview: { ...current, config } })
      }
      await get().fetchOverview(cwd, true)
    } catch (error) {
      set({
        overview: previous,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },

  approveCandidate: async (id, cwd) => {
    set({ pendingCandidateId: id, error: null })
    try {
      await skillsApi.approveCandidate(id)
      await get().fetchOverview(cwd, true)
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      throw error
    } finally {
      set({ pendingCandidateId: null })
    }
  },

  rejectCandidate: async (id, cwd) => {
    set({ pendingCandidateId: id, error: null })
    try {
      await skillsApi.rejectCandidate(id)
      await get().fetchOverview(cwd, true)
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      throw error
    } finally {
      set({ pendingCandidateId: null })
    }
  },
}))
