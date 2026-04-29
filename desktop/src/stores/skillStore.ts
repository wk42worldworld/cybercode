import { create } from 'zustand'
import { skillsApi } from '../api/skills'
import type { SkillMeta, SkillDetail } from '../types/skill'

export type SkillDetailReturnTab = 'skills' | 'plugins'

type SkillStore = {
  skills: SkillMeta[]
  selectedSkill: SkillDetail | null
  selectedSkillReturnTab: SkillDetailReturnTab
  isLoading: boolean
  isDetailLoading: boolean
  error: string | null

  fetchSkills: (cwd?: string) => Promise<void>
  fetchSkillDetail: (
    source: string,
    name: string,
    cwd?: string,
    returnTab?: SkillDetailReturnTab,
  ) => Promise<void>
  clearSelection: () => void
}

export const useSkillStore = create<SkillStore>((set) => ({
  skills: [],
  selectedSkill: null,
  selectedSkillReturnTab: 'skills',
  isLoading: false,
  isDetailLoading: false,
  error: null,

  fetchSkills: async (cwd) => {
    set({ isLoading: true, error: null })
    try {
      const { skills } = await skillsApi.list(cwd)
      set({ skills, isLoading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isLoading: false,
      })
    }
  },

  fetchSkillDetail: async (source, name, cwd, returnTab = 'skills') => {
    set({ isDetailLoading: true, error: null })
    try {
      const { detail } = await skillsApi.detail(source, name, cwd)
      set({
        selectedSkill: detail,
        selectedSkillReturnTab: returnTab,
        isDetailLoading: false,
      })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isDetailLoading: false,
      })
    }
  },

  clearSelection: () => set({ selectedSkill: null, selectedSkillReturnTab: 'skills' }),
}))
