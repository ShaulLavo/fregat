import { useRenderer } from '@opentui/react'
import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { Renderable } from '@opentui/core'

import { useCommands } from '@/commands/hooks/use-commands'
import type { FocusRegistration, FocusToken } from '@/commands/state/focus'

export function useCommandFocus(input: Omit<FocusRegistration, 'isFocused'>, active: boolean) {
  const { focus } = useCommands()
  const renderer = useRenderer()
  const {
    id,
    area,
    screen,
    environmentId,
    projectId,
    textEntry,
    overlay,
    available,
    focus: onFocus,
  } = input
  const callback = useRef(onFocus)
  const availability = useRef(available)
  const token = useRef<FocusToken | null>(null)

  useLayoutEffect(() => {
    callback.current = onFocus
    availability.current = available
  }, [onFocus, available])
  useLayoutEffect(() => {
    const renderable = () => renderer.root.findDescendantById(id)
    const registration = focus.register(
      createRegistration({
        scope: { id, area, screen, environmentId, projectId, textEntry, overlay },
        callback,
        availability,
        renderable,
      }),
    )
    const acceptNativeFocus = () => {
      focus.activate(registration.token)
    }
    token.current = registration.token
    renderer.on('focused_renderable', acceptNativeFocus)
    return () => {
      renderer.off('focused_renderable', acceptNativeFocus)
      token.current = null
      registration.unregister()
    }
  }, [renderer, focus, id, area, screen, environmentId, projectId, textEntry, overlay])

  useLayoutEffect(() => {
    if (token.current) focus.refreshAvailability(token.current)
  })
  useLayoutEffect(() => {
    if (active && overlay && token.current) focus.focus(token.current)
  }, [active, overlay, focus, renderer, id, area, screen, environmentId, projectId, textEntry])
  useLayoutEffect(() => {
    if (active && token.current) focus.activate(token.current)
  })
  return token
}

function createRegistration({
  scope,
  callback,
  availability,
  renderable,
}: {
  scope: Omit<FocusRegistration, 'available' | 'focus' | 'isFocused'>
  callback: RefObject<FocusRegistration['focus']>
  availability: RefObject<FocusRegistration['available']>
  renderable: () => Renderable | undefined
}): FocusRegistration {
  return {
    ...scope,
    get available() {
      return availability.current !== false && (!scope.overlay || renderable() !== undefined)
    },
    focus: (intent) => {
      if (!callback.current(intent)) return false
      renderable()?.focus()
      return true
    },
    isFocused: () => {
      const widget = renderable()
      return widget?.focused === true || widget?.hasFocusedDescendant === true
    },
  }
}
