import { useState } from 'react'

/**
 * `next` once it is ready, else the last value that was. A view switching subjects keeps the old
 * one on screen until the new one can paint whole, so the switch never passes through a loader.
 */
export function useHeldUntilReady<T>(next: T, ready: boolean): T {
  const [held, setHeld] = useState(next)
  if (ready && held !== next) setHeld(next)
  return ready ? next : held
}
