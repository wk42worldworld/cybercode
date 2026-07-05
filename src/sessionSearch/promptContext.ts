import { type Database } from 'bun:sqlite'
import {
  browseSessionSearch,
  discoverSessionSearch,
  readSessionSearch,
  type SessionSearchHit,
  type SessionSearchMessage,
} from './search.js'

const MAX_CONTEXT_CHARS = 3200
const PRIOR_CONTEXT_RE =
  /(之前|以前|过去|上次|刚才|历史|记得|创建过|命名|项目|叫什么|名字|叫做|称呼|project|previous|earlier|before|remember|name|created|named)/i
function fallbackRecallQueries(query: string): string[] {
  if (/(项目|project)/i.test(query)) {
    return ['项目', '创建', '命名', 'project', 'created', 'named', '叫做']
  }
  if (/(叫什么|名字|叫做|name|named)/i.test(query)) {
    return ['叫做', '名字', 'named', '命名', '创建', '项目', 'project']
  }
  return ['创建', '项目', '命名', '叫做', 'created', 'project', 'named']
}

function sanitizeContextText(value: string): string {
  return value
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, ' ')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted-key]')
    .replace(/\bghp_[A-Za-z0-9_]{12,}\b/g, '[redacted-token]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{12,}\b/g, '[redacted-token]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '$1[redacted]')
    .replace(
      /\b(api[_-]?key|auth[_-]?token|password|passwd|token|secret|密码)\b\s*[:：=]\s*["']?[^"'\s,;，。；]+/gi,
      '$1=[redacted]',
    )
}

function truncate(value: string, max: number): string {
  const normalized = sanitizeContextText(value).replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized
}

function formatMessage(message: SessionSearchMessage): string {
  return `- ${message.role}: ${truncate(message.content, 260)}`
}

function formatHit(hit: SessionSearchHit): string {
  const messages = hit.messages.length > 0
    ? hit.messages.slice(0, 6)
    : [...(hit.bookendStart ?? []), ...(hit.bookendEnd ?? [])].slice(0, 6)

  return [
    `Session: ${hit.title}`,
    `Project: ${hit.workDir ?? hit.projectPath}`,
    hit.snippet ? `Matched snippet: ${truncate(hit.snippet, 280)}` : '',
    messages.length > 0 ? 'Nearby messages:' : '',
    ...messages.map(formatMessage),
  ].filter(Boolean).join('\n')
}

export async function buildPastSessionPromptContext(params: {
  db: Database
  query: string
  currentSessionId?: string
  limit?: number
}): Promise<string | null> {
  const query = params.query.trim()
  if (!query) return null

  const chunks: string[] = [
    'Relevant snippets from previous CyberCode conversations follow. Use them only as recalled local history; if they conflict with the current request or files, prefer the current request and current files.',
  ]
  const seen = new Set<string>()

  const appendHit = (hit: SessionSearchHit) => {
    const key = `${hit.projectPath}:${hit.sessionId}`
    if (seen.has(key)) return true
    const formatted = formatHit(hit)
    const next = [...chunks, formatted].join('\n\n')
    if (next.length > MAX_CONTEXT_CHARS) return false
    seen.add(key)
    chunks.push(formatted)
    return true
  }

  const discovered = await discoverSessionSearch({
    db: params.db,
    query,
    currentSessionId: params.currentSessionId,
    limit: params.limit ?? 3,
  })

  for (const hit of discovered.results) {
    if (!appendHit(hit)) break
  }

  if (chunks.length === 1 && PRIOR_CONTEXT_RE.test(query)) {
    for (const fallbackQuery of fallbackRecallQueries(query)) {
      const fallback = await discoverSessionSearch({
        db: params.db,
        query: fallbackQuery,
        currentSessionId: params.currentSessionId,
        limit: params.limit ?? 3,
      })
      for (const hit of fallback.results) {
        if (!appendHit(hit)) break
      }
      if (chunks.length > 1) break
    }
  }

  if (chunks.length === 1 && PRIOR_CONTEXT_RE.test(query)) {
    const browsed = await browseSessionSearch({
      db: params.db,
      currentSessionId: params.currentSessionId,
      limit: params.limit ?? 3,
    })
    for (const hit of browsed.results) {
      const read = await readSessionSearch({
        db: params.db,
        sessionId: hit.sessionId,
        projectPath: hit.projectPath,
        head: 4,
        tail: 2,
      })
      if (!read || (read.mode !== 'read' && read.mode !== 'scroll')) continue
      const nextHit: SessionSearchHit = {
        ...hit,
        messages: read.messages,
        matchCount: 0,
        matches: [],
      }
      if (!appendHit(nextHit)) break
    }
  }

  return chunks.length > 1 ? chunks.join('\n\n') : null
}
