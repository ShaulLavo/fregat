/** The items either side of the current one, and where it sits; null when it is not in the list. */
export function neighbours<T>(items: readonly T[], isCurrent: (item: T) => boolean) {
  const index = items.findIndex(isCurrent)
  if (index < 0) return null

  return {
    count: items.length,
    index,
    next: items[index + 1] ?? null,
    previous: items[index - 1] ?? null,
  }
}
