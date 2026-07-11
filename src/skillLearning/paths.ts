import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export const SKILL_LEARNING_DIRNAME = 'skill-learning'
export const SKILL_LEARNING_STATE_FILENAME = 'state.json'
export const SKILL_LEARNING_CONFIG_FILENAME = 'config.json'

export function getSkillLearningRoot(): string {
  return join(getClaudeConfigHomeDir(), SKILL_LEARNING_DIRNAME).normalize('NFC')
}

export function getSkillLearningStatePath(): string {
  return join(getSkillLearningRoot(), SKILL_LEARNING_STATE_FILENAME)
}

export function getSkillLearningConfigPath(): string {
  return join(getSkillLearningRoot(), SKILL_LEARNING_CONFIG_FILENAME)
}

export function getSkillLearningBackupsRoot(): string {
  return join(getSkillLearningRoot(), 'backups')
}
