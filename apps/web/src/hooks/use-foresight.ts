import { useEffect, useEffectEvent, useState } from 'react'
import { ForesightManager, type ForesightRegisterOptionsWithoutElement } from 'js.foresight'

export function useForesight<T extends HTMLElement>(
  options: ForesightRegisterOptionsWithoutElement,
) {
  const [element, elementRef] = useState<T | null>(null)
  const onIntent = useEffectEvent(options.callback)
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
    update()
  }, [
    element,
    options.name,
    options.enabled,
    options.reactivateAfter,
    options.hitSlop,
    options.meta,
  ])
  return { elementRef }
}
