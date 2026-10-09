import { useEffect, useEffectEvent, useRef } from 'react'
import type {
  FileOpenIntentInterest,
  FileOpenIntentTrigger,
} from '@/lib/file-open-intent/state/service'

type ElementIntentReason = Extract<FileOpenIntentTrigger, 'trajectory' | 'hover' | 'focus'>

/** One element's independent pointer, focus and predicted callers. */
export function useFileIntentLifetime(
  prepare: (trigger: FileOpenIntentTrigger) => FileOpenIntentInterest | undefined,
) {
  const reasons = useRef(new Set<ElementIntentReason>())
  const interests = useRef(new Map<ElementIntentReason, FileOpenIntentInterest>())

  function end(trigger: ElementIntentReason) {
    reasons.current.delete(trigger)
    const interest = interests.current.get(trigger)
    interests.current.delete(trigger)
    interest?.release()
  }

  function begin(trigger: ElementIntentReason) {
    const next = prepare(trigger)
    const previous = interests.current.get(trigger)
    reasons.current.add(trigger)
    if (next) interests.current.set(trigger, next)
    else interests.current.delete(trigger)
    previous?.release()
    return () => {
      if (interests.current.get(trigger) !== next) return
      end(trigger)
    }
  }

  const resume = useEffectEvent(() => {
    for (const reason of reasons.current) begin(reason)
  })
  useEffect(() => {
    resume()
    const heldReasons = reasons.current
    const heldInterests = interests.current
    return () => {
      heldReasons.delete('trajectory')
      const captured = Array.from(heldInterests.values())
      heldInterests.clear()
      for (const interest of captured) interest.release()
    }
  }, [prepare])

  return {
    begin,
    onPointerEnter: () => begin('hover'),
    onPointerLeave: () => {
      end('hover')
      end('trajectory')
    },
    onFocus: () => begin('focus'),
    onBlur: () => end('focus'),
  }
}
