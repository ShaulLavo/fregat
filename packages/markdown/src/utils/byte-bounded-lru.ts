/**
 * An entry-count bound alone cannot bound this cache: one highlighted
 * diff-heavy code block is megabytes of tokens while a one-liner is bytes, so
 * eviction is driven by an approximate byte budget with the entry count as a
 * secondary ceiling. Insertion order in the Map is the recency order.
 */

type CacheEntry<TValue> = {
  readonly bytes: number
  readonly value: TValue
}

export class ByteBoundedLru<TValue> {
  private readonly entries = new Map<string, CacheEntry<TValue>>()
  private bytes = 0

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) {}

  get totalBytes() {
    return this.bytes
  }

  get size() {
    return this.entries.size
  }

  get(key: string): TValue | null {
    const entry = this.entries.get(key)
    if (!entry) return null

    this.entries.delete(key)
    this.entries.set(key, entry)

    return entry.value
  }

  /** A value larger than the whole budget is dropped rather than evicting everything for it. */
  set(key: string, value: TValue, bytes: number) {
    if (bytes > this.maxBytes) return

    const existing = this.entries.get(key)
    if (existing) {
      this.bytes -= existing.bytes
      this.entries.delete(key)
    }

    this.evictFor(bytes)
    this.entries.set(key, { bytes, value })
    this.bytes += bytes
  }

  clear() {
    this.entries.clear()
    this.bytes = 0
  }

  private evictFor(incomingBytes: number) {
    while (this.entries.size > 0) {
      if (this.entries.size < this.maxEntries && this.bytes + incomingBytes <= this.maxBytes) return

      const oldestKey = this.entries.keys().next().value
      if (oldestKey === undefined) return

      this.bytes -= this.entries.get(oldestKey)?.bytes ?? 0
      this.entries.delete(oldestKey)
    }
  }
}
