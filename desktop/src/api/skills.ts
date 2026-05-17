import { api } from './client'
import type { SkillMeta, SkillDetail } from '../types/skill'

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
}
