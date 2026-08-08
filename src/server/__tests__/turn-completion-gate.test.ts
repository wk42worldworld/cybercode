import { describe, expect, test } from 'bun:test'

import { TurnCompletionGate } from '../ws/turnCompletionGate.js'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('TurnCompletionGate', () => {
  test('waits for authoritative idle before flushing a result', async () => {
    const flushed: string[] = []
    const gate = new TurnCompletionGate<string>({
      settleMs: 10,
      fallbackMs: 100,
      onFlush: (_sessionId, value) => flushed.push(value),
    })

    gate.hold('session-a', 'complete')
    await wait(20)
    expect(flushed).toEqual([])

    gate.noteIdle('session-a')
    await wait(20)
    expect(flushed).toEqual(['complete'])
  })

  test('cancels completion when the same turn starts running again', async () => {
    const flushed: string[] = []
    const gate = new TurnCompletionGate<string>({
      settleMs: 15,
      fallbackMs: 100,
      onFlush: (_sessionId, value) => flushed.push(value),
    })

    gate.hold('session-b', 'first-result')
    gate.noteIdle('session-b')
    await wait(5)
    gate.noteActivity('session-b')
    await wait(25)
    expect(flushed).toEqual([])

    gate.hold('session-b', 'final-result')
    gate.noteIdle('session-b')
    await wait(25)
    expect(flushed).toEqual(['final-result'])
  })

  test('keeps only the latest result while queued work is draining', async () => {
    const flushed: string[] = []
    const gate = new TurnCompletionGate<string>({
      settleMs: 10,
      fallbackMs: 100,
      onFlush: (_sessionId, value) => flushed.push(value),
    })

    gate.hold('session-c', 'intermediate')
    gate.noteActivity('session-c')
    gate.hold('session-c', 'final')
    gate.noteIdle('session-c')
    await wait(20)

    expect(flushed).toEqual(['final'])
  })

  test('falls back after a quiet period for runtimes without idle events', async () => {
    const flushed: string[] = []
    const gate = new TurnCompletionGate<string>({
      settleMs: 10,
      fallbackMs: 20,
      onFlush: (_sessionId, value) => flushed.push(value),
    })

    gate.hold('session-d', 'legacy-complete')
    await wait(35)

    expect(flushed).toEqual(['legacy-complete'])
  })

  test('can flush immediately at an explicit stop boundary', () => {
    const flushed: string[] = []
    const gate = new TurnCompletionGate<string>({
      settleMs: 10,
      fallbackMs: 100,
      onFlush: (_sessionId, value) => flushed.push(value),
    })

    gate.hold('session-e', 'stopped')
    gate.flushNow('session-e')

    expect(flushed).toEqual(['stopped'])
  })
})
