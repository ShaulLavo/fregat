import {
  buildKeymapTrie,
  trieStep,
  type KeymapBinding,
  type KeymapNode,
} from '@singapore-editor/core/keymap'
import { parseHotkey } from '@tanstack/hotkeys'
import { CHORD_TIMEOUT_MS, parsedChord } from '@workspace/client-core/commands/chord'

import type { CommandBus } from '@/commands/state/bus'
import type { FocusRegistry } from '@/commands/state/focus'
import { activeTerminalBindings, type TerminalBinding } from '@/commands/utils/bindings'
import { terminalKeyboardEvent, type TerminalKeyEvent } from '@/commands/utils/keyboard'

type Candidate = TerminalBinding & { readonly firesWhileTyping: boolean }
export type PendingChord = { readonly keys: string; readonly commands: readonly TerminalBinding[] }
type Options = {
  readonly bus: CommandBus
  readonly focus: FocusRegistry
  readonly bindings: readonly TerminalBinding[]
  readonly onPendingChange: (pending: PendingChord | null) => void
}

export function createKeymapSession(options: Options) {
  let bindings = options.bindings
  let trie = makeTrie(bindings, options.focus)
  let pending: { readonly node: KeymapNode<Candidate>; readonly keys: string } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let keyCapture: { readonly handle: (event: TerminalKeyEvent) => void } | null = null
  const unsubscribe = options.focus.subscribe(() => {
    cancel()
    trie = makeTrie(bindings, options.focus)
  })

  function cancel() {
    if (!pending) return false
    pending = null
    clearTimeout(timer)
    options.onPendingChange(null)
    return true
  }

  function arm(node: KeymapNode<Candidate>, keys: string, commands: readonly TerminalBinding[]) {
    pending = { node, keys }
    clearTimeout(timer)
    timer = setTimeout(cancel, CHORD_TIMEOUT_MS)
    options.onPendingChange({ keys, commands })
  }

  function handle(event: TerminalKeyEvent) {
    if (disposed || event.defaultPrevented || event.eventType === 'release') return false
    if (keyCapture) {
      keyCapture.handle(event)
      return swallow(event)
    }
    if (pending && (event.name === 'escape' || event.repeated)) {
      if (!event.repeated) cancel()
      return swallow(event)
    }
    const fromChord = pending !== null
    const edge = trieStep(pending?.node ?? trie, terminalKeyboardEvent(event))
    if (!edge) return finishUnmatched(event, fromChord)
    const commands = options.bus.capture('keybinding')
    const textEntry = options.focus.getSnapshot().current?.capabilities.textEntry === true
    const available = (candidate: KeymapBinding<Candidate>) =>
      (!textEntry || candidate.payload.firesWhileTyping) &&
      commands.inspect(candidate.payload.command).status === 'ready'
    const eligible = edge.node.candidates.filter(available)
    for (const candidate of eligible) {
      if (!commands.dispatch(candidate.payload.command).claimed) continue
      cancel()
      return swallow(event)
    }
    if (eligible.length) return finishUnmatched(event, fromChord)
    const descendants = edge.node.descendants.filter(available)
    if (!descendants.length || event.repeated) return finishUnmatched(event, fromChord)
    const keys = pending ? `${pending.keys} ${edge.keys}` : edge.keys
    arm(
      edge.node,
      keys,
      descendants.map((candidate) => candidate.payload),
    )
    return swallow(event)
  }

  function finishUnmatched(event: TerminalKeyEvent, fromChord: boolean) {
    if (!fromChord) return false
    cancel()
    return swallow(event)
  }

  return {
    handle,
    cancel,
    captureKeys(handle: (event: TerminalKeyEvent) => void) {
      cancel()
      const capture = { handle }
      keyCapture = capture
      return () => {
        if (keyCapture === capture) keyCapture = null
      }
    },
    updateBindings(next: readonly TerminalBinding[]) {
      cancel()
      bindings = next
      trie = makeTrie(bindings, options.focus)
    },
    dispose() {
      disposed = true
      keyCapture = null
      cancel()
      unsubscribe()
    },
  }
}

function makeTrie(bindings: readonly TerminalBinding[], focus: FocusRegistry) {
  const area = focus.getSnapshot().current?.area ?? 'global'
  return buildKeymapTrie(
    activeTerminalBindings(bindings, area)
      .filter((binding) => {
        if (area !== 'terminal' || binding.pane === 'terminal') return true
        return (
          binding.source === 'user' || binding.keys.startsWith('Ctrl+K ') || binding.keys === 'F1'
        )
      })
      .map((binding) => {
        const chord = parsedChord(binding.keys, 'linux')
        const first = parseHotkey(binding.keys.split(' ')[0], 'linux')
        return {
          chord,
          payload: {
            ...binding,
            firesWhileTyping:
              first.ctrl ||
              /^F\d+$/u.test(first.key) ||
              first.key === 'Escape' ||
              first.key === 'Tab',
          },
        }
      }),
    'linux',
  )
}

function swallow(event: TerminalKeyEvent) {
  event.preventDefault()
  event.stopPropagation()
  return true
}
