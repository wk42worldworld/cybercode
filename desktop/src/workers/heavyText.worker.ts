import {
  boundDiffPreviewResult,
  boundRunOutputResult,
  createLargeDiffPreview,
  parseRunOutputCore,
  type HeavyTextTask,
} from '../lib/heavyTextCore'

type HeavyTextWorkerRequest = HeavyTextTask & { id: number }

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<HeavyTextWorkerRequest>) => void) | null
  postMessage(message: unknown): void
}

workerScope.onmessage = (event) => {
  const { id } = event.data
  try {
    const result = event.data.kind === 'parse-run-output'
      ? boundRunOutputResult(parseRunOutputCore(event.data.raw))
      : boundDiffPreviewResult(
          createLargeDiffPreview(event.data.oldString, event.data.newString),
        )
    workerScope.postMessage({ id, result })
  } catch (error) {
    workerScope.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
