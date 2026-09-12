type CoalescedLogEvent = Record<string, unknown>

type CoalescedLogQueue = {
  readonly flushAll: () => void
  readonly queue: (key: string, event: CoalescedLogEvent) => void
}

type CoalescedLogQueueOptions = {
  readonly countField?: string
  readonly delayMs: number
  readonly emit: (event: CoalescedLogEvent) => void
  readonly merge?: (current: CoalescedLogEvent, next: CoalescedLogEvent) => CoalescedLogEvent
}

type PendingCoalescedLog = {
  count: number
  event: CoalescedLogEvent
  timeoutId: ReturnType<typeof setTimeout>
}

export function createCoalescedLogQueue({
  countField = 'coalescedCount',
  delayMs,
  emit,
  merge,
}: CoalescedLogQueueOptions): CoalescedLogQueue {
  const pending = new Map<string, PendingCoalescedLog>()

  function flush(key: string) {
    const item = pending.get(key)
    if (!item) return

    pending.delete(key)
    clearTimeout(item.timeoutId)
    emit({ ...item.event, [countField]: item.count })
  }

  function queue(key: string, event: CoalescedLogEvent) {
    const item = pending.get(key)
    if (!item) {
      pending.set(key, {
        count: 1,
        event,
        timeoutId: setTimeout(() => flush(key), delayMs),
      })
      return
    }

    clearTimeout(item.timeoutId)
    item.count += 1
    item.event = merge ? merge(item.event, event) : event
    item.timeoutId = setTimeout(() => flush(key), delayMs)
  }

  function flushAll() {
    for (const key of Array.from(pending.keys())) {
      flush(key)
    }
  }

  return { flushAll, queue }
}
