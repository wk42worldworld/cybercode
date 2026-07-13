import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const RTK_VERSION = '0.43.0'
const RTK_TAG = `v${RTK_VERSION}`
const CHECKSUMS: Record<string, string> = {
  'rtk-aarch64-apple-darwin.tar.gz': '8a17e49acbd378997eb21d0eb6f7f861111f35b4fc9b1c74edf4c7448e576c65',
  'rtk-aarch64-unknown-linux-gnu.tar.gz': '5519f7ca12e5c143a609f0d28a0a77b97413a8dce31c2681f1a41c24519a8731',
  'rtk-x86_64-apple-darwin.tar.gz': 'a85f60e2637811be68366208b8d8b9c5ba1b748cb5df4477ab20cd73d3c5d9f8',
  'rtk-x86_64-pc-windows-msvc.zip': '7c5e4a2ef816a4d4ed947ddd74ca3df851fc39ea87d49a3ca2bf3abc515a016b',
  'rtk-x86_64-unknown-linux-musl.tar.gz': 'ff8a1e7766496e175291a85aeca1dc97c9ff6df33e51e5893d1fbc78fea2a609',
}
const desktopRoot = path.resolve(import.meta.dir, '..')
const resourceDir = path.join(desktopRoot, 'src-tauri', 'resources', 'rtk')
const binariesDir = path.join(desktopRoot, 'src-tauri', 'binaries')
const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || ''

const archiveName = archiveForTarget(targetTriple)
const expectedChecksum = CHECKSUMS[archiveName]
const releaseBase = `https://github.com/rtk-ai/rtk/releases/download/${RTK_TAG}`
const binaryName = targetTriple.includes('windows') ? 'rtk.exe' : 'rtk'
const externalBinaryPath = path.join(
  binariesDir,
  `rtk-${targetTriple}${targetTriple.includes('windows') ? '.exe' : ''}`,
)

await prepareRuntime()

async function prepareRuntime() {
  if (hasReusableRuntime()) {
    await stageExternalBinary()
    console.log(`[prepare-rtk] reusing RTK ${RTK_VERSION} for ${targetTriple}`)
    return
  }

  const temporaryDir = `${resourceDir}.preparing-${process.pid}-${Date.now()}`
  const backupDir = `${resourceDir}.backup-${process.pid}-${Date.now()}`
  const archivePath = path.join(temporaryDir, archiveName)

  await rm(temporaryDir, { recursive: true, force: true })
  await rm(backupDir, { recursive: true, force: true })
  await mkdir(temporaryDir, { recursive: true })

  try {
    await writeFile(path.join(temporaryDir, '.gitignore'), '*\n!.gitignore\n')

    const archive = await download(`${releaseBase}/${archiveName}`)
    const actualChecksum = createHash('sha256').update(archive).digest('hex')
    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        `[prepare-rtk] checksum mismatch for ${archiveName}: expected ${expectedChecksum}, got ${actualChecksum}`,
      )
    }
    await writeFile(archivePath, archive)

    const extract = Bun.spawn(['tar', '-xf', archivePath, '-C', temporaryDir], {
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const extractExit = await extract.exited
    if (extractExit !== 0) {
      throw new Error(`[prepare-rtk] failed to extract ${archiveName} (exit ${extractExit})`)
    }
    await rm(archivePath, { force: true })

    const binaryPath = path.join(temporaryDir, binaryName)
    if (!existsSync(binaryPath)) {
      throw new Error(`[prepare-rtk] archive did not contain ${binaryName}`)
    }
    if (!targetTriple.includes('windows')) await chmod(binaryPath, 0o755)

    const license = await download(`https://raw.githubusercontent.com/rtk-ai/rtk/${RTK_TAG}/LICENSE`)
    await writeFile(path.join(temporaryDir, 'LICENSE'), license)
    await writeFile(path.join(temporaryDir, 'manifest.json'), `${JSON.stringify({
      name: 'RTK',
      version: RTK_VERSION,
      source: 'https://github.com/rtk-ai/rtk',
      license: 'Apache-2.0',
      targetTriple,
      sha256: actualChecksum,
    }, null, 2)}\n`)

    if (existsSync(resourceDir)) await rename(resourceDir, backupDir)
    try {
      await rename(temporaryDir, resourceDir)
    } catch (error) {
      if (!existsSync(resourceDir) && existsSync(backupDir)) {
        await rename(backupDir, resourceDir)
      }
      throw error
    }
    await rm(backupDir, { recursive: true, force: true })
    await stageExternalBinary()
    console.log(`[prepare-rtk] RTK ${RTK_VERSION} prepared for ${targetTriple}`)
  } finally {
    await rm(temporaryDir, { recursive: true, force: true })
    await rm(backupDir, { recursive: true, force: true })
  }
}

async function stageExternalBinary() {
  const sourcePath = path.join(resourceDir, binaryName)
  const temporaryPath = `${externalBinaryPath}.preparing-${process.pid}-${Date.now()}`

  await mkdir(binariesDir, { recursive: true })
  await rm(temporaryPath, { force: true })

  try {
    await copyFile(sourcePath, temporaryPath)
    if (!targetTriple.includes('windows')) await chmod(temporaryPath, 0o755)
    await rm(externalBinaryPath, { force: true })
    await rename(temporaryPath, externalBinaryPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

function hasReusableRuntime() {
  const binaryPath = path.join(resourceDir, binaryName)
  const manifestPath = path.join(resourceDir, 'manifest.json')
  if (!existsSync(binaryPath) || !existsSync(manifestPath)) return false

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      version?: string
      targetTriple?: string
      sha256?: string
    }
    return manifest.version === RTK_VERSION
      && manifest.targetTriple === targetTriple
      && manifest.sha256 === expectedChecksum
  } catch {
    return false
  }
}

async function download(url: string) {
  try {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok) {
      throw new Error(`[prepare-rtk] download failed (${response.status}): ${url}`)
    }
    return Buffer.from(await response.arrayBuffer())
  } catch (error) {
    console.warn(`[prepare-rtk] Bun download failed; retrying with curl: ${errorMessage(error)}`)
    return downloadWithCurl(url)
  }
}

async function downloadWithCurl(url: string) {
  const process = Bun.spawn(
    ['curl', '--fail', '--location', '--silent', '--show-error', url],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const bodyPromise = new Response(process.stdout).arrayBuffer()
  const errorPromise = new Response(process.stderr).text()
  const exitCode = await process.exited
  const [body, stderr] = await Promise.all([bodyPromise, errorPromise])
  if (exitCode !== 0) {
    throw new Error(`[prepare-rtk] curl download failed (exit ${exitCode}): ${stderr.trim() || url}`)
  }
  return Buffer.from(body)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function archiveForTarget(triple: string) {
  if (triple === 'aarch64-apple-darwin') return 'rtk-aarch64-apple-darwin.tar.gz'
  if (triple === 'x86_64-apple-darwin') return 'rtk-x86_64-apple-darwin.tar.gz'
  if (triple === 'x86_64-pc-windows-msvc') return 'rtk-x86_64-pc-windows-msvc.zip'
  if (triple === 'x86_64-unknown-linux-gnu') return 'rtk-x86_64-unknown-linux-musl.tar.gz'
  if (triple === 'aarch64-unknown-linux-gnu') return 'rtk-aarch64-unknown-linux-gnu.tar.gz'
  throw new Error(`[prepare-rtk] unsupported target triple: ${triple || '(empty)'}`)
}
