import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

const NON_TEXT_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Escape',
  'Home',
  'PageDown',
  'PageUp',
  'Tab',
])

/**
 * Whether this session has seen a hardware keyboard. No web API reports one; a software keyboard
 * sends text keys, so the first modifier chord or navigation key is the signal. A fine pointer is
 * the prior.
 */
const store = createStore<boolean>(
  () => typeof matchMedia === 'function' && matchMedia('(any-pointer: fine)').matches,
)

export function noteKeyboardEvent(event: KeyboardEvent) {
  if (store.getState()) return
  if (!(event.ctrlKey || event.metaKey || event.altKey || isNonTextKey(event.key))) return

  store.setState(true, true)
}

export function useKeyboardSeen(): boolean {
  return useStore(store)
}

function isNonTextKey(key: string) {
  return NON_TEXT_KEYS.has(key) || /^F\d{1,2}$/.test(key)
}
