export type BackgroundTaskLane =
  | 'disk-read'
  | 'disk-write'
  | 'sqlite-write'
  | 'cpu'
  | 'external'

export type BackgroundTaskPriority = 0 | 1 | 2 | 3
// join observes the active result; replace aborts it and queues the new run;
// drop discards the submitted run and returns the active handle marked "dropped".
export type BackgroundTaskDedupe = 'join' | 'replace' | 'drop'
export type BackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type BackgroundTaskProgress = {
  stage?: string
  completed?: number
  total?: number
  message?: string
  [key: string]: unknown
}

export type BackgroundTaskSnapshot = {
  id: string
  type: string
  key: string
  lane: BackgroundTaskLane
  priority: BackgroundTaskPriority
  resourceKey?: string
  status: BackgroundTaskStatus
  progress?: BackgroundTaskProgress
  checkpoint?: unknown
  queuedAt: number
  startedAt?: number
  completedAt?: number
  error?: string
}

export type BackgroundTaskContext = {
  signal: AbortSignal
  report(progress: BackgroundTaskProgress): void
  checkpoint(data?: unknown): Promise<void>
  yieldIfNeeded(): Promise<void>
}

export type BackgroundTaskSpec<T> = {
  type: string
  key: string
  priority: BackgroundTaskPriority
  lane: BackgroundTaskLane
  resourceKey?: string
  dedupe: BackgroundTaskDedupe
  run(context: BackgroundTaskContext): Promise<T>
}

export type BackgroundTaskHandle<T> = {
  id: string
  deduped: boolean
  dedupeResult: 'new' | 'joined' | 'dropped' | 'replaced'
  promise: Promise<T>
  cancel(reason?: unknown): boolean
  snapshot(): BackgroundTaskSnapshot
}

export type BackgroundTaskListener = (
  snapshot: BackgroundTaskSnapshot,
) => void

export type BackgroundSchedulerOptions = {
  limits?: Partial<Record<BackgroundTaskLane, number>>
  yieldIntervalMs?: number
  completedHistoryLimit?: number
}

export type BackgroundSchedulerShutdownOptions = {
  timeoutMs?: number
}
