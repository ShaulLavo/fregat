import { addTransitionType, startTransition, useLayoutEffect, useState } from 'react'
import type { ColorMode } from '@workspace/contracts'

export function useTransitionedColorMode(requested: ColorMode): ColorMode {
  const [rendered, setRendered] = useState(requested)
  // Settings subscriptions are synchronous; give React ownership of the visual commit.
  useLayoutEffect(() => {
    startTransition(() => {
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) addTransitionType('color-mode')
      setRendered(requested)
    })
  }, [requested])

  return rendered
}
