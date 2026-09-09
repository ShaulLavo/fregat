import {
  formatAddress,
  parseAddress,
  type Address,
  type AddressEnvironments,
} from '@workspace/client-core/address/grammar'
import { log } from '@/lib/client-logging'

/**
 * Store → URL.
 *
 * Mostly a projection: the store changes, and the URL is re-rendered from it. The one
 * thing it must also know is when the URL moved on its own, because push-versus-replace
 * is decided by comparing against the last address — and after a back press the "last
 * address" the browser is showing is not the one this module wrote. `adopt` is that
 * single inbound fact; without it a back press is indistinguishable from a forward
 * navigation and gets answered with a `pushState`, which truncates the entry the user
 * was standing next to.
 *
 * Writes are debounced on the trailing edge rather than rationed. Safari throttles
 * `replaceState` at roughly 100 calls per 30 seconds and then *throws*, which an
 * earlier version of this file defended with a rolling budget — but a budget DROPS
 * writes once it trips, and the dropped one is the address the user actually ended on,
 * so the URL and the restore payload both went stale until something else moved. One
 * write per quiet period makes exceeding the engine limit structurally impossible
 * instead, and has no failure mode to recover from.
 */

/** Long enough that a keystroke burst is one write, short enough to feel immediate. */
export const PROJECTION_DEBOUNCE_MS = 250

export type AddressWriter = {
  readonly push: (href: string) => void
  readonly replace: (href: string) => void
}

// Selecting a document pushes history; changing its filters replaces the current entry.
function identityOf(address: Address) {
  return JSON.stringify([
    address.environmentId,
    address.rejectedEnvironment,
    address.workspace,
    address.mode,
    address.document,
    address.editor,
  ])
}

export type AddressProjectionOptions = {
  readonly isSuspended?: () => boolean
  readonly environments?: () => AddressEnvironments
  /**
   * Runs `write` after the quiet period and returns a cancel. Injected so node tests
   * drive the projection without a clock, and so the debounce interval belongs to the
   * caller rather than to this state machine.
   */
  readonly schedule: (write: () => void) => () => void
  readonly writer: AddressWriter
}

export type AddressProjection = {
  /**
   * Take the address the browser is now showing as this projection's own last write,
   * without writing anything. Called on `popstate`, so the flush that follows the
   * applier's store changes compares against where the user actually IS.
   */
  readonly adopt: (href: string) => void
  /** Drops a scheduled write. StrictMode builds two projections; only one may win. */
  readonly cancel: () => void
  /** Writes any pending address immediately. For `pagehide`, where there is no later. */
  readonly flushNow: () => void
  readonly project: (address: Address) => void
}

export function createAddressProjection({
  schedule,
  writer,
  environments,
  isSuspended,
}: AddressProjectionOptions): AddressProjection {
  let pending: Address | null = null
  let cancelScheduled: (() => void) | null = null
  let lastWritten: string | null = null
  let lastIdentity: string | null = null
  let cancelled = false

  function flush() {
    cancelScheduled = null
    if (isSuspended?.()) return
    const address = pending
    pending = null
    if (!address || cancelled) return

    const href = formatAddress(address)
    // The store settles far more often than the address changes, and an identical href
    // is not worth a history entry.
    if (href === lastWritten) return

    const identity = identityOf(address)
    const isNavigation = lastIdentity !== null && identity !== lastIdentity

    lastWritten = href
    lastIdentity = identity
    if (isNavigation) writer.push(href)
    else writer.replace(href)
    log.debug({
      action: 'address.projected',
      area: 'address',
      // The href itself is deliberately absent: it carries the user's search query
      // (`s.q=`), their file paths and their branch names, and `client-logging` redacts
      // by FIELD NAME — `absolutePath`, `fileName`, `cwd` are all on the deny list, so
      // shipping the same content under `href` would walk it straight past that policy.
      hrefLength: href.length,
      navigation: isNavigation,
    })
  }

  return {
    // Canonicalized through the codec rather than stored raw, so the comparison in
    // `flush` is like-for-like: a popped entry the projection itself wrote then matches
    // exactly and costs no write at all.
    adopt(href) {
      const address = parseAddress(href, environments?.())
      lastWritten = formatAddress(address)
      lastIdentity = identityOf(address)
    },
    cancel() {
      cancelled = true
      pending = null
      cancelScheduled?.()
      cancelScheduled = null
    },
    // Cancels before flushing, unlike the timer's own call into `flush`. Without this
    // `pagehide` left the timer armed AND dropped its canceller, so a page resumed from
    // the back/forward cache had an orphan that no later `project()` could stop — and
    // that orphan fired mid-burst, writing at the very moment coalescing exists to avoid.
    flushNow() {
      cancelScheduled?.()
      cancelScheduled = null
      flush()
    },
    // Trailing edge: every change restarts the quiet period, so a burst writes once at
    // the end, at the address the user actually stopped on.
    project(address) {
      pending = address
      cancelScheduled?.()
      cancelScheduled = schedule(flush)
    },
  }
}
