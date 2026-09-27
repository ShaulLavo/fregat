import { createContext } from 'react'

/** Leaves the screen on top of the phone's stack; null on the session list, the root. */
export const BackContext = createContext<(() => void) | null>(null)
