const HTML_FILE_RE = /\.html?$/i
const SCRIPT_BLOCK_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi

export function isHtmlFile(filePath: string): boolean {
  return HTML_FILE_RE.test(filePath)
}

export function extractHtmlJavaScript(source: string): string {
  let output = ''
  let cursor = 0
  SCRIPT_BLOCK_RE.lastIndex = 0

  for (const match of source.matchAll(SCRIPT_BLOCK_RE)) {
    const whole = match[0]
    const attributes = match[1] || ''
    const body = match[2] || ''
    const blockStart = match.index || 0
    const bodyStart = blockStart + whole.indexOf('>') + 1
    const bodyEnd = bodyStart + body.length

    output += blankMarkup(source.slice(cursor, bodyStart))
    output += isJavaScriptBlock(attributes) ? body : blankMarkup(body)
    cursor = bodyEnd
  }

  return output + blankMarkup(source.slice(cursor))
}

function blankMarkup(value: string): string {
  return value.replace(/[^\r\n]/g, ' ')
}

function isJavaScriptBlock(attributes: string): boolean {
  const match = attributes.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
  if (!match) return true
  const type = (match[1] || match[2] || match[3] || '').trim().toLowerCase()
  return type === 'module' || type.includes('javascript') || type.includes('ecmascript')
}
