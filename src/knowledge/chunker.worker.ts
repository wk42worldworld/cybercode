export const KNOWLEDGE_CHUNK_WORKER_SOURCE = String.raw`
import { createHash } from 'crypto'
import { readFile } from 'fs/promises'

const CHUNK_TARGET_CHARS = 5000
const CHUNK_OVERLAP_CHARS = 300
const RESULT_BATCH_SIZE = 128

function splitMarkdownSections(content) {
  const lines = content.split('\n')
  const sections = []
  let heading = ''
  let body = []
  const flush = () => {
    const value = body.join('\n').trim()
    if (value) sections.push({ heading, content: value })
    body = []
  }
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line)
    if (match) {
      flush()
      heading = match[2].trim()
    } else {
      body.push(line)
    }
  }
  flush()
  return sections.length > 0 ? sections : [{ heading: '', content }]
}

function chunkText(content) {
  if (!content) return []
  const sections = splitMarkdownSections(content)
  const chunks = []
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

async function processRequest(event) {
  const { id, filePath } = event.data
  try {
    let content = event.data.content || ''
    let contentHash
    if (filePath) {
      const buffer = await readFile(filePath)
      const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
      if (sample.includes(0)) {
        globalThis.postMessage({ id, type: 'done', binary: true })
        return
      }
      content = buffer.toString('utf8').replace(/\r\n?/g, '\n').trim()
      contentHash = createHash('sha256').update(content).digest('hex')
    }
    const chunks = chunkText(content)
    for (let offset = 0; offset < chunks.length; offset += RESULT_BATCH_SIZE) {
      globalThis.postMessage({
        id,
        type: 'batch',
        chunks: chunks.slice(offset, offset + RESULT_BATCH_SIZE),
      })
    }
    globalThis.postMessage({ id, type: 'done', binary: false, contentHash })
  } catch (error) {
    globalThis.postMessage({
      id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

globalThis.onmessage = (event) => {
  void processRequest(event)
}
`
