import { buildSemanticLayout, type GraphViewMode } from '../components/codegraph/codeGraphLayoutCore'
import type { CodeGraphData } from '../api/tokenOptimization'

type LayoutWorkerRequest = {
  id: number
  data: CodeGraphData
  viewMode: GraphViewMode
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<LayoutWorkerRequest>) => void) | null
  postMessage(message: unknown): void
}

workerScope.onmessage = (event) => {
  const { id, data, viewMode } = event.data
  try {
    workerScope.postMessage({ id, layout: buildSemanticLayout(data, viewMode) })
  } catch (error) {
    workerScope.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
