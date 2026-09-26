import { onTestFinished, vi } from 'vitest'

/**
 * Stops `Date.now` for the rest of the test. A prepared open is adopted only inside the snapshot's
 * `FILE_SNAPSHOT_STALE_MS`, which worker preparation on a loaded runner can outlast.
 */
export function holdWallClock() {
  vi.useFakeTimers({ toFake: ['Date'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
}
