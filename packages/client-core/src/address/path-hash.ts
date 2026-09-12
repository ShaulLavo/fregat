export function updateStableHashCode(hash: number, code: number): number {
  return Math.imul(hash ^ code, 0x01000193)
}

// Keep the raw accumulator signed; each consumer owns its persisted encoding.
export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash = updateStableHashCode(hash, value.charCodeAt(index))
  }
  return hash
}

// FNV-1a-32 supplies a stable suffix when address slugs collide.
export function stablePathHash(value: string) {
  return (fnv1a32(value) >>> 0).toString(16).padStart(8, '0')
}
