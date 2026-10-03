import {
  createDispatcher,
  keyInputFromTerminalKey,
  terminalKeyEffects,
  parseHotkey,
  type CompiledBinding,
  type FocusNode,
  type KeymapEntry,
} from '@fregat/hotkeys'
import type { CommandBus } from '@/commands/state/bus'
import type { FocusRegistry } from '@/commands/state/focus'
import type { TerminalBinding } from '@/commands/utils/bindings'
import { terminalBindingContext } from '@/commands/utils/bindings'
import type { TerminalKeyEvent } from '@/commands/utils/keyboard'
import { normalizedChord, CHORD_TIMEOUT_MS } from '@workspace/client-core/commands/chord'
import type { CommandId } from '@workspace/client-core/commands/catalog'

export type PendingChord = {
  readonly keys: string
  readonly commands: readonly (TerminalBinding & { readonly command: CommandId })[]
}
type Options = {
  readonly bus: CommandBus
  readonly focus: FocusRegistry
  readonly bindings: readonly TerminalBinding[]
  readonly onPendingChange: (pending: PendingChord | null) => void
}

export function createKeymapSession(options: Options) {
  let bindings = options.bindings
  let captured: ReturnType<CommandBus['capture']> | null = null
  let keyCapture: { readonly handle: (event: TerminalKeyEvent) => void } | null = null
  let disposed = false
  const dispatcher = createDispatcher<TerminalKeyEvent>({
    platform: 'linux',
    timeoutMs: CHORD_TIMEOUT_MS,
    keymap: bindings.map(toEntry),
    effects: terminalKeyEffects,
    isAvailable,
    onPendingChange(pending) {
      options.onPendingChange(
        pending
          ? {
              keys: pending.keys,
              commands: bindings.filter(
                (binding): binding is TerminalBinding & { readonly command: CommandId } =>
                  binding.command !== null &&
                  !binding.unbind &&
                  normalizedChord(binding.keys, 'linux').startsWith(`${pending.keys} `),
              ),
            }
          : null,
      )
    },
  })
  const root = dispatcher.createNode({ context: 'Workspace' })
  const nodes = new Map<string, FocusNode<TerminalKeyEvent>>()
  const commands = new Set<string>()
  for (const binding of bindings) registerCommand(binding)
  function registerCommand(binding: TerminalBinding) {
    const command = binding.command
    if (command === null || commands.has(command)) return
    commands.add(command)
    root.handle(
      command,
      () => (captured ?? options.bus.capture('keybinding')).dispatch(command).claimed,
    )
  }
  function syncFocus() {
    const area = options.focus.getSnapshot().current?.area ?? 'global'
    const context = terminalBindingContext({ pane: area })
    let node = nodes.get(context)
    if (!node) {
      node = dispatcher.createNode({ parent: root, context })
      nodes.set(context, node)
    }
    dispatcher.focus(node)
  }
  function isAvailable(candidate: CompiledBinding) {
    const binding = bindings[candidate.index]
    if (!binding) return false
    const target = options.focus.getSnapshot().current
    if (
      target?.area === 'terminal' &&
      binding.pane !== 'terminal' &&
      binding.source !== 'user' &&
      !binding.keys.startsWith('Ctrl+K ') &&
      binding.keys !== 'F1'
    )
      return false
    const stroke = parseHotkey(binding.keys.split(' ')[0]!, 'linux')
    const firesWhileTyping =
      stroke.ctrl ||
      /^F\d+$/u.test(stroke.key ?? '') ||
      stroke.key === 'Escape' ||
      stroke.key === 'Tab'
    if (target?.capabilities.textEntry && !firesWhileTyping) return false
    if (binding.command === null) return true
    return (
      (captured ?? options.bus.capture('keybinding')).inspect(binding.command).status === 'ready'
    )
  }
  const unsubscribe = options.focus.subscribe(() => {
    dispatcher.cancel()
    syncFocus()
  })
  syncFocus()
  return {
    handle(event: TerminalKeyEvent) {
      if (disposed || event.defaultPrevented || event.eventType === 'release') return false
      if (keyCapture) {
        keyCapture.handle(event)
        terminalKeyEffects.swallow(event)
        return true
      }
      captured = options.bus.capture('keybinding')
      const input = keyInputFromTerminalKey(event)
      if (input.key === 'Escape' && dispatcher.pending()) {
        dispatcher.cancel()
        terminalKeyEffects.swallow(event)
        return true
      }
      return dispatcher.handleKey(input, event)
    },
    cancel: dispatcher.cancel,
    captureKeys(handle: (event: TerminalKeyEvent) => void) {
      dispatcher.cancel()
      const capture = { handle }
      keyCapture = capture
      return () => {
        if (keyCapture === capture) keyCapture = null
      }
    },
    updateBindings(next: readonly TerminalBinding[]) {
      bindings = next
      for (const binding of next) registerCommand(binding)
      dispatcher.setKeymap(next.map(toEntry))
    },
    dispose() {
      disposed = true
      keyCapture = null
      unsubscribe()
      dispatcher.dispose()
    },
  }
}

function toEntry(binding: TerminalBinding): KeymapEntry {
  const shared = {
    keys: binding.keys,
    context: terminalBindingContext(binding),
    source: binding.source,
  }
  return binding.unbind
    ? { ...shared, unbind: binding.unbind }
    : { ...shared, command: binding.command }
}
