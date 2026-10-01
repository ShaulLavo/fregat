export function reattachedTerminal<T extends { ready: boolean }>(
  connections: readonly T[],
  previousCount: number,
): T | undefined {
  if (connections.length <= previousCount) return undefined
  const connection = connections.at(-1)
  return connection?.ready ? connection : undefined
}
