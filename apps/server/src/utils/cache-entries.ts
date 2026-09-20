type ExpiringEntry = { readonly expiresAt: number | null }

export function readFreshEntry<Key, Entry extends ExpiringEntry>(
  entries: Map<Key, Entry>,
  key: Key,
  now: () => number,
) {
  const entry = entries.get(key)
  if (!entry) return undefined
  if (!isExpired(entry, now)) return entry

  entries.delete(key)
  return undefined
}

export function purgeExpiredEntries<Key, Entry extends ExpiringEntry>(
  entries: Map<Key, Entry>,
  now: () => number,
) {
  for (const [key, entry] of entries) {
    if (isExpired(entry, now)) entries.delete(key)
  }
}

export function trimEntriesToCapacity<Key, Entry>(entries: Map<Key, Entry>, capacity: number) {
  while (entries.size > capacity) {
    const oldest = entries.keys().next()
    if (oldest.done) return
    entries.delete(oldest.value)
  }
}

function isExpired(entry: ExpiringEntry, now: () => number) {
  return entry.expiresAt !== null && entry.expiresAt <= now()
}
