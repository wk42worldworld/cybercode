export async function detectHostTriple(cwd = process.cwd()): Promise<string> {
  const proc = Bun.spawn(['rustc', '-vV'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    throw new Error(`[sidecar-target] rustc -vV failed: ${stderr || stdout}`)
  }

  const hostLine = stdout
    .split('\n')
    .map(line => line.trim())
    .find(line => line.startsWith('host: '))

  if (!hostLine) {
    throw new Error('[sidecar-target] Could not detect Rust host triple')
  }

  return hostLine.replace('host: ', '')
}

export function mapTargetTripleToBun(triple: string) {
  switch (triple) {
    case 'aarch64-apple-darwin':
      return 'bun-darwin-arm64'
    case 'x86_64-apple-darwin':
      return 'bun-darwin-x64'
    case 'x86_64-pc-windows-msvc':
      // Bun recommends the baseline runtime when distributed Windows binaries
      // report "Illegal instruction". It still runs on modern x64 CPUs.
      return 'bun-windows-x64-baseline'
    case 'aarch64-pc-windows-msvc':
      return 'bun-windows-arm64'
    case 'x86_64-unknown-linux-gnu':
      return 'bun-linux-x64-baseline'
    case 'aarch64-unknown-linux-gnu':
      return 'bun-linux-arm64'
    case 'x86_64-unknown-linux-musl':
      return 'bun-linux-x64-musl'
    case 'aarch64-unknown-linux-musl':
      return 'bun-linux-arm64-musl'
    default:
      throw new Error(`[sidecar-target] Unsupported target triple: ${triple}`)
  }
}
