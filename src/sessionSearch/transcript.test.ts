import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  TRANSCRIPT_JSONL_WORKER_THRESHOLD_BYTES,
  parseHistoryLogFileWithStatus,
  parseSessionTranscript,
  type TranscriptWorkerLike,
} from './transcript.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('large transcript worker parsing', () => {
  test('uses only the bounded prefix when the worker fails', async () => {
    const filePath = await writeLargeTranscript('bounded-worker-fallback')
    let terminated = false
    const workerFactory = (): TranscriptWorkerLike => ({
      onmessage: null,
      onerror: null,
      postMessage() {
        queueMicrotask(() => this.onerror?.({} as ErrorEvent))
      },
      terminate() {
        terminated = true
      },
    })

    const parsed = await parseSessionTranscript({
      filePath,
      projectPath: '-tmp-worker-fallback',
      workerFactory,
    })

    expect(terminated).toBe(true)
    expect(parsed.fileSize).toBeGreaterThan(TRANSCRIPT_JSONL_WORKER_THRESHOLD_BYTES)
    expect(parsed.isComplete).toBe(false)
    expect(parsed.messages.length).toBeGreaterThan(0)
    expect(parsed.messages.length).toBeLessThan(900)
    expect(parsed.messages.some(message => message.contentText.includes('tail-only-marker'))).toBe(false)
  })

  test('terminates an active worker when parsing is aborted', async () => {
    const filePath = await writeLargeTranscript('abort-worker')
    const controller = new AbortController()
    let terminated = false
    let markPosted!: () => void
    const posted = new Promise<void>(resolve => {
      markPosted = resolve
    })
    const workerFactory = (): TranscriptWorkerLike => ({
      onmessage: null,
      onerror: null,
      postMessage() {
        markPosted()
      },
      terminate() {
        terminated = true
      },
    })

    const parsing = parseSessionTranscript({
      filePath,
      projectPath: '-tmp-worker-abort',
      signal: controller.signal,
      workerFactory,
    })
    await posted
    controller.abort()

    await expect(parsing).rejects.toMatchObject({ name: 'AbortError' })
    expect(terminated).toBe(true)
  })

  test('bounds retained messages while preserving the oldest and newest transcript entries', async () => {
    const filePath = await writeLargeTranscript('bounded-message-budget')
    const parsed = await parseSessionTranscript({
      filePath,
      projectPath: '-tmp-worker-budget',
      messageLimit: 20,
      contentLimitChars: 12_000,
    })

    expect(parsed.isComplete).toBe(true)
    expect(parsed.messages.length).toBeLessThanOrEqual(20)
    expect(parsed.messages.some(message => message.contentText.startsWith('0 '))).toBe(true)
    expect(parsed.messages.some(message => message.contentText.includes('tail-only-marker'))).toBe(true)
    expect(parsed.messages.reduce((sum, message) => sum + message.contentText.length, 0))
      .toBeLessThanOrEqual(14_000)
  })

  test('bounds retained history entries while preserving the oldest and newest prompts', async () => {
    const filePath = await writeLargeHistory('bounded-history-budget')
    const parsed = await parseHistoryLogFileWithStatus({
      filePath,
      fileSize: (await stat(filePath)).size,
      maxCollectedEntries: 20,
      maxCollectedChars: 12_000,
    })

    expect(parsed.isComplete).toBe(true)
    expect(parsed.entries.length).toBeLessThanOrEqual(20)
    expect(parsed.entries.some(({ entry }) => entry.display?.startsWith('0 '))).toBe(true)
    expect(parsed.entries.some(({ entry }) => entry.display?.includes('history-tail-marker'))).toBe(true)
  })
})

async function writeLargeTranscript(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `cybercode-${name}-`))
  cleanupPaths.push(directory)
  const filePath = join(directory, '11111111-1111-4111-8111-111111111111.jsonl')
  const payload = 'x'.repeat(900)
  const lines = Array.from({ length: 900 }, (_, index) => JSON.stringify({
    type: 'user',
    uuid: `message-${index}`,
    timestamp: '2026-08-01T00:00:00.000Z',
    message: {
      role: 'user',
      content: index === 899 ? `tail-only-marker ${payload}` : `${index} ${payload}`,
    },
  }))
  await writeFile(filePath, `${lines.join('\n')}\n`)
  return filePath
}

async function writeLargeHistory(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `cybercode-${name}-`))
  cleanupPaths.push(directory)
  const filePath = join(directory, 'history.jsonl')
  const payload = 'y'.repeat(900)
  const lines = Array.from({ length: 900 }, (_, index) => JSON.stringify({
    display: index === 899 ? `history-tail-marker ${payload}` : `${index} ${payload}`,
    project: '/tmp/history-budget',
    sessionId: '11111111-1111-4111-8111-111111111111',
    timestamp: 1_786_000_000_000 + index,
  }))
  await writeFile(filePath, `${lines.join('\n')}\n`)
  return filePath
}
