import { mkdtemp, open, readFile, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { pathToFileURL } from 'url'
import {
  boundSessionSearchContent,
  boundSessionSearchMetadata,
} from './indexText.js'
import { stripProjectMemoryContext } from './projectMemoryContext.js'
import { TRANSCRIPT_WORKER_SOURCE } from './transcript.worker.js'

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
  isTemporary: boolean
  title: string
  createdAt: string
  modifiedAt: string
  fileMtimeMs: number
  fileSize: number
  isComplete: boolean
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
  workDir?: string
  isTemporary?: boolean
  message?: {
    role?: string
    content?: unknown
    model?: string
  }
}

type TranscriptIndexEntryDto = {
  lineNo: number
  timestamp: string | null
  sessionMetaWorkDir: string | null
  sessionMetaIsTemporary: boolean
  cwd: string | null
  customTitle: string | null
  aiTitle: string | null
  firstUserTitle: string | null
  message: TranscriptSearchMessage | null
}

export type HistoryLogIndexEntryDto = {
  display: string | null
  timestamp: number | string | null
  project: string | null
  sessionId: string | null
}

type ParsedJsonlEntry<Entry> = { entry: Entry; lineNo: number }

export type ParsedJsonlFileResult<Entry> = {
  entries: Array<ParsedJsonlEntry<Entry>>
  isComplete: boolean
}

type ParsedJsonlStreamOptions<Entry> = {
  collectEntries?: boolean
  onBatch?: (entries: Array<ParsedJsonlEntry<Entry>>) => void
  onReset?: () => void
  maxCollectedEntries?: number
  maxCollectedChars?: number
  entrySize?: (entry: ParsedJsonlEntry<Entry>) => number
}

type TranscriptWorkerRequest = {
  id: number
  filePath: string
  mode: 'jsonl' | 'session-index' | 'history-index'
  sessionId?: string
}

function toHistoryLogIndexEntryDto(entry: Record<string, unknown>): HistoryLogIndexEntryDto {
  return {
    display: typeof entry.display === 'string'
      ? boundSessionSearchContent(entry.display)
      : null,
    timestamp: typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)
      ? entry.timestamp
      : boundSessionSearchMetadata(
          typeof entry.timestamp === 'string' ? entry.timestamp : null,
          128,
        ),
    project: boundSessionSearchMetadata(
      typeof entry.project === 'string' ? entry.project : null,
      4096,
    ),
    sessionId: boundSessionSearchMetadata(
      typeof entry.sessionId === 'string' ? entry.sessionId : null,
      128,
    ),
  }
}

type TranscriptWorkerResponse =
  | {
      id: number
      type: 'batch'
      parsed: Array<{ entry: unknown; lineNo: number }>
    }
  | { id: number; type: 'done' }
  | { id: number; type: 'error'; error: string }

export type TranscriptWorkerLike = {
  onmessage: ((event: MessageEvent<TranscriptWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: TranscriptWorkerRequest): void
  terminate(): void
}

export type TranscriptWorkerFactory = () =>
  | TranscriptWorkerLike
  | Promise<TranscriptWorkerLike>

export const TRANSCRIPT_JSONL_WORKER_THRESHOLD_BYTES = 512 * 1024
export const SESSION_SEARCH_FILE_MAX_MESSAGES = 12_000
export const SESSION_SEARCH_FILE_MAX_CONTENT_CHARS = 16 * 1024 * 1024
const TRANSCRIPT_JSONL_FALLBACK_BYTES = 256 * 1024
const TRANSCRIPT_WORKER_TIMEOUT_MS = 30_000
let nextTranscriptWorkerRequestId = 0
let transcriptWorkerScriptUrlPromise: Promise<URL> | null = null

class BoundedHeadTailCollector<Value> {
  private readonly head: Array<{ value: Value; size: number }> = []
  private readonly tail: Array<{ value: Value; size: number }> = []
  private readonly headEntryLimit: number
  private readonly tailEntryLimit: number
  private readonly headCharLimit: number
  private readonly tailCharLimit: number
  private headChars = 0
  private tailChars = 0
  private tailStart = 0

  constructor(
    maxEntries: number,
    maxChars: number,
  ) {
    const normalizedEntries = Number.isFinite(maxEntries)
      ? Math.max(2, Math.floor(maxEntries))
      : Number.POSITIVE_INFINITY
    const normalizedChars = Number.isFinite(maxChars)
      ? Math.max(2, Math.floor(maxChars))
      : Number.POSITIVE_INFINITY
    this.headEntryLimit = Math.ceil(normalizedEntries / 2)
    this.tailEntryLimit = Math.floor(normalizedEntries / 2)
    this.headCharLimit = Math.ceil(normalizedChars / 2)
    this.tailCharLimit = Math.floor(normalizedChars / 2)
  }

  add(value: Value, estimatedChars: number): void {
    const size = Math.max(0, Math.floor(estimatedChars))
    if (
      this.head.length < this.headEntryLimit
      && (this.headChars + size <= this.headCharLimit || this.head.length === 0)
    ) {
      this.head.push({ value, size })
      this.headChars += size
      return
    }

    this.tail.push({ value, size })
    this.tailChars += size
    while (
      this.tail.length - this.tailStart > 1
      && (
        this.tail.length - this.tailStart > this.tailEntryLimit
        || this.tailChars > this.tailCharLimit
      )
    ) {
      this.tailChars -= this.tail[this.tailStart]!.size
      this.tailStart += 1
    }
    if (this.tailStart > 1_024 && this.tailStart * 2 > this.tail.length) {
      this.tail.splice(0, this.tailStart)
      this.tailStart = 0
    }
  }

  clear(): void {
    this.head.length = 0
    this.tail.length = 0
    this.headChars = 0
    this.tailChars = 0
    this.tailStart = 0
  }

  values(): Value[] {
    return [
      ...this.head.map(item => item.value),
      ...this.tail.slice(this.tailStart).map(item => item.value),
    ]
  }
}

const USER_INTERRUPTION_TEXTS = new Set([
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
])

const NO_RESPONSE_REQUESTED_TEXT = 'No response requested.'

function extractText(content: unknown): string {
  if (typeof content === 'string') return stripProjectMemoryContext(content)
  if (Array.isArray(content)) {
    const text = content
      .flatMap(block => {
        if (!block || typeof block !== 'object') return []
        const record = block as Record<string, unknown>
        if (typeof record.text === 'string') {
          return [stripProjectMemoryContext(record.text)]
        }
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
    return stripProjectMemoryContext(text)
  }
  return ''
}

function extractTextBlocks(content: unknown, extractedText?: string): string[] {
  return (extractedText ?? extractText(content))
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

function shouldHideEntry(entry: RawEntry, extractedText?: string): boolean {
  const role = entry.message?.role
  const content = entry.message?.content
  if (role === 'user') {
    const textBlocks = extractTextBlocks(content, extractedText)
    return (
      isInternalCommandBreadcrumb(content) ||
      (textBlocks.length > 0 &&
        textBlocks.every(text => USER_INTERRUPTION_TEXTS.has(text)))
    )
  }
  if (role === 'assistant') {
    const textBlocks = extractTextBlocks(content, extractedText)
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

function toTranscriptIndexEntryDto(
  entry: RawEntry,
  lineNo: number,
  sessionId: string,
): TranscriptIndexEntryDto {
  const role = boundSessionSearchMetadata(entry.message?.role, 64)
  const extractedText = role ? extractText(entry.message?.content).trim() : ''
  const contentText = extractedText
    ? boundSessionSearchContent(extractedText)
    : ''
  const timestamp = boundSessionSearchMetadata(entry.timestamp, 128)
  const isFirstUserTitle =
    entry.type === 'user' &&
    !entry.isMeta &&
    role === 'user' &&
    contentText.length > 0
  const message =
    !entry.isMeta &&
    role &&
    contentText &&
    !shouldHideEntry(entry, contentText)
      ? {
          messageUuid:
            boundSessionSearchMetadata(entry.uuid, 512) ?? `${sessionId}:${lineNo}`,
          role,
          type: entryType(entry),
          contentText,
          timestamp,
          model: boundSessionSearchMetadata(entry.message?.model, 256),
          lineNo,
          isSidechain: entry.isSidechain === true,
        }
      : null

  return {
    lineNo,
    timestamp,
    sessionMetaWorkDir:
      entry.type === 'session-meta'
        ? boundSessionSearchMetadata(entry.workDir, 4096)
        : null,
    sessionMetaIsTemporary:
      entry.type === 'session-meta' && entry.isTemporary === true,
    cwd: boundSessionSearchMetadata(entry.cwd, 4096),
    customTitle:
      entry.type === 'custom-title'
        ? boundSessionSearchMetadata(entry.customTitle, 160)
        : null,
    aiTitle:
      entry.type === 'ai-title'
        ? boundSessionSearchMetadata(entry.aiTitle, 160)
        : null,
    firstUserTitle: isFirstUserTitle
      ? contentText.length > 80
        ? `${contentText.slice(0, 80)}...`
        : contentText
      : null,
    message,
  }
}

function parseJsonl<Entry>(raw: string): Array<ParsedJsonlEntry<Entry>> {
  const parsed: Array<ParsedJsonlEntry<Entry>> = []
  const lines = raw.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim()
    if (!trimmed) continue
    try {
      parsed.push({ entry: JSON.parse(trimmed) as Entry, lineNo: index + 1 })
    } catch {
      // Skip malformed transcript lines; JSONL remains the source of truth.
    }
  }
  return parsed
}

async function parseBoundedJsonlFallback<Entry>(
  filePath: string,
  fileSize: number,
  signal?: AbortSignal,
): Promise<ParsedJsonlFileResult<Entry>> {
  signal?.throwIfAborted()
  const bytesToRead = Math.min(fileSize, TRANSCRIPT_JSONL_FALLBACK_BYTES)
  const buffer = Buffer.allocUnsafe(bytesToRead)
  const handle = await open(filePath, 'r')
  let bytesRead = 0
  try {
    signal?.throwIfAborted()
    bytesRead = (await handle.read(buffer, 0, bytesToRead, 0)).bytesRead
  } finally {
    await handle.close()
  }
  signal?.throwIfAborted()
  let raw = buffer.subarray(0, bytesRead).toString('utf8')
  if (bytesRead < fileSize) {
    const lastCompleteLine = raw.lastIndexOf('\n')
    raw = lastCompleteLine >= 0 ? raw.slice(0, lastCompleteLine + 1) : ''
  }
  return {
    entries: parseJsonl<Entry>(raw),
    isComplete: bytesRead >= fileSize,
  }
}

async function getTranscriptWorkerScriptUrl(): Promise<URL> {
  if (!transcriptWorkerScriptUrlPromise) {
    transcriptWorkerScriptUrlPromise = (async () => {
      const directory = await mkdtemp(join(tmpdir(), 'cybercode-transcript-worker-'))
      const filePath = join(directory, 'transcript-worker.mjs')
      await writeFile(filePath, TRANSCRIPT_WORKER_SOURCE, { encoding: 'utf8', mode: 0o600 })
      return pathToFileURL(filePath)
    })()
  }
  return transcriptWorkerScriptUrlPromise
}

async function createTranscriptWorker(): Promise<TranscriptWorkerLike> {
  if (typeof Worker === 'undefined') throw new Error('Worker unavailable')
  const workerScriptUrl = await getTranscriptWorkerScriptUrl()
  return new Worker(
    workerScriptUrl,
    { type: 'module' },
  ) as unknown as TranscriptWorkerLike
}

function createAbortError(): Error {
  const error = new Error('Transcript parsing aborted')
  error.name = 'AbortError'
  return error
}

async function parseLargeFileWithWorker<Entry>(params: {
  filePath: string
  signal?: AbortSignal
  workerFactory?: TranscriptWorkerFactory
  workerTimeoutMs?: number
  mode: 'jsonl' | 'session-index' | 'history-index'
  sessionId?: string
  fallback: () => Promise<ParsedJsonlFileResult<Entry>>
} & ParsedJsonlStreamOptions<Entry>): Promise<ParsedJsonlFileResult<Entry>> {
  params.signal?.throwIfAborted()
  let worker: TranscriptWorkerLike
  try {
    worker = await (params.workerFactory ?? createTranscriptWorker)()
    if (params.signal?.aborted) {
      worker.terminate()
      params.signal.throwIfAborted()
    }
  } catch {
    const result = await params.fallback()
    params.onBatch?.(result.entries)
    return {
      entries: params.collectEntries === false ? [] : result.entries,
      isComplete: result.isComplete,
    }
  }

  const id = ++nextTranscriptWorkerRequestId
  return new Promise<ParsedJsonlFileResult<Entry>>((resolve, reject) => {
    const collectEntries = params.collectEntries !== false
    const collector = new BoundedHeadTailCollector<ParsedJsonlEntry<Entry>>(
      params.maxCollectedEntries ?? Number.POSITIVE_INFINITY,
      params.maxCollectedChars ?? Number.POSITIVE_INFINITY,
    )
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const deliverBatch = (batch: Array<ParsedJsonlEntry<Entry>>) => {
      params.signal?.throwIfAborted()
      params.onBatch?.(batch)
      if (collectEntries) {
        for (const entry of batch) {
          collector.add(entry, params.entrySize?.(entry) ?? 0)
        }
      }
    }
    const claim = (): boolean => {
      if (settled) return false
      settled = true
      if (timer) clearTimeout(timer)
      params.signal?.removeEventListener('abort', handleAbort)
      worker.terminate()
      return true
    }
    const fallback = () => {
      if (!claim()) return
      try {
        collector.clear()
        params.onReset?.()
      } catch (error) {
        reject(error)
        return
      }
      void params.fallback().then(result => {
        try {
          deliverBatch(result.entries)
          resolve({
            entries: collectEntries ? collector.values() : [],
            isComplete: result.isComplete,
          })
        } catch (error) {
          reject(error)
        }
      }, reject)
    }
    const handleAbort = () => {
      if (!claim()) return
      reject(createAbortError())
    }

    worker.onmessage = (event) => {
      if (event.data.id !== id) return
      if (event.data.type === 'error') {
        fallback()
        return
      }
      if (event.data.type === 'batch') {
        try {
          deliverBatch(event.data.parsed as Array<ParsedJsonlEntry<Entry>>)
        } catch (error) {
          if (!claim()) return
          reject(error)
        }
        return
      }
      if (!claim()) return
      resolve({
        entries: collectEntries ? collector.values() : [],
        isComplete: true,
      })
    }
    worker.onerror = fallback
    params.signal?.addEventListener('abort', handleAbort, { once: true })
    timer = setTimeout(fallback, Math.max(1, params.workerTimeoutMs ?? TRANSCRIPT_WORKER_TIMEOUT_MS))
    try {
      worker.postMessage({
        id,
        filePath: params.filePath,
        mode: params.mode,
        sessionId: params.sessionId,
      })
    } catch {
      fallback()
    }
  })
}

async function parseLargeJsonlWithWorker<Entry>(params: {
  filePath: string
  fileSize: number
  signal?: AbortSignal
  workerFactory?: TranscriptWorkerFactory
  workerTimeoutMs?: number
} & ParsedJsonlStreamOptions<Entry>): Promise<ParsedJsonlFileResult<Entry>> {
  return parseLargeFileWithWorker<Entry>({
    ...params,
    mode: 'jsonl',
    fallback: () => parseBoundedJsonlFallback<Entry>(
      params.filePath,
      params.fileSize,
      params.signal,
    ),
  })
}

async function parseLargeSessionWithWorker(params: {
  filePath: string
  fileSize: number
  sessionId: string
  signal?: AbortSignal
  workerFactory?: TranscriptWorkerFactory
  workerTimeoutMs?: number
} & ParsedJsonlStreamOptions<TranscriptIndexEntryDto>): Promise<
  ParsedJsonlFileResult<TranscriptIndexEntryDto>
> {
  return parseLargeFileWithWorker<TranscriptIndexEntryDto>({
    ...params,
    mode: 'session-index',
    fallback: async () => {
      const fallback = await parseBoundedJsonlFallback<RawEntry>(
        params.filePath,
        params.fileSize,
        params.signal,
      )
      return {
        entries: fallback.entries.map(({ entry, lineNo }) => ({
          entry: toTranscriptIndexEntryDto(entry, lineNo, params.sessionId),
          lineNo,
        })),
        isComplete: fallback.isComplete,
      }
    },
  })
}

async function parseLargeHistoryWithWorker(params: {
  filePath: string
  fileSize: number
  signal?: AbortSignal
  workerFactory?: TranscriptWorkerFactory
  workerTimeoutMs?: number
} & ParsedJsonlStreamOptions<HistoryLogIndexEntryDto>): Promise<
  ParsedJsonlFileResult<HistoryLogIndexEntryDto>
> {
  return parseLargeFileWithWorker<HistoryLogIndexEntryDto>({
    ...params,
    mode: 'history-index',
    fallback: async () => {
      const fallback = await parseBoundedJsonlFallback<Record<string, unknown>>(
        params.filePath,
        params.fileSize,
        params.signal,
      )
      return {
        entries: fallback.entries.map(({ entry, lineNo }) => ({
          entry: toHistoryLogIndexEntryDto(entry),
          lineNo,
        })),
        isComplete: fallback.isComplete,
      }
    },
  })
}

export async function parseJsonlFile<Entry>(params: {
  filePath: string
  fileSize: number
  signal?: AbortSignal
  workerFactory?: TranscriptWorkerFactory
  workerTimeoutMs?: number
}): Promise<Array<ParsedJsonlEntry<Entry>>> {
  return (await parseJsonlFileWithStatus<Entry>(params)).entries
}

export async function parseJsonlFileWithStatus<Entry>(params: {
  filePath: string
  fileSize: number
  signal?: AbortSignal
  workerFactory?: TranscriptWorkerFactory
  workerTimeoutMs?: number
} & ParsedJsonlStreamOptions<Entry>): Promise<ParsedJsonlFileResult<Entry>> {
  params.signal?.throwIfAborted()
  if (params.fileSize >= TRANSCRIPT_JSONL_WORKER_THRESHOLD_BYTES) {
    return parseLargeJsonlWithWorker<Entry>(params)
  }
  const raw = await readFile(params.filePath, 'utf8')
  params.signal?.throwIfAborted()
  const entries = parseJsonl<Entry>(raw)
  params.onBatch?.(entries)
  const collector = new BoundedHeadTailCollector<ParsedJsonlEntry<Entry>>(
    params.maxCollectedEntries ?? Number.POSITIVE_INFINITY,
    params.maxCollectedChars ?? Number.POSITIVE_INFINITY,
  )
  if (params.collectEntries !== false) {
    for (const entry of entries) {
      collector.add(entry, params.entrySize?.(entry) ?? 0)
    }
  }
  return {
    entries: params.collectEntries === false ? [] : collector.values(),
    isComplete: true,
  }
}

export async function parseHistoryLogFileWithStatus(params: {
  filePath: string
  fileSize: number
  signal?: AbortSignal
  workerFactory?: TranscriptWorkerFactory
  workerTimeoutMs?: number
} & ParsedJsonlStreamOptions<HistoryLogIndexEntryDto>): Promise<
  ParsedJsonlFileResult<HistoryLogIndexEntryDto>
> {
  params.signal?.throwIfAborted()
  const boundedParams = {
    ...params,
    maxCollectedEntries:
      params.maxCollectedEntries ?? SESSION_SEARCH_FILE_MAX_MESSAGES,
    maxCollectedChars:
      params.maxCollectedChars ?? SESSION_SEARCH_FILE_MAX_CONTENT_CHARS,
    entrySize: ({ entry }: ParsedJsonlEntry<HistoryLogIndexEntryDto>) =>
      (entry.display?.length ?? 0)
      + (entry.project?.length ?? 0)
      + (entry.sessionId?.length ?? 0),
  }
  if (params.fileSize >= TRANSCRIPT_JSONL_WORKER_THRESHOLD_BYTES) {
    return parseLargeHistoryWithWorker(boundedParams)
  }
  const raw = await readFile(params.filePath, 'utf8')
  params.signal?.throwIfAborted()
  const entries = parseJsonl<Record<string, unknown>>(raw).map(({ entry, lineNo }) => ({
    entry: toHistoryLogIndexEntryDto(entry),
    lineNo,
  }))
  boundedParams.onBatch?.(entries)
  const collector = new BoundedHeadTailCollector<
    ParsedJsonlEntry<HistoryLogIndexEntryDto>
  >(
    boundedParams.maxCollectedEntries,
    boundedParams.maxCollectedChars,
  )
  for (const entry of entries) {
    collector.add(entry, boundedParams.entrySize(entry))
  }
  return {
    entries: params.collectEntries === false ? [] : collector.values(),
    isComplete: true,
  }
}

export async function parseSessionTranscript(params: {
  filePath: string
  projectPath: string
  sessionId?: string
  signal?: AbortSignal
  workerFactory?: TranscriptWorkerFactory
  workerTimeoutMs?: number
  yieldIfNeeded?: () => Promise<void>
  messageLimit?: number
  contentLimitChars?: number
}): Promise<ParsedSessionTranscript> {
  params.signal?.throwIfAborted()
  const fileStat = await stat(params.filePath)
  params.signal?.throwIfAborted()
  const sessionId =
    params.sessionId ??
    basename(params.filePath)
      .replace(/\.placeholder$/, '')
      .replace(/\.jsonl$/, '')

  const messages = new BoundedHeadTailCollector<TranscriptSearchMessage>(
    params.messageLimit ?? SESSION_SEARCH_FILE_MAX_MESSAGES,
    params.contentLimitChars ?? SESSION_SEARCH_FILE_MAX_CONTENT_CHARS,
  )
  let firstTimestamp: string | undefined
  let sessionMetaWorkDir: string | null = null
  let lastCwd: string | null = null
  let isTemporary = false
  let customTitle: string | null = null
  let firstUserTitle: string | null = null
  let aiTitle: string | null = null

  const resetParsedState = () => {
    messages.clear()
    firstTimestamp = undefined
    sessionMetaWorkDir = null
    lastCwd = null
    isTemporary = false
    customTitle = null
    firstUserTitle = null
    aiTitle = null
  }
  const consumeIndexEntry = (entry: TranscriptIndexEntryDto) => {
    params.signal?.throwIfAborted()
    if (!firstTimestamp && entry.timestamp) firstTimestamp = entry.timestamp
    if (sessionMetaWorkDir === null && entry.sessionMetaWorkDir) {
      sessionMetaWorkDir = entry.sessionMetaWorkDir
    }
    if (entry.sessionMetaIsTemporary) isTemporary = true
    if (entry.cwd) lastCwd = entry.cwd
    if (entry.customTitle) customTitle = entry.customTitle
    if (entry.aiTitle) aiTitle = entry.aiTitle
    if (firstUserTitle === null && entry.firstUserTitle) {
      firstUserTitle = entry.firstUserTitle
    }
    if (entry.message) messages.add(entry.message, entry.message.contentText.length)
  }
  const consumeIndexBatch = (
    batch: Array<ParsedJsonlEntry<TranscriptIndexEntryDto>>,
  ) => {
    for (const { entry } of batch) consumeIndexEntry(entry)
  }
  const consumeParsedBatch = (batch: Array<ParsedJsonlEntry<RawEntry>>) => {
    for (const { entry, lineNo } of batch) {
      params.signal?.throwIfAborted()
      consumeIndexEntry(toTranscriptIndexEntryDto(entry, lineNo, sessionId))
    }
  }

  const parsedFile = fileStat.size >= TRANSCRIPT_JSONL_WORKER_THRESHOLD_BYTES
    ? await parseLargeSessionWithWorker({
        filePath: params.filePath,
        fileSize: fileStat.size,
        sessionId,
        signal: params.signal,
        workerFactory: params.workerFactory,
        workerTimeoutMs: params.workerTimeoutMs,
        collectEntries: false,
        onBatch: consumeIndexBatch,
        onReset: resetParsedState,
      })
    : await parseJsonlFileWithStatus<RawEntry>({
        filePath: params.filePath,
        fileSize: fileStat.size,
        signal: params.signal,
        workerFactory: params.workerFactory,
        workerTimeoutMs: params.workerTimeoutMs,
        collectEntries: false,
        onBatch: consumeParsedBatch,
        onReset: resetParsedState,
      })
  params.signal?.throwIfAborted()

  const workDir = sessionMetaWorkDir
    ?? lastCwd
    ?? params.projectPath.replace(/-/g, '/')
  const title = (customTitle ?? firstUserTitle ?? aiTitle ?? sessionId) || 'Untitled Session'
  return {
    sessionId,
    projectPath: params.projectPath,
    filePath: params.filePath,
    workDir,
    isTemporary,
    title,
    createdAt: firstTimestamp ?? fileStat.birthtime.toISOString(),
    modifiedAt: fileStat.mtime.toISOString(),
    fileMtimeMs: fileStat.mtimeMs,
    fileSize: fileStat.size,
    isComplete: parsedFile.isComplete,
    messages: messages.values(),
  }
}
