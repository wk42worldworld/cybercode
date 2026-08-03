import { describe, expect, it } from 'vitest'
import type { HeavyTextWorkerLike } from './heavyTextWorker'
import {
  HEAVY_TEXT_FALLBACK_EDGE_BYTES,
  createBoundedRunOutputFallback,
} from './heavyTextWorker'
import {
  parseRunOutput,
  parseRunOutputAsync,
  shouldParseRunOutputInWorker,
} from './parseRunOutput'

describe('parseRunOutputAsync', () => {
  it('keeps small output on the synchronous path', async () => {
    let workerCreated = false
    await expect(parseRunOutputAsync('plain output', {
      workerFactory: () => {
        workerCreated = true
        throw new Error('not expected')
      },
    })).resolves.toBe('plain output')
    expect(workerCreated).toBe(false)
  })

  it('parses large output in a worker and ignores stale responses', async () => {
    const raw = 'x'.repeat(256 * 1024)
    const worker = fakeWorker((message, instance) => {
      instance.onmessage?.({ data: { id: message.id + 1, result: 'stale' } } as MessageEvent)
      instance.onmessage?.({ data: { id: message.id, result: 'worker result' } } as MessageEvent)
    })

    expect(shouldParseRunOutputInWorker(raw)).toBe(true)
    await expect(parseRunOutputAsync(raw, { workerFactory: () => worker }))
      .resolves.toBe('worker result')
  })

  it('cancels a pending worker without requiring DOMException', async () => {
    const raw = 'x'.repeat(256 * 1024)
    const controller = new AbortController()
    let terminated = false
    const worker = fakeWorker(() => undefined, () => { terminated = true })
    const pending = parseRunOutputAsync(raw, {
      signal: controller.signal,
      workerFactory: () => worker,
    })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(terminated).toBe(true)
  })

  it('uses a bounded marked preview when worker creation or execution fails', async () => {
    const raw = 'a'.repeat(300 * 1024)
    const expected = createBoundedRunOutputFallback(raw)
    const failedWorker = fakeWorker((_message, instance) => {
      instance.onerror?.(new ErrorEvent('error'))
    })

    expect(expected.length).toBeLessThan(raw.length)
    expect(expected.length).toBeLessThan(HEAVY_TEXT_FALLBACK_EDGE_BYTES * 2 + 1024)
    expect(expected).toContain(`[...] ${HEAVY_TEXT_FALLBACK_EDGE_BYTES * 2}/${raw.length}`)
    await expect(parseRunOutputAsync(raw, {
      workerFactory: () => { throw new Error('unavailable') },
    })).resolves.toBe(expected)
    await expect(parseRunOutputAsync(raw, {
      workerFactory: () => failedWorker,
    })).resolves.toBe(expected)
  })

  it('preserves legacy NDJSON extraction', () => {
    const raw = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }),
      JSON.stringify({ type: 'result', result: 'done' }),
    ].join('\n')
    expect(parseRunOutput(raw)).toBe('hello\n\ndone')
  })
})

function fakeWorker(
  respond: (message: { id: number }, worker: HeavyTextWorkerLike) => void,
  terminate = () => undefined,
): HeavyTextWorkerLike {
  const worker: HeavyTextWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      respond(message, worker)
    },
    terminate,
  }
  return worker
}
