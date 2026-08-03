import { SESSION_SEARCH_CONTENT_MAX_CHARS } from './indexText.js'

export const TRANSCRIPT_WORKER_SOURCE = String.raw`
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const WORKER_RESULT_BATCH_SIZE = 32
const WORKER_RESULT_BATCH_CONTENT_CHARS = 64 * 1024
const INDEX_CONTENT_MAX_CHARS = ${SESSION_SEARCH_CONTENT_MAX_CHARS}
const INDEX_HEAD_CHARS = 10 * 1024
const INDEX_TAIL_CHARS = 10 * 1024
const TRUNCATION_MARKER = '\n...[search index truncated]...\n'
const ERROR_CLUE_RE = /(?:\berror\b|\bfatal\b|\bexception\b|\bpanic\b|\bfailed\b|\bfailure\b|\btraceback\b|\bstderr\b|\bwarning\b|\bexit(?:ed)?\s+(?:code|status)\b|错误|失败|异常|崩溃|警告)/giu
const PROJECT_MEMORY_CONTEXT_RE = /\n?\s*<cybercode_project_memory_context>[\s\S]*?<\/cybercode_project_memory_context>\s*/g
const USER_INTERRUPTION_TEXTS = new Set([
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
])

function boundedMetadata(value, maxChars) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  return text.length <= maxChars ? text : text.slice(0, maxChars)
}

function collectErrorClues(text, maxChars) {
  if (maxChars <= 0) return ''
  ERROR_CLUE_RE.lastIndex = 0
  const clues = []
  let usedChars = 0
  let previousEnd = -1
  let match
  while (clues.length < 48 && (match = ERROR_CLUE_RE.exec(text)) !== null) {
    const start = Math.max(0, match.index - 192)
    const end = Math.min(text.length, match.index + match[0].length + 512)
    if (start < previousEnd) continue
    const separatorChars = clues.length === 0 ? 0 : 1
    const remaining = maxChars - usedChars - separatorChars
    if (remaining <= 0) break
    const clue = text.slice(start, end).trim().slice(0, remaining)
    if (!clue) continue
    clues.push(clue)
    usedChars += separatorChars + clue.length
    previousEnd = end
  }
  return clues.join('\n')
}

function boundIndexText(value) {
  const text = value.trim()
  if (text.length <= INDEX_CONTENT_MAX_CHARS) return text
  const clueBudget = Math.max(
    0,
    INDEX_CONTENT_MAX_CHARS - INDEX_HEAD_CHARS - INDEX_TAIL_CHARS - TRUNCATION_MARKER.length * 2,
  )
  const clues = collectErrorClues(text, clueBudget)
  return [
    text.slice(0, INDEX_HEAD_CHARS),
    TRUNCATION_MARKER,
    clues,
    TRUNCATION_MARKER,
    text.slice(-INDEX_TAIL_CHARS),
  ].join('').slice(0, INDEX_CONTENT_MAX_CHARS)
}

function stripProjectMemoryContext(text) {
  PROJECT_MEMORY_CONTEXT_RE.lastIndex = 0
  return text.replace(PROJECT_MEMORY_CONTEXT_RE, '').trim()
}

function extractText(content) {
  if (typeof content === 'string') return stripProjectMemoryContext(content)
  if (!Array.isArray(content)) return ''
  const chunks = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (typeof block.text === 'string') {
      chunks.push(stripProjectMemoryContext(block.text))
      continue
    }
    if (block.type === 'tool_use') {
      const name = typeof block.name === 'string' ? block.name : 'tool'
      const input = block.input === undefined ? '' : JSON.stringify(block.input)
      chunks.push('tool:' + name + (input ? ' ' + input : ''))
      continue
    }
    if (block.type === 'tool_result') {
      chunks.push(extractText(block.content))
      continue
    }
    if (typeof block.content === 'string' || Array.isArray(block.content)) {
      chunks.push(extractText(block.content))
    }
  }
  return stripProjectMemoryContext(chunks.map(text => text.trim()).filter(Boolean).join('\n'))
}

function isInternalCommandBreadcrumb(content) {
  return typeof content === 'string' && (
    content.includes('<command-name>') ||
    content.includes('<command-message>') ||
    content.includes('<command-args>') ||
    content.includes('<local-command-caveat>')
  )
}

function shouldHideEntry(entry, contentText) {
  const role = entry.message?.role
  if (role === 'user' && isInternalCommandBreadcrumb(entry.message?.content)) return true
  if (contentText.length > 2048) return false
  const blocks = contentText.split('\n').map(text => text.trim()).filter(Boolean)
  if (role === 'user') {
    return blocks.length > 0 && blocks.every(text => USER_INTERRUPTION_TEXTS.has(text))
  }
  if (role === 'assistant') {
    return blocks.length > 0 && blocks.every(text => text === 'No response requested.')
  }
  return false
}

function entryType(entry) {
  const role = entry.message?.role
  const content = entry.message?.content
  if (role === 'user') {
    if (Array.isArray(content) && content.some(block => block?.type === 'tool_result')) {
      return 'tool_result'
    }
    return 'user'
  }
  if (role === 'assistant') {
    if (Array.isArray(content) && content.some(block => block?.type === 'tool_use')) {
      return 'tool_use'
    }
    return 'assistant'
  }
  return 'system'
}

function toSessionIndexDto(entry, lineNo, sessionId) {
  const role = boundedMetadata(entry.message?.role, 64)
  const extractedText = role ? extractText(entry.message?.content).trim() : ''
  const contentText = extractedText ? boundIndexText(extractedText) : ''
  const timestamp = boundedMetadata(entry.timestamp, 128)
  const isFirstUserTitle =
    entry.type === 'user' && !entry.isMeta && role === 'user' && contentText.length > 0
  const message =
    !entry.isMeta && role && contentText && !shouldHideEntry(entry, contentText)
      ? {
          messageUuid: boundedMetadata(entry.uuid, 512) ?? sessionId + ':' + lineNo,
          role,
          type: entryType(entry),
          contentText,
          timestamp,
          model: boundedMetadata(entry.message?.model, 256),
          lineNo,
          isSidechain: entry.isSidechain === true,
        }
      : null

  return {
    lineNo,
    timestamp,
    sessionMetaWorkDir:
      entry.type === 'session-meta' ? boundedMetadata(entry.workDir, 4096) : null,
    sessionMetaIsTemporary: entry.type === 'session-meta' && entry.isTemporary === true,
    cwd: boundedMetadata(entry.cwd, 4096),
    customTitle:
      entry.type === 'custom-title' ? boundedMetadata(entry.customTitle, 160) : null,
    aiTitle: entry.type === 'ai-title' ? boundedMetadata(entry.aiTitle, 160) : null,
    firstUserTitle: isFirstUserTitle
      ? contentText.length > 80 ? contentText.slice(0, 80) + '...' : contentText
      : null,
    message,
  }
}

function toHistoryIndexDto(entry) {
  return {
    display: typeof entry.display === 'string' ? boundIndexText(entry.display) : null,
    timestamp:
      typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)
        ? entry.timestamp
        : boundedMetadata(entry.timestamp, 128),
    project: boundedMetadata(entry.project, 4096),
    sessionId: boundedMetadata(entry.sessionId, 128),
  }
}

async function parseFile(id, filePath, mode, sessionId) {
  const input = createReadStream(filePath, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  const parsed = []
  let parsedContentChars = 0
  let lineNo = 0
  try {
    for await (const line of lines) {
      lineNo += 1
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const entry = JSON.parse(trimmed)
        const parsedEntry = mode === 'session-index'
          ? {
              entry: toSessionIndexDto(entry, lineNo, sessionId),
              lineNo,
            }
          : mode === 'history-index'
            ? { entry: toHistoryIndexDto(entry), lineNo }
            : { entry, lineNo }
        parsed.push(parsedEntry)
        parsedContentChars += mode === 'session-index'
          ? parsedEntry.entry.message?.contentText.length ?? 0
          : mode === 'history-index'
            ? parsedEntry.entry.display?.length ?? 0
            : 0
        if (
          parsed.length >= WORKER_RESULT_BATCH_SIZE ||
          parsedContentChars >= WORKER_RESULT_BATCH_CONTENT_CHARS
        ) {
          globalThis.postMessage({ id, type: 'batch', parsed: parsed.splice(0) })
          parsedContentChars = 0
        }
      } catch {
        // Ignore malformed JSONL lines, including an append in progress.
      }
    }
    if (parsed.length > 0) {
      globalThis.postMessage({ id, type: 'batch', parsed })
    }
    globalThis.postMessage({ id, type: 'done' })
  } finally {
    lines.close()
    input.destroy()
  }
}

globalThis.onmessage = (event) => {
  const { id, filePath, mode = 'jsonl', sessionId = '' } = event.data
  void parseFile(id, filePath, mode, sessionId).catch((error) => {
    globalThis.postMessage({
      id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
  })
}
`
