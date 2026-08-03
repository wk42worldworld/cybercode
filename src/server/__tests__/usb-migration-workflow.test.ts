import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

describe('desktop portable release workflow', () => {
  test('publishes signed portable assets and a versioned manifest', async () => {
    const workflow = await readFile(
      resolve(import.meta.dir, '../../../.github/workflows/release-desktop.yml'),
      'utf8',
    )

    expect(workflow).toContain("tauri_args: '--verbose --bundles deb,appimage'")
    expect(workflow).toContain('CyberCode_${VERSION}_${ASSET_SUFFIX}_portable.AppImage')
    expect(workflow).toContain('"$APPIMAGE" --appimage-extract')
    expect(workflow).toContain('smoke_linux_sidecar "$APPIMAGE_ROOT" "appimage"')
    expect(workflow).toContain('CyberCode_${VERSION}_${ASSET_SUFFIX}_portable.zip')
    expect(workflow).toContain("'release-assets/portable.json'")
    expect(workflow).toContain("crypto.createHash('sha256')")
    expect(workflow).toContain('Sign portable release asset')
    expect(workflow).toContain('signature: sig(definition.filename)')
    expect(workflow).toContain('schemaVersion: 2')
    expect(workflow).toContain("'macos-arm64'")
    expect(workflow).toContain("'macos-x64'")
    expect(workflow).toContain("'linux-x64'")
    expect(workflow).toContain("'windows-x64'")
  })

  test('updates AppImage installs with a signed AppImage rather than a DEB', async () => {
    const workflow = await readFile(
      resolve(import.meta.dir, '../../../.github/workflows/release-desktop.yml'),
      'utf8',
    )

    expect(workflow).toContain("'linux-x86_64': asset(assetBaseUrl, linuxAppImage)")
    expect(workflow).toContain("'linux-x86_64-appimage': asset(assetBaseUrl, linuxAppImage)")
    expect(workflow).toContain("'linux-x86_64-deb': asset(assetBaseUrl, linuxDeb)")
    expect(workflow).toContain('linux_x64_portable.AppImage.sig')
    expect(workflow).toContain('windows_x64_portable.zip.sig')
  })

  test('creates the Windows portable archive from the validated installer payload', async () => {
    const workflow = await readFile(
      resolve(import.meta.dir, '../../../.github/workflows/release-desktop.yml'),
      'utf8',
    )
    const extractIndex = workflow.indexOf('7z x -bd -y "-o$ROOT" "$NSIS"')
    const portableIndex = workflow.indexOf(
      'CyberCode_${VERSION}_${ASSET_SUFFIX}_portable.zip',
      extractIndex,
    )
    const validationIndex = workflow.indexOf(
      'Validate packaged runtime resources',
    )

    expect(extractIndex).toBeGreaterThan(validationIndex)
    expect(portableIndex).toBeGreaterThan(extractIndex)
  })
})
