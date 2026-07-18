import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export const KNOWLEDGE_DIRNAME = 'knowledge'
export const KNOWLEDGE_DB_FILENAME = 'knowledge.db'

export function getKnowledgeDir(): string {
  return join(getClaudeConfigHomeDir(), KNOWLEDGE_DIRNAME).normalize('NFC')
}

export function getKnowledgeDbPath(): string {
  return join(getKnowledgeDir(), KNOWLEDGE_DB_FILENAME).normalize('NFC')
}
