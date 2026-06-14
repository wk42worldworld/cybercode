import { readFile, stat } from 'fs/promises'
import { basename } from 'path'

export type TranscriptSearchMessage = {
  messageUuid: string
  role: string
  type: string
  contentText: string
  timestamp: string | null
  model: string | null
  lineNo: number
  isSidechain: boolean
}

export type ParsedSessionTranscript = {
  sessionId: string
  projectPath: string
  filePath: string
  workDir: string | null
  title: string
  createdAt: string
  modifiedAt: string
  fileMtimeMs: number
  fileSize: number
  messages: TranscriptSearchMessage[]
}

type RawEntry = {
  type?: string
  uuid?: string
  isMeta?: boolean
  isSidechain?: boolean
  cwd?: string
  timestamp?: string
  customTitle?: string
  aiTitle?: string
  message?: {
    role?: string
    content?: unknown
    model?: string
  }
}

const USER_INTERRUPTION_TEXTS = new Set([
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
])

const NO_RESPONSE_REQUESTED_TEXT = 'No response requested.'

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .flatMap(block => {
        if (!block || typeof block !== 'object') return []
        const record = block as Record<string, unknown>
        if (typeof record.text === 'string') return [record.text]
        if (record.type === 'tool_use') {
          const name = typeof record.name === 'string' ? record.name : 'tool'
          const input =
            record.input === undefined ? '' : JSON.stringify(record.input)
          return [`tool:${name}${input ? ` ${input}` : ''}`]
        }
        if (record.type === 'tool_result') {
          return [extractText(record.content)]
        }
        if (typeof record.content === 'string' || Array.isArray(record.content)) {
          return [extractText(record.content)]
        }
        return []
      })
      .map(text => text.trim())
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function extractTextBlocks(content: unknown): string[] {
  return extractText(content)
    .split('\n')
    .map(text => text.trim())
    .filter(Boolean)
}

function isInternalCommandBreadcrumb(content: unknown): boolean {
  if (typeof content !== 'string') return false
  return (
    content.includes('<command-name>') ||
    content.includes('<command-message>') ||
    content.includes('<command-args>') ||
    content.includes('<local-command-caveat>')
  )
}

function shouldHideEntry(entry: RawEntry): boolean {
  const role = entry.message?.role
  const content = entry.message?.content
  if (role === 'user') {
    const textBlocks = extractTextBlocks(content)
    return (
      isInternalCommandBreadcrumb(content) ||
      (textBlocks.length > 0 &&
        textBlocks.every(text => USER_INTERRUPTION_TEXTS.has(text)))
    )
  }
  if (role === 'assistant') {
    const textBlocks = extractTextBlocks(content)
    return (
      textBlocks.length > 0 &&
      textBlocks.every(text => text === NO_RESPONSE_REQUESTED_TEXT)
    )
  }
  return false
}

function entryType(entry: RawEntry): string {
  const role = entry.message?.role
  const content = entry.message?.content
  if (role === 'user') {
    if (
      Array.isArray(content) &&
      content.some(
        block =>
          typeof block === 'object' &&
          block !== null &&
          (block as { type?: unknown }).type === 'tool_result',
      )
    ) {
      return 'tool_result'
    }
    return 'user'
  }
  if (role === 'assistant') {
    if (
      Array.isArray(content) &&
      content.some(
        block =>
          typeof block === 'object' &&
          block !== null &&
          (block as { type?: unknown }).type === 'tool_use',
      )
    ) {
      return 'tool_use'
    }
    return 'assistant'
  }
  return 'system'
}

function extractWorkDir(entries: RawEntry[], fallbackProjectPath: string): string | null {
  for (const entry of entries) {
    if (
      entry.type === 'session-meta' &&
      typeof (entry as Record<string, unknown>).workDir === 'string'
    ) {
      return (entry as Record<string, unknown>).workDir as string
    }
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const cwd = entries[index]?.cwd
    if (typeof cwd === 'string' && cwd.trim()) return cwd
  }
  return fallbackProjectPath.replace(/-/g, '/')
}

function extractTitle(entries: RawEntry[], fallbackSessionId: string): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!
    if (entry.type === 'custom-title' && entry.customTitle) {
      return entry.customTitle
    }
  }
  for (const entry of entries) {
    if (entry.type !== 'user' || entry.isMeta || entry.message?.role !== 'user') {
      continue
    }
    const text = extractText(entry.message.content).trim()
    if (text) return text.length > 80 ? `${text.slice(0, 80)}...` : text
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!
    if (entry.type === 'ai-title' && entry.aiTitle) return entry.aiTitle
  }
  return fallbackSessionId || 'Untitled Session'
}

function parseJsonl(raw: string): Array<{ entry: RawEntry; lineNo: number }> {
  const parsed: Array<{ entry: RawEntry; lineNo: number }> = []
  const lines = raw.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim()
    if (!trimmed) continue
    try {
      parsed.push({ entry: JSON.parse(trimmed) as RawEntry, lineNo: index + 1 })
    } catch {
      // Skip malformed transcript lines; JSONL remains the source of truth.
    }
  }
  return parsed
}

export async function parseSessionTranscript(params: {
  filePath: string
  projectPath: string
  sessionId?: string
}): Promise<ParsedSessionTranscript> {
  const [raw, fileStat] = await Promise.all([
    readFile(params.filePath, 'utf-8'),
    stat(params.filePath),
  ])
  const parsed = parseJsonl(raw)
  const entries = parsed.map(item => item.entry)
  const sessionId =
    params.sessionId ??
    basename(params.filePath)
      .replace(/\.placeholder$/, '')
      .replace(/\.jsonl$/, '')

  const messages = parsed.flatMap(({ entry, lineNo }) => {
    if (entry.isMeta || !entry.message?.role || shouldHideEntry(entry)) {
      return []
    }
    const contentText = extractText(entry.message.content).trim()
    if (!contentText) return []
    return [
      {
        messageUuid: entry.uuid ?? `${sessionId}:${lineNo}`,
        role: entry.message.role,
        type: entryType(entry),
        contentText,
        timestamp: entry.timestamp ?? null,
        model: entry.message.model ?? null,
        lineNo,
        isSidechain: entry.isSidechain === true,
      },
    ]
  })

  const firstTimestamp = entries.find(entry => entry.timestamp)?.timestamp
  return {
    sessionId,
    projectPath: params.projectPath,
    filePath: params.filePath,
    workDir: extractWorkDir(entries, params.projectPath),
    title: extractTitle(entries, sessionId),
    createdAt: firstTimestamp ?? fileStat.birthtime.toISOString(),
    modifiedAt: fileStat.mtime.toISOString(),
    fileMtimeMs: fileStat.mtimeMs,
    fileSize: fileStat.size,
    messages,
  }
}
