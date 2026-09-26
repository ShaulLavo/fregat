import { create } from 'zustand'
import type { SessionId } from '@workspace/contracts'

type RevealRequest = { readonly sessionId: SessionId; readonly rowId: string }

type TimelineRevealStore = {
  /** A row the open timeline should scroll to; it clears the request once it has. */
  readonly request: RevealRequest | null
  /** The row a reader was just taken to, marked until they scroll on. */
  readonly highlighted: string | null
  reveal: (request: RevealRequest) => void
  settle: (rowId: string) => void
  release: () => void
}

/** Taking a reader to a transcript row from outside the timeline: a cited reply, a plan. */
export const useTimelineRevealStore = create<TimelineRevealStore>((set) => ({
  request: null,
  highlighted: null,
  reveal: (request) => set({ request, highlighted: null }),
  settle: (rowId) => set({ request: null, highlighted: rowId }),
  release: () => set({ highlighted: null }),
}))
