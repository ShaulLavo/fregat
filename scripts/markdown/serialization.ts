export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, ordered(entry)]),
  )
}

export function stable(value: unknown) {
  return JSON.stringify(ordered(value))
}

export function encoded(value: unknown) {
  return JSON.stringify(value, null, 2) + '\n'
}
