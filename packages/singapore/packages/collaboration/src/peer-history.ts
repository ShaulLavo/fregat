export function prunePeerHistory<T>(
  history: Map<string, T>,
  active: (peer: string) => boolean,
): void {
  if (history.size < 64) return
  for (const peer of history.keys()) {
    if (active(peer)) continue
    history.delete(peer)
    return
  }
}
