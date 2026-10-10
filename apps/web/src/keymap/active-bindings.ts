import {
  bindingsForInput,
  compileKeymap,
  createKeyInput,
  detectPlatform,
  parseRegisterableHotkey,
  predicateDepth,
} from '@fregat/hotkeys'
import type { KeybindingOverrides } from '@workspace/contracts'
import { isBindableChord, type PlatformName } from '@workspace/client-core/commands/chord'
import { presetBinding } from '@/keymap/default-bindings'
import { isPlatformCommandId } from '@/keymap/table'
import type { PlatformKeyBinding } from '@/keymap/types'
import { contextPathLabel, reportContextPaths } from '@/keymap/utils/report-context'

export type BindingResolutionEntry = {
  readonly bindingId: string
  readonly command: string | null
  readonly keys: string
  readonly context: string
  readonly reason: 'shadowed' | 'unbound' | 'unknown-command' | 'invalid-chord'
  readonly winner: string | null
  readonly winnerKeys: string | null
  readonly winnerContext: string | null
}

export type KeyBindingResolution = {
  readonly bindings: readonly PlatformKeyBinding[]
  readonly report: readonly BindingResolutionEntry[]
}

export function bindingResolutionId(binding: PlatformKeyBinding, index: number): string {
  return `${binding.source}:${index}`
}

export function resolvedPlatformKeyBindings(
  defaults: readonly PlatformKeyBinding[],
  overrides: KeybindingOverrides,
  platform: PlatformName = detectPlatform(),
): readonly PlatformKeyBinding[] {
  return configuredBindings(defaults, overrides, platform).bindings
}

function configuredBindings(
  defaults: readonly PlatformKeyBinding[],
  overrides: KeybindingOverrides,
  platform: PlatformName,
) {
  const bindings = Array.from(defaults)
  const report: BindingResolutionEntry[] = []
  for (const [index, entry] of overrides.entries()) {
    const command = 'command' in entry ? entry.command : entry.unbind
    const validKeys = isBindableChord(entry.keys)
    if (!validKeys) {
      report.push({
        bindingId: `user:${index}`,
        command,
        keys: entry.keys,
        context: entry.context ?? 'Workspace',
        reason: 'invalid-chord',
        winner: null,
        winnerKeys: null,
        winnerContext: null,
      })
      continue
    }
    bindings.push(presetBinding({ ...entry, source: 'user' }, platform))
    if (command && !isPlatformCommandId(command))
      report.push({
        bindingId: `user:${index}`,
        command,
        keys: entry.keys,
        context: entry.context ?? 'Workspace',
        reason: 'unknown-command',
        winner: null,
        winnerKeys: null,
        winnerContext: null,
      })
  }
  return { bindings, report }
}

/** Menus and badges expose bindings that can win in one of their declared contexts. */
export function displayPlatformKeyBindings(
  bindings: readonly PlatformKeyBinding[],
  platform: PlatformName = detectPlatform(),
): readonly PlatformKeyBinding[] {
  const compiled = compileKeymap(
    bindings.map(({ entry }) => entry),
    platform,
  )
  return bindings.filter((binding, index) => {
    if ('unbind' in binding.entry || !binding.command) return false
    const inputs = bindingInputs(binding, platform)
    return reportContextPaths(binding.context).some(
      (stack) => bindingsForInput(compiled, inputs, stack).bindings[0]?.index === index,
    )
  })
}

export function keyBindingResolution(
  defaults: readonly PlatformKeyBinding[],
  overrides: KeybindingOverrides,
  platform: PlatformName = detectPlatform(),
): KeyBindingResolution {
  const configured = configuredBindings(defaults, overrides, platform)
  const compiled = compileKeymap(
    configured.bindings.map(({ entry }) => entry),
    platform,
  )
  const report = configured.report
  const paths = new Map(
    configured.bindings.flatMap((binding) =>
      reportContextPaths(binding.context).map((stack) => [contextPathLabel(stack), stack] as const),
    ),
  )
  for (const [index, binding] of configured.bindings.entries()) {
    if (
      'unbind' in binding.entry ||
      !('command' in binding.entry) ||
      binding.entry.command === null
    )
      continue
    const inputs = bindingInputs(binding, platform)
    for (const stack of paths.values()) {
      if (predicateDepth(compiled.bindings[index]!.payload.predicate, stack) === null) continue
      const selected = bindingsForInput(compiled, inputs, stack).bindings
      const own = selected.find((candidate) => candidate.index === index)
      const winner = selected[0] ? configured.bindings[selected[0].index] : undefined
      if (winner === binding) continue
      report.push({
        bindingId: bindingResolutionId(binding, index),
        command: binding.command ?? binding.entry.command,
        keys: binding.keys,
        context: contextPathLabel(stack),
        reason: own ? 'shadowed' : 'unbound',
        winner:
          winner?.command ?? (winner && 'command' in winner.entry ? winner.entry.command : null),
        winnerKeys: winner?.keys ?? null,
        winnerContext: winner?.context ?? null,
      })
    }
  }
  return { bindings: configured.bindings, report }
}

function bindingInputs(binding: PlatformKeyBinding, platform: PlatformName) {
  return binding.chord.map((stroke) => {
    const parsed = parseRegisterableHotkey(stroke, platform)
    return createKeyInput({
      key: parsed.key ?? '',
      code: parsed.code,
      modifiers: parsed,
    })
  })
}
