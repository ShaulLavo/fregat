import terminalDefaults from '@/commands/presets/default.json'
import type { KeybindingOverrides } from '@workspace/contracts'
import { commandById, type CommandId } from '@workspace/client-core/commands/catalog'
import {
  isBindableChord,
  normalizedChord,
  chordStrokes,
  parseKeyStroke,
} from '@workspace/client-core/commands/chord'
import { FOCUS_AREAS, type FocusArea } from '@workspace/client-core/commands/focus'
import {
  bindingsForInput,
  compileKeymap,
  createKeyInput,
  parseHotkey,
  parseKeyContext,
} from '@fregat/hotkeys'

export type TerminalBinding = {
  readonly command: CommandId | null
  readonly keys: string
  readonly pane?: FocusArea | 'any'
  readonly context?: string
  readonly unbind?: string
  readonly source: 'default' | 'user'
}
export type BindingDiagnostic = {
  readonly command: string
  readonly keys: string | null
  readonly reason: string
}

export function commandShortcut(bindings: readonly TerminalBinding[], command: CommandId) {
  const keymap = compileKeymap(
    bindings.map((binding) => ({
      keys: binding.keys,
      context: terminalBindingContext(binding),
      source: binding.source,
      ...('unbind' in binding && binding.unbind
        ? { unbind: binding.unbind }
        : { command: binding.command }),
    })),
    'linux',
  )
  const contexts = FOCUS_AREAS.map((area) => [
    parseKeyContext('Workspace'),
    parseKeyContext(terminalBindingContext({ pane: area })),
  ])
  return (
    bindings
      .filter((binding, index) => {
        if (binding.unbind || binding.command !== command) return false
        const inputs = binding.keys.split(' ').map((stroke) => {
          const parsed = parseHotkey(stroke, 'linux')
          return createKeyInput({
            key: parsed.key ?? 'Unidentified',
            code: parsed.code,
            modifiers: parsed,
          })
        })
        return contexts.some(
          (stack) => bindingsForInput(keymap, inputs, stack).bindings[0]?.index === index,
        )
      })
      .map((binding) => binding.keys)
      .join(' / ') || 'unassigned'
  )
}

export function effectiveTerminalBindings(overrides: KeybindingOverrides, kitty = false) {
  const diagnostics: BindingDiagnostic[] = []
  const bindings: TerminalBinding[] = terminalDefaults.flatMap(
    (row): readonly TerminalBinding[] => {
      const command = commandById(row.command)
      if (!command || (row.terminalProtocol && !kitty)) return []
      return [
        {
          command: command.id,
          keys: terminalChord(row.keys),
          pane: FOCUS_AREAS.find((area) => area === row.pane) ?? 'any',
          context: terminalBindingContext({ pane: row.pane }),
          source: 'default',
        },
      ]
    },
  )
  for (const entry of overrides) {
    const id = 'command' in entry ? entry.command : entry.unbind
    if (id === null) {
      const reason = terminalBindingReason(null, entry.keys, kitty)
      if (reason) {
        diagnostics.push({ command: 'Key reservation', keys: entry.keys, reason })
        continue
      }
      bindings.push({
        command: null,
        keys: terminalChord(entry.keys),
        context: entry.context,
        source: 'user',
      })
      continue
    }
    const command = commandById(id)
    if (!command) {
      diagnostics.push({ command: id, keys: entry.keys, reason: 'Unknown command.' })
      continue
    }
    const reason = terminalBindingReason(command.id, entry.keys, kitty)
    if (reason) {
      diagnostics.push({ command: id, keys: entry.keys, reason })
      continue
    }
    bindings.push({
      command: command.id,
      keys: terminalChord(entry.keys),
      context: entry.context,
      source: 'user',
      ...('unbind' in entry ? { unbind: entry.unbind } : {}),
    })
  }
  const compiled = compileKeymap(
    bindings.map((binding) => ({
      keys: binding.keys,
      context: terminalBindingContext(binding),
      source: binding.source,
      ...(binding.unbind ? { unbind: binding.unbind } : { command: binding.command }),
    })),
    'linux',
  )
  const stacks = FOCUS_AREAS.map((area) => [
    parseKeyContext('Workspace'),
    parseKeyContext(terminalBindingContext({ pane: area })),
  ])
  for (const [index, binding] of bindings.entries()) {
    if (binding.unbind || binding.command === null) continue
    const inputs = binding.keys.split(' ').map((stroke) => {
      const parsed = parseHotkey(stroke, 'linux')
      return createKeyInput({
        key: parsed.key ?? 'Unidentified',
        code: parsed.code,
        modifiers: parsed,
      })
    })
    const winners = new Set<string>()
    for (const stack of stacks) {
      const selected = bindingsForInput(compiled, inputs, stack).bindings
      if (!selected.some((candidate) => candidate.index === index)) continue
      const winner = selected[0] ? bindings[selected[0].index] : undefined
      if (winner?.source === 'user' && winner.command !== binding.command)
        winners.add(winner.command ?? 'a key reservation')
    }
    for (const winner of winners)
      diagnostics.push({
        command: binding.command,
        keys: binding.keys,
        reason: `Shadowed by ${winner}.`,
      })
  }
  return { bindings, diagnostics }
}

export function terminalBindingContext(binding: {
  readonly context?: string
  readonly pane?: string
}): string {
  if (binding.context !== undefined) return binding.context
  const contexts: Readonly<Record<string, string>> = {
    editor: 'Editor',
    terminal: 'Terminal',
    chat: 'Chat',
    settings: 'Settings',
    'file-tree': 'FileTree',
    git: 'Git',
    search: 'Search',
    dialog: 'Dialog',
    logs: 'Logs',
    problems: 'Problems',
    'command-palette': 'CommandPalette',
  }
  return binding.pane ? (contexts[binding.pane] ?? 'Workspace') : 'Workspace'
}

export function terminalBindingReason(
  command: CommandId | null,
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
    if (
      command !== null &&
      stroke.ctrl &&
      stroke.key.toUpperCase() === 'C' &&
      command !== 'workspace.quit'
    )
      return 'Ctrl+C belongs to Quit.'
    if (
      command !== null &&
      stroke.ctrl &&
      stroke.key.toUpperCase() === 'Z' &&
      command !== 'workspace.suspend'
    )
      return 'Ctrl+Z belongs to Suspend.'
    if (stroke.ctrl && !kitty && (stroke.shift || !/^[a-z]$/iu.test(stroke.key)))
      return 'This shortcut requires an enhanced Kitty keyboard.'
    if (index > 0 && (stroke.ctrl || stroke.alt))
      return 'Use a plain letter or navigation key for the second stroke.'
  }
  if (strokes.length > 1 && !strokes[0].ctrl) return 'A terminal chord must start with Control.'
  return null
}

function terminalChord(keys: string) {
  return normalizedChord(keys, 'linux').replaceAll('Mod+', 'Ctrl+')
}
