import { spawnBackground } from '../spawnBackground.js'

// Compiled as a GUI executable by spawnBackground.test.ts, just like the
// desktop sidecar. An ordinary console-hosted test would mask this regression.
const script = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
[Console]::Write([ConsoleProbe]::GetConsoleWindow().ToInt64())
[Console]::Error.Write('probe stderr')
exit 7
`

const command = ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script]
const options = { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } as const

async function probe(hidden: boolean) {
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
  const visible = await probe(false)
  const hidden = await probe(true)
  await Bun.write(process.argv[2], JSON.stringify({ visible, hidden }))
} catch (error) {
  await Bun.write(process.argv[2], JSON.stringify({ error: String(error) }))
  process.exitCode = 1
}
