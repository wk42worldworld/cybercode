import type { CodeGraphData } from '../../api/tokenOptimization'
import {
  buildBoundedSemanticLayout,
  buildSemanticLayout,
  shouldUseCodeGraphLayoutWorker,
  type GraphLayout,
  type GraphLayoutFallbackReason,
  type GraphViewMode,
} from './codeGraphLayoutCore'

export {
  CODE_GRAPH_LAYOUT_WORKER_THRESHOLD,
  CODE_GRAPH_FALLBACK_MAX_EDGES,
  CODE_GRAPH_FALLBACK_MAX_NODES,
  EMPTY_GRAPH_LAYOUT,
  buildBoundedSemanticLayout,
  buildSemanticLayout,
  clamp,
  hashString,
  shouldUseCodeGraphLayoutWorker,
} from './codeGraphLayoutCore'
export type {
  GraphCluster,
  GraphLayout,
  GraphLayoutFallbackReason,
  GraphViewMode,
  PositionedNode,
} from './codeGraphLayoutCore'

type LayoutWorkerRequest = {
  id: number
  data: CodeGraphData
  viewMode: GraphViewMode
}

type LayoutWorkerResponse = {
  id: number
  layout?: GraphLayout
  error?: string
}

export type LayoutWorkerLike = {
  onmessage: ((event: MessageEvent<LayoutWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: LayoutWorkerRequest): void
  terminate(): void
}

export type LayoutWorkerFactory = () => LayoutWorkerLike
export const CODE_GRAPH_LAYOUT_WORKER_TIMEOUT_MS = 15_000

type LayoutRequestOptions = {
  signal?: AbortSignal
  workerFactory?: LayoutWorkerFactory
  timeoutMs?: number
}

let nextLayoutRequestId = 0

export function requestCodeGraphLayout(
  data: CodeGraphData,
  viewMode: GraphViewMode,
  options: LayoutRequestOptions = {},
): Promise<GraphLayout> {
  if (!shouldUseCodeGraphLayoutWorker(data)) {
    return Promise.resolve(buildSemanticLayout(data, viewMode))
  }
  if (options.signal?.aborted) return Promise.reject(createAbortError())

  const workerFactory = options.workerFactory ?? createLayoutWorker
  let worker: LayoutWorkerLike
  try {
    worker = workerFactory()
  } catch {
    return Promise.resolve(buildBoundedSemanticLayout(
      data,
      viewMode,
      'worker-unavailable',
    ))
  }

  const id = ++nextLayoutRequestId
  return new Promise<GraphLayout>((resolve, reject) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      options.signal?.removeEventListener('abort', handleAbort)
      worker.terminate()
      callback()
    }
    const fallback = (reason: GraphLayoutFallbackReason) => finish(() => resolve(
      buildBoundedSemanticLayout(data, viewMode, reason),
    ))
    const handleAbort = () => finish(() => reject(createAbortError()))

    worker.onmessage = (event) => {
      if (event.data.id !== id) return
      if (!event.data.layout || event.data.error) {
        fallback('worker-error')
        return
      }
      finish(() => resolve(event.data.layout!))
    }
    worker.onerror = () => fallback('worker-error')
    options.signal?.addEventListener('abort', handleAbort, { once: true })
    timeout = setTimeout(
      () => fallback('worker-timeout'),
      Math.max(1, options.timeoutMs ?? CODE_GRAPH_LAYOUT_WORKER_TIMEOUT_MS),
    )
    try {
      worker.postMessage({ id, data, viewMode })
    } catch {
      fallback('worker-post-failed')
    }
  })
}

function createLayoutWorker(): LayoutWorkerLike {
  if (typeof Worker === 'undefined') throw new Error('Worker unavailable')
  return new Worker(
    new URL('../../workers/codeGraphLayout.worker.ts', import.meta.url),
    { type: 'module' },
  )
}

function createAbortError() {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}
