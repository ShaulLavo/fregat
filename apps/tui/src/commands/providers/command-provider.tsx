import { useRenderer } from '@opentui/react'
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import type { KeybindingOverrides } from '@workspace/contracts'
import type { CommandId } from '@workspace/client-core/commands/catalog'

import { CommandContext } from '@/commands/providers/command-context'
import { createCommandBus, type CommandHandlers } from '@/commands/state/bus'
import { createFocusRegistry, type FocusScope } from '@/commands/state/focus'
import { createKeymapSession, type PendingChord } from '@/commands/state/keymap'
import { effectiveTerminalBindings } from '@/commands/utils/bindings'

type Props = {
  readonly children: ReactNode
  readonly scope: FocusScope
  readonly handlers: CommandHandlers
  readonly overrides: KeybindingOverrides
  readonly kitty?: boolean
  readonly onExecuted?: (command: CommandId) => void
  readonly onError: (error: unknown, command: CommandId) => void
  readonly signal?: AbortSignal
}

export function CommandProvider({
  children,
  scope,
  handlers,
  overrides,
  kitty = false,
  onExecuted,
  onError,
  signal,
}: Props) {
  const renderer = useRenderer()
  const [focus] = useState(() => createFocusRegistry(scope))
  const [bus] = useState(() =>
    createCommandBus({
      focus,
      handlers,
      onExecuted,
      onError,
      signal,
    }),
  )
  // The binding update useEffect depends on this identity to preserve pending chords.
  const resolution = useMemo(() => effectiveTerminalBindings(overrides, kitty), [overrides, kitty])
  const [pending, setPending] = useState<PendingChord | null>(null)
  const [keymap] = useState(() =>
    createKeymapSession({ bus, focus, bindings: resolution.bindings, onPendingChange: setPending }),
  )

  useLayoutEffect(() => {
    bus.setHandlers(handlers)
    bus.setCallbacks({ onExecuted, onError })
  }, [bus, handlers, onExecuted, onError])
  const { screen, environmentId, projectId } = scope
  useLayoutEffect(() => {
    focus.setScope({ screen, environmentId, projectId })
  }, [focus, screen, environmentId, projectId])
  useEffect(() => {
    keymap.updateBindings(resolution.bindings)
  }, [resolution.bindings, keymap])
  useEffect(
    () => () => {
      bus.dispose()
      keymap.dispose()
      focus.dispose()
    },
    [bus, keymap, focus],
  )
  useEffect(() => {
    // Command capture precedes widget shortcuts, including user overrides of navigation keys.
    renderer.keyInput.prependListener('keypress', keymap.handle)
    return () => {
      renderer.keyInput.off('keypress', keymap.handle)
    }
  }, [renderer, keymap])

  return (
    <CommandContext value={{ bus, focus, keymap, ...resolution, pending, kitty }}>
      {children}
    </CommandContext>
  )
}
