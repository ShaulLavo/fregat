import { createStore } from 'zustand/vanilla'
import type { EditTextRequest } from '@/host/providers/actions-context'
import { createTuiError } from '@/host/utils/structured-errors'

export function createTextEditor() {
  /** The open edit request; components select from this with `useStore`. */
  const store = createStore<EditTextRequest | null>(() => null)
  let finish: ((text: string | null) => void) | null = null
  return {
    store,
    getSnapshot: store.getState,
    editText(request: EditTextRequest): Promise<string | null> {
      request.signal.throwIfAborted()
      if (store.getState())
        throw createTuiError('An editor is already open.', 'Finish editing first.')
      const result = Promise.withResolvers<string | null>()
      const clear = () => {
        request.signal.removeEventListener('abort', abort)
        finish = null
        store.setState(null, true)
      }
      const abort = () => {
        clear()
        result.reject(request.signal.reason)
      }
      finish = (text) => {
        clear()
        result.resolve(text)
      }
      request.signal.addEventListener('abort', abort, { once: true })
      store.setState(request, true)
      return result.promise
    },
    complete(text: string | null) {
      finish?.(text)
    },
    dispose() {
      finish?.(null)
    },
  }
}
