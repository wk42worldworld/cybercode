type Timer = ReturnType<typeof setTimeout>

type PendingCompletion<T> = {
  value: T
  settleTimer: Timer | null
  fallbackTimer: Timer | null
}

type TurnCompletionGateOptions<T> = {
  settleMs: number
  fallbackMs: number
  onFlush: (sessionId: string, value: T) => void
}

/**
 * Defers a CLI result until the session reports authoritative idle. A short
 * settle window absorbs the queue-drain race where idle is immediately
 * followed by another running state for the same logical user turn.
 */
export class TurnCompletionGate<T> {
  private readonly pending = new Map<string, PendingCompletion<T>>()

  constructor(private readonly options: TurnCompletionGateOptions<T>) {}

  hold(sessionId: string, value: T): void {
    this.clearTimers(this.pending.get(sessionId))
    const pending: PendingCompletion<T> = {
      value,
      settleTimer: null,
      fallbackTimer: null,
    }
    this.pending.set(sessionId, pending)
    this.armFallback(sessionId, pending)
  }

  noteActivity(sessionId: string): void {
    const pending = this.pending.get(sessionId)
    if (!pending) return

    if (pending.settleTimer) {
      clearTimeout(pending.settleTimer)
      pending.settleTimer = null
    }
    this.armFallback(sessionId, pending)
  }

  noteIdle(sessionId: string): void {
    const pending = this.pending.get(sessionId)
    if (!pending) return

    if (pending.fallbackTimer) {
      clearTimeout(pending.fallbackTimer)
      pending.fallbackTimer = null
    }
    if (pending.settleTimer) clearTimeout(pending.settleTimer)
    pending.settleTimer = setTimeout(() => {
      if (this.pending.get(sessionId) !== pending) return
      this.flush(sessionId, pending)
    }, this.options.settleMs)
  }

  clear(sessionId: string): void {
    const pending = this.pending.get(sessionId)
    this.clearTimers(pending)
    this.pending.delete(sessionId)
  }

  flushNow(sessionId: string): void {
    const pending = this.pending.get(sessionId)
    if (pending) this.flush(sessionId, pending)
  }

  private armFallback(sessionId: string, pending: PendingCompletion<T>): void {
    if (pending.fallbackTimer) clearTimeout(pending.fallbackTimer)
    pending.fallbackTimer = setTimeout(() => {
      if (this.pending.get(sessionId) !== pending) return
      this.flush(sessionId, pending)
    }, this.options.fallbackMs)
  }

  private flush(sessionId: string, pending: PendingCompletion<T>): void {
    this.clearTimers(pending)
    this.pending.delete(sessionId)
    this.options.onFlush(sessionId, pending.value)
  }

  private clearTimers(pending: PendingCompletion<T> | undefined): void {
    if (!pending) return
    if (pending.settleTimer) clearTimeout(pending.settleTimer)
    if (pending.fallbackTimer) clearTimeout(pending.fallbackTimer)
    pending.settleTimer = null
    pending.fallbackTimer = null
  }
}
