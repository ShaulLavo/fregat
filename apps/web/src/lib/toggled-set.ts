/** A copy of `set` with `value` flipped: added when absent, removed when present. */
export function toggledSet<Value>(set: ReadonlySet<Value>, value: Value): ReadonlySet<Value> {
  const next = new Set(set)
  if (next.has(value)) {
    next.delete(value)
    return next
  }

  next.add(value)
  return next
}
