import type { EditTextRequest } from '@/host/providers/actions-context'
import { createTuiError } from '@/host/utils/structured-errors'

export function createTextEditor() {
  const listeners = new Set<() => void>()
  let current: EditTextRequest | null = null
  let finish: ((text: string | null) => void) | null = null
  const publish = () => {
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    editText(request: EditTextRequest): Promise<string | null> {
      request.signal.throwIfAborted()
      if (current) throw createTuiError('An editor is already open.', 'Finish editing first.')
      const result = Promise.withResolvers<string | null>()
      const clear = () => {
        request.signal.removeEventListener('abort', abort)
        current = null
        finish = null
        publish()
      }
      const abort = () => {
        clear()
        result.reject(request.signal.reason)
      }
      finish = (text) => {
        clear()
        result.resolve(text)
      }
      current = request
      request.signal.addEventListener('abort', abort, { once: true })
      publish()
      return result.promise
    },
    complete(text: string | null) {
      finish?.(text)
    },
    dispose() {
      finish?.(null)
      listeners.clear()
    },
  }
}
