import {
  createKeymapRuntime,
  type KeymapBinding,
  type KeymapRuntime,
  type KeymapSequenceEvent,
  type PendingChordLabel,
} from '@singapore-editor/core/keymap'
import { parseHotkey, rawHotkeyToParsedHotkey, detectPlatform } from '@tanstack/hotkeys'

import type { PlatformCommandBus } from '@/keymap/providers/command-context'
import type { PlatformKeyBinding } from '@/keymap/types'
import { eventTargetsTextEntry } from '@/keymap/utils/keyboard-event'
import { editorBindingConditionsMatch } from '@/keymap/utils/when'
import type { FocusArea, FocusService, FocusTargetToken } from '@/lib/focus/state/service'
import { focusTargetIdsEqual, type FocusTargetId } from '@/lib/focus/state/service'
import { createWideEventScope } from '@/lib/wide-event-scope'

type Candidate = {
  readonly binding: PlatformKeyBinding
  readonly firesWhileTyping: boolean
}

type Configuration = {
  readonly bindings: readonly PlatformKeyBinding[]
  readonly bus: Pick<PlatformCommandBus, 'capture'>
  readonly focus?: FocusService
  readonly focusedPane: FocusArea
  readonly focusedTarget?: FocusTargetToken | null
  readonly onPendingChange: (pending: PendingChordLabel | null) => void
}

type StrokeContext = {
  readonly commands: ReturnType<PlatformCommandBus['capture']>
  readonly targetsTextEntry: boolean
}

export function createPlatformKeymapSession(initial: Configuration) {
  let config = initial
  let runtime: KeymapRuntime<Candidate> | null = null
  let unsubscribeFocus: (() => void) | undefined
  let owner: FocusTargetToken | null = null
  let input: HTMLElement | null = null
  let identity: FocusTargetId | null = null

  function captureContext(event: KeyboardEvent): StrokeContext {
    const commands = config.bus.capture({ event, source: { kind: 'keybinding' } })
    const target = commands.inspect('editor.selectAll').target
    const editorInput = target?.kind === 'editor' ? target.inputElement : null
    return { commands, targetsTextEntry: eventTargetsTextEntry(event, editorInput) }
  }

  function focusIdentity() {
    const current = config.focus?.getSnapshot().currentOwner
    return {
      owner: current?.token ?? config.focusedTarget ?? null,
      input: current?.capabilities.editor?.getInputElement?.() ?? null,
      identity: current?.id ?? null,
    }
  }

  function cancelOnFocusChange() {
    const next = focusIdentity()
    const sameIdentity =
      identity && next.identity
        ? focusTargetIdsEqual(identity, next.identity)
        : identity === next.identity
    if (next.owner !== owner || next.input !== input || !sameIdentity) runtime?.cancel('superseded')
    owner = next.owner
    input = next.input
    identity = next.identity
  }

  function mount() {
    runtime = createKeymapRuntime({
      root: document,
      bindings: runtimeBindings(config.bindings),
      captureContext,
      isAvailable: candidateAvailable,
      dispatch: ({ payload }, context) => {
        const command = payload.binding.command
        return command ? context.commands.dispatch(command).claimed : true
      },
      onPendingChange: (pending) => config.onPendingChange(pending),
      onSequence: (sequence) => reportSequence(sequence, config.focusedPane),
    })
    cancelOnFocusChange()
    unsubscribeFocus = config.focus?.subscribe(cancelOnFocusChange)
    document.addEventListener('focusin', cancelOnFocusChange, true)
    return dispose
  }

  function update(next: Configuration) {
    const focusChanged = next.focus !== config.focus
    if (
      next.bus !== config.bus ||
      next.focusedPane !== config.focusedPane ||
      next.focusedTarget !== config.focusedTarget
    )
      runtime?.cancel('superseded')
    if (next.bindings !== config.bindings) runtime?.updateBindings(runtimeBindings(next.bindings))
    config = next
    if (!focusChanged || !runtime) return
    unsubscribeFocus?.()
    unsubscribeFocus = config.focus?.subscribe(cancelOnFocusChange)
    cancelOnFocusChange()
  }

  function dispose() {
    unsubscribeFocus?.()
    document.removeEventListener('focusin', cancelOnFocusChange, true)
    runtime?.dispose()
    runtime = null
  }

  return {
    mount,
    update,
    claimKeybinding: (event: KeyboardEvent) => runtime?.claimKeybinding(event) ?? false,
  }
}

function runtimeBindings(
  bindings: readonly PlatformKeyBinding[],
): readonly KeymapBinding<Candidate>[] {
  const platform = detectPlatform()
  return bindings.map((binding) => {
    const first = binding.chord[0]
    const stroke =
      typeof first === 'string'
        ? parseHotkey(first, platform)
        : rawHotkeyToParsedHotkey(first, platform)
    return {
      chord: binding.chord,
      payload: { binding, firesWhileTyping: stroke.ctrl || stroke.meta || stroke.key === 'Escape' },
      preventDefault: binding.preventDefault,
      stopPropagation: binding.stopPropagation,
    }
  })
}

function candidateAvailable({ payload }: KeymapBinding<Candidate>, context: StrokeContext) {
  const { binding, firesWhileTyping } = payload
  if (context.targetsTextEntry && !firesWhileTyping) return false
  if (!binding.command) return true
  const inspection = context.commands.inspect(binding.command)
  if (inspection.status !== 'ready') return false
  if (inspection.target.kind !== 'editor') return true
  if (context.targetsTextEntry) return false
  return editorBindingConditionsMatch(binding.editorWhen, inspection.target.keymapContext)
}

function reportSequence(event: KeymapSequenceEvent<Candidate>, pane: FocusArea) {
  const binding = event.binding?.payload.binding
  const scope = createWideEventScope({ action: 'keymap.chord', area: 'command' })
  scope.end({
    candidateCount: event.candidateCount,
    command: binding?.command ?? null,
    elapsedMs: event.elapsedMs,
    keys: binding?.keys ?? event.keys,
    outcome: event.outcome,
    pane,
    prefix: event.keys.split(' ')[0],
    strokeCount: event.strokeCount,
  })
}
