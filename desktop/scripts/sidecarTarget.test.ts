import { describe, expect, it } from 'vitest'
import { mapTargetTripleToBun } from './sidecarTarget'

describe('mapTargetTripleToBun', () => {
  it('uses Bun baseline runtime for distributable Windows x64 sidecars', () => {
    expect(mapTargetTripleToBun('x86_64-pc-windows-msvc')).toBe(
      'bun-windows-x64-baseline',
    )
  })

  it('keeps native targets for the other release platforms', () => {
    expect(mapTargetTripleToBun('aarch64-apple-darwin')).toBe('bun-darwin-arm64')
    expect(mapTargetTripleToBun('x86_64-apple-darwin')).toBe('bun-darwin-x64')
    expect(mapTargetTripleToBun('x86_64-unknown-linux-gnu')).toBe(
      'bun-linux-x64-baseline',
    )
  })

  it('rejects an unsupported release target', () => {
    expect(() => mapTargetTripleToBun('mips-unknown')).toThrow(
      'Unsupported target triple',
    )
  })
})
