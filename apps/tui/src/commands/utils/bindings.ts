import type { KeybindingOverrides } from '@workspace/contracts'
import {
  commandMetadata,
  commandById,
  type CommandId,
} from '@workspace/client-core/commands/catalog'
import {
  chordKeys,
  isBindableChord,
  normalizedChord,
  keysConflict,
  chordStrokes,
  parseKeyStroke,
} from '@workspace/client-core/commands/chord'
import type { FocusArea } from '@workspace/client-core/commands/focus'

export type TerminalBinding = {
  readonly command: CommandId
  readonly keys: string
  readonly pane?: FocusArea | 'any'
  readonly source: 'default' | 'user'
}
export type BindingDiagnostic = {
  readonly command: string
  readonly keys: string | null
  readonly reason: string
}

export function commandShortcut(bindings: readonly TerminalBinding[], command: CommandId) {
  return (
    bindings
      .filter((binding) => binding.command === command)
      .map((binding) => binding.keys)
      .join(' / ') || 'unassigned'
  )
}

export function effectiveTerminalBindings(overrides: KeybindingOverrides, kitty = false) {
  const diagnostics: BindingDiagnostic[] = []
  const replaced = new Set<CommandId>()
  const user: TerminalBinding[] = []
  for (const [id, keys] of Object.entries(overrides)) {
    const command = commandById(id)
    const reason = command ? terminalBindingReason(command.id, keys, kitty) : 'Unknown command.'
    if (reason || !command) {
      diagnostics.push({ command: id, keys, reason: reason ?? 'Unknown command.' })
      continue
    }
    replaced.add(command.id)
    if (keys !== null)
      user.push({
        command: command.id,
        keys: terminalChord(keys),
        source: 'user',
        pane: defaultPane(command.id),
      })
  }
  const authored = commandMetadata.flatMap((command) =>
    (command.keys ?? [])
      .filter((key) => key.platforms?.includes('tui') && (!key.terminalProtocol || kitty))
      .map(
        (key) =>
          ({
            command: command.id,
            keys: chordKeys(key.chord, 'linux'),
            pane: key.pane,
            source: 'default',
          }) satisfies TerminalBinding,
      ),
  )
  const kept = authored
    .filter((binding) => !replaced.has(binding.command))
    .map((binding) => ({ ...binding, keys: terminalChord(binding.keys) }))
  const winners: TerminalBinding[] = []
  for (const binding of user.toReversed()) {
    const winner = winners.find((candidate) => collides(candidate, binding))
    if (winner) {
      diagnostics.push({
        command: binding.command,
        keys: binding.keys,
        reason: `Replaced by ${winner.command}.`,
      })
      continue
    }
    winners.push(binding)
  }
  const bindings = kept.filter((binding) => {
    const winner = winners.find((candidate) => collides(candidate, binding))
    if (winner)
      diagnostics.push({
        command: binding.command,
        keys: binding.keys,
        reason: `Replaced by ${winner.command}.`,
      })
    return !winner
  })
  return { bindings: [...winners.toReversed(), ...bindings], diagnostics }
}

export function terminalBindingReason(
  command: CommandId,
  keys: string | null,
  kitty: boolean,
): string | null {
  if (keys === null) return null
  if (!isBindableChord(keys))
    return 'Invalid shortcut. Use one stroke or a Control chord with at most two strokes.'
  const strokes = chordStrokes(keys).flatMap((stroke) => parseKeyStroke(stroke, 'linux') ?? [])
  for (const [index, stroke] of strokes.entries()) {
    if (stroke.meta) return 'Meta shortcuts are reserved by the desktop. Use Control.'
    if (stroke.ctrl && ['S', 'Q', 'I', 'J', 'M', '['].includes(stroke.key.toUpperCase()))
      return 'This Control key is ambiguous or reserved by legacy terminals.'
    if (stroke.ctrl && stroke.key.toUpperCase() === 'C' && command !== 'workspace.quit')
      return 'Ctrl+C belongs to Quit.'
    if (stroke.ctrl && stroke.key.toUpperCase() === 'Z' && command !== 'workspace.suspend')
      return 'Ctrl+Z belongs to Suspend.'
    if (stroke.ctrl && !kitty && (stroke.shift || !/^[a-z]$/iu.test(stroke.key)))
      return 'This shortcut requires an enhanced Kitty keyboard.'
    if (index > 0 && (stroke.ctrl || stroke.alt))
      return 'Use a plain letter or navigation key for the second stroke.'
  }
  if (strokes.length > 1 && !strokes[0].ctrl) return 'A terminal chord must start with Control.'
  return null
}

export function activeTerminalBindings(bindings: readonly TerminalBinding[], area: FocusArea) {
  return bindings
    .filter((binding) => !binding.pane || binding.pane === 'any' || binding.pane === area)
    .toSorted((left, right) => Number(right.pane === area) - Number(left.pane === area))
}

function collides(left: TerminalBinding, right: TerminalBinding) {
  return (left.pane ?? 'any') === (right.pane ?? 'any') && keysConflict(left.keys, right.keys)
}

function defaultPane(command: CommandId): FocusArea | 'any' {
  const metadata = commandById(command)
  const authored = metadata?.keys?.find((key) => key.platforms?.includes('tui'))
  return authored?.pane ?? (metadata?.target === 'editor' ? 'editor' : 'any')
}

function terminalChord(keys: string) {
  return normalizedChord(keys, 'linux').replaceAll('Mod+', 'Ctrl+')
}
