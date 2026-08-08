import { describe, expect, test } from 'bun:test'
import { startParentProcessMonitor } from './parentProcessMonitor.js'

describe('startParentProcessMonitor', () => {
  test('does not schedule a monitor without a valid host pid', () => {
    let scheduled = false

    startParentProcessMonitor(() => {}, {
      parentPid: 'invalid',
      schedule: (() => {
        scheduled = true
        return {} as ReturnType<typeof setInterval>
      }) as typeof setInterval,
    })

    expect(scheduled).toBe(false)
  })

  test('stops an orphaned child exactly once', () => {
    let checkParent: (() => void) | undefined
    let cancelled = 0
    let parentExitCalls = 0
    const timer = { unref() {} } as ReturnType<typeof setInterval>

    const stop = startParentProcessMonitor(
      () => {
        parentExitCalls++
      },
      {
        parentPid: '4321',
        isRunning: () => false,
        schedule: ((callback: () => void) => {
          checkParent = callback
          return timer
        }) as typeof setInterval,
        cancel: () => {
          cancelled++
        },
      },
    )

    checkParent?.()
    checkParent?.()
    stop()

    expect(parentExitCalls).toBe(1)
    expect(cancelled).toBe(1)
  })

  test('keeps a live owner and probes its pid', () => {
    let checkParent: (() => void) | undefined
    let probedPid: number | null = null
    let parentExitCalls = 0

    const stop = startParentProcessMonitor(
      () => {
        parentExitCalls++
      },
      {
        parentPid: '9876',
        isRunning: pid => {
          probedPid = pid
          return true
        },
        schedule: ((callback: () => void) => {
          checkParent = callback
          return { unref() {} } as ReturnType<typeof setInterval>
        }) as typeof setInterval,
        cancel: () => {},
      },
    )

    checkParent?.()
    stop()

    expect(probedPid).toBe(9876)
    expect(parentExitCalls).toBe(0)
  })
})
