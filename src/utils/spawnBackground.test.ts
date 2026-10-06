import { describe, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnBackground } from './spawnBackground.js'

describe('background processes', () => {
  test('preserves piped input, output, environment, cwd and nonzero exits', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'cybercode-background-'))
    try {
      const child = spawnBackground([process.execPath, '-e', `
        const input = await Bun.stdin.text()
        console.log(JSON.stringify({ input, cwd: process.cwd(), marker: process.env.PROCESS_TEST_MARKER }))
        console.error('diagnostic')
        process.exitCode = 7
      `], {
        cwd,
        env: { ...process.env, PROCESS_TEST_MARKER: 'background' },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      child.stdin.write('测试 input\n')
      child.stdin.end()
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(JSON.parse(stdout)).toEqual({ input: '测试 input\n', cwd: await realpath(cwd), marker: 'background' })
      expect(stderr.trim()).toBe('diagnostic')
      expect(code).toBe(7)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('does not allow runtime Bun subprocesses to bypass the background launcher', async () => {
    const root = resolve(import.meta.dir, '..')
    const bypasses: string[] = []
    for await (const file of new Bun.Glob('**/*.{ts,tsx}').scan(root)) {
      if (/\.(test|spec)\./.test(file) || /(^|[/\\])(__tests__|__fixtures__)([/\\]|$)/.test(file)) continue
      if (file.replaceAll('\\', '/') === 'utils/spawnBackground.ts') continue
      if (/\bBun\.spawn(?:Sync)?\s*\(/.test(await Bun.file(join(root, file)).text())) bypasses.push(file)
    }
    expect(bypasses).toEqual([])
  })

  test.skipIf(process.platform !== 'win32')('GUI sidecar children have no console window (with an unfixed control)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cybercode-console-'))
    try {
      const outfile = join(dir, 'gui-sidecar.exe')
      const resultPath = join(dir, 'console-result.json')
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, '__fixtures__/windowsConsole.ts')],
        compile: { outfile, windows: { hideConsole: true } },
      })
      expect(build.success).toBe(true)
      const child = spawnBackground([outfile, resultPath], {
        stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: 45_000,
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ])
      expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: '', stderr: '' })
      const result = await Bun.file(resultPath).json()
      console.log('Windows GUI subprocess probe:', JSON.stringify(result))
      expect(result.error).toBeUndefined()
      expect(result.visible.code).toBe(7)
      expect(result.visible.consoleWindow).toMatch(/^[1-9]\d*$/)
      expect(result.hidden).toEqual({ consoleWindow: '0', stderr: 'probe stderr', code: 7 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 90_000)
})
