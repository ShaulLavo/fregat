import {
  purgeExpiredEntries,
  readFreshEntry,
  trimEntriesToCapacity,
} from '../../utils/cache-entries'

/**
 * The git service's cache primitive: string-keyed, capacity-bounded, TTL-bounded,
 * and single-flight. Every entry holds the in-flight promise rather than the
 * settled value, so N concurrent status polls for one repository run one `git`
 * process. A rejected load is dropped instead of cached — a failure has no
 * freshness to serve, and caching one would extend a transient error over the
 * whole TTL.
 *
 * TTL may be a function of the resolved value, which is how a "no repository
 * here" answer gets its own (negative) lifetime without a second cache.
 */

type CacheEntry<Value> = {
  /** `null` while the load is in flight: an unsettled entry has no freshness to lose. */
  expiresAt: number | null
  value: Promise<Value>
}

type BoundedTtlCacheOptions<Value> = {
  capacity: number
  now?: () => number
  ttlMs: number | ((value: Value) => number)
}

export class BoundedTtlCache<Value> {
  private readonly capacity: number
  private readonly entries = new Map<string, CacheEntry<Value>>()
  private readonly now: () => number
  private readonly ttlMs: number | ((value: Value) => number)

  constructor(options: BoundedTtlCacheOptions<Value>) {
    this.capacity = options.capacity
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs
  }

  get size() {
    purgeExpiredEntries(this.entries, this.now)
    return this.entries.size
  }

  read(key: string) {
    return readFreshEntry(this.entries, key, this.now)?.value
  }

  load(key: string, loader: () => Promise<Value>): Promise<Value> {
    const cached = this.read(key)
    if (cached) return cached

    const pending = loader()
    this.write(key, pending)

    return pending.then(
      (value) => {
        this.stamp(key, pending, value)
        return value
      },
      (error: unknown) => {
        this.evict(key, pending)
        throw error
      },
    )
  }

  /** Explicit invalidation for every entry a single repository owns. */
  invalidatePrefix(prefix: string) {
    for (const key of this.entries.keys()) {
      if (!key.startsWith(prefix)) continue

      this.entries.delete(key)
    }
  }

  private write(key: string, value: Promise<Value>) {
    purgeExpiredEntries(this.entries, this.now)
    this.entries.delete(key)
    this.entries.set(key, { expiresAt: null, value })
    trimEntriesToCapacity(this.entries, this.capacity)
  }

  private stamp(key: string, pending: Promise<Value>, value: Value) {
    const entry = this.entries.get(key)
    if (entry?.value !== pending) return

    entry.expiresAt = this.now() + this.ttlMsForValue(value)
  }

  private evict(key: string, pending: Promise<Value>) {
    if (this.entries.get(key)?.value !== pending) return

    this.entries.delete(key)
  }

  private ttlMsForValue(value: Value) {
    if (typeof this.ttlMs === 'number') return this.ttlMs

    return this.ttlMs(value)
  }
}
