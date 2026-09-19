/** Stop page-owned resources on departure and recreate them after a cached-page restore. */
export function startPageSubscription(start: () => () => void) {
  let stop: (() => void) | null = start()
  const suspend = () => {
    const cleanup = stop
    stop = null
    cleanup?.()
  }
  const resume = () => {
    if (!stop) stop = start()
  }
  const beforeUnload = (event: BeforeUnloadEvent) => {
    // The unsaved-work guard runs in capture phase. Keep subscriptions alive while
    // its confirmation is pending; pagehide handles a confirmed departure.
    if (!event.defaultPrevented) suspend()
  }
  window.addEventListener('beforeunload', beforeUnload)
  window.addEventListener('pagehide', suspend)
  window.addEventListener('pageshow', resume)
  return () => {
    window.removeEventListener('beforeunload', beforeUnload)
    window.removeEventListener('pagehide', suspend)
    window.removeEventListener('pageshow', resume)
    suspend()
  }
}
