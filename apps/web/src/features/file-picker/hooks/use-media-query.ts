import { useCallback, useSyncExternalStore } from 'react'

/** Whether the viewport matches `query`; `serverValue` stands in where there is no window. */
export function useMediaQuery(query: string, serverValue: boolean) {
  // Identity is load-bearing: useSyncExternalStore resubscribes whenever `subscribe` changes.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  )
}
