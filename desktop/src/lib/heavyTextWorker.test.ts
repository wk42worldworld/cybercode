import { describe, expect, it, vi } from 'vitest'
import {
  HEAVY_TEXT_FALLBACK_EDGE_BYTES,
  HEAVY_TEXT_RESULT_MAX_BYTES,
  HEAVY_TEXT_WORKER_MAX_CONCURRENCY,
  createBoundedDiffPreview,
  createBoundedRunOutputFallback,
  createBoundedTextSample,
  createLargeDiffPreview,
  prepareLargeDiffPreviewAsync,
  reachesUtf8ByteLimit,
  requestHeavyTextTask,
  shouldUseLargeDiffPreview,
  type HeavyTextWorkerLike,
} from './heavyTextWorker'

describe('large diff preview', () => {
  it('detects byte and line thresholds without scanning beyond the limit', () => {
    expect(reachesUtf8ByteLimit('你'.repeat(90_000))).toBe(true)
    expect(shouldUseLargeDiffPreview('small', 'change')).toBe(false)
    expect(shouldUseLargeDiffPreview('', Array.from({ length: 2001 }, () => 'x').join('\n'))).toBe(true)
  })

  it('bounds line count and individual line width with explicit technical markers', () => {
    const oldString = Array.from({ length: 3000 }, (_, index) => `old ${index}`).join('\n')
    const newString = `${'x'.repeat(20_000)}\n${Array.from({ length: 3000 }, (_, index) => `new ${index}`).join('\n')}`
    const preview = createLargeDiffPreview(oldString, newString)

    expect(preview.truncated).toBe(true)
    expect(preview.oldShownLineCount).toBe(600)
    expect(preview.newShownLineCount).toBe(600)
    expect(preview.oldValue).toContain('[...] 2400')
    expect(preview.newValue).toContain('[...]')
    expect(preview.newValue.length).toBeLessThan(newString.length)
  })

  it('samples fixed UTF-8 byte edges without traversing the large middle', () => {
    const source = `HEAD-${'中'.repeat(200_000)}-TAIL`
    const sample = createBoundedTextSample(source)

    expect(sample.truncated).toBe(true)
    expect(sample.sampledUtf8Bytes).toBeLessThanOrEqual(HEAVY_TEXT_FALLBACK_EDGE_BYTES * 2)
    expect(sample.sampledCodeUnits).toBeLessThan(source.length)
    expect(sample.head).toMatch(/^HEAD-/)
    expect(sample.tail).toMatch(/-TAIL$/)
    expect(sample.value).toContain(`[...] ${sample.sampledCodeUnits}/${source.length}`)
  })

  it('never invokes an unbounded log fallback when worker creation or execution fails', async () => {
    const hiddenMiddle = 'SHOULD_NOT_REACH_MAIN_THREAD_FALLBACK'
    const raw = `${JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'head result' }] },
    })}\n${'a'.repeat(400_000)}${hiddenMiddle}${'b'.repeat(400_000)}\n${JSON.stringify({ type: 'result', result: 'tail result' })}`
    const unsafeFallback = vi.fn(() => {
      throw new Error('unbounded fallback must not run')
    })
    const expected = createBoundedRunOutputFallback(raw)

    await expect(requestHeavyTextTask(
      { kind: 'parse-run-output', raw },
      unsafeFallback,
      { workerFactory: () => { throw new Error('unavailable') } },
    )).resolves.toBe(expected)
    const failedWorker = fakeWorker((_message, worker) => {
      worker.onerror?.(new ErrorEvent('error'))
    })
    await expect(requestHeavyTextTask(
      { kind: 'parse-run-output', raw },
      unsafeFallback,
      { workerFactory: () => failedWorker },
    )).resolves.toBe(expected)
    expect(unsafeFallback).not.toHaveBeenCalled()
    expect(expected.length).toBeLessThan(HEAVY_TEXT_FALLBACK_EDGE_BYTES * 2 + 1024)
    expect(expected).not.toContain(hiddenMiddle)
  })

  it('extracts assistant text from an oversized single-line NDJSON envelope', () => {
    const assistantText = `assistant answer ${'x'.repeat(HEAVY_TEXT_FALLBACK_EDGE_BYTES * 12)}`
    const raw = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: assistantText }] },
    })

    const result = createBoundedRunOutputFallback(raw)

    expect(result).toMatch(/^assistant answer /)
    expect(result).not.toContain('"type":"assistant"')
    expect(result).not.toContain('"message"')
    expect(result.length).toBeLessThan(HEAVY_TEXT_FALLBACK_EDGE_BYTES + 1024)
  })

  it('preserves true source line counts in bounded diff fallbacks', () => {
    const oldString = Array.from({ length: 8_000 }, (_, index) => `old-${index}`).join('\n')
    const newString = Array.from({ length: 9_000 }, (_, index) => `new-${index}`).join('\n')

    const preview = createBoundedDiffPreview(oldString, newString)

    expect(preview.oldLineCount).toBe(8_000)
    expect(preview.newLineCount).toBe(9_000)
    expect(preview.oldShownLineCount).toBeLessThan(preview.oldLineCount)
    expect(preview.newShownLineCount).toBeLessThan(preview.newLineCount)
  })

  it('uses the same bounded diff fallback on worker timeout', async () => {
    const oldString = Array.from({ length: 30_000 }, (_, index) => `old-${index}`).join('\n')
    const newString = Array.from({ length: 30_000 }, (_, index) => `new-${index}`).join('\n')
    let terminated = false
    const worker = fakeWorker(() => undefined, () => { terminated = true })

    const preview = await prepareLargeDiffPreviewAsync(oldString, newString, {
      workerFactory: () => worker,
      timeoutMs: 2,
    })
    expect(terminated).toBe(true)
    expect(preview.truncated).toBe(true)
    expect(preview.oldLineCount).toBe(30_000)
    expect(preview.newLineCount).toBe(30_000)
    expect(preview.oldValue.length).toBeLessThan(HEAVY_TEXT_FALLBACK_EDGE_BYTES * 2 + 1024)
    expect(preview.newValue.length).toBeLessThan(HEAVY_TEXT_FALLBACK_EDGE_BYTES * 2 + 1024)
  })

  it('aborts without invoking any fallback', async () => {
    const raw = 'x'.repeat(HEAVY_TEXT_FALLBACK_EDGE_BYTES * 20)
    const controller = new AbortController()
    const unsafeFallback = vi.fn(() => 'fallback')
    let terminated = false
    const worker = fakeWorker(() => undefined, () => { terminated = true })
    const pending = requestHeavyTextTask(
      { kind: 'parse-run-output', raw },
      unsafeFallback,
      { signal: controller.signal, workerFactory: () => worker },
    )
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(unsafeFallback).not.toHaveBeenCalled()
    expect(terminated).toBe(true)
  })

  it('bounds successful worker results before returning them to React', async () => {
    const workerResult = `HEAD-${'x'.repeat(HEAVY_TEXT_RESULT_MAX_BYTES * 3)}-TAIL`
    const worker = fakeWorker((message, instance) => {
      instance.onmessage?.({ data: { id: message.id, result: workerResult } } as MessageEvent)
    })

    const result = await requestHeavyTextTask(
      { kind: 'parse-run-output', raw: workerResult },
      () => 'fallback',
      { workerFactory: () => worker },
    )

    expect(result).toMatch(/^HEAD-/)
    expect(result).toMatch(/-TAIL$/)
    expect(result.length).toBeLessThan(HEAVY_TEXT_RESULT_MAX_BYTES + 1024)
    expect(result.length).toBeLessThan(workerResult.length)
  })

  it('shares at most two worker execution slots across requests', async () => {
    const running: Array<{
      message: { id: number }
      worker: HeavyTextWorkerLike
    }> = []
    let activeWorkers = 0
    let maxActiveWorkers = 0
    const workerFactory = vi.fn(() => fakeWorker(
      (message, worker) => {
        activeWorkers += 1
        maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers)
        running.push({ message, worker })
      },
      () => { activeWorkers -= 1 },
    ))

    const requests = ['one', 'two', 'three'].map((raw) => requestHeavyTextTask(
      { kind: 'parse-run-output', raw },
      () => `fallback-${raw}`,
      { workerFactory },
    ))

    expect(workerFactory).toHaveBeenCalledTimes(HEAVY_TEXT_WORKER_MAX_CONCURRENCY)
    expect(maxActiveWorkers).toBe(HEAVY_TEXT_WORKER_MAX_CONCURRENCY)

    completeWorker(requireRunningWorker(running, 0), 'one')
    expect(workerFactory).toHaveBeenCalledTimes(3)
    expect(maxActiveWorkers).toBe(HEAVY_TEXT_WORKER_MAX_CONCURRENCY)

    completeWorker(requireRunningWorker(running, 1), 'two')
    completeWorker(requireRunningWorker(running, 2), 'three')
    await expect(Promise.all(requests)).resolves.toEqual(['one', 'two', 'three'])
    expect(activeWorkers).toBe(0)
  })

  it('cancels a queued request without creating its worker or consuming a slot', async () => {
    const running: Array<{
      message: { id: number }
      worker: HeavyTextWorkerLike
    }> = []
    const occupiedFactory = () => fakeWorker((message, worker) => {
      running.push({ message, worker })
    })
    const first = requestHeavyTextTask(
      { kind: 'parse-run-output', raw: 'first' },
      () => 'first fallback',
      { workerFactory: occupiedFactory },
    )
    const second = requestHeavyTextTask(
      { kind: 'parse-run-output', raw: 'second' },
      () => 'second fallback',
      { workerFactory: occupiedFactory },
    )
    const controller = new AbortController()
    const queuedFactory = vi.fn(() => fakeWorker(() => undefined))
    const queued = requestHeavyTextTask(
      { kind: 'parse-run-output', raw: 'queued' },
      () => 'queued fallback',
      { signal: controller.signal, workerFactory: queuedFactory },
    )

    expect(running).toHaveLength(HEAVY_TEXT_WORKER_MAX_CONCURRENCY)
    expect(queuedFactory).not.toHaveBeenCalled()
    controller.abort()

    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    expect(queuedFactory).not.toHaveBeenCalled()

    completeWorker(requireRunningWorker(running, 0), 'first')
    completeWorker(requireRunningWorker(running, 1), 'second')
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
    expect(queuedFactory).not.toHaveBeenCalled()
  })

  it('terminates running work and immediately reuses its slot after cancellation', async () => {
    const controller = new AbortController()
    const running: Array<{
      message: { id: number }
      worker: HeavyTextWorkerLike
    }> = []
    let cancelledWorkerTerminations = 0
    const first = requestHeavyTextTask(
      { kind: 'parse-run-output', raw: 'first' },
      () => 'first fallback',
      {
        signal: controller.signal,
        workerFactory: () => fakeWorker(
          (message, worker) => { running.push({ message, worker }) },
          () => { cancelledWorkerTerminations += 1 },
        ),
      },
    )
    const second = requestHeavyTextTask(
      { kind: 'parse-run-output', raw: 'second' },
      () => 'second fallback',
      {
        workerFactory: () => fakeWorker((message, worker) => {
          running.push({ message, worker })
        }),
      },
    )
    const queuedWorkers: Array<{
      message: { id: number }
      worker: HeavyTextWorkerLike
    }> = []
    const queuedFactory = vi.fn(() => fakeWorker((message, worker) => {
      queuedWorkers.push({ message, worker })
    }))
    const third = requestHeavyTextTask(
      { kind: 'parse-run-output', raw: 'third' },
      () => 'third fallback',
      { workerFactory: queuedFactory },
    )

    expect(queuedFactory).not.toHaveBeenCalled()
    controller.abort()

    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelledWorkerTerminations).toBe(1)
    expect(queuedFactory).toHaveBeenCalledTimes(1)

    completeWorker(requireRunningWorker(running, 1), 'second')
    completeWorker(requireRunningWorker(queuedWorkers, 0), 'third')
    await expect(Promise.all([second, third])).resolves.toEqual(['second', 'third'])
  })

  it('releases a failed worker slot and continues dispatching queued work', async () => {
    const running: Array<{
      message: { id: number }
      worker: HeavyTextWorkerLike
    }> = []
    const occupiedFactory = () => fakeWorker((message, worker) => {
      running.push({ message, worker })
    })
    const first = requestHeavyTextTask(
      { kind: 'parse-run-output', raw: 'first' },
      () => 'first fallback',
      { workerFactory: occupiedFactory },
    )
    const second = requestHeavyTextTask(
      { kind: 'parse-run-output', raw: 'second' },
      () => 'second fallback',
      { workerFactory: occupiedFactory },
    )
    const queuedWorkers: Array<{
      message: { id: number }
      worker: HeavyTextWorkerLike
    }> = []
    const queuedFactory = vi.fn(() => fakeWorker((message, worker) => {
      queuedWorkers.push({ message, worker })
    }))
    const third = requestHeavyTextTask(
      { kind: 'parse-run-output', raw: 'third' },
      () => 'third fallback',
      { workerFactory: queuedFactory },
    )

    expect(queuedFactory).not.toHaveBeenCalled()
    requireRunningWorker(running, 0).worker.onerror?.(new ErrorEvent('error'))

    await expect(first).resolves.toBe('first fallback')
    expect(queuedFactory).toHaveBeenCalledTimes(1)
    expect(queuedWorkers).toHaveLength(1)

    completeWorker(requireRunningWorker(running, 1), 'second')
    completeWorker(requireRunningWorker(queuedWorkers, 0), 'third')
    await expect(Promise.all([second, third])).resolves.toEqual(['second', 'third'])
  })
})

function completeWorker(
  running: { message: { id: number }; worker: HeavyTextWorkerLike },
  result: unknown,
) {
  running.worker.onmessage?.({
    data: { id: running.message.id, result },
  } as MessageEvent)
}

function requireRunningWorker(
  workers: Array<{ message: { id: number }; worker: HeavyTextWorkerLike }>,
  index: number,
) {
  const worker = workers[index]
  expect(worker).toBeDefined()
  return worker!
}

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
