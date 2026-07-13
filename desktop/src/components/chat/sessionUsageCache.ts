import type { SessionUsageResponse } from '../../api/sessions'

const MAX_CACHED_SESSIONS = 100
export type CachedSessionUsage = {
  response: SessionUsageResponse
  revision: number
}

const usageCache = new Map<string, CachedSessionUsage>()

function cacheKey(sessionId: string, projectPath?: string) {
  return `${sessionId}:${projectPath ?? ''}`
}

export function readCachedSessionUsage(sessionId: string, projectPath?: string) {
  return readCachedSessionUsageEntry(sessionId, projectPath)?.response ?? null
}

export function readCachedSessionUsageEntry(sessionId: string, projectPath?: string) {
  return usageCache.get(cacheKey(sessionId, projectPath)) ?? null
}

export function writeCachedSessionUsage(
  sessionId: string,
  projectPath: string | undefined,
  response: SessionUsageResponse,
  revision = -1,
) {
  const key = cacheKey(sessionId, projectPath)
  usageCache.delete(key)
  usageCache.set(key, { response, revision })
  if (usageCache.size > MAX_CACHED_SESSIONS) {
    const oldestKey = usageCache.keys().next().value
    if (oldestKey) usageCache.delete(oldestKey)
  }
}

export function clearSessionUsageCache() {
  usageCache.clear()
}
