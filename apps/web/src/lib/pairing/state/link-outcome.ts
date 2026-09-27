import { create } from 'zustand'

/** Why the pairing link this page opened with did not pair it, for the pairing screen to say. */
export const usePairingLinkStore = create<{ readonly failure: string | null }>(() => ({
  failure: null,
}))
