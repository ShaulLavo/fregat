type CancelLiveEventFlush = () => void
type ScheduleLiveEventFlush = (flush: () => void) => CancelLiveEventFlush

export function createLiveEventBatcher<TItem>(
  onFlush: (events: readonly TItem[]) => void,
  scheduleFlush: ScheduleLiveEventFlush = scheduleLiveEventFlush,
) {
  let events: TItem[] = []
  let cancelFlush: CancelLiveEventFlush | null = null

  function flush() {
    cancelFlush?.()
    cancelFlush = null
    const nextEvents = events
    events = []
    if (nextEvents.length === 0) return

    onFlush(nextEvents)
  }

  return {
    cancel() {
      cancelFlush?.()
      cancelFlush = null
      events = []
    },
    push(event: TItem) {
      events.push(event)
      if (events.length >= 500) {
        flush()
        return
      }
      if (cancelFlush) return

      cancelFlush = scheduleFlush(flush)
    },
  }
}

function scheduleLiveEventFlush(flush: () => void) {
  const timeout = setTimeout(flush, 16)

  return () => clearTimeout(timeout)
}
