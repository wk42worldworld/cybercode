/**
 * Tiny class-name combiner used across the UI surface.
 * Falsy values are skipped; arrays are flattened.
 */
type Value = string | number | false | null | undefined
export function cn(...inputs: (Value | Value[])[]): string {
  const out: string[] = []
  for (const input of inputs) {
    if (!input) continue
    if (Array.isArray(input)) {
      for (const x of input) if (x) out.push(String(x))
    } else {
      out.push(String(input))
    }
  }
  return out.join(' ')
}
