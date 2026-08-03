import {
  HEAVY_TEXT_THRESHOLD_BYTES,
  parseRunOutputCore,
  reachesUtf8ByteLimit,
} from './heavyTextCore'
import { requestHeavyTextTask, type HeavyTextWorkerFactory } from './heavyTextWorker'

/**
 * Parse task run output into displayable text.
 *
 * The output may be in one of two formats:
 *
 * 1. **Extracted text** (new runs) — The server's `extractAssistantText` has
 *    already parsed the raw NDJSON and stored only the AI's text response.
 *    This is plain text / markdown that should be returned as-is.
 *
 * 2. **Raw NDJSON** (old runs before the server-side extraction was added) —
 *    Each line is a JSON object from the CLI's stream-json output. We parse
 *    these and extract assistant text blocks + result messages.
 *
 * Detection: if at least one line parses as JSON with a recognized `type`
 * field, treat as NDJSON. Otherwise return as-is.
 */
export function parseRunOutput(raw: string): string {
  return parseRunOutputCore(raw)
}

export function shouldParseRunOutputInWorker(raw: string) {
  return reachesUtf8ByteLimit(raw, HEAVY_TEXT_THRESHOLD_BYTES)
}

const BOUNDED_RUN_PREVIEW_CHARS = 64 * 1024

export function createBoundedRunOutputPreview(raw: string) {
  if (raw.length <= BOUNDED_RUN_PREVIEW_CHARS * 2) return parseRunOutput(raw)
  const head = parseRunOutput(raw.slice(0, BOUNDED_RUN_PREVIEW_CHARS))
  const tail = parseRunOutput(raw.slice(-BOUNDED_RUN_PREVIEW_CHARS))
  const marker = `[...] ${BOUNDED_RUN_PREVIEW_CHARS * 2}/${raw.length}`
  return [head, marker, tail].filter(Boolean).join('\n\n')
}

export function parseRunOutputAsync(
  raw: string,
  options: { signal?: AbortSignal; workerFactory?: HeavyTextWorkerFactory } = {},
) {
  if (!shouldParseRunOutputInWorker(raw)) return Promise.resolve(parseRunOutput(raw))
  return requestHeavyTextTask(
    { kind: 'parse-run-output', raw },
    () => createBoundedRunOutputPreview(raw),
    options,
  )
}
