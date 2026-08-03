import { createHash } from 'node:crypto'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import {
  USB_PORTABLE_DIRECTORY_NAME,
  USB_PORTABLE_MARKER,
  UsbMigrationError,
  UsbMigrationService,
  type PortableReleaseManifest,
  type UsbMigrationJob,
} from '../services/usbMigrationService.js'
import { BackgroundScheduler } from '../background/scheduler.js'

describe('UsbMigrationService', () => {
  let root: string
  let configDir: string
  let projectDir: string
  let destinationDir: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cyber-usb-migration-'))
    configDir = join(root, 'home', '.cyber')
    projectDir = join(root, 'workspace', 'app')
    destinationDir = join(root, 'usb')
    await mkdir(join(configDir, 'skills', 'review'), { recursive: true })
    await mkdir(join(configDir, 'plugins', 'cache'), { recursive: true })
    await mkdir(join(projectDir, 'src'), { recursive: true })
    await mkdir(destinationDir, { recursive: true })
    await writeFile(join(configDir, 'skills', 'review', 'SKILL.md'), '# Review')
    await writeFile(join(configDir, 'plugins', 'cache', 'plugin.json'), '{"name":"demo"}')
    await writeFile(join(projectDir, 'src', 'index.ts'), 'export const answer = 42\n')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('copies config, skills, plugins, projects, registry, and launchers', async () => {
    const service = createService()
    const scan = await service.scan()

    expect(scan.configSizeBytes).toBeGreaterThan(0)
    expect(scan.projects).toHaveLength(1)
    expect(scan.projects[0]?.sizeBytes).toBeGreaterThan(0)

    const started = await service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [scan.projects[0]!.id],
    })
    const completed = await waitForJob(service, started.id)
    const portableRoot = join(destinationDir, USB_PORTABLE_DIRECTORY_NAME)

    expect(completed).toMatchObject({
      status: 'completed',
      stage: 'completed',
      progressPercent: 100,
    })
    expect(await readFile(
      join(portableRoot, 'data', 'config', 'skills', 'review', 'SKILL.md'),
      'utf8',
    )).toBe('# Review')
    expect(await readFile(
      join(portableRoot, 'data', 'config', 'plugins', 'cache', 'plugin.json'),
      'utf8',
    )).toContain('demo')

    const registry = JSON.parse(await readFile(
      join(portableRoot, 'data', 'config', 'portable-projects.json'),
      'utf8',
    )) as {
      projects: Array<{ relativePath: string; originalPaths: string[] }>
    }
    expect(registry.projects).toHaveLength(1)
    expect(registry.projects[0]?.originalPaths).toEqual([await realpath(projectDir)])
    expect(await readFile(
      join(portableRoot, registry.projects[0]!.relativePath, 'src', 'index.ts'),
      'utf8',
    )).toContain('answer')

    await access(join(portableRoot, 'Start-CyberCode.command'))
    await access(join(portableRoot, 'Start-CyberCode.sh'))
    await access(join(portableRoot, 'Start-CyberCode.cmd'))
    await access(join(portableRoot, 'Start-CyberCode.ps1'))
    const shellLauncher = await readFile(
      join(portableRoot, 'Start-CyberCode.sh'),
      'utf8',
    )
    const windowsLauncher = await readFile(
      join(portableRoot, 'Start-CyberCode.ps1'),
      'utf8',
    )
    expect(shellLauncher).toContain('export CYBER_CONFIG_DIR="$ROOT/data/config"')
    expect(shellLauncher).toContain('export CYBER_PORTABLE_ROOT="$ROOT"')
    expect(shellLauncher).toContain("Print :CFBundleExecutable")
    expect(shellLauncher).not.toContain("CyberCode.app/Contents/MacOS/*")
    expect(shellLauncher).toContain('APPIMAGE_EXTRACT_AND_RUN=1 exec "$APPIMAGE"')
    expect(windowsLauncher).toContain('$env:CYBER_CONFIG_DIR')
    expect(windowsLauncher).toContain('$env:CYBER_PORTABLE_ROOT')
    expect(windowsLauncher).toContain('$LaunchOptions.ArgumentList = $args')
    expect(await readFile(join(portableRoot, '.cybercode-portable'), 'utf8'))
      .toBe('cybercode-portable-v1\n')
  })

  test('skips rebuildable caches and generated project dependencies', async () => {
    await mkdir(join(configDir, '.runtime', 'python'), { recursive: true })
    await mkdir(join(configDir, 'indexes'), { recursive: true })
    await mkdir(join(configDir, 'cache'), { recursive: true })
    await writeFile(join(configDir, '.runtime', 'python', 'runtime.bin'), 'runtime')
    await writeFile(join(configDir, 'indexes', 'memory.db'), 'index')
    await writeFile(join(configDir, 'cache', 'response.json'), 'cache')

    const generatedDirectories = [
      ['node_modules', 'package', 'index.js'],
      ['target', 'debug', 'app'],
      ['.codegraph', 'graph.db'],
      ['build', 'bundle.js'],
    ]
    for (const parts of generatedDirectories) {
      const target = join(projectDir, ...parts)
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, 'generated')
    }

    const service = createService()
    const scan = await service.scan()

    expect(scan.configSizeBytes).toBe(
      Buffer.byteLength('# Review') + Buffer.byteLength('{"name":"demo"}'),
    )
    expect(scan.projects[0]?.sizeBytes).toBe(
      Buffer.byteLength('export const answer = 42\n'),
    )

    const started = await service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [scan.projects[0]!.id],
    })
    const completed = await waitForJob(service, started.id)
    const portableRoot = join(destinationDir, USB_PORTABLE_DIRECTORY_NAME)
    const portableProject = join(
      portableRoot,
      'projects',
      `app-${scan.projects[0]!.id.slice(0, 8)}`,
    )

    expect(completed.status).toBe('completed')
    await access(join(portableProject, 'src', 'index.ts'))
    await expect(access(join(portableRoot, 'data', 'config', '.runtime')))
      .rejects.toThrow()
    await expect(access(join(portableRoot, 'data', 'config', 'indexes')))
      .rejects.toThrow()
    await expect(access(join(portableProject, 'node_modules')))
      .rejects.toThrow()
    await expect(access(join(portableProject, 'target')))
      .rejects.toThrow()
    await expect(access(join(portableProject, '.codegraph')))
      .rejects.toThrow()
    await expect(access(join(portableProject, 'build')))
      .rejects.toThrow()
  })

  test('downloads and verifies a selected platform package', async () => {
    const packageBytes = new TextEncoder().encode('portable-windows-package')
    const sha256 = createHash('sha256').update(packageBytes).digest('hex')
    const manifest = createManifest({
      filename: 'CyberCode_1.2.0_windows_x64_portable.zip',
      size: packageBytes.byteLength,
      sha256,
      archiveType: 'zip',
      urls: ['https://example.test/windows.zip'],
    })
    const service = createService({
      resolveRelease: async () => ({
        manifest,
        sourceUrl: 'https://example.test/portable.json',
      }),
      fetchImpl: async (input) => {
        expect(String(input)).toBe('https://example.test/windows.zip')
        return new Response(packageBytes)
      },
    })
    const scan = await service.scan()
    const started = await service.start({
      destinationPath: destinationDir,
      projectIds: [scan.projects[0]!.id],
      platforms: ['windows-x64'],
    })
    const completed = await waitForJob(service, started.id)
    const packagePath = join(
      destinationDir,
      USB_PORTABLE_DIRECTORY_NAME,
      'packages',
      'windows-x64',
      'CyberCode_1.2.0_windows_x64_portable.zip',
    )

    expect(completed.status).toBe('completed')
    expect(new Uint8Array(await Bun.file(packagePath).arrayBuffer())).toEqual(packageBytes)
    expect(await readFile(
      join(destinationDir, USB_PORTABLE_DIRECTORY_NAME, 'checksums.sha256'),
      'utf8',
    )).toContain(sha256)
  })

  test('rejects a portable package whose trusted release signature is invalid', async () => {
    const packageBytes = new TextEncoder().encode('forged-portable-package')
    const manifest = createManifest({
      filename: 'CyberCode_1.2.0_windows_x64_portable.zip',
      size: packageBytes.byteLength,
      sha256: createHash('sha256').update(packageBytes).digest('hex'),
      signature: 'dGVzdA==',
      archiveType: 'zip',
      urls: ['https://mirror.example.test/windows.zip'],
    })
    const service = createService({
      resolveRelease: async () => ({
        manifest,
        sourceUrl: 'https://mirror.example.test/portable.json',
      }),
      fetchImpl: async () => new Response(packageBytes),
      verifyAssetSignature: () => false,
    })
    const scan = await service.scan()
    const started = await service.start({
      destinationPath: destinationDir,
      projectIds: [],
      platforms: ['windows-x64'],
    })
    const completed = await waitForJob(service, started.id)

    expect(completed).toMatchObject({
      status: 'failed',
      stage: 'failed',
    })
    expect(completed.error).toContain('发布签名校验失败')
    await expect(access(join(destinationDir, USB_PORTABLE_DIRECTORY_NAME)))
      .rejects.toThrow()
  })

  test('falls back to the next package mirror when a download stalls', async () => {
    const packageBytes = new TextEncoder().encode('portable-windows-package')
    const sha256 = createHash('sha256').update(packageBytes).digest('hex')
    const urls = [
      'https://slow.example.test/windows.zip',
      'https://mirror.example.test/windows.zip',
    ]
    const requests: string[] = []
    const manifest = createManifest({
      filename: 'CyberCode_1.2.0_windows_x64_portable.zip',
      size: packageBytes.byteLength,
      sha256,
      archiveType: 'zip',
      urls,
    })
    const service = createService({
      resolveRelease: async () => ({
        manifest,
        sourceUrl: 'https://example.test/portable.json',
      }),
      downloadStallTimeoutMs: 10,
      fetchImpl: async (input, init) => {
        const url = String(input)
        requests.push(url)
        if (url === urls[0]) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(init.signal?.reason),
              { once: true },
            )
          })
        }
        return new Response(packageBytes)
      },
    })
    const scan = await service.scan()
    const started = await service.start({
      destinationPath: destinationDir,
      projectIds: [],
      platforms: ['windows-x64'],
    })
    const completed = await waitForJob(service, started.id)

    expect(completed.status).toBe('completed')
    expect(requests).toEqual(urls)
  })

  test('rejects a destination inside a project being copied', async () => {
    const nestedDestination = join(projectDir, 'backup')
    await mkdir(nestedDestination)
    const service = createService()
    const scan = await service.scan()

    await expect(service.start({
      destinationPath: nestedDestination,
      includeApplications: false,
      projectIds: [scan.projects[0]!.id],
    })).rejects.toMatchObject<Partial<UsbMigrationError>>({
      code: 'DESTINATION_INSIDE_SOURCE',
    })
  })

  test('requires explicit confirmation before replacing an existing bundle', async () => {
    const service = createService()
    const scan = await service.scan()
    const first = await service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [scan.projects[0]!.id],
    })
    await waitForJob(service, first.id)

    await expect(service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [scan.projects[0]!.id],
    })).rejects.toMatchObject<Partial<UsbMigrationError>>({
      code: 'PORTABLE_BUNDLE_EXISTS',
    })

    const replacement = await service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      replaceExisting: true,
      projectIds: [scan.projects[0]!.id],
    })
    expect((await waitForJob(service, replacement.id)).status).toBe('completed')
  })

  test('updates a portable bundle when the bundle directory itself is selected', async () => {
    const service = createService()
    const scan = await service.scan()
    const first = await service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [scan.projects[0]!.id],
    })
    await waitForJob(service, first.id)

    const portableRoot = join(destinationDir, USB_PORTABLE_DIRECTORY_NAME)
    const replacement = await service.start({
      destinationPath: portableRoot,
      includeApplications: false,
      replaceExisting: true,
      projectIds: [scan.projects[0]!.id],
    })

    expect((await waitForJob(service, replacement.id)).status).toBe('completed')
    expect(await readFile(join(portableRoot, '.cybercode-portable'), 'utf8'))
      .toBe('cybercode-portable-v1\n')
  })

  test('creates an empty portable config directory for a first-run profile', async () => {
    await rm(configDir, { recursive: true, force: true })
    const service = createService()
    const started = await service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [],
    })
    const completed = await waitForJob(service, started.id)
    const portableConfigDir = join(
      destinationDir,
      USB_PORTABLE_DIRECTORY_NAME,
      'data',
      'config',
    )

    expect(completed.status).toBe('completed')
    await access(portableConfigDir)
    await access(join(portableConfigDir, 'portable-projects.json'))
  })

  test('excludes filesystem, user-profile, and config-owning roots from projects', async () => {
    const service = createService({
      discoverProjects: async () => [
        { path: projectDir, modifiedAt: '2026-07-30T12:00:00.000Z' },
        { path: homedir(), modifiedAt: '2026-07-30T11:00:00.000Z' },
        { path: parse(homedir()).root, modifiedAt: '2026-07-30T10:00:00.000Z' },
        { path: configDir, modifiedAt: '2026-07-30T09:00:00.000Z' },
        { path: join(root, 'home'), modifiedAt: '2026-07-30T08:00:00.000Z' },
      ],
    })

    const result = await service.scan()

    expect(result.projects).toHaveLength(1)
    expect(result.projects[0]?.path).toBe(await realpath(projectDir))
  })

  test('joins duplicate scans instead of reading the same trees twice', async () => {
    const scheduler = new BackgroundScheduler()
    let releaseScan!: () => void
    const gate = new Promise<void>(resolve => {
      releaseScan = resolve
    })
    let discoverCalls = 0
    const service = createService({
      backgroundScheduler: scheduler,
      discoverProjects: async (signal) => {
        discoverCalls += 1
        await gate
        signal?.throwIfAborted()
        return [{ path: projectDir, modifiedAt: '2026-07-30T12:00:00.000Z' }]
      },
    })

    const first = service.scan(true)
    const second = service.scan(true)
    await Bun.sleep(5)
    expect(discoverCalls).toBe(1)
    releaseScan()
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(secondResult.scannedAt).toBe(firstResult.scannedAt)
  })

  test('keeps a shared scan alive when one observer cancels', async () => {
    const scheduler = new BackgroundScheduler()
    let releaseScan!: () => void
    const gate = new Promise<void>(resolve => {
      releaseScan = resolve
    })
    let markStarted!: () => void
    const started = new Promise<void>(resolve => {
      markStarted = resolve
    })
    let discoverCalls = 0
    const service = createService({
      backgroundScheduler: scheduler,
      discoverProjects: async signal => {
        discoverCalls += 1
        markStarted()
        await gate
        signal?.throwIfAborted()
        return [{ path: projectDir, modifiedAt: '2026-07-30T12:00:00.000Z' }]
      },
    })
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = service.scan(true, firstController.signal)
    const second = service.scan(true, secondController.signal)
    await started

    firstController.abort(new DOMException('First observer left', 'AbortError'))
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect((scheduler.snapshot() as Array<{ type: string; status: string }>))
      .toContainEqual(expect.objectContaining({
        type: 'usb-migration-scan',
        status: 'running',
      }))

    releaseScan()
    expect((await second).projects).toHaveLength(1)
    expect(discoverCalls).toBe(1)
  })

  test('cancels shared scan work after the final observer leaves', async () => {
    const scheduler = new BackgroundScheduler()
    let scanBoundaries = 0
    let markStarted!: () => void
    const started = new Promise<void>(resolve => {
      markStarted = resolve
    })
    const service = createService({
      backgroundScheduler: scheduler,
      discoverProjects: async signal => {
        markStarted()
        if (!signal) throw new Error('Expected scan signal')
        while (!signal.aborted) {
          scanBoundaries += 1
          await Bun.sleep(1)
        }
        signal.throwIfAborted()
        return []
      },
    })
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = service.scan(true, firstController.signal)
    const second = service.scan(true, secondController.signal)
    await started

    firstController.abort(new DOMException('First observer left', 'AbortError'))
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    secondController.abort(new DOMException('Final observer left', 'AbortError'))
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    const countAfterCancel = scanBoundaries
    await Bun.sleep(10)
    expect(scanBoundaries).toBe(countAfterCancel)
    expect((scheduler.snapshot() as Array<{ type: string; status: string }>))
      .toContainEqual(expect.objectContaining({
        type: 'usb-migration-scan',
        status: 'cancelled',
      }))
  })

  test('stops scan work promptly after scheduler cancellation', async () => {
    const scheduler = new BackgroundScheduler()
    let scanBoundaries = 0
    const service = createService({
      backgroundScheduler: scheduler,
      discoverProjects: async (signal) => {
        if (!signal) throw new Error('Expected scan signal')
        while (!signal.aborted) {
          scanBoundaries += 1
          await Bun.sleep(1)
        }
        signal.throwIfAborted()
        return []
      },
    })

    const scan = service.scan(true)
    await Bun.sleep(5)
    const task = (scheduler.snapshot() as Array<{ id: string; type: string; status: string }>)
      .find(candidate => candidate.type === 'usb-migration-scan' && candidate.status === 'running')
    expect(task).toBeDefined()
    scheduler.cancel(task!.id, 'test cancellation')
    await expect(scan).rejects.toMatchObject({ name: 'AbortError' })
    const countAfterCancel = scanBoundaries
    await Bun.sleep(10)
    expect(scanBoundaries).toBe(countAfterCancel)
  })

  test('cancels start preflight when the requesting client disconnects', async () => {
    const scheduler = new BackgroundScheduler()
    const controller = new AbortController()
    let blockScan = true
    let markScanStarted!: () => void
    const scanStarted = new Promise<void>(resolve => {
      markScanStarted = resolve
    })
    const service = createService({
      backgroundScheduler: scheduler,
      discoverProjects: async signal => {
        if (!blockScan) return []
        if (!signal) throw new Error('Expected scan signal')
        markScanStarted()
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(signal.reason)
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
        })
        return []
      },
    })

    const starting = service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [],
    }, controller.signal)
    await scanStarted
    controller.abort(new DOMException('Client disconnected', 'AbortError'))

    await expect(starting).rejects.toMatchObject({ name: 'AbortError' })
    expect((scheduler.snapshot() as Array<{ type: string }>))
      .not.toContainEqual(expect.objectContaining({ type: 'usb-migration' }))

    blockScan = false
    const retried = await service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [],
    })
    expect((await waitForJob(service, retried.id)).status).toBe('completed')
    await scheduler.shutdown({ timeoutMs: 1_000 })
  })

  test('queues portable bundle writes behind the shared disk-write lane', async () => {
    const scheduler = new BackgroundScheduler({ limits: { 'disk-write': 1 } })
    let releaseBlocker!: () => void
    const blockerGate = new Promise<void>(resolve => {
      releaseBlocker = resolve
    })
    let markBlockerStarted!: () => void
    const blockerStarted = new Promise<void>(resolve => {
      markBlockerStarted = resolve
    })
    const blocker = scheduler.enqueue({
      type: 'test-disk-write',
      key: 'blocker',
      priority: 0,
      lane: 'disk-write',
      dedupe: 'drop',
      run: async () => {
        markBlockerStarted()
        await blockerGate
      },
    })

    try {
      await blockerStarted
      const service = createService({ backgroundScheduler: scheduler })
      const scan = await service.scan()
      const started = await service.start({
        destinationPath: destinationDir,
        includeApplications: false,
        projectIds: [scan.projects[0]!.id],
      })
      await Bun.sleep(10)

      expect(started).not.toHaveProperty('schedulerTaskId')
      expect(service.getJob(started.id).status).toBe('queued')
      expect((scheduler.snapshot() as Array<{ type: string; lane: string; status: string }>))
        .toContainEqual(expect.objectContaining({
          type: 'usb-migration',
          lane: 'disk-write',
          status: 'queued',
        }))

      releaseBlocker()
      await blocker.promise
      expect((await waitForJob(service, started.id)).status).toBe('completed')
    } finally {
      releaseBlocker()
      await scheduler.shutdown({ timeoutMs: 1_000 })
    }
  })

  test('reserves a destination before concurrent starts can both pass validation', async () => {
    let releaseScan!: () => void
    const scanGate = new Promise<void>(resolve => {
      releaseScan = resolve
    })
    let markScanStarted!: () => void
    const scanStarted = new Promise<void>(resolve => {
      markScanStarted = resolve
    })
    const service = createService({
      discoverProjects: async signal => {
        markScanStarted()
        await scanGate
        signal?.throwIfAborted()
        return []
      },
    })

    const first = service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [],
    })
    await scanStarted
    await expect(service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [],
    })).rejects.toMatchObject<Partial<UsbMigrationError>>({
      code: 'MIGRATION_ALREADY_RUNNING',
    })

    releaseScan()
    const started = await first
    expect((await waitForJob(service, started.id)).status).toBe('completed')
  })

  test('recovers a prepared portable bundle after interruption during commit', async () => {
    const jobId = 'recover-prepared'
    const canonicalDestination = await realpath(destinationDir)
    const portablePath = join(canonicalDestination, USB_PORTABLE_DIRECTORY_NAME)
    const stagingPath = join(canonicalDestination, `.${USB_PORTABLE_DIRECTORY_NAME}.tmp-${jobId}`)
    const backupPath = join(canonicalDestination, `.${USB_PORTABLE_DIRECTORY_NAME}.backup-${jobId}`)
    await writeTestPortableBundle(stagingPath, 'new-version')
    await writeTestPortableBundle(backupPath, 'old-version')
    const journalPath = await writeTestUsbJournal(configDir, {
      jobId,
      phase: 'committing',
      portablePath,
      stagingPath,
      backupPath,
      existingMoved: true,
    })

    const service = createService()
    await service.recoverInterruptedMigrations()

    expect(await readFile(join(portablePath, 'version.txt'), 'utf8')).toBe('new-version')
    await expect(access(stagingPath)).rejects.toThrow()
    await expect(access(backupPath)).rejects.toThrow()
    await expect(access(journalPath)).rejects.toThrow()
    expect(service.getRecoveryStatus()).toMatchObject({
      state: 'completed',
      totalJobs: 1,
      recoveredJobs: 1,
      waitingJobs: 0,
      failedJobs: 0,
    })
  })

  test('relocates an interrupted migration after a removable drive mount changes', async () => {
    const jobId = 'recover-relocated-drive'
    const relocatedParent = await realpath(destinationDir)
    const previousParent = join(root, 'old-drive', 'exports')
    const markerName = `.cybercode-usb-migration-${jobId}`
    const relocatedPortable = join(relocatedParent, USB_PORTABLE_DIRECTORY_NAME)
    const relocatedStaging = join(
      relocatedParent,
      `.${USB_PORTABLE_DIRECTORY_NAME}.tmp-${jobId}`,
    )
    await writeTestPortableBundle(relocatedStaging, 'relocated-version')
    await writeFile(join(relocatedParent, markerName), `${jobId}\n`)
    await mkdir(previousParent, { recursive: true })
    await writeFile(join(previousParent, 'different-drive.txt'), 'leave untouched')
    const journalPath = await writeTestUsbJournal(configDir, {
      schemaVersion: 2,
      jobId,
      phase: 'committing',
      portablePath: join(previousParent, USB_PORTABLE_DIRECTORY_NAME),
      stagingPath: join(previousParent, `.${USB_PORTABLE_DIRECTORY_NAME}.tmp-${jobId}`),
      backupPath: join(previousParent, `.${USB_PORTABLE_DIRECTORY_NAME}.backup-${jobId}`),
      existingMoved: false,
      volumeRelativeParent: 'exports',
      volumeMarkerName: markerName,
    })
    const service = createService({
      recoveryParentCandidates: async () => [relocatedParent],
    })

    await service.recoverInterruptedMigrations()

    expect(await readFile(join(relocatedPortable, 'version.txt'), 'utf8'))
      .toBe('relocated-version')
    expect(await readFile(join(previousParent, 'different-drive.txt'), 'utf8'))
      .toBe('leave untouched')
    await expect(access(join(relocatedParent, markerName))).rejects.toThrow()
    await expect(access(journalPath)).rejects.toThrow()
    expect(service.getRecoveryStatus()).toMatchObject({
      state: 'completed',
      recoveredJobs: 1,
      waitingJobs: 0,
    })
  })

  test('runs interrupted recovery in the disk-write lane with the target volume lock', async () => {
    const scheduler = new BackgroundScheduler({ limits: { 'disk-write': 2 } })
    const canonicalDestination = await realpath(destinationDir)
    const resourceKey = `usb-volume:${parse(canonicalDestination).root}`
    let releaseBlocker!: () => void
    const blockerGate = new Promise<void>(resolve => {
      releaseBlocker = resolve
    })
    let markBlockerStarted!: () => void
    const blockerStarted = new Promise<void>(resolve => {
      markBlockerStarted = resolve
    })
    const blocker = scheduler.enqueue({
      type: 'test-volume-write',
      key: 'volume-blocker',
      priority: 0,
      lane: 'disk-write',
      resourceKey,
      dedupe: 'drop',
      run: async () => {
        markBlockerStarted()
        await blockerGate
      },
    })
    await blockerStarted

    const jobId = 'recover-lane'
    const portablePath = join(canonicalDestination, USB_PORTABLE_DIRECTORY_NAME)
    const stagingPath = join(canonicalDestination, `.${USB_PORTABLE_DIRECTORY_NAME}.tmp-${jobId}`)
    const backupPath = join(canonicalDestination, `.${USB_PORTABLE_DIRECTORY_NAME}.backup-${jobId}`)
    await writeTestPortableBundle(stagingPath, 'new-version')
    await writeTestUsbJournal(configDir, {
      jobId,
      phase: 'committing',
      portablePath,
      stagingPath,
      backupPath,
      existingMoved: false,
    })
    const service = createService({ backgroundScheduler: scheduler })
    const recovery = service.recoverInterruptedMigrations()
    expect(service.getRecoveryStatus().state).toBe('running')
    await Bun.sleep(10)

    expect((scheduler.snapshot() as Array<{
      type: string
      lane: string
      resourceKey?: string
      status: string
    }>)).toContainEqual(expect.objectContaining({
      type: 'usb-migration-recovery',
      lane: 'disk-write',
      resourceKey,
      status: 'queued',
    }))
    await expect(access(portablePath)).rejects.toThrow()

    releaseBlocker()
    await blocker.promise
    await recovery
    expect(await readFile(join(portablePath, 'version.txt'), 'utf8')).toBe('new-version')
    await scheduler.shutdown({ timeoutMs: 1_000 })
  })

  test('ignores forged journal paths without deleting arbitrary files', async () => {
    const canonicalDestination = await realpath(destinationDir)
    const jobId = 'forged-paths'
    const portablePath = join(canonicalDestination, USB_PORTABLE_DIRECTORY_NAME)
    const sentinel = join(root, 'must-not-delete')
    await writeTestPortableBundle(portablePath, 'current-version')
    await mkdir(sentinel, { recursive: true })
    await writeFile(join(sentinel, 'sentinel.txt'), 'keep me')
    const journalPath = await writeTestUsbJournal(configDir, {
      jobId,
      phase: 'committing',
      portablePath,
      stagingPath: sentinel,
      backupPath: join(
        canonicalDestination,
        `.${USB_PORTABLE_DIRECTORY_NAME}.backup-${jobId}`,
      ),
      existingMoved: false,
    })

    const service = createService()
    await service.recoverInterruptedMigrations()

    expect(await readFile(join(sentinel, 'sentinel.txt'), 'utf8')).toBe('keep me')
    await access(journalPath)
    expect(service.getRecoveryStatus()).toMatchObject({
      state: 'failed',
      totalJobs: 1,
      failedJobs: 1,
    })
  })

  test('rejects recovery targets at filesystem, home, and config boundaries', async () => {
    const unsafeParents = [
      parse(destinationDir).root,
      homedir(),
      configDir,
    ]
    const journals: string[] = []
    for (const [index, parent] of unsafeParents.entries()) {
      const jobId = `unsafe-boundary-${index}`
      journals.push(await writeTestUsbJournal(configDir, {
        jobId,
        phase: 'interrupted',
        portablePath: join(parent, USB_PORTABLE_DIRECTORY_NAME),
        stagingPath: join(parent, `.${USB_PORTABLE_DIRECTORY_NAME}.tmp-${jobId}`),
        backupPath: join(parent, `.${USB_PORTABLE_DIRECTORY_NAME}.backup-${jobId}`),
        existingMoved: false,
      }))
    }

    await createService().recoverInterruptedMigrations()

    for (const journal of journals) await access(journal)
  })

  test('does not run recovery against a target owned by an active migration', async () => {
    const scheduler = new BackgroundScheduler()
    let releaseCopy!: () => void
    const copyGate = new Promise<void>(resolve => {
      releaseCopy = resolve
    })
    let markCopyPaused!: () => void
    const copyPaused = new Promise<void>(resolve => {
      markCopyPaused = resolve
    })
    let paused = false
    const service = createService({
      backgroundScheduler: scheduler,
      copyChunkHook: async () => {
        if (paused) return
        paused = true
        markCopyPaused()
        await copyGate
      },
    })
    const scan = await service.scan()
    const started = await service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [scan.projects[0]!.id],
    })
    await copyPaused

    const canonicalDestination = await realpath(destinationDir)
    const recoveryJobId = 'must-wait-for-active'
    const recoveryStaging = join(
      canonicalDestination,
      `.${USB_PORTABLE_DIRECTORY_NAME}.tmp-${recoveryJobId}`,
    )
    await writeTestPortableBundle(recoveryStaging, 'stale-version')
    const recoveryJournal = await writeTestUsbJournal(configDir, {
      jobId: recoveryJobId,
      phase: 'committing',
      portablePath: join(canonicalDestination, USB_PORTABLE_DIRECTORY_NAME),
      stagingPath: recoveryStaging,
      backupPath: join(
        canonicalDestination,
        `.${USB_PORTABLE_DIRECTORY_NAME}.backup-${recoveryJobId}`,
      ),
      existingMoved: false,
    })

    await service.recoverInterruptedMigrations()
    await access(recoveryStaging)
    await access(recoveryJournal)
    expect((scheduler.snapshot() as Array<{ type: string }>).filter(
      task => task.type === 'usb-migration-recovery',
    )).toHaveLength(0)

    releaseCopy()
    expect((await waitForJob(service, started.id)).status).toBe('completed')
  })

  test('restores the previous portable bundle when interrupted staging is invalid', async () => {
    const jobId = 'recover-backup'
    const canonicalDestination = await realpath(destinationDir)
    const portablePath = join(canonicalDestination, USB_PORTABLE_DIRECTORY_NAME)
    const stagingPath = join(canonicalDestination, `.${USB_PORTABLE_DIRECTORY_NAME}.tmp-${jobId}`)
    const backupPath = join(canonicalDestination, `.${USB_PORTABLE_DIRECTORY_NAME}.backup-${jobId}`)
    await mkdir(stagingPath, { recursive: true })
    await writeFile(join(stagingPath, 'partial.txt'), 'incomplete')
    await writeTestPortableBundle(backupPath, 'old-version')
    const journalPath = await writeTestUsbJournal(configDir, {
      jobId,
      phase: 'committing',
      portablePath,
      stagingPath,
      backupPath,
      existingMoved: true,
    })

    await createService().recoverInterruptedMigrations()

    expect(await readFile(join(portablePath, 'version.txt'), 'utf8')).toBe('old-version')
    await expect(access(stagingPath)).rejects.toThrow()
    await expect(access(backupPath)).rejects.toThrow()
    await expect(access(journalPath)).rejects.toThrow()
  })

  test('keeps recovery material when the removable destination is offline', async () => {
    const jobId = 'recover-offline'
    const portablePath = join(root, 'offline-usb', USB_PORTABLE_DIRECTORY_NAME)
    const stagingPath = join(root, 'offline-usb', `.${USB_PORTABLE_DIRECTORY_NAME}.tmp-${jobId}`)
    const backupPath = join(root, 'offline-usb', `.${USB_PORTABLE_DIRECTORY_NAME}.backup-${jobId}`)
    const journalPath = await writeTestUsbJournal(configDir, {
      jobId,
      phase: 'interrupted',
      portablePath,
      stagingPath,
      backupPath,
      existingMoved: false,
    })

    const service = createService()
    await service.recoverInterruptedMigrations()

    await access(journalPath)
    expect(service.getRecoveryStatus()).toMatchObject({
      state: 'waiting-for-drive',
      totalJobs: 1,
      waitingJobs: 1,
      failedJobs: 0,
    })
  })

  test('cancels a large file copy at a deterministic chunk boundary', async () => {
    const largeFile = join(projectDir, 'large.bin')
    await writeFile(largeFile, Buffer.alloc(2 * 1024 * 1024 + 257, 7))
    let releaseChunk!: () => void
    const chunkGate = new Promise<void>(resolve => {
      releaseChunk = resolve
    })
    let markChunkPaused!: () => void
    const chunkPaused = new Promise<void>(resolve => {
      markChunkPaused = resolve
    })
    let capturedChunk: { bytesCopied: number; chunkBytes: number } | null = null
    const service = createService({
      copyChunkHook: async event => {
        if (event.sourcePath !== await realpath(largeFile) || capturedChunk) return
        capturedChunk = {
          bytesCopied: event.bytesCopied,
          chunkBytes: event.chunkBytes,
        }
        markChunkPaused()
        await chunkGate
      },
    })
    const scan = await service.scan()
    const started = await service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [scan.projects[0]!.id],
    })
    await chunkPaused

    expect(capturedChunk).toEqual({
      bytesCopied: 1024 * 1024,
      chunkBytes: 1024 * 1024,
    })
    expect(service.getJob(started.id).processedBytes).toBeGreaterThanOrEqual(1024 * 1024)
    service.cancel(started.id)
    releaseChunk()

    expect((await waitForJob(service, started.id)).status).toBe('cancelled')
    await expect(access(join(
      destinationDir,
      `.${USB_PORTABLE_DIRECTORY_NAME}.tmp-${started.id}`,
    ))).rejects.toThrow()
    await expect(access(join(destinationDir, USB_PORTABLE_DIRECTORY_NAME)))
      .rejects.toThrow()
  })

  test('graceful shutdown cancels and waits for an active package download', async () => {
    const packageBytes = new TextEncoder().encode('never-delivered-package')
    const manifest = createManifest({
      filename: 'CyberCode_1.2.0_windows_x64_portable.zip',
      size: packageBytes.byteLength,
      sha256: createHash('sha256').update(packageBytes).digest('hex'),
      archiveType: 'zip',
      urls: ['https://slow.example.test/windows.zip'],
    })
    let markDownloadStarted!: () => void
    const downloadStarted = new Promise<void>(resolve => {
      markDownloadStarted = resolve
    })
    const service = createService({
      resolveRelease: async () => ({
        manifest,
        sourceUrl: 'https://example.test/portable.json',
      }),
      fetchImpl: async (_input, init) => {
        markDownloadStarted()
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true },
          )
        })
      },
    })
    const scan = await service.scan()
    const started = await service.start({
      destinationPath: destinationDir,
      projectIds: [],
      platforms: ['windows-x64'],
    })
    await downloadStarted

    await service.shutdown({ timeoutMs: 1_000 })

    expect(service.getJob(started.id).status).toBe('cancelled')
    await expect(access(join(
      destinationDir,
      `.${USB_PORTABLE_DIRECTORY_NAME}.tmp-${started.id}`,
    ))).rejects.toThrow()
  })

  function createService(overrides: ConstructorParameters<typeof UsbMigrationService>[0] = {}) {
    return new UsbMigrationService({
      configDir,
      discoverProjects: async () => [{
        path: projectDir,
        modifiedAt: '2026-07-30T12:00:00.000Z',
        sessionCount: 2,
      }],
      resolveRelease: async () => null,
      availableBytes: async () => Number.MAX_SAFE_INTEGER,
      verifyAssetSignature: () => true,
      ...overrides,
    })
  }
})

async function writeTestPortableBundle(root: string, version: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, USB_PORTABLE_MARKER), 'cybercode-portable-v1\n')
  await writeFile(join(root, 'version.txt'), version)
}

async function writeTestUsbJournal(
  configDir: string,
  input: {
    schemaVersion?: 1 | 2
    jobId: string
    phase: 'committing' | 'interrupted'
    portablePath: string
    stagingPath: string
    backupPath: string
    existingMoved: boolean
    volumeRelativeParent?: string
    volumeMarkerName?: string
  },
): Promise<string> {
  const directory = join(
    configDir,
    'tmp',
    'usb-migration-journal',
    input.jobId,
  )
  await mkdir(directory, { recursive: true })
  const journalPath = join(directory, `00000001-${input.phase}.json`)
  await writeFile(journalPath, `${JSON.stringify({
    schemaVersion: input.schemaVersion ?? 1,
    sequence: 1,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...input,
  })}\n`)
  return journalPath
}

async function waitForJob(
  service: UsbMigrationService,
  jobId: string,
): Promise<UsbMigrationJob> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const job = service.getJob(jobId)
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for USB migration job ${jobId}`)
}

function createManifest(
  windowsAsset: Omit<
    PortableReleaseManifest['platforms']['windows-x64'],
    'signature'
  > & Partial<Pick<
    PortableReleaseManifest['platforms']['windows-x64'],
    'signature'
  >>,
): PortableReleaseManifest {
  const placeholder = {
    filename: 'placeholder.bin',
    size: 1,
    sha256: '0'.repeat(64),
    signature: 'dGVzdA==',
    archiveType: 'zip' as const,
  }
  return {
    schemaVersion: 2,
    version: '1.2.0',
    generatedAt: '2026-07-30T12:00:00.000Z',
    platforms: {
      'macos-arm64': { ...placeholder, archiveType: 'app-tar-gz' },
      'macos-x64': { ...placeholder, archiveType: 'app-tar-gz' },
      'windows-x64': { signature: 'dGVzdA==', ...windowsAsset },
      'linux-x64': { ...placeholder, archiveType: 'appimage' },
    },
  }
}
