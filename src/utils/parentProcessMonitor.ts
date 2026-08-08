import { isProcessRunning } from './genericProcessUtils.js'

export const CYBERCODE_DESKTOP_PARENT_PID_ENV =
  'CYBERCODE_DESKTOP_PARENT_PID'

const DEFAULT_PARENT_CHECK_INTERVAL_MS = 2_000

type TimerHandle = ReturnType<typeof setInterval>

type ParentProcessMonitorOptions = {
  parentPid?: string
  isRunning?: (pid: number) => boolean
  intervalMs?: number
  schedule?: (callback: () => void, intervalMs: number) => TimerHandle
  cancel?: (timer: TimerHandle) => void
}

/**
 * Stops a host-managed process when its desktop server owner disappears.
 * Checking the recorded owner PID also supports grandchildren such as MCP
 * servers, whose immediate parent is the session CLI rather than the desktop
 * server itself.
 */
export function startParentProcessMonitor(
  onParentExit: () => void,
  options: ParentProcessMonitorOptions = {},
): () => void {
  const rawParentPid =
    options.parentPid ?? process.env[CYBERCODE_DESKTOP_PARENT_PID_ENV]
  const parentPid = Number.parseInt(rawParentPid ?? '', 10)
  if (!Number.isSafeInteger(parentPid) || parentPid <= 1) {
    return () => {}
  }

  const isRunning = options.isRunning ?? isProcessRunning
  const schedule = options.schedule ?? setInterval
  const cancel = options.cancel ?? clearInterval
  let timer: TimerHandle | null = null
  let stopped = false

  const stop = () => {
    if (stopped) return
    stopped = true
    if (timer) {
      cancel(timer)
      timer = null
    }
  }

  const checkParent = () => {
    if (stopped) return
    if (isRunning(parentPid)) return

    stop()
    onParentExit()
  }

  timer = schedule(
    checkParent,
    options.intervalMs ?? DEFAULT_PARENT_CHECK_INTERVAL_MS,
  )
  timer.unref?.()
  return stop
}
