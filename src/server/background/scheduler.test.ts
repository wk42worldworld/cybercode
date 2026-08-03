import { describe, expect, test } from 'bun:test'
import { BackgroundScheduler } from './scheduler.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function settleScheduler(): Promise<void> {
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('BackgroundScheduler', () => {
  test('runs queued work by priority and FIFO within the same priority', async () => {
    const scheduler = new BackgroundScheduler({ limits: { cpu: 1 } })
    const blocker = deferred<void>()
    const order: string[] = []
    const first = scheduler.enqueue({
      type: 'test', key: 'running', priority: 2, lane: 'cpu', dedupe: 'join',
      run: async () => blocker.promise,
    })
    await settleScheduler()
    const low = scheduler.enqueue({
      type: 'test', key: 'low', priority: 3, lane: 'cpu', dedupe: 'join',
      run: async () => { order.push('low') },
    })
    const highA = scheduler.enqueue({
      type: 'test', key: 'high-a', priority: 0, lane: 'cpu', dedupe: 'join',
      run: async () => { order.push('high-a') },
    })
    const highB = scheduler.enqueue({
      type: 'test', key: 'high-b', priority: 0, lane: 'cpu', dedupe: 'join',
      run: async () => { order.push('high-b') },
    })
    blocker.resolve()
    await Promise.all([first.promise, low.promise, highA.promise, highB.promise])
    expect(order).toEqual(['high-a', 'high-b', 'low'])
  })

  test('serializes the same resource across different lanes', async () => {
    const scheduler = new BackgroundScheduler()
    const blocker = deferred<void>()
    let concurrent = 0
    let maximum = 0
    const run = async (wait = false) => {
      concurrent += 1
      maximum = Math.max(maximum, concurrent)
      if (wait) await blocker.promise
      concurrent -= 1
    }
    const read = scheduler.enqueue({
      type: 'read', key: 'a', priority: 1, lane: 'disk-read', resourceKey: 'volume:a', dedupe: 'join',
      run: () => run(true),
    })
    const write = scheduler.enqueue({
      type: 'write', key: 'b', priority: 1, lane: 'disk-write', resourceKey: 'volume:a', dedupe: 'join',
      run: () => run(),
    })
    await settleScheduler()
    expect(write.snapshot().status).toBe('queued')
    blocker.resolve()
    await Promise.all([read.promise, write.promise])
    expect(maximum).toBe(1)
  })

  test('joins, drops, and replaces duplicate work', async () => {
    const scheduler = new BackgroundScheduler({ limits: { cpu: 1 } })
    const firstBlocker = deferred<number>()
    const first = scheduler.enqueue({
      type: 'refresh', key: 'same', priority: 2, lane: 'cpu', dedupe: 'join',
      run: () => firstBlocker.promise,
    })
    const joined = scheduler.enqueue({
      type: 'refresh', key: 'same', priority: 2, lane: 'cpu', dedupe: 'join',
      run: async () => 99,
    })
    const dropped = scheduler.enqueue({
      type: 'refresh', key: 'same', priority: 2, lane: 'cpu', dedupe: 'drop',
      run: async () => 100,
    })
    expect(joined.id).toBe(first.id)
    expect(joined.deduped).toBe(true)
    expect(dropped.id).toBe(first.id)
    expect(joined.dedupeResult).toBe('joined')
    expect(dropped.dedupeResult).toBe('dropped')
    firstBlocker.resolve(1)
    expect(await joined.promise).toBe(1)

    const oldBlocker = deferred<number>()
    const old = scheduler.enqueue({
      type: 'refresh', key: 'replace', priority: 2, lane: 'cpu', dedupe: 'join',
      run: async ({ signal }) => {
        await Promise.race([
          oldBlocker.promise,
          new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
        ])
        return 2
      },
    })
    await settleScheduler()
    const replacement = scheduler.enqueue({
      type: 'refresh', key: 'replace', priority: 1, lane: 'cpu', dedupe: 'replace',
      run: async () => 3,
    })
    await expect(old.promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(await replacement.promise).toBe(3)
    expect(replacement.dedupeResult).toBe('replaced')
  })

  test('cancels queued and running work and bounds shutdown', async () => {
    const scheduler = new BackgroundScheduler({ limits: { external: 1 } })
    const running = scheduler.enqueue({
      type: 'long', key: 'running', priority: 2, lane: 'external', dedupe: 'join',
      run: async ({ signal }) => {
        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      },
    })
    const queued = scheduler.enqueue({
      type: 'long', key: 'queued', priority: 2, lane: 'external', dedupe: 'join',
      run: async () => undefined,
    })
    await settleScheduler()
    expect(queued.cancel()).toBe(true)
    await expect(queued.promise).rejects.toMatchObject({ name: 'AbortError' })
    await scheduler.shutdown({ timeoutMs: 50 })
    await expect(running.promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(running.snapshot().status).toBe('cancelled')
    expect(() => scheduler.enqueue({
      type: 'late', key: 'late', priority: 3, lane: 'external', dedupe: 'join', run: async () => undefined,
    })).toThrow('shutting down')
  })

  test('bounds completed history while completed handles retain their snapshot', async () => {
    const scheduler = new BackgroundScheduler({ completedHistoryLimit: 2 })
    const handles = Array.from({ length: 5 }, (_, index) => scheduler.enqueue({
      type: 'short', key: String(index), priority: 3, lane: 'cpu', dedupe: 'join',
      run: async () => index,
    }))
    await Promise.all(handles.map(handle => handle.promise))
    expect(scheduler.snapshot()).toHaveLength(2)
    expect(handles[0]!.snapshot().status).toBe('completed')
    expect(scheduler.snapshot(handles[0]!.id)).toBeNull()
  })

  test('can start again after a completed shutdown lifecycle', async () => {
    const scheduler = new BackgroundScheduler()
    expect(await scheduler.enqueue({
      type: 'lifecycle', key: 'first', priority: 1, lane: 'cpu', dedupe: 'join',
      run: async () => 'first',
    }).promise).toBe('first')
    await scheduler.shutdown({ timeoutMs: 50 })
    scheduler.start()
    expect(await scheduler.enqueue({
      type: 'lifecycle', key: 'second', priority: 1, lane: 'cpu', dedupe: 'join',
      run: async () => 'second',
    }).promise).toBe('second')
  })
})
