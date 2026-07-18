import { api } from './client'
import type {
  SkillMeta,
  SkillDetail,
  SkillLearningConfig,
  SkillLearningMode,
  SkillLearningOverview,
  SkillCandidate,
} from '../types/skill'

export type SkillsConfig = {
  userSkillsDir: string
  displayPath: string
}

export const skillsApi = {
  config: () => api.get<{ config: SkillsConfig }>('/api/skills/config'),

  openConfig: () => api.get<{ ok: true }>('/api/skills/open-config'),

  setEnabled: (source: string, name: string, enabled: boolean) =>
    api.patch<{ ok: true; disabledSkills: string[] }>('/api/skills/enabled', {
      source,
      name,
      enabled,
    }),

  list: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<{ skills: SkillMeta[] }>(`/api/skills${query}`, { timeout: 120_000 })
  },

  detail: (source: string, name: string, cwd?: string) => {
    const query = new URLSearchParams({
      source,
      name,
    })
    if (cwd) query.set('cwd', cwd)

    return api.get<{ detail: SkillDetail }>(
      `/api/skills/detail?${query.toString()}`,
      { timeout: 120_000 },
    )
  },

  learning: async (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    const { overview } = await api.get<{
      overview: Omit<SkillLearningOverview, 'recentCandidates'> & {
        recentCandidates?: SkillCandidate[]
      }
    }>(
      `/api/skills/learning${query}`,
      { timeout: 120_000 },
    )
    return {
      overview: {
        ...overview,
        recentCandidates: Array.isArray(overview.recentCandidates)
          ? overview.recentCandidates
          : [],
      },
    }
  },

  updateLearningConfig: (update: {
    mode?: SkillLearningMode
    minToolUses?: number
    minConfidence?: number
    autoApproveConfidence?: number
  }) =>
    api.patch<{ ok: true; config: SkillLearningConfig }>(
      '/api/skills/learning',
      update,
    ),

  approveCandidate: (id: string) =>
    api.post<{ ok: true; candidate: SkillCandidate }>(
      `/api/skills/learning/${encodeURIComponent(id)}/approve`,
      {},
    ),

  rejectCandidate: (id: string) =>
    api.post<{ ok: true; candidate: SkillCandidate }>(
      `/api/skills/learning/${encodeURIComponent(id)}/reject`,
      {},
    ),
}
