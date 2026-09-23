import { detectPlatform } from '@tanstack/hotkeys'
import type { KeybindingOverrides } from '@workspace/contracts'

import type { FocusArea } from '@/lib/focus/state/service'
import {
  chordKeys,
  isBindableChord,
  keysConflict,
  parsedChord,
} from '@workspace/client-core/commands/chord'

import { commandHotkeyMeta } from '@/keymap/command-registry'
import { platformCommand, platformCommands } from '@/keymap/table'
import type {
  CommandKeyBinding,
  KeyBindingSource,
  PlatformCommandId,
  PlatformKeyBinding,
} from '@/keymap/types'

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
}

/** A settings row: the effective binding plus the command that took its key. */
export type CommandKeyBindingRow = CommandKeyBinding & {
  readonly effectiveKeys: readonly string[]
  /** Set only when the command has no binding left because another one won the key. */
  readonly shadowedBy: PlatformCommandId | null
}

export function resolvedPlatformKeyBindings(
  defaults: readonly PlatformKeyBinding[],
  overrides: KeybindingOverrides,
  platform: PlatformName = detectPlatform(),
): readonly PlatformKeyBinding[] {
  return keyBindingResolution(defaults, overrides, platform).bindings
}

export function activePlatformKeyBindings(
  bindings: readonly PlatformKeyBinding[],
  focusedPane: FocusArea,
): readonly PlatformKeyBinding[] {
  // Pane-specific candidates precede globals; ties retain preset order.
  return bindings
    .filter((binding) => bindingMatchesFocusedPane(binding, focusedPane))
    .toSorted(
      (left, right) => bindingPriority(right, focusedPane) - bindingPriority(left, focusedPane),
    )
}

export function commandKeyBindings(
  defaults: readonly PlatformKeyBinding[],
  overrides: KeybindingOverrides,
  platform: PlatformName = detectPlatform(),
): readonly CommandKeyBindingRow[] {
  const { bindings, shadowedBy } = keyBindingResolution(defaults, overrides, platform)
  const applied = new Map(appliedOverrides(overrides))
  const live = liveBindingsByCommand(bindings)
  const defaultKeys = defaultKeysByCommand(defaults)

  return platformCommands.map(({ id: command }) =>
    commandKeyBindingRow({
      applied,
      command,
      defaultKeys: defaultKeys.get(command) ?? [],
      live: live.get(command) ?? [],
      shadowedBy: shadowedBy.get(command) ?? null,
    }),
  )
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
  const bound = entries.flatMap(([command, keys]) =>
    userKeyBinding(defaults, command, keys, platform),
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
      : defaults.find((candidate) => candidate.command && collidesWith(candidate, binding))
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
  for (const [command, keys] of Object.entries(overrides)) {
    if (!known.has(command) || (keys !== null && !isBindableChord(keys))) {
      report.push({
        bindingId: `user:${command}`,
        command,
        keys,
        reason: known.has(command) ? 'invalid-chord' : 'unknown-command',
        winner: null,
      })
    }
  }
  for (const [index, binding] of defaults.entries()) {
    if (!binding.command || !applied.has(binding.command)) continue
    const reason = overrides[binding.command] === null ? 'unbound' : 'replaced'
    report.push(resolutionEntry(binding, index, reason))
  }
  return report
}

function liveKeyBindings(
  kept: readonly PlatformKeyBinding[],
  bound: readonly PlatformKeyBinding[],
): KeyBindingResolution {
  const shadowedBy = new Map<PlatformCommandId, PlatformCommandId>()
  const report: BindingResolutionEntry[] = []
  const liveOverrides: PlatformKeyBinding[] = []
  const bindings: PlatformKeyBinding[] = []

  // A discarded prefix must not suppress otherwise compatible sibling chords.
  for (const binding of bound.toReversed()) {
    const winner = bindingClaimingKey(liveOverrides, binding)
    if (winner) {
      recordShadowedCommand(shadowedBy, binding, winner)
      report.push(resolutionEntry(binding, report.length, 'override', winner.command))
      continue
    }

    liveOverrides.push(binding)
  }

  for (const binding of kept) {
    const winner = bindingClaimingKey(liveOverrides, binding)
    if (winner) {
      recordShadowedCommand(shadowedBy, binding, winner)
      report.push(resolutionEntry(binding, report.length, 'override', winner.command))
      continue
    }

    bindings.push(binding)
  }

  bindings.push(...liveOverrides.reverse())
  return { bindings, report, shadowedBy }
}

function bindingClaimingKey(
  candidates: readonly PlatformKeyBinding[],
  binding: PlatformKeyBinding,
): PlatformKeyBinding | null {
  return candidates.find((candidate) => collidesWith(candidate, binding)) ?? null
}

function collidesWith(candidate: PlatformKeyBinding, binding: PlatformKeyBinding) {
  if (!keysConflict(candidate.keys, binding.keys)) return false

  return (candidate.pane ?? 'any') === (binding.pane ?? 'any')
}

function recordShadowedCommand(
  shadowedBy: Map<PlatformCommandId, PlatformCommandId>,
  shadowed: PlatformKeyBinding,
  winner: PlatformKeyBinding,
) {
  // A no-op binding has no settings row to report, and nothing is lost: the
  // winner reserves the key from the browser the same way the no-op did.
  if (!shadowed.command) return
  if (!winner.command) return

  shadowedBy.set(shadowed.command, winner.command)
}

function bindingMatchesFocusedPane(binding: PlatformKeyBinding, focusedPane: FocusArea) {
  if (!binding.pane) return true
  if (binding.pane === 'any') return true

  return binding.pane === focusedPane
}

function bindingPriority(binding: PlatformKeyBinding, focusedPane: FocusArea) {
  if (focusedPane && binding.pane === focusedPane) return 2
  if (!binding.pane || binding.pane === 'any') return 1

  return 0
}

function appliedOverrides(
  overrides: KeybindingOverrides,
): readonly (readonly [PlatformCommandId, string | null])[] {
  const known = knownCommands()
  const entries: (readonly [PlatformCommandId, string | null])[] = []

  for (const [command, keys] of Object.entries(overrides)) {
    if (!isPlatformCommandId(command, known)) continue
    if (keys !== null && !isBindableChord(keys)) continue

    entries.push([command, keys])
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
  keys: string | null,
  platform: PlatformName,
): readonly PlatformKeyBinding[] {
  if (keys === null) return []

  const chord = parsedChord(keys, platform)
  // The default carries the pane and event handling the command was designed
  // for; only the keys are the user's to change.
  const template = defaults.find((binding) => binding.command === command)

  return [
    {
      command,
      chord,
      editorWhen: template?.editorWhen,
      keys: chordKeys(chord, platform),
      meta: commandHotkeyMeta(command),
      pane: template?.pane ?? commandDefaultPane(command),
      preventDefault: template?.preventDefault,
      source: 'user',
      stopPropagation: template?.stopPropagation,
      vscodeCommandId: template?.vscodeCommandId,
      yieldsToTextEntry: template?.yieldsToTextEntry,
    },
  ]
}

function commandDefaultPane(command: PlatformCommandId): PlatformKeyBinding['pane'] {
  return platformCommand(command)?.target === 'editor' ? 'editor' : 'any'
}

function commandKeyBindingRow({
  applied,
  command,
  defaultKeys,
  live,
  shadowedBy,
}: {
  readonly applied: ReadonlyMap<PlatformCommandId, string | null>
  readonly command: PlatformCommandId
  readonly defaultKeys: readonly string[]
  readonly live: readonly PlatformKeyBinding[]
  readonly shadowedBy: PlatformCommandId | null
}): CommandKeyBindingRow {
  const primary = live[0]
  const effectiveKeys = live.map((binding) => binding.keys)
  if (primary) {
    return {
      command,
      defaultKeys,
      effectiveKeys,
      keys: primary.keys,
      shadowedBy: null,
      source: primary.source,
    }
  }

  const source: KeyBindingSource = applied.has(command) ? 'user' : 'default'
  // The dead key still shows: it is what the row is configured with, and it is
  // the only way to see which shortcut the winner took.
  if (shadowedBy) {
    return {
      command,
      defaultKeys,
      effectiveKeys,
      keys: applied.get(command) ?? firstKeys(defaultKeys),
      shadowedBy,
      source,
    }
  }

  return { command, defaultKeys, effectiveKeys, keys: null, shadowedBy: null, source }
}

function liveBindingsByCommand(bindings: readonly PlatformKeyBinding[]) {
  const byCommand = new Map<PlatformCommandId, PlatformKeyBinding[]>()

  for (const binding of bindings) {
    if (!binding.command) continue

    const commandBindings = byCommand.get(binding.command) ?? []
    commandBindings.push(binding)
    byCommand.set(binding.command, commandBindings)
  }

  return byCommand
}

function firstKeys(defaultKeys: readonly string[]): string | null {
  if (defaultKeys.length === 0) return null

  return defaultKeys[0]
}

function defaultKeysByCommand(bindings: readonly PlatformKeyBinding[]) {
  const byCommand = new Map<PlatformCommandId, string[]>()

  for (const binding of bindings) {
    if (!binding.command) continue

    const keys = byCommand.get(binding.command) ?? []
    keys.push(binding.keys)
    byCommand.set(binding.command, keys)
  }

  return byCommand
}
