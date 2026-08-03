import { randomUUID } from 'crypto'
import type {
  BackgroundSchedulerOptions,
  BackgroundSchedulerShutdownOptions,
  BackgroundTaskHandle,
  BackgroundTaskLane,
  BackgroundTaskListener,
  BackgroundTaskSnapshot,
  BackgroundTaskSpec,
} from './types.js'

const DEFAULT_LIMITS: Record<BackgroundTaskLane, number> = {
  'disk-read': 2,
  'disk-write': 1,
  'sqlite-write': 1,
  cpu: 2,
  external: 1,
}

export class BackgroundTaskCancelledError extends Error {
  constructor(message = 'Background task was cancelled') {
    super(message)
    this.name = 'AbortError'
  }
}

type TaskRecord<T = unknown> = {
  spec: BackgroundTaskSpec<T>
  snapshot: BackgroundTaskSnapshot
  controller: AbortController
  promise: Promise<T>
  resolve(value: T | PromiseLike<T>): void
  reject(reason?: unknown): void
  settled: boolean
  sequence: number
  lastYieldAt: number
}

export class BackgroundScheduler {
  private readonly limits: Record<BackgroundTaskLane, number>
  private readonly yieldIntervalMs: number
  private readonly completedHistoryLimit: number
  private readonly tasks = new Map<string, TaskRecord>()
  private readonly activeByKey = new Map<string, TaskRecord>()
  private readonly listeners = new Set<BackgroundTaskListener>()
  private readonly runningByLane = new Map<BackgroundTaskLane, number>()
  private readonly runningResources = new Set<string>()
  private sequence = 0
  private accepting = true
  private scheduling = false

  constructor(options: BackgroundSchedulerOptions = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...options.limits }
    this.yieldIntervalMs = Math.max(0, options.yieldIntervalMs ?? 8)
    this.completedHistoryLimit = Math.max(0, options.completedHistoryLimit ?? 128)
  }

  start(): void {
    this.accepting = true
    this.schedule()
  }

  enqueue<T>(spec: BackgroundTaskSpec<T>): BackgroundTaskHandle<T> {
    if (!this.accepting) {
      throw new Error('Background scheduler is shutting down')
    }
    this.validateSpec(spec)

    const dedupeKey = this.dedupeKey(spec)
    const existing = this.activeByKey.get(dedupeKey) as TaskRecord<T> | undefined
    if (existing && spec.dedupe === 'join') {
      return this.createHandle(existing, 'joined')
    }
    if (existing && spec.dedupe === 'drop') {
      return this.createHandle(existing, 'dropped')
    }
    if (existing) {
      this.cancelRecord(existing, new BackgroundTaskCancelledError('Background task was replaced'))
    }

    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    // A background caller may intentionally ignore the result. Keep cancellation
    // from surfacing as a process-level unhandled rejection in that case.
    void promise.catch(() => undefined)

    const id = randomUUID()
    const record: TaskRecord<T> = {
      spec,
      snapshot: {
        id,
        type: spec.type,
        key: spec.key,
        lane: spec.lane,
        priority: spec.priority,
        resourceKey: spec.resourceKey,
        status: 'queued',
        queuedAt: Date.now(),
      },
      controller: new AbortController(),
      promise,
      resolve,
      reject,
      settled: false,
      sequence: this.sequence++,
      lastYieldAt: Date.now(),
    }
    this.tasks.set(id, record)
    this.activeByKey.set(dedupeKey, record)
    this.emit(record)
    this.schedule()
    return this.createHandle(record, existing ? 'replaced' : 'new')
  }

  cancel(id: string, reason?: unknown): boolean {
    const record = this.tasks.get(id)
    if (!record || record.settled) return false
    return this.cancelRecord(record, reason)
  }

  snapshot(id?: string): BackgroundTaskSnapshot | BackgroundTaskSnapshot[] | null {
    if (id) {
      const record = this.tasks.get(id)
      return record ? this.cloneSnapshot(record.snapshot) : null
    }
    return [...this.tasks.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .map(record => this.cloneSnapshot(record.snapshot))
  }

  subscribe(listener: BackgroundTaskListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async shutdown(options: BackgroundSchedulerShutdownOptions = {}): Promise<void> {
    if (!this.accepting && !this.hasActiveTasks()) return
    this.accepting = false
    const active = [...this.tasks.values()].filter(record => !record.settled)
    for (const record of active) {
      this.cancelRecord(record, new BackgroundTaskCancelledError('Background scheduler shut down'))
    }
    if (active.length === 0) return

    const waitForTasks = Promise.allSettled(active.map(record => record.promise)).then(() => undefined)
    const timeoutMs = Math.max(0, options.timeoutMs ?? 2_000)
    if (timeoutMs === 0) return
    await Promise.race([
      waitForTasks,
      new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
    ])
  }

  private validateSpec<T>(spec: BackgroundTaskSpec<T>): void {
    if (!spec.type.trim() || !spec.key.trim()) {
      throw new Error('Background task type and key are required')
    }
    const limit = this.limits[spec.lane]
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Invalid concurrency limit for ${spec.lane}`)
    }
  }

  private createHandle<T>(
    record: TaskRecord<T>,
    dedupeResult: BackgroundTaskHandle<T>['dedupeResult'],
  ): BackgroundTaskHandle<T> {
    return {
      id: record.snapshot.id,
      deduped: dedupeResult === 'joined' || dedupeResult === 'dropped',
      dedupeResult,
      promise: record.promise,
      cancel: reason => this.cancel(record.snapshot.id, reason),
      snapshot: () => this.cloneSnapshot(record.snapshot),
    }
  }

  private cancelRecord(record: TaskRecord, reason?: unknown): boolean {
    if (record.settled) return false
    const cancellation = this.abortReason(reason)
    record.controller.abort(cancellation)
    if (record.snapshot.status === 'queued') {
      this.finish(record, 'cancelled', undefined, cancellation)
    }
    return true
  }

  private schedule(): void {
    if (this.scheduling) return
    this.scheduling = true
    queueMicrotask(() => {
      try {
        let started = true
        while (started) {
          started = false
          const candidates = [...this.tasks.values()]
            .filter(record => record.snapshot.status === 'queued')
            .sort((left, right) =>
              left.spec.priority - right.spec.priority || left.sequence - right.sequence)
          for (const record of candidates) {
            if (!this.canStart(record)) continue
            this.startTask(record)
            started = true
          }
        }
      } finally {
        this.scheduling = false
      }
    })
  }

  private canStart(record: TaskRecord): boolean {
    const running = this.runningByLane.get(record.spec.lane) ?? 0
    if (running >= this.limits[record.spec.lane]) return false
    return !record.spec.resourceKey || !this.runningResources.has(record.spec.resourceKey)
  }

  private startTask(record: TaskRecord): void {
    if (record.controller.signal.aborted) {
      this.finish(record, 'cancelled', undefined, record.controller.signal.reason)
      return
    }
    record.snapshot.status = 'running'
    record.snapshot.startedAt = Date.now()
    this.runningByLane.set(record.spec.lane, (this.runningByLane.get(record.spec.lane) ?? 0) + 1)
    if (record.spec.resourceKey) this.runningResources.add(record.spec.resourceKey)
    this.emit(record)

    const context = {
      signal: record.controller.signal,
      report: (progress: Record<string, unknown>) => {
        if (record.settled) return
        record.snapshot.progress = { ...progress }
        this.emit(record)
      },
      checkpoint: async (data?: unknown) => {
        this.throwIfAborted(record)
        record.snapshot.checkpoint = data
        this.emit(record)
        await this.cooperativeYield(record, true)
      },
      yieldIfNeeded: () => this.cooperativeYield(record, false),
    }

    void Promise.resolve()
      .then(() => record.spec.run(context))
      .then(
        value => {
          if (record.controller.signal.aborted) {
            this.finish(record, 'cancelled', undefined, record.controller.signal.reason)
          } else {
            this.finish(record, 'completed', value)
          }
        },
        error => {
          if (record.controller.signal.aborted || this.isAbortError(error)) {
            this.finish(record, 'cancelled', undefined, error)
          } else {
            this.finish(record, 'failed', undefined, error)
          }
        },
      )
  }

  private async cooperativeYield(record: TaskRecord, force: boolean): Promise<void> {
    this.throwIfAborted(record)
    const now = Date.now()
    if (force || now - record.lastYieldAt >= this.yieldIntervalMs) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      record.lastYieldAt = Date.now()
    }
    this.throwIfAborted(record)
  }

  private throwIfAborted(record: TaskRecord): void {
    if (!record.controller.signal.aborted) return
    throw this.abortReason(record.controller.signal.reason)
  }

  private finish(
    record: TaskRecord,
    status: 'completed' | 'failed' | 'cancelled',
    value?: unknown,
    error?: unknown,
  ): void {
    if (record.settled) return
    const wasRunning = record.snapshot.status === 'running'
    record.settled = true
    record.snapshot.status = status
    record.snapshot.completedAt = Date.now()
    if (error !== undefined) {
      record.snapshot.error = error instanceof Error ? error.message : String(error)
    }
    if (wasRunning) {
      this.runningByLane.set(
        record.spec.lane,
        Math.max(0, (this.runningByLane.get(record.spec.lane) ?? 1) - 1),
      )
      if (record.spec.resourceKey) this.runningResources.delete(record.spec.resourceKey)
    }
    const dedupeKey = this.dedupeKey(record.spec)
    if (this.activeByKey.get(dedupeKey) === record) this.activeByKey.delete(dedupeKey)
    this.emit(record)

    if (status === 'completed') record.resolve(value)
    else record.reject(status === 'cancelled' ? this.abortReason(error) : error)
    this.pruneCompletedHistory()
    this.schedule()
  }

  private dedupeKey(spec: Pick<BackgroundTaskSpec<unknown>, 'type' | 'key'>): string {
    return `${spec.type}:${spec.key}`
  }

  private emit(record: TaskRecord): void {
    if (this.listeners.size === 0) return
    const snapshot = this.cloneSnapshot(record.snapshot)
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // Monitoring must never disrupt the task being monitored.
      }
    }
  }

  private cloneSnapshot(snapshot: BackgroundTaskSnapshot): BackgroundTaskSnapshot {
    return {
      ...snapshot,
      progress: snapshot.progress ? { ...snapshot.progress } : undefined,
    }
  }

  private abortReason(reason?: unknown): Error {
    if (reason instanceof Error) return reason
    return new BackgroundTaskCancelledError(
      typeof reason === 'string' ? reason : undefined,
    )
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError'
  }

  private hasActiveTasks(): boolean {
    return [...this.tasks.values()].some(record => !record.settled)
  }

  private pruneCompletedHistory(): void {
    const completed = [...this.tasks.values()]
      .filter(record => record.settled)
      .sort((left, right) => right.sequence - left.sequence)
    for (const record of completed.slice(this.completedHistoryLimit)) {
      this.tasks.delete(record.snapshot.id)
    }
  }
}

export const backgroundScheduler = new BackgroundScheduler()
