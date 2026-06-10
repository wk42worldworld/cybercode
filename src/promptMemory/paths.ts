import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export const SOUL_FILENAME = 'SOUL.md'
export const PROMPT_MEMORY_DIRNAME = 'prompt-memory'
export const BRIEF_FILENAME = 'BRIEF.md'
export const USER_PROMPT_MEMORY_FILENAME = 'USER.md'

export function getSoulPath(): string {
  return join(getClaudeConfigHomeDir(), SOUL_FILENAME).normalize('NFC')
}

export function getPromptMemoryDir(): string {
  return join(getClaudeConfigHomeDir(), PROMPT_MEMORY_DIRNAME).normalize('NFC')
}

export function getBriefPath(): string {
  return join(getPromptMemoryDir(), BRIEF_FILENAME).normalize('NFC')
}

export function getUserPromptMemoryPath(): string {
  return join(getPromptMemoryDir(), USER_PROMPT_MEMORY_FILENAME).normalize(
    'NFC',
  )
}
