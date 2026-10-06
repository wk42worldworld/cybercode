/**
 * Start a piped/background command without creating a Windows console window.
 * Hiding the compiled sidecar's own console does not apply to its children.
 * Interactive terminals must keep using their PTY launcher instead.
 */
export function spawnBackground<
  const In extends Bun.SpawnOptions.Writable = 'ignore',
  const Out extends Bun.SpawnOptions.Readable = 'pipe',
  const Err extends Bun.SpawnOptions.Readable = 'inherit',
>(
  command: string[],
  options?: Bun.SpawnOptions.SpawnOptions<In, Out, Err>,
): Bun.Subprocess<In, Out, Err> {
  return Bun.spawn(command, { ...options, windowsHide: true })
}
