export const line = 'export const value: number = 123; // deterministic TypeScript fixture\n'

export function fixture(mib) {
  const bytes = mib * 1024 * 1024
  return line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes)
}
