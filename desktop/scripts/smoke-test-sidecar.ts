import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { detectHostTriple } from './sidecarTarget'

const desktopRoot = path.resolve(import.meta.dir, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const targetTriple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  process.env.CARGO_BUILD_TARGET ||
  (await detectHostTriple(repoRoot))
const executableBase = path.join(
  desktopRoot,
  'src-tauri',
  'binaries',
  `claude-sidecar-${targetTriple}`,
)
const executable = [executableBase, `${executableBase}.exe`].find(existsSync)

if (!executable) {
  throw new Error(`[sidecar-smoke] Missing sidecar executable: ${executableBase}`)
}

const temporaryHome = await mkdtemp(path.join(tmpdir(), 'cybercode-sidecar-smoke-'))
const port = await reserveLocalPort()
const authToken = 'cybercode-release-smoke-test'
const child = Bun.spawn(
  [
    executable,
    'server',
    '--auth-required',
    '--app-root',
    repoRoot,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
  ],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: temporaryHome,
      USERPROFILE: temporaryHome,
      CYBER_CONFIG_DIR: path.join(temporaryHome, '.cyber'),
      CLAUDE_CONFIG_DIR: path.join(temporaryHome, '.cyber'),
      SERVER_AUTH_TOKEN: authToken,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  },
)

const stdoutPromise = new Response(child.stdout).text()
const stderrPromise = new Response(child.stderr).text()
let exited = false
let exitCode: number | null = null
const exitPromise = child.exited.then(code => {
  exited = true
  exitCode = code
  return code
})
let healthy = false

try {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && !exited) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(750),
      })
      if (response.ok) {
        const payload = (await response.json()) as { status?: string }
        healthy = payload.status === 'ok'
        if (healthy) break
      }
    } catch {
      // The server is still importing its bundled modules.
    }
    await Bun.sleep(150)
  }
} finally {
  if (!exited) child.kill()
  await exitPromise
  await rm(temporaryHome, { recursive: true, force: true })
}

const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
if (!healthy) {
  throw new Error(
    [
      `[sidecar-smoke] Server failed to become healthy (exit ${exitCode ?? 'unknown'})`,
      stdout.trim() ? `[stdout]\n${stdout.trim()}` : '',
      stderr.trim() ? `[stderr]\n${stderr.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  )
}

console.log(`[sidecar-smoke] ${targetTriple} server reached /health successfully`)

async function reserveLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('[sidecar-smoke] Could not reserve a local port'))
        return
      }
      server.close(error => {
        if (error) reject(error)
        else resolve(address.port)
      })
    })
  })
}
