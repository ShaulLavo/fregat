import { createSubscriptions } from '@workspace/utils/subscriptions'

export function createObservableStore<T>(initial: T, { signal }: { signal?: AbortSignal } = {}) {
  const subscriptions = createSubscriptions()
  let value = initial
  let disposed = signal?.aborted ?? false

  function dispose() {
    disposed = true
    signal?.removeEventListener('abort', dispose)
    subscriptions.clear()
  }
  function replace(next: T) {
    if (disposed) return
    value = next
    subscriptions.notify()
  }
  if (!disposed) signal?.addEventListener('abort', dispose, { once: true })

  return {
    get value() {
      return value
    },
    get disposed() {
      return disposed
    },
    getSnapshot: () => value,
    subscribe(listener: () => void) {
      if (disposed) return () => {}
      return subscriptions.subscribe(listener)
    },
    replace,
    patch: (patch: Partial<T>) => replace({ ...value, ...patch }),
    dispose,
  }
}
