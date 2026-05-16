import type { CommandBase } from '../types/command.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import type { SettingsJson } from '../utils/settings/types.js'

export type ToggleableSkillSource =
  | 'user'
  | 'project'
  | 'plugin'
  | 'mcp'
  | 'bundled'

type SkillLike = Pick<CommandBase, 'name' | 'loadedFrom'> & {
  source?: string
}

const VALID_TOGGLEABLE_SKILL_SOURCES = new Set<ToggleableSkillSource>([
  'user',
  'project',
  'plugin',
  'mcp',
  'bundled',
])

export function isToggleableSkillSource(
  value: string,
): value is ToggleableSkillSource {
  return VALID_TOGGLEABLE_SKILL_SOURCES.has(value as ToggleableSkillSource)
}

export function getSkillEnablementKey(
  source: ToggleableSkillSource,
  name: string,
): string {
  return `${source}:${name}`
}

export function normalizeSkillEnablementSource(
  source?: string,
  loadedFrom?: string,
): ToggleableSkillSource | null {
  if (source === 'userSettings') return 'user'
  if (source === 'projectSettings' || source === 'localSettings') return 'project'
  if (loadedFrom === 'plugin') return 'plugin'
  if (loadedFrom === 'mcp') return 'mcp'
  if (loadedFrom === 'bundled') return 'bundled'
  if (source === 'user' || source === 'project') return source
  return null
}

export function getDisabledSkillKeys(): Set<string> {
  const disabledSkills = getSettingsForSource('userSettings')?.disabledSkills
  return new Set(
    Array.isArray(disabledSkills)
      ? disabledSkills.filter((key): key is string => typeof key === 'string')
      : [],
  )
}

export function isSkillEnabled(
  source: ToggleableSkillSource,
  name: string,
  disabledSkillKeys = getDisabledSkillKeys(),
): boolean {
  return !disabledSkillKeys.has(getSkillEnablementKey(source, name))
}

export function isSkillCommandEnabled(
  skill: SkillLike,
  disabledSkillKeys = getDisabledSkillKeys(),
): boolean {
  const source = normalizeSkillEnablementSource(skill.source, skill.loadedFrom)
  if (!source) return true
  return isSkillEnabled(source, skill.name, disabledSkillKeys)
}

export function filterEnabledSkillCommands<T extends SkillLike>(
  skills: T[],
  disabledSkillKeys = getDisabledSkillKeys(),
): T[] {
  return skills.filter(skill => isSkillCommandEnabled(skill, disabledSkillKeys))
}

export function updateSkillEnablement(
  source: ToggleableSkillSource,
  name: string,
  enabled: boolean,
): { disabledSkills: string[]; error: Error | null } {
  const disabledSkills = getDisabledSkillKeys()
  const key = getSkillEnablementKey(source, name)

  if (enabled) {
    disabledSkills.delete(key)
  } else {
    disabledSkills.add(key)
  }

  const nextDisabledSkills = [...disabledSkills].sort()
  const { error } = updateSettingsForSource('userSettings', {
    disabledSkills: nextDisabledSkills,
  } as SettingsJson)

  return { disabledSkills: nextDisabledSkills, error }
}
