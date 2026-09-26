import { bindingsCollide, defaultBindingPane } from '@workspace/client-core/commands/bindings'
import { detectPlatform } from '@tanstack/hotkeys'
import type { KeybindingOverrides } from '@workspace/contracts'

import {
  chordKeys,
  isBindableChord,
  keysConflict,
  parsedChord,
} from '@workspace/client-core/commands/chord'

import { commandHotkeyMeta } from '@/keymap/command-registry'
import { platformCommand, platformCommands } from '@/keymap/table'
import type { PlatformCommandId, PlatformKeyBinding } from '@/keymap/types'

type PlatformName = ReturnType<typeof detectPlatform>

export type BindingResolutionEntry = {
  readonly bindingId: string
  readonly command: string | null
  readonly keys: string | null
  readonly reason:
    | 'duplicate'
    | 'reservation'
    | 'reservation-replaced'
    | 'unreachable-prefix'
    | 'override'
    | 'unbound'
    | 'replaced'
    | 'unknown-command'
    | 'invalid-chord'
  readonly winner: PlatformCommandId | null
}

export type KeyBindingResolution = {
  readonly bindings: readonly PlatformKeyBinding[]
  readonly report: readonly BindingResolutionEntry[]
  readonly shadowedBy: ReadonlyMap<PlatformCommandId, PlatformCommandId>
  /** Every chord a command lost, with the command that took it. */
  readonly lostChords: readonly LostChord[]
}

export type LostChord = {
  readonly command: PlatformCommandId
  readonly keys: string
  readonly winner: PlatformCommandId
}

export function resolvedPlatformKeyBindings(
  defaults: readonly PlatformKeyBinding[],
  overrides: KeybindingOverrides,
  platform: PlatformName = detectPlatform(),
): readonly PlatformKeyBinding[] {
  return keyBindingResolution(defaults, overrides, platform).bindings
}

export function keyBindingResolution(
  defaults: readonly PlatformKeyBinding[],
  overrides: KeybindingOverrides,
  platform: PlatformName = detectPlatform(),
): KeyBindingResolution {
  const preset = resolvePresetBindings(defaults)
  const entries = appliedOverrides(overrides)
  const overridden = new Set(entries.map(([command]) => command))
  const kept = preset.bindings.filter(
    (binding) => !binding.command || !overridden.has(binding.command),
  )
  const bound = entries.flatMap(([command, chords]) =>
    chords.flatMap((keys) => userKeyBinding(defaults, command, keys, platform)),
  )
  const resolved = liveKeyBindings(kept, bound)
  return {
    ...resolved,
    report: [
      ...preset.report,
      ...overrideReport(defaults, overrides, overridden),
      ...resolved.report,
    ],
  }
}

function resolvePresetBindings(defaults: readonly PlatformKeyBinding[]) {
  const bindings: PlatformKeyBinding[] = []
  const report: BindingResolutionEntry[] = []
  for (const [index, binding] of defaults.entries()) {
    const executable = binding.command
      ? null
      : defaults.find((candidate) => candidate.command && bindingsCollide(candidate, binding))
    if (executable) {
      report.push(resolutionEntry(binding, index, 'reservation-replaced', executable.command))
      continue
    }
    const winner = bindings.find((candidate) => presetConflict(candidate, binding))
    if (winner) {
      const reason = winner.keys === binding.keys ? 'duplicate' : 'unreachable-prefix'
      report.push(resolutionEntry(binding, index, reason, winner.command))
      continue
    }
    bindings.push(binding)
    if (!binding.command) report.push(resolutionEntry(binding, index, 'reservation'))
  }
  return { bindings, report }
}

function presetConflict(candidate: PlatformKeyBinding, binding: PlatformKeyBinding) {
  if ((candidate.pane ?? 'any') !== (binding.pane ?? 'any')) return false
  if (!keysConflict(candidate.keys, binding.keys)) return false
  if (!candidate.command) return true
  if (!binding.command && candidate.keys === binding.keys) return true
  // A command may be disabled or decline, so its longer alternatives remain reachable.
  if (candidate.keys !== binding.keys) return false
  return bindingConditions(candidate) === bindingConditions(binding)
}

function bindingConditions(binding: PlatformKeyBinding) {
  const command = binding.command ? platformCommand(binding.command) : null
  return JSON.stringify([command?.when ?? [], binding.editorWhen ?? []])
}

function resolutionEntry(
  binding: PlatformKeyBinding,
  index: number,
  reason: BindingResolutionEntry['reason'],
  winner: PlatformCommandId | null = null,
): BindingResolutionEntry {
  return {
    bindingId: `${binding.source}:${binding.pane ?? 'any'}:${index}:${binding.command ?? 'reservation'}:${binding.keys}`,
    command: binding.command,
    keys: binding.keys,
    reason,
    winner,
  }
}

function overrideReport(
  defaults: readonly PlatformKeyBinding[],
  overrides: KeybindingOverrides,
  applied: ReadonlySet<PlatformCommandId>,
): BindingResolutionEntry[] {
  const known = knownCommands()
  const report: BindingResolutionEntry[] = []
  for (const [command, list] of Object.entries(overrides)) {
    report.push(...invalidOverrideReport(command, list ?? [], known))
  }
  for (const [index, binding] of defaults.entries()) {
    if (!binding.command || !applied.has(binding.command)) continue
    const unbound = (overrides[binding.command] ?? []).length === 0
    report.push(resolutionEntry(binding, index, unbound ? 'unbound' : 'replaced'))
  }
  return report
}

function invalidOverrideReport(
  command: string,
  list: readonly string[],
  known: ReadonlySet<string>,
): BindingResolutionEntry[] {
  const entry = (keys: string | null, reason: BindingResolutionEntry['reason']) => ({
    bindingId: `user:${command}:${keys ?? ''}`,
    command,
    keys,
    reason,
    winner: null,
  })
  if (!known.has(command)) return [entry(list[0] ?? null, 'unknown-command')]

  return list.filter((keys) => !isBindableChord(keys)).map((keys) => entry(keys, 'invalid-chord'))
}

function liveKeyBindings(
  kept: readonly PlatformKeyBinding[],
  bound: readonly PlatformKeyBinding[],
): KeyBindingResolution {
  const shadowedBy = new Map<PlatformCommandId, PlatformCommandId>()
  const lostChords: LostChord[] = []
  const report: BindingResolutionEntry[] = []
  const liveOverrides: PlatformKeyBinding[] = []
  const bindings: PlatformKeyBinding[] = []

  // A discarded prefix must not suppress otherwise compatible sibling chords.
  for (const binding of bound.toReversed()) {
    const winner = bindingClaimingKey(liveOverrides, binding)
    // One command's own templates share a pane when only their editor conditions differ.
    if (winner?.command === binding.command) {
      liveOverrides.push(binding)
      continue
    }
    if (winner) {
      recordShadowedCommand(shadowedBy, lostChords, binding, winner)
      report.push(resolutionEntry(binding, report.length, 'override', winner.command))
      continue
    }

    liveOverrides.push(binding)
  }

  for (const binding of kept) {
    const winner = bindingClaimingKey(liveOverrides, binding)
    if (winner) {
      recordShadowedCommand(shadowedBy, lostChords, binding, winner)
      report.push(resolutionEntry(binding, report.length, 'override', winner.command))
      continue
    }

    bindings.push(binding)
  }

  bindings.push(...liveOverrides.reverse())
  return { bindings, report, shadowedBy, lostChords }
}

function bindingClaimingKey(
  candidates: readonly PlatformKeyBinding[],
  binding: PlatformKeyBinding,
): PlatformKeyBinding | null {
  return candidates.find((candidate) => bindingsCollide(candidate, binding)) ?? null
}

function recordShadowedCommand(
  shadowedBy: Map<PlatformCommandId, PlatformCommandId>,
  lostChords: LostChord[],
  shadowed: PlatformKeyBinding,
  winner: PlatformKeyBinding,
) {
  // A no-op binding has no settings row to report, and nothing is lost: the
  // winner reserves the key from the browser the same way the no-op did.
  if (!shadowed.command) return
  if (!winner.command) return

  shadowedBy.set(shadowed.command, winner.command)
  lostChords.push({ command: shadowed.command, keys: shadowed.keys, winner: winner.command })
}

/** Each known command's bindable chords; an empty list is an unbind. */
function appliedOverrides(
  overrides: KeybindingOverrides,
): readonly (readonly [PlatformCommandId, readonly string[]])[] {
  const known = knownCommands()
  const entries: (readonly [PlatformCommandId, readonly string[]])[] = []

  for (const [command, list] of Object.entries(overrides)) {
    if (!isPlatformCommandId(command, known)) continue

    const chords = [...new Set((list ?? []).filter(isBindableChord))]
    // A list whose every chord is invalid is not a deliberate unbind; keep the defaults.
    if (chords.length === 0 && (list ?? []).length > 0) continue

    entries.push([command, chords])
  }

  return entries
}

/** The table is the only place a command exists, so it is the only list to check. */
function knownCommands(): ReadonlySet<string> {
  return new Set(platformCommands.map((command) => command.id))
}

function isPlatformCommandId(
  command: string,
  known: ReadonlySet<string>,
): command is PlatformCommandId {
  return known.has(command)
}

function userKeyBinding(
  defaults: readonly PlatformKeyBinding[],
  command: PlatformCommandId,
  keys: string,
  platform: PlatformName,
): readonly PlatformKeyBinding[] {
  const chord = parsedChord(keys, platform)
  // The defaults carry the panes and event handling the command was designed
  // for; only the keys are the user's to change. A command bound in six panes
  // keeps all six.
  const templates = bindingTemplates(defaults, command)
  const shared = {
    chord,
    command,
    keys: chordKeys(chord, platform),
    meta: commandHotkeyMeta(command),
    source: 'user',
  } as const
  if (templates.length === 0) return [{ ...shared, pane: commandDefaultPane(command) }]

  return templates.map((template) => ({
    ...shared,
    editorWhen: template.editorWhen,
    pane: template.pane ?? commandDefaultPane(command),
    preventDefault: template.preventDefault,
    stopPropagation: template.stopPropagation,
    vscodeCommandId: template.vscodeCommandId,
    yieldsToTextEntry: template.yieldsToTextEntry,
  }))
}

/** One default binding per distinct (pane, editor condition) the command is bound under. */
function bindingTemplates(
  defaults: readonly PlatformKeyBinding[],
  command: PlatformCommandId,
): readonly PlatformKeyBinding[] {
  const seen = new Set<string>()

  return defaults.filter((binding) => {
    if (binding.command !== command) return false

    const slot = JSON.stringify([binding.pane ?? 'any', binding.editorWhen ?? []])
    if (seen.has(slot)) return false

    seen.add(slot)
    return true
  })
}

function commandDefaultPane(command: PlatformCommandId): PlatformKeyBinding['pane'] {
  return defaultBindingPane(platformCommand(command)?.target)
}
