import { describe, expect, test } from 'bun:test'
import { BackgroundScheduler } from '../server/background/scheduler.js'
import { scheduleSessionSearchTranscriptRefresh } from './turnIndex.js'

describe('turn-end session search refresh', () => {
  test('passes scheduler cancellation and cooperative yielding into the active indexer', async () => {
    const scheduler = new BackgroundScheduler()
    let markStarted!: () => void
    const started = new Promise<void>(resolve => {
      markStarted = resolve
    })
    let firstSignal: AbortSignal | undefined
    let firstYield: (() => Promise<void>) | undefined

    const first = scheduleSessionSearchTranscriptRefresh({
      transcriptPath: '/tmp/session.jsonl',
      sessionId: 'session-a',
      scheduler,
      indexTranscript: async (_path, options) => {
        firstSignal = options.signal
        firstYield = options.yieldIfNeeded
        markStarted()
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(options.signal?.reason)
          options.signal?.addEventListener('abort', abort, { once: true })
          if (options.signal?.aborted) abort()
        })
        return true
      },
    })
    await started

    const replacement = scheduleSessionSearchTranscriptRefresh({
      transcriptPath: '/tmp/session.jsonl',
      sessionId: 'session-a',
      scheduler,
      indexTranscript: async (_path, options) => {
        expect(options.signal?.aborted).toBe(false)
        expect(options.yieldIfNeeded).toBeFunction()
        return true
      },
    })

    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await replacement
    expect(firstSignal?.aborted).toBe(true)
    expect(firstYield).toBeFunction()
    await scheduler.shutdown({ timeoutMs: 1_000 })
  })
})
