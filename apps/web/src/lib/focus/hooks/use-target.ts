import { useCallback, useEffectEvent, useLayoutEffect, useState } from 'react'

import { useFocusService } from '@/lib/focus/hooks/use-service'
import { useFocusSnapshot } from '@/lib/focus/hooks/use-snapshot'
import type {
  FocusTargetRegistration,
  FocusTargetRegistrationUpdate,
  FocusTargetToken,
} from '@/lib/focus/state/service'

export type FocusTargetRef<E extends HTMLElement> = {
  readonly focused: boolean
  readonly ref: (element: E | null) => void
  readonly token: FocusTargetToken | null
}

export function useFocusTarget<E extends HTMLElement>(
  input: FocusTargetRegistrationUpdate,
  enabled = true,
): FocusTargetRef<E> {
  const service = useFocusService()
  const snapshot = useFocusSnapshot()
  const [element, setElement] = useState<E | null>(null)
  const [registration, setRegistration] = useState<FocusTargetRegistration | null>(null)
  const registerElement = useEffectEvent((targetElement: E) =>
    service.register({ ...input, element: targetElement }),
  )
  const updateRegistration = useEffectEvent((targetRegistration: FocusTargetRegistration) => {
    targetRegistration.update(input)
  })

  // A stable ref callback prevents detach/register churn on ordinary renders.
  // Manual memo: React calls a ref callback with null and then the node whenever its identity
  // changes, and the compiler's cache is a cache, not an identity guarantee.
  const ref = useCallback((nextElement: E | null) => {
    setElement(nextElement)
    if (!nextElement) setRegistration(null)
  }, [])

  useLayoutEffect(() => {
    if (!element || !enabled) return

    const nextRegistration = registerElement(element)
    // The external registration exists only after the DOM ref commits.
    // oxlint-disable-next-line oxc-react-compiler/set-state-in-effect
    setRegistration(nextRegistration)
    return () => {
      nextRegistration.unregister()
      // Never expose an unregistered token if a readiness gate opens again.
      // oxlint-disable-next-line oxc-react-compiler/set-state-in-effect
      setRegistration((current) => (current === nextRegistration ? null : current))
    }
  }, [element, enabled])

  useLayoutEffect(() => {
    if (enabled && registration) updateRegistration(registration)
  })

  const token = enabled ? (registration?.token ?? null) : null
  return {
    focused: token !== null && snapshot.currentOwner?.token === token,
    ref,
    token,
  }
}
