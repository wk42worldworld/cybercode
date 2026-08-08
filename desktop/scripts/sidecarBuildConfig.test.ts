import { describe, expect, test } from 'bun:test'
import { SIDECAR_MINIFY_OPTIONS } from './sidecarBuildConfig'

describe('sidecar build config', () => {
  test('keeps identifier minification disabled for the multi-mode executable', () => {
    expect(SIDECAR_MINIFY_OPTIONS).toEqual({
      whitespace: true,
      identifiers: false,
      syntax: true,
    })
  })
})
