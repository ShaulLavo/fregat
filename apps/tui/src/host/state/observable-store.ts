import { createStore } from 'zustand/vanilla'

/** A zustand store that stops publishing once disposed or once its parent signal aborts. */
export function createObservableStore<T>(initial: T, { signal }: { signal?: AbortSignal } = {}) {
  const store = createStore<T>(() => initial)
  let disposed = signal?.aborted ?? false

  function dispose() {
    disposed = true
    signal?.removeEventListener('abort', dispose)
  }
  function replace(next: T) {
    if (disposed) return
    store.setState(next, true)
  }
  if (!disposed) signal?.addEventListener('abort', dispose, { once: true })

  return {
    /** Components select from this with `useStore`. */
    store,
    get value() {
      return store.getState()
    },
    get disposed() {
      return disposed
    },
    getSnapshot: store.getState,
    subscribe(listener: () => void) {
      if (disposed) return () => {}
      return store.subscribe(() => listener())
    },
    replace,
    patch: (patch: Partial<T>) => replace({ ...store.getState(), ...patch }),
    dispose,
  }
}
