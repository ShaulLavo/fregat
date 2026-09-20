import { isRecord } from '@workspace/utils/objects'

/**
 * Structural equality for JSON-shaped values.
 *
 * Exists so the resolver can hand back the *previous* value when a re-resolve
 * produces an equal one. Every settings value arrives by parsing JSON, so the
 * cases are exactly: primitives, arrays, and plain objects — no dates, maps,
 * cycles, or class instances to worry about.
 *
 * `JSON.stringify` comparison would be shorter and wrong: it is key-order
 * sensitive, and key order changes whenever someone hand-edits the file, which
 * is precisely the moment this is asked to say "nothing changed".
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) return arraysEqual(a, b)
  if (isRecord(a) && isRecord(b)) return recordsEqual(a, b)

  return false
}

function arraysEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false

  return a.every((item, index) => jsonEqual(item, b[index]))
}

function recordsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false

  // `hasOwn` rather than a truthiness check: an explicit `undefined` and a
  // missing key are different documents, and only one of them round-trips.
  return keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
}
