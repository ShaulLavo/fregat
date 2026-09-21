/** Bound traversal before the writer checks exact escaped JSON bytes. */
export function fitsCacheBudget(value: unknown, maxBytes: number, maxNodes = 20_000): boolean {
  const pending: unknown[] = [value]
  let nodes = 0
  let bytes = 0
  while (pending.length) {
    const current = pending.pop()
    nodes += 1
    if (nodes > maxNodes) return false
    if (typeof current === 'string') bytes += current.length * 2
    if (bytes > maxBytes) return false
    if (!current || typeof current !== 'object') continue
    if (Array.isArray(current) && current.length + pending.length > maxNodes - nodes) return false
    const fields = current as Record<string, unknown>
    for (const key in fields) {
      if (!Object.hasOwn(fields, key)) continue
      bytes += key.length * 2
      if (bytes > maxBytes || pending.length >= maxNodes - nodes) return false
      pending.push(fields[key])
    }
  }
  return true
}
