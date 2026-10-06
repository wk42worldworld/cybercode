import { spawnBackground } from '../spawnBackground.js'

// Compiled as a GUI executable by spawnBackground.test.ts, just like the
// desktop sidecar. An ordinary console-hosted test would mask this regression.
const script = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
[Console]::Write([ConsoleProbe]::GetConsoleWindow().ToInt64())
[Console]::Error.Write('probe stderr')
exit 7
`

const commands = {
  powershell: ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
  python: ['python.exe', '-c', "import ctypes, sys; sys.stdout.write(str(ctypes.windll.kernel32.GetConsoleWindow())); sys.stderr.write('probe stderr'); sys.exit(7)"],
}
const options = { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } as const

async function probe(command: string[], hidden: boolean) {
  const child = hidden ? spawnBackground(command, options) : Bun.spawn(command, options)
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { consoleWindow: stdout.trim(), stderr, code }
}

try {
  // Negative control proves that this test environment exposes the old bug.
  const results: Record<string, unknown> = {}
  for (const [name, command] of Object.entries(commands)) {
    results[name] = { visible: await probe(command, false), hidden: await probe(command, true) }
  }
  await Bun.write(process.argv[2], JSON.stringify(results))
} catch (error) {
  await Bun.write(process.argv[2], JSON.stringify({ error: String(error) }))
  process.exitCode = 1
}
