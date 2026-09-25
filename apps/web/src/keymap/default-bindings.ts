import {
  defaultEditorKeyBindings,
  vscodeEditorKeyBindings,
  type EditorKeyBinding,
} from '@singapore-editor/core/keymap'
import { detectPlatform } from '@tanstack/hotkeys'

import { chordKeys } from '@workspace/client-core/commands/chord'

import { editorCommands } from '@/keymap/editor-commands'
import { commandHotkeyMeta } from '@/keymap/command-registry'
import type { CommandKeyDefault, KeybindingPreset } from '@workspace/client-core/commands/metadata'
import { platformCommands, type CommandEntry } from '@/keymap/table'
import type { KeyChord, PlatformCommandId, PlatformKeyBinding } from '@/keymap/types'

export type UnmappedKeyBinding = {
  readonly command: string
  readonly keys: string
  readonly reason: string
}

type PlatformName = ReturnType<typeof detectPlatform>

/**
 * A hotkey the app claims from the browser without dispatching anything. It has
 * no command, so it cannot live in the command table.
 */
type ReservedHotkey = {
  readonly chord: KeyChord
  readonly pane?: PlatformKeyBinding['pane']
  readonly platforms?: readonly PlatformName[]
  readonly vscodeCommandId?: string
}

export function defaultPlatformKeyBindings(
  platform: PlatformName = detectPlatform(),
  preset: KeybindingPreset = 'default',
): readonly PlatformKeyBinding[] {
  return presetPlatformKeyBindings(platform, preset).bindings
}

export function presetPlatformKeyBindings(
  platform: PlatformName = detectPlatform(),
  preset: KeybindingPreset = 'default',
) {
  const pack = editorPack(platform, preset)
  const bindings: PlatformKeyBinding[] = platformCommands.flatMap((command) =>
    commandBindings(command, platform, preset),
  )
  const unmapped: UnmappedKeyBinding[] = []
  for (const row of pack) {
    const command = editorCommands.find((entry) => entry.id === `editor.${row.command}`)
    const keys = chordKeys(row.chord, platform)
    if (!command) {
      unmapped.push({
        command: row.command,
        keys,
        reason: 'Editor preset command is not registered in Platform.',
      })
      continue
    }
    bindings.push({
      chord: row.chord,
      command: command.id,
      editorWhen: row.when,
      keys,
      meta: commandHotkeyMeta(command.id),
      pane: 'editor',
      preventDefault: row.preventDefault,
      source: 'default',
      stopPropagation: row.stopPropagation,
      vscodeCommandId: command.vscodeCommandIds?.[0],
    })
  }
  const reservations = reservedBrowserHotkeys.flatMap((chord) => reservedBinding(chord, platform))
  bindings.push(...reservations)
  unmapped.push(
    ...reservations.flatMap((binding) =>
      binding.vscodeCommandId
        ? [
            {
              command: binding.vscodeCommandId,
              keys: binding.keys,
              reason: 'Reserved by the browser host without command dispatch.',
            },
          ]
        : [],
    ),
  )
  const boundCommands = new Set(bindings.map((binding) => binding.command))
  const omitted = editorCommands
    .filter((command) => !boundCommands.has(command.id))
    .map((command) => command.id)
  return { bindings, omitted, unmapped }
}

/**
 * Both modes edit with the VS Code pack. On macOS VS Code folds with Cmd+Option+[ and ],
 * which Platform mode gives to previous and next item, so folding keeps the native chords.
 */
function editorPack(platform: PlatformName, preset: KeybindingPreset): readonly EditorKeyBinding[] {
  const pack = vscodeEditorKeyBindings(platform)
  if (preset === 'vscode' || platform !== 'mac') return pack

  const folding = new Map(
    defaultEditorKeyBindings(platform)
      .filter((row) => platformFoldingCommands.has(row.command))
      .map((row) => [row.command, row.chord]),
  )
  return pack.map((row) => {
    const chord = folding.get(row.command)
    return chord ? { ...row, chord } : row
  })
}

const platformFoldingCommands: ReadonlySet<string> = new Set([
  'editor.fold',
  'editor.unfold',
  'editor.foldRecursively',
  'editor.unfoldRecursively',
])

function commandBindings(
  command: CommandEntry,
  platform: PlatformName,
  preset: KeybindingPreset,
): readonly PlatformKeyBinding[] {
  if (!command.keys) return []

  return command.keys.flatMap((key) => keyBinding(key, command.id, platform, preset))
}

function keyBinding(
  key: CommandKeyDefault,
  command: PlatformCommandId,
  platform: PlatformName,
  preset: KeybindingPreset,
): readonly PlatformKeyBinding[] {
  if (!matchesPlatform(key.platforms, platform)) return []
  if (key.presets && !key.presets.includes(preset)) return []

  return [
    {
      command,
      chord: key.chord,
      keys: chordKeys(key.chord, platform),
      meta: commandHotkeyMeta(command),
      pane: key.pane ?? 'any',
      preventDefault: key.preventDefault,
      source: 'default',
      stopPropagation: key.stopPropagation,
      vscodeCommandId: key.vscodeCommandId,
      yieldsToTextEntry: key.yieldsToTextEntry,
    },
  ]
}

function reservedBinding(
  chord: ReservedHotkey,
  platform: PlatformName,
): readonly PlatformKeyBinding[] {
  if (!matchesPlatform(chord.platforms, platform)) return []

  return [
    {
      command: null,
      chord: chord.chord,
      keys: chordKeys(chord.chord, platform),
      meta: undefined,
      pane: chord.pane ?? 'any',
      preventDefault: true,
      source: 'default',
      stopPropagation: true,
      vscodeCommandId: chord.vscodeCommandId,
    },
  ]
}

function matchesPlatform(platforms: readonly string[] | undefined, platform: PlatformName) {
  if (!platforms) return true

  return platforms.includes(platform)
}

// TODO(electron): Bind these desktop/window-level VS Code defaults once
// Platform can own shortcuts outside the browser sandbox. Until then each one is
// swallowed and dispatches nothing, which is the whole point: binding one to a
// command would hand the hotkey back to the browser it was reserved from.
const reservedBrowserHotkeys: readonly ReservedHotkey[] = [
  { chord: ['Control+Tab'], vscodeCommandId: 'workbench.action.quickOpenPreviousEditor' },
  { chord: ['Control+Q'], vscodeCommandId: 'workbench.action.quickOpenView' },
  {
    chord: ['Mod+Alt+Tab'],
    platforms: ['mac'],
    vscodeCommandId: 'workbench.action.showAllEditors',
  },
  { chord: ['Mod+Shift+T'], vscodeCommandId: 'workbench.action.reopenClosedEditor' },
  { chord: ['Mod+1'], vscodeCommandId: 'workbench.action.focusFirstEditorGroup' },
  { chord: ['Mod+2'], vscodeCommandId: 'workbench.action.focusSecondEditorGroup' },
  { chord: ['Mod+3'], vscodeCommandId: 'workbench.action.focusThirdEditorGroup' },
  { chord: ['Mod+W'], vscodeCommandId: 'workbench.action.closeActiveEditor' },
]
