import type { Ref } from 'react'

export function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === 'function') {
    return ref(value)
  }

  ref.current = value
}
