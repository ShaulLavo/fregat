import type { WatchCoverage } from '@workspace/contracts'

const stillLive =
  'Open files and the top level update live; the rest refreshes when you return to the window.'

/** The tooltip for a limited root. Counting stops once it passes what is free, so that is the bound. */
export function limitedWatchDescription(coverage: WatchCoverage) {
  const limit = coverage.limit ?? 0
  const available = coverage.available ?? 0
  if (available >= limit) {
    return `Live updates limited: this folder has more than ${limit.toLocaleString()} folders, the folder watch limit. ${stillLive}`
  }
  return `Live updates limited: this folder has more than ${available.toLocaleString()} folders, and ${available.toLocaleString()} of the ${limit.toLocaleString()} folder watches are free. ${stillLive}`
}
