import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(join(
  process.cwd(),
  'src/components/providers/route-graph/routeGraph.css',
), 'utf8')
const editorSource = readFileSync(join(
  process.cwd(),
  'src/components/providers/route-graph/RouteGraphEditor.tsx',
), 'utf8')

describe('route graph compact viewport contract', () => {
  it('does not force a workspace taller than a 640x420 desktop window', () => {
    expect(stylesheet).toContain(
      'height: clamp(240px, calc(100dvh - 164px), 880px);',
    )
    expect(stylesheet).toContain('@media (max-height: 520px)')
    expect(stylesheet).not.toMatch(/min-height:\s*(?:560|580)px/)
  })

  it('uses a dark two-level engineering grid with readable canvas controls', () => {
    expect(stylesheet).toContain('background: #080a0e;')
    expect(stylesheet).toContain('border: 1px solid #2d3745;')
    expect(editorSource).toContain('id="route-grid-minor"')
    expect(editorSource).toContain('id="route-grid-major"')
    expect(editorSource).toContain('color="#18212c"')
    expect(editorSource).toContain('color="#293647"')
    expect(stylesheet).toContain('--route-canvas-edge: #91cfff;')
    expect(editorSource.match(/variant=\{BackgroundVariant\.Lines\}/g)).toHaveLength(2)
    expect(editorSource).not.toContain('variant={BackgroundVariant.Dots}')
  })

  it('tints every node title bar from its category accent', () => {
    expect(stylesheet).toContain(
      'background: color-mix(in srgb, var(--route-node-accent) 18%, var(--color-surface-container));',
    )
    expect(stylesheet).not.toMatch(/box-shadow:\s*inset[^;]*var\(--route-node-accent\)/)
  })
})
