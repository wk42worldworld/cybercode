import {
  boundDiffPreviewResult,
  boundRunOutputResult,
  createBoundedDiffPreview,
  createBoundedRunOutputFallback,
  createLargeDiffPreview,
  reachesUtf8ByteLimit,
  shouldUseLargeDiffPreview,
  type DiffPreview,
  type HeavyTextTask,
} from './heavyTextCore'

export {
  HEAVY_TEXT_THRESHOLD_BYTES,
  HEAVY_TEXT_FALLBACK_EDGE_BYTES,
  HEAVY_TEXT_RESULT_MAX_BYTES,
  LARGE_DIFF_LINE_THRESHOLD,
  createBoundedDiffPreview,
  createBoundedRunOutputFallback,
  createBoundedTextSample,
  createLargeDiffPreview,
  reachesUtf8ByteLimit,
  shouldUseLargeDiffPreview,
} from './heavyTextCore'
export type { DiffPreview, HeavyTextTask } from './heavyTextCore'

type HeavyTextWorkerRequest = HeavyTextTask & { id: number }

type HeavyTextWorkerResponse = {
  id: number
  result?: unknown
  error?: string
}

export type HeavyTextWorkerLike = {
  onmessage: ((event: MessageEvent<HeavyTextWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: HeavyTextWorkerRequest): void
  terminate(): void
}

export type HeavyTextWorkerFactory = () => HeavyTextWorkerLike
export const HEAVY_TEXT_WORKER_TIMEOUT_MS = 15_000
export const HEAVY_TEXT_WORKER_MAX_CONCURRENCY = 2

type HeavyTextRequestOptions = {
  signal?: AbortSignal
  workerFactory?: HeavyTextWorkerFactory
  timeoutMs?: number
}

let nextHeavyTextRequestId = 0
let activeHeavyTextWorkerCount = 0
let isDrainingHeavyTextQueue = false

type HeavyTextQueueEntry = {
  start(): void
}

const heavyTextQueue: HeavyTextQueueEntry[] = []

export function prepareLargeDiffPreviewAsync(
  oldString: string,
  newString: string,
  options: HeavyTextRequestOptions = {},
) {
  if (!shouldUseLargeDiffPreview(oldString, newString)) {
    return Promise.resolve(createLargeDiffPreview(oldString, newString))
  }
  return requestHeavyTextTask<DiffPreview>(
    { kind: 'diff-preview', oldString, newString },
    () => createLargeDiffPreview(oldString, newString),
    options,
  )
}

export function requestHeavyTextTask<Result>(
  task: HeavyTextTask,
  fallback: () => Result,
  options: HeavyTextRequestOptions = {},
): Promise<Result> {
  if (options.signal?.aborted) return Promise.reject(createAbortError())
  const runSafeFallback = () => createSafeFallback(task, fallback)
  const workerFactory = options.workerFactory ?? createHeavyTextWorker
  const id = ++nextHeavyTextRequestId

  return new Promise<Result>((resolve, reject) => {
    let state: 'queued' | 'running' | 'settled' = 'queued'
    let worker: HeavyTextWorkerLike | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const signal = options.signal

    const closeRunningRequest = () => {
      if (state !== 'running') return false
      state = 'settled'
      if (timeout) clearTimeout(timeout)
      signal?.removeEventListener('abort', handleRunningAbort)
      safelyTerminateWorker(worker)
      releaseHeavyTextWorkerSlot()
      return true
    }
    const resolveRunningRequest = (getResult: () => Result) => {
      if (!closeRunningRequest()) return
      try {
        resolve(getResult())
      } catch (error) {
        reject(error)
      }
    }
    const handleRunningAbort = () => {
      if (!closeRunningRequest()) return
      reject(createAbortError())
    }
    const runFallback = () => resolveRunningRequest(runSafeFallback)

    const entry: HeavyTextQueueEntry = {
      start() {
        if (state !== 'queued') {
          releaseHeavyTextWorkerSlot()
          return
        }
        signal?.removeEventListener('abort', handleQueuedAbort)
        state = 'running'
        signal?.addEventListener('abort', handleRunningAbort, { once: true })

        if (signal?.aborted) {
          handleRunningAbort()
          return
        }

        try {
          worker = workerFactory()
          if (state !== 'running') {
            safelyTerminateWorker(worker)
            return
          }

          worker.onmessage = (event) => {
            if (event.data.id !== id) return
            if (event.data.error || event.data.result === undefined) {
              runFallback()
              return
            }
            resolveRunningRequest(
              () => boundWorkerResult(task, event.data.result) as Result,
            )
          }
          worker.onerror = runFallback
          timeout = setTimeout(
            runFallback,
            Math.max(1, options.timeoutMs ?? HEAVY_TEXT_WORKER_TIMEOUT_MS),
          )
          worker.postMessage({ ...task, id } as HeavyTextWorkerRequest)
        } catch {
          runFallback()
        }
      },
    }

    const handleQueuedAbort = () => {
      if (state !== 'queued') return
      state = 'settled'
      signal?.removeEventListener('abort', handleQueuedAbort)
      const queueIndex = heavyTextQueue.indexOf(entry)
      if (queueIndex >= 0) heavyTextQueue.splice(queueIndex, 1)
      reject(createAbortError())
      drainHeavyTextQueue()
    }

    heavyTextQueue.push(entry)
    signal?.addEventListener('abort', handleQueuedAbort, { once: true })
    if (signal?.aborted) {
      handleQueuedAbort()
      return
    }
    drainHeavyTextQueue()
  })
}

function drainHeavyTextQueue() {
  if (isDrainingHeavyTextQueue) return
  isDrainingHeavyTextQueue = true
  try {
    while (
      activeHeavyTextWorkerCount < HEAVY_TEXT_WORKER_MAX_CONCURRENCY
      && heavyTextQueue.length > 0
    ) {
      const entry = heavyTextQueue.shift()!
      activeHeavyTextWorkerCount += 1
      entry.start()
    }
  } finally {
    isDrainingHeavyTextQueue = false
  }
}

function releaseHeavyTextWorkerSlot() {
  activeHeavyTextWorkerCount = Math.max(0, activeHeavyTextWorkerCount - 1)
  drainHeavyTextQueue()
}

function safelyTerminateWorker(worker: HeavyTextWorkerLike | undefined) {
  if (!worker) return
  try {
    worker.terminate()
  } catch {
    // A broken worker must not retain a shared execution slot.
  }
}

function boundWorkerResult(task: HeavyTextTask, result: unknown): unknown {
  if (task.kind === 'parse-run-output' && typeof result === 'string') {
    return boundRunOutputResult(result)
  }
  if (
    task.kind === 'diff-preview'
    && result
    && typeof result === 'object'
    && typeof (result as DiffPreview).oldValue === 'string'
    && typeof (result as DiffPreview).newValue === 'string'
  ) {
    return boundDiffPreviewResult(result as DiffPreview)
  }
  return result
}

function createSafeFallback<Result>(task: HeavyTextTask, fallback: () => Result): Result {
  if (task.kind === 'parse-run-output' && reachesUtf8ByteLimit(task.raw)) {
    return createBoundedRunOutputFallback(task.raw) as Result
  }
  if (
    task.kind === 'diff-preview'
    && shouldUseLargeDiffPreview(task.oldString, task.newString)
  ) {
    return createBoundedDiffPreview(task.oldString, task.newString) as Result
  }
  return fallback()
}

function createHeavyTextWorker(): HeavyTextWorkerLike {
  if (typeof Worker === 'undefined') throw new Error('Worker unavailable')
  return new Worker(
    new URL('../workers/heavyText.worker.ts', import.meta.url),
    { type: 'module' },
  )
}

function createAbortError() {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}
