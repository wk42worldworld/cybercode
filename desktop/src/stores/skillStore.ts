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
  setSkillEnabled: (
    source: string,
    name: string,
    enabled: boolean,
    cwd?: string,
  ) => Promise<void>
  clearSelection: () => void
}

function normalizeSkill(skill: SkillMeta): SkillMeta {
  return {
    ...skill,
    enabled: skill.enabled !== false,
  }
}

export const useSkillStore = create<SkillStore>((set, get) => ({
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
      set({ skills: skills.map(normalizeSkill), isLoading: false })
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

  setSkillEnabled: async (source, name, enabled, _cwd) => {
    const previousSkills = get().skills
    const previousSelectedSkill = get().selectedSkill
    const updateMeta = (skill: SkillMeta): SkillMeta =>
      skill.source === source && skill.name === name
        ? { ...skill, enabled }
        : skill

    set({
      skills: previousSkills.map(updateMeta),
      selectedSkill:
        previousSelectedSkill?.meta.source === source &&
        previousSelectedSkill.meta.name === name
          ? {
              ...previousSelectedSkill,
              meta: updateMeta(previousSelectedSkill.meta),
            }
          : previousSelectedSkill,
      error: null,
    })

    try {
      await skillsApi.setEnabled(source, name, enabled)
    } catch (err) {
      set({
        skills: previousSkills,
        selectedSkill: previousSelectedSkill,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  },

  clearSelection: () => set({ selectedSkill: null, selectedSkillReturnTab: 'skills' }),
}))
