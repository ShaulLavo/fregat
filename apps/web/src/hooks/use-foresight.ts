import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { ForesightManager, type ForesightRegisterOptionsWithoutElement } from 'js.foresight'

type ForesightOptions = Omit<ForesightRegisterOptionsWithoutElement, 'callback'> & {
  callback: (
    ...args: Parameters<ForesightRegisterOptionsWithoutElement['callback']>
  ) => void | (() => void)
}
type CallbackOwner = {
  readonly callback: ForesightOptions['callback']
  disposer: (() => void) | null
}

export function useForesight<T extends HTMLElement>(options: ForesightOptions) {
  const [element, elementRef] = useState<T | null>(null)
  const owner = useRef<CallbackOwner | null>(null)
  const onIntent = useEffectEvent((...args: Parameters<ForesightOptions['callback']>) => {
    const captured = owner.current
    if (!captured) return
    const result = captured.callback(...args)
    const next = typeof result === 'function' ? result : null
    if (owner.current !== captured) {
      next?.()
      return
    }
    const previous = captured.disposer
    captured.disposer = next
    previous?.()
  })
  const update = useEffectEvent(() => {
    if (element && ForesightManager.instance.registeredElements.has(element))
      ForesightManager.instance.updateElementOptions(element, { ...options, callback: onIntent })
  })

  useEffect(() => {
    if (!element) return
    const registration = ForesightManager.instance.register({ element, callback: onIntent })
    return () => registration.unregister()
  }, [element])

  useEffect(() => {
    if (!element) return
    const captured: CallbackOwner = { callback: options.callback, disposer: null }
    owner.current = captured
    update()
    return () => {
      if (owner.current === captured) owner.current = null
      const release = captured.disposer
      captured.disposer = null
      release?.()
    }
  }, [
    element,
    options.callback,
    options.name,
    options.enabled,
    options.reactivateAfter,
    options.hitSlop,
    options.meta,
  ])
  return { element, elementRef }
}
