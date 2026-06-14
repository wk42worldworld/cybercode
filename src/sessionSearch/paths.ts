import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export const SESSION_SEARCH_INDEX_DIRNAME = 'indexes'
export const SESSION_SEARCH_DB_FILENAME = 'session-search.db'

export function getSessionSearchIndexDir(): string {
  return join(getClaudeConfigHomeDir(), SESSION_SEARCH_INDEX_DIRNAME).normalize(
    'NFC',
  )
}

export function getSessionSearchDbPath(): string {
  return join(getSessionSearchIndexDir(), SESSION_SEARCH_DB_FILENAME).normalize(
    'NFC',
  )
}
