import { createHash } from 'crypto'
import { mkdtemp, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { KNOWLEDGE_CHUNK_WORKER_SOURCE } from './chunker.worker.js'

const CHUNK_TARGET_CHARS = 5_000
const CHUNK_OVERLAP_CHARS = 300
const COOPERATIVE_SCAN_CHARS = 128 * 1024
const WORKER_TIMEOUT_MS = 30_000
export const KNOWLEDGE_CHUNK_WORKER_THRESHOLD_CHARS = 256 * 1024
export const KNOWLEDGE_FILE_WORKER_THRESHOLD_BYTES = 256 * 1024

export type KnowledgeChunk = {
  heading: string
  content: string
}

export type ProcessedKnowledgeFile = {
  mode: 'text' | 'metadata'
  chunks: KnowledgeChunk[]
  contentHash: string | null
  error: string | null
}

type WorkerRequest = {
  id: number
  content?: string
  filePath?: string
}

type WorkerResponse =
  | { id: number; type: 'batch'; chunks: KnowledgeChunk[] }
  | {
      id: number
      type: 'done'
      binary?: boolean
      contentHash?: string
    }
  | { id: number; type: 'error'; error: string }

export type KnowledgeChunkWorkerLike = {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: WorkerRequest): void
  terminate(): void
}

export type KnowledgeChunkWorkerFactory = () =>
  | KnowledgeChunkWorkerLike
  | Promise<KnowledgeChunkWorkerLike>

type ChunkOptions = {
  signal?: AbortSignal
  yieldIfNeeded?: () => Promise<void>
  workerFactory?: KnowledgeChunkWorkerFactory
  workerTimeoutMs?: number
}

let nextWorkerRequestId = 0
let workerScriptUrlPromise: Promise<URL> | null = null

export async function chunkKnowledgeText(
  content: string,
  options: ChunkOptions = {},
): Promise<KnowledgeChunk[]> {
  options.signal?.throwIfAborted()
  if (!content) return []
  if (content.length < KNOWLEDGE_CHUNK_WORKER_THRESHOLD_CHARS) {
    return chunkTextSync(content)
  }
  return chunkWithWorker(content, options)
}

export async function processKnowledgeFile(
  filePath: string,
  options: ChunkOptions = {},
): Promise<ProcessedKnowledgeFile> {
  options.signal?.throwIfAborted()
  let worker: KnowledgeChunkWorkerLike
  try {
    worker = await (options.workerFactory ?? createWorker)()
    if (options.signal?.aborted) {
      worker.terminate()
      options.signal.throwIfAborted()
    }
  } catch {
    return processKnowledgeFileCooperatively(filePath, options)
  }

  const id = ++nextWorkerRequestId
  return new Promise<ProcessedKnowledgeFile>((resolve, reject) => {
    const chunks: KnowledgeChunk[] = []
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const claim = (): boolean => {
      if (settled) return false
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', handleAbort)
      worker.terminate()
      return true
    }
    const fallback = () => {
      if (!claim()) return
      void processKnowledgeFileCooperatively(filePath, options).then(resolve, reject)
    }
    const handleAbort = () => {
      if (!claim()) return
      reject(createAbortError())
    }

    worker.onmessage = event => {
      if (event.data.id !== id) return
      if (event.data.type === 'batch') {
        chunks.push(...event.data.chunks)
        return
      }
      if (event.data.type === 'error') {
        fallback()
        return
      }
      if (!claim()) return
      resolve(event.data.binary
        ? {
            mode: 'metadata',
            chunks: [],
            contentHash: null,
            error: 'Binary content is represented by filename and path only',
          }
        : {
            mode: 'text',
            chunks,
            contentHash: event.data.contentHash ?? null,
            error: null,
          })
    }
    worker.onerror = fallback
    options.signal?.addEventListener('abort', handleAbort, { once: true })
    timer = setTimeout(fallback, Math.max(1, options.workerTimeoutMs ?? WORKER_TIMEOUT_MS))
    try {
      worker.postMessage({ id, filePath })
    } catch {
      fallback()
    }
  })
}

async function chunkWithWorker(
  content: string,
  options: ChunkOptions,
): Promise<KnowledgeChunk[]> {
  let worker: KnowledgeChunkWorkerLike
  try {
    worker = await (options.workerFactory ?? createWorker)()
    if (options.signal?.aborted) {
      worker.terminate()
      options.signal.throwIfAborted()
    }
  } catch {
    return chunkTextCooperatively(content, options)
  }

  const id = ++nextWorkerRequestId
  return new Promise<KnowledgeChunk[]>((resolve, reject) => {
    const chunks: KnowledgeChunk[] = []
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const claim = (): boolean => {
      if (settled) return false
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', handleAbort)
      worker.terminate()
      return true
    }
    const fallback = () => {
      if (!claim()) return
      void chunkTextCooperatively(content, options).then(resolve, reject)
    }
    const handleAbort = () => {
      if (!claim()) return
      reject(createAbortError())
    }

    worker.onmessage = event => {
      if (event.data.id !== id) return
      if (event.data.type === 'batch') {
        chunks.push(...event.data.chunks)
        return
      }
      if (event.data.type === 'error') {
        fallback()
        return
      }
      if (!claim()) return
      resolve(chunks)
    }
    worker.onerror = fallback
    options.signal?.addEventListener('abort', handleAbort, { once: true })
    timer = setTimeout(fallback, Math.max(1, options.workerTimeoutMs ?? WORKER_TIMEOUT_MS))
    try {
      worker.postMessage({ id, content })
    } catch {
      fallback()
    }
  })
}

async function processKnowledgeFileCooperatively(
  filePath: string,
  options: ChunkOptions,
): Promise<ProcessedKnowledgeFile> {
  options.signal?.throwIfAborted()
  const buffer = await readFile(filePath)
  options.signal?.throwIfAborted()
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192))
  if (sample.includes(0)) {
    return {
      mode: 'metadata',
      chunks: [],
      contentHash: null,
      error: 'Binary content is represented by filename and path only',
    }
  }
  const content = buffer.toString('utf8').replace(/\r\n?/g, '\n').trim()
  const contentHash = createHash('sha256').update(content).digest('hex')
  const chunks = await chunkTextCooperatively(content, options)
  return { mode: 'text', chunks, contentHash, error: null }
}

async function createWorker(): Promise<KnowledgeChunkWorkerLike> {
  if (typeof Worker === 'undefined') throw new Error('Worker unavailable')
  const workerScriptUrl = await getWorkerScriptUrl()
  return new Worker(workerScriptUrl, { type: 'module' }) as unknown as KnowledgeChunkWorkerLike
}

async function getWorkerScriptUrl(): Promise<URL> {
  if (!workerScriptUrlPromise) {
    workerScriptUrlPromise = (async () => {
      const directory = await mkdtemp(join(tmpdir(), 'cybercode-knowledge-worker-'))
      const filePath = join(directory, 'knowledge-worker.mjs')
      await writeFile(filePath, KNOWLEDGE_CHUNK_WORKER_SOURCE, {
        encoding: 'utf8',
        mode: 0o600,
      })
      return pathToFileURL(filePath)
    })()
  }
  return workerScriptUrlPromise
}

async function chunkTextCooperatively(
  content: string,
  options: ChunkOptions,
): Promise<KnowledgeChunk[]> {
  const sections = await splitMarkdownSectionsCooperatively(content, options)
  const chunks: KnowledgeChunk[] = []
  for (const section of sections) {
    options.signal?.throwIfAborted()
    let cursor = 0
    while (cursor < section.content.length) {
      let end = Math.min(section.content.length, cursor + CHUNK_TARGET_CHARS)
      if (end < section.content.length) {
        const paragraphBoundary = section.content.lastIndexOf('\n\n', end)
        const lineBoundary = section.content.lastIndexOf('\n', end)
        const boundary = Math.max(paragraphBoundary, lineBoundary)
        if (boundary > cursor + Math.floor(CHUNK_TARGET_CHARS * 0.55)) end = boundary
      }
      const value = section.content.slice(cursor, end).trim()
      if (value) chunks.push({ heading: section.heading, content: value })
      if (end >= section.content.length) break
      cursor = Math.max(cursor + 1, end - CHUNK_OVERLAP_CHARS)
      if (options.yieldIfNeeded) await options.yieldIfNeeded()
      else await yieldToEventLoop()
      options.signal?.throwIfAborted()
    }
  }
  return chunks
}

async function splitMarkdownSectionsCooperatively(
  content: string,
  options: ChunkOptions,
): Promise<Array<{ heading: string; content: string }>> {
  const sections: Array<{ heading: string; content: string }> = []
  let heading = ''
  let sectionStart = 0
  let cursor = 0
  let lastYieldAt = 0

  while (cursor <= content.length) {
    options.signal?.throwIfAborted()
    const newline = content.indexOf('\n', cursor)
    const lineEnd = newline < 0 ? content.length : newline
    const line = content.slice(cursor, lineEnd)
    const match = /^(#{1,6})\s+(.+)$/.exec(line)
    if (match) {
      const value = content.slice(sectionStart, cursor).trim()
      if (value) sections.push({ heading, content: value })
      heading = match[2]!.trim()
      sectionStart = newline < 0 ? content.length : newline + 1
    }
    if (newline < 0) break
    cursor = newline + 1
    if (cursor - lastYieldAt >= COOPERATIVE_SCAN_CHARS) {
      if (options.yieldIfNeeded) await options.yieldIfNeeded()
      else await yieldToEventLoop()
      options.signal?.throwIfAborted()
      lastYieldAt = cursor
    }
  }

  const tail = content.slice(sectionStart).trim()
  if (tail) sections.push({ heading, content: tail })
  return sections.length > 0 ? sections : [{ heading: '', content }]
}

function chunkTextSync(content: string): KnowledgeChunk[] {
  const sections = splitMarkdownSectionsSync(content)
  const chunks: KnowledgeChunk[] = []
  for (const section of sections) {
    let cursor = 0
    while (cursor < section.content.length) {
      let end = Math.min(section.content.length, cursor + CHUNK_TARGET_CHARS)
      if (end < section.content.length) {
        const paragraphBoundary = section.content.lastIndexOf('\n\n', end)
        const lineBoundary = section.content.lastIndexOf('\n', end)
        const boundary = Math.max(paragraphBoundary, lineBoundary)
        if (boundary > cursor + Math.floor(CHUNK_TARGET_CHARS * 0.55)) end = boundary
      }
      const value = section.content.slice(cursor, end).trim()
      if (value) chunks.push({ heading: section.heading, content: value })
      if (end >= section.content.length) break
      cursor = Math.max(cursor + 1, end - CHUNK_OVERLAP_CHARS)
    }
  }
  return chunks
}

function splitMarkdownSectionsSync(content: string): Array<{ heading: string; content: string }> {
  const lines = content.split('\n')
  const sections: Array<{ heading: string; content: string }> = []
  let heading = ''
  let body: string[] = []
  const flush = () => {
    const value = body.join('\n').trim()
    if (value) sections.push({ heading, content: value })
    body = []
  }
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line)
    if (match) {
      flush()
      heading = match[2]!.trim()
    } else {
      body.push(line)
    }
  }
  flush()
  return sections.length > 0 ? sections : [{ heading: '', content }]
}

function createAbortError(): Error {
  const error = new Error('Knowledge chunking aborted')
  error.name = 'AbortError'
  return error
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
