import { KeyEvent, parseKeypress } from '@opentui/core'
import type { CommandId } from '@workspace/client-core/commands/catalog'
import { createCommandBus, type CommandHandlers } from '@/commands/state/bus'
import { createFocusRegistry, type FocusRegistration } from '@/commands/state/focus'
import { createKeymapSession, type PendingChord } from '@/commands/state/keymap'
import { effectiveTerminalBindings, type TerminalBinding } from '@/commands/utils/bindings'

export function createCommandHarness(options: {
  readonly handlers: CommandHandlers
  readonly bindings?: readonly TerminalBinding[]
  readonly textEntry?: boolean
  readonly area?: FocusRegistration['area']
}) {
  const scope = { screen: 'settings', environmentId: 'environment-a', projectId: null }
  const focus = createFocusRegistry(scope)
  const target = focus.register({
    ...scope,
    id: 'settings-search',
    area: options.area ?? 'settings',
    textEntry: options.textEntry ?? false,
    focus: () => true,
    isFocused: () => true,
  })
  focus.activate(target.token)
  const executed: CommandId[] = []
  const errors: unknown[] = []
  const bus = createCommandBus({
    focus,
    handlers: options.handlers,
    onExecuted: (id) => executed.push(id),
    onError: (error) => errors.push(error),
  })
  const state: { pending: PendingChord | null } = { pending: null }
  const keymap = createKeymapSession({
    bus,
    focus,
    bindings: options.bindings ?? effectiveTerminalBindings([]).bindings,
    onPendingChange: (value) => {
      state.pending = value
    },
  })
  return {
    scope,
    focus,
    target,
    bus,
    keymap,
    state,
    executed,
    errors,
    key(sequence: string, kitty = false) {
      const parsed = parseKeypress(sequence, { useKittyKeyboard: kitty })
      return parsed ? keymap.handle(new KeyEvent(parsed)) : false
    },
    dispose() {
      bus.dispose()
      keymap.dispose()
      focus.dispose()
    },
  }
}
