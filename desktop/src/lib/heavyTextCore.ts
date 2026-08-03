export const HEAVY_TEXT_THRESHOLD_BYTES = 256 * 1024
export const LARGE_DIFF_LINE_THRESHOLD = 2000
export const HEAVY_TEXT_FALLBACK_EDGE_BYTES = 32 * 1024
export const HEAVY_TEXT_RESULT_MAX_BYTES = 512 * 1024
const HEAVY_TEXT_RESULT_EDGE_BYTES = HEAVY_TEXT_RESULT_MAX_BYTES / 8
const DIFF_PREVIEW_HEAD_LINES = 400
const DIFF_PREVIEW_TAIL_LINES = 200
const DIFF_PREVIEW_LINE_CHARS = 8000

export type DiffPreview = {
  oldValue: string
  newValue: string
  oldLineCount: number
  newLineCount: number
  oldShownLineCount: number
  newShownLineCount: number
  truncated: boolean
}

export type HeavyTextTask =
  | { kind: 'parse-run-output'; raw: string }
  | { kind: 'diff-preview'; oldString: string; newString: string }

export type BoundedTextSample = {
  head: string
  tail: string
  value: string
  sourceCodeUnits: number
  sampledCodeUnits: number
  sampledUtf8Bytes: number
  omittedCodeUnits: number
  truncated: boolean
}

export function parseRunOutputCore(raw: string): string {
  if (!raw || !raw.trim()) return ''

  const lines = raw.trim().split('\n')
  const firstLine = lines.find((line) => line.trim())
  if (!firstLine || !firstLine.trim().startsWith('{')) return raw.trim()

  const textParts: string[] = []
  let anyRecognized = false
  for (const line of lines) {
    if (!line.trim()) continue
    let parsed: any
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const type = parsed?.type
    if (type === 'assistant') {
      anyRecognized = true
      const content = parsed?.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block.type === 'text' && block.text?.trim()) textParts.push(block.text.trim())
      }
    }
    if (type === 'result') {
      anyRecognized = true
      const result = parsed?.result
      if (typeof result === 'string' && result.trim()) textParts.push(result.trim())
      else if (result?.message?.trim()) textParts.push(result.message.trim())
    }
    if (type === 'system' || type === 'user') anyRecognized = true
  }
  return anyRecognized ? textParts.join('\n\n') : raw.trim()
}

export function reachesUtf8ByteLimit(value: string, limit = HEAVY_TEXT_THRESHOLD_BYTES) {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else bytes += 3
    } else bytes += 3
    if (bytes >= limit) return true
  }
  return false
}

export function shouldUseLargeDiffPreview(oldString: string, newString: string) {
  if (reachesUtf8ByteLimit(oldString) || reachesUtf8ByteLimit(newString)) return true
  let lines = 2
  for (const value of [oldString, newString]) {
    for (let index = 0; index < value.length; index += 1) {
      if (value.charCodeAt(index) === 10 && ++lines > LARGE_DIFF_LINE_THRESHOLD) return true
    }
  }
  return false
}

export function createLargeDiffPreview(oldString: string, newString: string): DiffPreview {
  const oldPreview = previewLines(oldString)
  const newPreview = previewLines(newString)
  return {
    oldValue: oldPreview.value,
    newValue: newPreview.value,
    oldLineCount: oldPreview.lineCount,
    newLineCount: newPreview.lineCount,
    oldShownLineCount: oldPreview.shownLineCount,
    newShownLineCount: newPreview.shownLineCount,
    truncated: oldPreview.truncated || newPreview.truncated,
  }
}

export function createBoundedRunOutputFallback(raw: string): string {
  const sample = createBoundedTextSample(raw)
  if (!sample.truncated) return parseRunOutputCore(sample.value)
  const assistantText = extractBoundedSingleLineAssistantText(sample.head, raw)
  if (assistantText) {
    return [assistantText, boundedSampleMarker(sample)].join('\n\n')
  }
  const head = parseRunOutputCore(sample.head)
  const tail = parseRunOutputCore(sample.tail)
  return [head, boundedSampleMarker(sample), tail].filter(Boolean).join('\n\n')
}

export function createBoundedDiffPreview(oldString: string, newString: string): DiffPreview {
  const oldSample = createBoundedTextSample(oldString)
  const newSample = createBoundedTextSample(newString)
  const preview = createLargeDiffPreview(oldSample.value, newSample.value)
  const oldLineCount = countLines(oldString)
  const newLineCount = countLines(newString)
  return {
    ...preview,
    oldLineCount,
    newLineCount,
    oldShownLineCount: Math.min(oldLineCount, preview.oldShownLineCount),
    newShownLineCount: Math.min(newLineCount, preview.newShownLineCount),
    truncated: preview.truncated || oldSample.truncated || newSample.truncated,
  }
}

export function boundRunOutputResult(value: string): string {
  if (!reachesUtf8ByteLimit(value, HEAVY_TEXT_RESULT_MAX_BYTES)) return value
  return createBoundedTextSample(value, HEAVY_TEXT_RESULT_MAX_BYTES / 2).value
}

export function boundDiffPreviewResult(preview: DiffPreview): DiffPreview {
  const oldSample = createBoundedTextSample(preview.oldValue, HEAVY_TEXT_RESULT_EDGE_BYTES)
  const newSample = createBoundedTextSample(preview.newValue, HEAVY_TEXT_RESULT_EDGE_BYTES)
  if (!oldSample.truncated && !newSample.truncated) return preview
  return {
    ...preview,
    oldValue: oldSample.value,
    newValue: newSample.value,
    truncated: true,
  }
}

export function createBoundedTextSample(
  value: string,
  edgeBytes = HEAVY_TEXT_FALLBACK_EDGE_BYTES,
): BoundedTextSample {
  const limit = Math.max(1, Math.floor(edgeBytes))
  const prefix = takeUtf8Prefix(value, limit)
  const suffix = takeUtf8Suffix(value, limit)
  const overlaps = prefix.end >= suffix.start
  const head = overlaps ? value.slice(0, suffix.start) : prefix.text
  const tail = suffix.text
  const omittedCodeUnits = overlaps ? 0 : Math.max(0, suffix.start - prefix.end)
  const sampledCodeUnits = overlaps ? value.length : head.length + tail.length
  const sampledUtf8Bytes = overlaps
    ? prefix.bytes + suffix.bytes
    : prefix.bytes + suffix.bytes
  const sample: BoundedTextSample = {
    head,
    tail,
    value: '',
    sourceCodeUnits: value.length,
    sampledCodeUnits,
    sampledUtf8Bytes,
    omittedCodeUnits,
    truncated: omittedCodeUnits > 0,
  }
  sample.value = sample.truncated
    ? `${head}\n${boundedSampleMarker(sample)}\n${tail}`
    : `${head}${tail}`
  return sample
}

function previewLines(value: string) {
  const head: string[] = []
  const tail: string[] = []
  let tailCursor = 0
  let lineCount = 0
  let truncatedLine = false
  let start = 0

  const addLine = (line: string) => {
    const clipped = clipLine(line)
    truncatedLine ||= clipped.length !== line.length
    if (lineCount < DIFF_PREVIEW_HEAD_LINES) head.push(clipped)
    else if (tail.length < DIFF_PREVIEW_TAIL_LINES) tail.push(clipped)
    else {
      tail[tailCursor] = clipped
      tailCursor = (tailCursor + 1) % DIFF_PREVIEW_TAIL_LINES
    }
    lineCount += 1
  }

  while (start <= value.length) {
    const newline = value.indexOf('\n', start)
    if (newline === -1) {
      addLine(value.slice(start))
      break
    }
    addLine(value.slice(start, newline))
    start = newline + 1
  }

  const omittedLines = Math.max(0, lineCount - head.length - tail.length)
  const orderedTail = tail.length < DIFF_PREVIEW_TAIL_LINES || tailCursor === 0
    ? tail
    : [...tail.slice(tailCursor), ...tail.slice(0, tailCursor)]
  const lines = omittedLines > 0
    ? [...head, `[...] ${omittedLines}`, ...orderedTail]
    : [...head, ...orderedTail]
  return {
    value: lines.join('\n'),
    lineCount,
    shownLineCount: lineCount - omittedLines,
    truncated: omittedLines > 0 || truncatedLine,
  }
}

function clipLine(line: string) {
  if (line.length <= DIFF_PREVIEW_LINE_CHARS) return line
  const half = Math.floor(DIFF_PREVIEW_LINE_CHARS / 2)
  return `${line.slice(0, half)} [...] ${line.slice(-half)}`
}

function countLines(value: string) {
  let count = 1
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1
  }
  return count
}

function extractBoundedSingleLineAssistantText(head: string, raw: string) {
  if (raw.indexOf('\n') >= 0) return null
  if (!/"type"\s*:\s*"assistant"/.test(head)) return null
  const contentIndex = head.search(/"content"\s*:/)
  if (contentIndex < 0) return null
  const textBlock = /"type"\s*:\s*"text"/.exec(head.slice(contentIndex))
  const searchFrom = textBlock ? contentIndex + textBlock.index + textBlock[0].length : contentIndex
  const textProperty = /"text"\s*:\s*"/.exec(head.slice(searchFrom))
  if (!textProperty) return null
  const valueStart = searchFrom + textProperty.index + textProperty[0].length
  const decoded = decodeJsonStringPrefix(head, valueStart).trim()
  return decoded || null
}

function decodeJsonStringPrefix(value: string, start: number) {
  let result = ''
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]!
    if (character === '"') break
    if (character !== '\\') {
      result += character
      continue
    }
    const escape = value[++index]
    if (!escape) break
    if (escape === 'u') {
      const code = value.slice(index + 1, index + 5)
      if (!/^[0-9a-fA-F]{4}$/.test(code)) break
      result += String.fromCharCode(Number.parseInt(code, 16))
      index += 4
      continue
    }
    result += JSON_ESCAPE_CHARACTERS[escape] ?? escape
  }
  return result
}

const JSON_ESCAPE_CHARACTERS: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

function boundedSampleMarker(sample: BoundedTextSample) {
  return `[...] ${sample.sampledCodeUnits}/${sample.sourceCodeUnits}`
}

function takeUtf8Prefix(value: string, limit: number) {
  let end = 0
  let bytes = 0
  while (end < value.length) {
    const codePoint = value.codePointAt(end)!
    const width = codePoint > 0xffff ? 2 : 1
    const nextBytes = utf8Bytes(codePoint)
    if (bytes + nextBytes > limit) break
    bytes += nextBytes
    end += width
  }
  return { text: value.slice(0, end), end, bytes }
}

function takeUtf8Suffix(value: string, limit: number) {
  let start = value.length
  let bytes = 0
  while (start > 0) {
    let nextStart = start - 1
    const code = value.charCodeAt(nextStart)
    if (code >= 0xdc00 && code <= 0xdfff && nextStart > 0) {
      const previous = value.charCodeAt(nextStart - 1)
      if (previous >= 0xd800 && previous <= 0xdbff) nextStart -= 1
    }
    const codePoint = value.codePointAt(nextStart)!
    const nextBytes = utf8Bytes(codePoint)
    if (bytes + nextBytes > limit) break
    bytes += nextBytes
    start = nextStart
  }
  return { text: value.slice(start), start, bytes }
}

function utf8Bytes(codePoint: number) {
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  if (codePoint <= 0xffff) return 3
  return 4
}
