import { useEffect } from 'react'
import { useStore } from 'zustand'

import { retainCoarseClock, coarseClockStore } from '@/state/coarse-clock'

// The compiler observes this clock as a memo input; an in-render Date.now() would freeze.
export function useCoarseNow() {
  useEffect(retainCoarseClock, [])

  return useStore(coarseClockStore, (state) => state.nowMs)
}
