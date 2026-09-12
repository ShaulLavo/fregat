export function pruneScopedRecord<T>(
  entries: Readonly<Record<string, T>>,
  prune: (entries: Readonly<Record<string, T>>) => Readonly<Record<string, T>>,
): Record<string, T> {
  const scopes = new Map<string, Record<string, T>>()
  for (const [key, value] of Object.entries(entries)) {
    const scope = key.slice(0, key.indexOf(':'))
    const values = scopes.get(scope) ?? {}
    values[key] = value
    scopes.set(scope, values)
  }
  return Object.fromEntries(
    Array.from(scopes.values(), (scope) => prune(scope)).flatMap(Object.entries),
  )
}
