import { createStore } from 'zustand/vanilla'

// State keeps relative labels in the React Compiler's memo keys; Date.now() in render freezes them.
// One refcounted minute clock serves every mounted aging label.
export const COARSE_CLOCK_INTERVAL_MS = 60_000

type CoarseClockStore = {
  nowMs: number
}

export const coarseClockStore = createStore<CoarseClockStore>(() => ({
  nowMs: Date.now(),
}))

let subscribers = 0
let intervalId: ReturnType<typeof setInterval> | null = null

/** Stops the clock when its last mounted consumer releases it. */
export function retainCoarseClock() {
  subscribers += 1
  if (subscribers === 1) {
    // Stamped immediately: a clock that resumed after being idle would
    // otherwise hand out the time it stopped at until the first tick.
    coarseClockStore.setState({ nowMs: Date.now() })
    intervalId = setInterval(
      () => coarseClockStore.setState({ nowMs: Date.now() }),
      COARSE_CLOCK_INTERVAL_MS,
    )
  }

  let released = false

  return () => {
    if (released) return

    released = true
    subscribers -= 1
    if (subscribers > 0 || intervalId === null) return

    clearInterval(intervalId)
    intervalId = null
  }
}

/** Test seam: advances the shared clock without waiting a real minute. */
export function setCoarseClockNow(nowMs: number) {
  coarseClockStore.setState({ nowMs })
}
