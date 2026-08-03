import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _resetPortablePathCacheForTesting,
  CYBER_PORTABLE_ROOT_ENV,
  isPortableProjectReference,
  resolvePortableProjectPath,
  toPortableProjectReference,
} from '../portablePaths.js'
import { _resetConfigHomeDirForTesting } from '../envUtils.js'
import { parseSessionInfoFromLite } from '../listSessionsImpl.js'

describe('portable project paths', () => {
  let root: string
  let previousPortableRoot: string | undefined
  let previousConfigDir: string | undefined

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cyber-portable-paths-'))
    previousPortableRoot = process.env[CYBER_PORTABLE_ROOT_ENV]
    previousConfigDir = process.env.CYBER_CONFIG_DIR
    process.env[CYBER_PORTABLE_ROOT_ENV] = root
    process.env.CYBER_CONFIG_DIR = join(root, 'data', 'config')
    await mkdir(process.env.CYBER_CONFIG_DIR, { recursive: true })
    await writeFile(
      join(process.env.CYBER_CONFIG_DIR, 'portable-projects.json'),
      JSON.stringify({
        schemaVersion: 1,
        createdAt: '2026-07-30T00:00:00.000Z',
        projects: [{
          id: 'project-1',
          name: 'cybercode',
          relativePath: 'projects/cybercode-a1b2c3d4',
          originalPaths: [
            '/Users/wang/dev/cybercode',
            'D:\\work\\cybercode',
          ],
        }],
      }),
    )
    _resetConfigHomeDirForTesting()
    _resetPortablePathCacheForTesting()
  })

  afterEach(async () => {
    if (previousPortableRoot === undefined) delete process.env[CYBER_PORTABLE_ROOT_ENV]
    else process.env[CYBER_PORTABLE_ROOT_ENV] = previousPortableRoot
    if (previousConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
    else process.env.CYBER_CONFIG_DIR = previousConfigDir
    _resetConfigHomeDirForTesting()
    _resetPortablePathCacheForTesting()
    await rm(root, { recursive: true, force: true })
  })

  test('maps original macOS and Windows paths to the current USB root', () => {
    expect(resolvePortableProjectPath('/Users/wang/dev/cybercode/src/index.ts')).toBe(
      join(root, 'projects', 'cybercode-a1b2c3d4', 'src', 'index.ts'),
    )
    expect(resolvePortableProjectPath('d:\\WORK\\cybercode\\README.md')).toBe(
      join(root, 'projects', 'cybercode-a1b2c3d4', 'README.md'),
    )
  })

  test('maps paths written under a previous USB mount point', () => {
    expect(resolvePortableProjectPath(
      '/Volumes/OLD_USB/CyberCode-Portable/projects/cybercode-a1b2c3d4/package.json',
    )).toBe(join(root, 'projects', 'cybercode-a1b2c3d4', 'package.json'))
  })

  test('maps a Windows USB path even when project directory casing changes', async () => {
    const registryPath = join(process.env.CYBER_CONFIG_DIR!, 'portable-projects.json')
    await writeFile(registryPath, JSON.stringify({
      schemaVersion: 1,
      createdAt: '2026-07-30T00:00:00.000Z',
      projects: [{
        id: 'project-1',
        name: 'CyberCode',
        relativePath: 'projects/CyberCode-a1b2c3d4',
        originalPaths: ['D:\\work\\CyberCode'],
      }],
    }))
    _resetPortablePathCacheForTesting()

    expect(resolvePortableProjectPath(
      'E:\\CYBERCODE-PORTABLE\\PROJECTS\\cybercode-a1b2c3d4\\src\\index.ts',
    )).toBe(join(root, 'projects', 'CyberCode-a1b2c3d4', 'src', 'index.ts'))
  })

  test('stores portable project paths as mount-independent references', () => {
    const currentPath = join(root, 'projects', 'cybercode-a1b2c3d4', 'src')
    const reference = toPortableProjectReference(currentPath)

    expect(reference).toBe('cybercode-portable://projects/cybercode-a1b2c3d4/src')
    expect(isPortableProjectReference(reference)).toBe(true)
    expect(resolvePortableProjectPath(reference)).toBe(currentPath)
  })

  test('resolves repaired portable work directories in CLI session listings', () => {
    const info = parseSessionInfoFromLite(
      '11111111-1111-4111-8111-111111111111',
      {
        mtime: Date.now(),
        size: 512,
        head: `${JSON.stringify({
          type: 'session-meta',
          workDir: 'D:\\work\\cybercode',
        })}\n${JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'continue portable work' },
        })}\n`,
        tail: `${JSON.stringify({
          type: 'last-prompt',
          lastPrompt: 'continue portable work',
        })}\n${JSON.stringify({
          type: 'session-meta',
          workDir: 'cybercode-portable://projects/cybercode-a1b2c3d4',
        })}\n`,
      },
    )

    expect(info?.cwd).toBe(join(root, 'projects', 'cybercode-a1b2c3d4'))
  })

  test('leaves unrelated paths unchanged', () => {
    expect(resolvePortableProjectPath('/tmp/unrelated')).toBe('/tmp/unrelated')
    expect(toPortableProjectReference('/tmp/unrelated')).toBe('/tmp/unrelated')
  })
})
