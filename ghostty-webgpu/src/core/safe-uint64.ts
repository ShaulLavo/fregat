import { createGhosttyError } from './error.js'

export function decodeSafeUint64(
  view: DataView,
  pointer: number,
  name: string,
  operation: string,
): number {
  const value = view.getBigUint64(pointer, true)
  if (value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value)
  throw createGhosttyError(operation, `${name} exceeds Number.MAX_SAFE_INTEGER`)
}
