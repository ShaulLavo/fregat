import { create } from 'zustand'
import type { WatchCoverage } from '@workspace/contracts'

/**
 * How the server watches each open root, from its project stream's `ready`. A `limited` root
 * updates its top level and open files live; the rest refreshes when the window regains focus.
 */
type WatchCoverageStore = {
  readonly byRoot: Readonly<Record<string, WatchCoverage>>
}

export const useWatchCoverageStore = create<WatchCoverageStore>()(() => ({ byRoot: {} }))

export function watchCoverageKey(origin: string, rootPath: string) {
  return `${origin} ${rootPath}`
}

export function setWatchCoverage(key: string, coverage: WatchCoverage | undefined) {
  useWatchCoverageStore.setState(({ byRoot }) => {
    if (byRoot[key] === coverage) return {}
    const next = { ...byRoot }
    if (coverage) next[key] = coverage
    else delete next[key]
    return { byRoot: next }
  })
}
