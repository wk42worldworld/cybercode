import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  chunkKnowledgeText,
  processKnowledgeFile,
  type KnowledgeChunkWorkerLike,
} from './chunker.js'

function largeContent(tail = 'unique-tail-marker'): string {
  return `# Architecture\n${'alpha beta gamma delta\n'.repeat(16_000)}${tail}`
}

describe('knowledge chunk worker', () => {
  test('chunks large documents in a worker without losing headings or the tail', async () => {
    const chunks = await chunkKnowledgeText(largeContent())

    expect(chunks[0]?.heading).toBe('Architecture')
    expect(chunks.some(chunk => chunk.content.includes('unique-tail-marker'))).toBe(true)
  })

  test('reads, normalizes, hashes, and chunks a large file inside the worker', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cyber-knowledge-worker-test-'))
    const filePath = join(directory, 'large.md')
    await writeFile(filePath, largeContent('worker-file-tail').replaceAll('\n', '\r\n'))
    try {
      const result = await processKnowledgeFile(filePath)

      expect(result.mode).toBe('text')
      expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/)
      expect(result.chunks.some(chunk => chunk.content.includes('worker-file-tail'))).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('uses a cooperative full-content fallback when the worker fails', async () => {
    const chunks = await chunkKnowledgeText(largeContent('fallback-tail'), {
      workerFactory: () => createFakeWorker((worker, id) => {
        worker.onmessage?.({
          data: { id, type: 'error', error: 'worker failed' },
        } as MessageEvent)
      }),
      yieldIfNeeded: () => Promise.resolve(),
    })

    expect(chunks.some(chunk => chunk.content.includes('fallback-tail'))).toBe(true)
  })

  test('terminates worker work promptly when cancelled', async () => {
    const controller = new AbortController()
    let terminated = false
    const promise = chunkKnowledgeText(largeContent(), {
      signal: controller.signal,
      workerFactory: () => ({
        onmessage: null,
        onerror: null,
        postMessage: () => undefined,
        terminate: () => {
          terminated = true
        },
      }),
    })

    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(terminated).toBe(true)
  })
})

function createFakeWorker(
  start: (worker: KnowledgeChunkWorkerLike, id: number) => void,
): KnowledgeChunkWorkerLike {
  const worker: KnowledgeChunkWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: message => queueMicrotask(() => start(worker, message.id)),
    terminate: () => undefined,
  }
  return worker
}
