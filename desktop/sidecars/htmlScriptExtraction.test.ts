import { describe, expect, it } from 'vitest'
import { extractHtmlJavaScript, isHtmlFile } from './htmlScriptExtraction'

describe('HTML script extraction', () => {
  it('keeps inline JavaScript at its original offsets while blanking markup', () => {
    const source = [
      '<!doctype html>',
      '<style>body { color: red; }</style>',
      '<script>',
      '  function start() {',
      '    return run()',
      '  }',
      '</script>',
    ].join('\n')

    const extracted = extractHtmlJavaScript(source)

    expect(extracted).toHaveLength(source.length)
    expect(extracted.split('\n')).toHaveLength(source.split('\n').length)
    expect(extracted).toContain('function start()')
    expect(extracted.indexOf('function start()')).toBe(source.indexOf('function start()'))
    expect(extracted).not.toContain('<style>')
    expect(extracted).not.toContain('<script>')
  })

  it('indexes JavaScript modules and ignores non-JavaScript script blocks', () => {
    const source = [
      '<script type="importmap">{"imports": {}}</script>',
      '<script type="application/json">{"theme":"dark"}</script>',
      '<script type="module">export function boot() { return true }</script>',
    ].join('\n')

    const extracted = extractHtmlJavaScript(source)

    expect(extracted).not.toContain('"imports"')
    expect(extracted).not.toContain('"theme"')
    expect(extracted).toContain('export function boot()')
  })

  it('recognizes both HTML file extensions', () => {
    expect(isHtmlFile('/project/index.html')).toBe(true)
    expect(isHtmlFile('legacy.HTM')).toBe(true)
    expect(isHtmlFile('component.tsx')).toBe(false)
  })
})
