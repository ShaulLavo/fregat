import { terminalDefaultPack, terminalShellKeysPack } from 'ghostty-webgpu'
import { applicationBindings } from '@/keymap/presets/application'
import {
  baseEditorKeymap,
  readonlyDiffPack,
  suggestPack,
  vscodeNavigationPack,
  vscodeSelectionPack,
  vscodeEditingPack,
  vscodeAdvancedEditingPack,
  vscodeMultiCursorPack,
  vscodeFindPack,
  vscodeFoldingPack,
  vscodeLspNavigationPack,
  vscodeLspEditingPack,
  vscodeInlineSuggestPack,
  type EditorKeymapPack,
} from '@singapore-editor/core/keymap'
import { detectPlatform, type KeymapEntry } from '@fregat/hotkeys'
import {
  chordKeys,
  isBindableChord,
  parsedChord,
  type PlatformName,
} from '@workspace/client-core/commands/chord'
import type { KeybindingPreset } from '@workspace/client-core/commands/metadata'

import ours from '@/keymap/presets/ours.json'
import zed from '@/keymap/presets/zed.json'
import vscodeApp from '@/keymap/presets/vscode-app.json'
import { editorCommandIdFromPlatform, editorPlatformCommandId } from '@/keymap/editor-keymap'
import { isPlatformCommandId, platformCommand } from '@/keymap/table'
import type { PlatformKeyBinding } from '@/keymap/types'

export type UnmappedPresetBinding = {
  readonly platform: string
  readonly context: string
  readonly command: string
  readonly keys: string
  readonly reason: string
}

type ZedRow = (typeof zed)[number]

const vscodePacks: readonly EditorKeymapPack[] = [
  vscodeNavigationPack,
  vscodeSelectionPack,
  vscodeEditingPack,
  vscodeAdvancedEditingPack,
  vscodeMultiCursorPack,
  vscodeFindPack,
  vscodeFoldingPack,
  vscodeLspNavigationPack,
  vscodeLspEditingPack,
  vscodeInlineSuggestPack,
  suggestPack,
]

export function defaultPlatformKeyBindings(
  platform: PlatformName = detectPlatform(),
  preset: KeybindingPreset = 'ours',
  shellKeys = false,
): readonly PlatformKeyBinding[] {
  return presetPlatformKeyBindings(platform, preset, shellKeys).bindings
}

export function presetPlatformKeyBindings(
  platform: PlatformName = detectPlatform(),
  preset: KeybindingPreset = 'ours',
  shellKeys = false,
) {
  const shell = shellKeys
    ? terminalShellKeysPack.map((entry) => presetBinding(entry, platform))
    : []
  const appWidgets = applicationBindings.map(({ firesWhileTyping, ...entry }) => ({
    ...presetBinding(entry, platform),
    firesWhileTyping,
  }))
  const widgets = baseEditorKeymap[platform].map((entry) => presetBinding(entry, platform))
  const readOnly = readonlyDiffPack[platform].map((entry) => presetBinding(entry, platform))
  if (preset === 'vscode') {
    const app = vscodeApp.flatMap((row) => {
      if (row.platforms && !row.platforms.includes(platform)) return []
      if (row.presets && !row.presets.includes('vscode')) return []
      if (!isPlatformCommandId(row.command)) return []
      const context = areaContext(row.pane, row.command)
      return [
        presetBinding(
          {
            keys: row.keys,
            command: editorCommandIdFromPlatform(row.command) ?? row.command,
            context,
            source: 'default',
            preventDefault: row.preventDefault,
            stopPropagation: row.stopPropagation,
          },
          platform,
          row.vscodeCommandId,
          row.yieldsToTextEntry,
        ),
      ]
    })
    const editor = vscodePacks.flatMap((pack) =>
      pack[platform].map((entry) => presetBinding(entry, platform)),
    )
    const terminal = terminalDefaultPack[platform].map((entry) => presetBinding(entry, platform))
    return {
      bindings: [...app, ...appWidgets, ...widgets, ...editor, ...terminal, ...readOnly, ...shell],
      unmapped: [],
    }
  }
  const rows: readonly ZedRow[] = preset === 'ours' ? ours : zed
  const current = rows.filter((row) => row.platform === (platform === 'mac' ? 'mac' : 'linux'))
  const bindings: PlatformKeyBinding[] = []
  const unmapped: UnmappedPresetBinding[] = []
  for (const row of current) {
    if ('reserved' in row && row.reserved && row.context && row.reason === null) {
      bindings.push(
        presetBinding(
          { keys: row.keys, command: null, context: row.context, source: 'default' },
          platform,
          row.upstreamCommand,
        ),
      )
      continue
    }
    if (
      !row.command ||
      !row.context ||
      !isPlatformCommandId(row.command) ||
      !isBindableChord(row.keys)
    ) {
      unmapped.push({
        platform,
        context: row.context ?? row.upstreamContext,
        command: row.upstreamCommand,
        keys: row.keys,
        reason:
          row.reason ??
          (isBindableChord(row.keys)
            ? 'The command is unavailable in this client.'
            : 'The key is unavailable in this client.'),
      })
      continue
    }
    bindings.push(
      presetBinding(
        {
          keys: row.keys,
          command: editorCommandIdFromPlatform(row.command) ?? row.command,
          context: row.context,
          ...('args' in row ? { args: row.args } : {}),
          source: 'default',
        },
        platform,
        row.upstreamCommand,
      ),
    )
  }
  return { bindings: [...appWidgets, ...widgets, ...bindings, ...readOnly, ...shell], unmapped }
}

export function presetBinding(
  entry: KeymapEntry,
  platform: PlatformName,
  upstreamCommandId?: string,
  yieldsToTextEntry?: boolean,
): PlatformKeyBinding {
  const chord = typeof entry.keys === 'string' ? parsedChord(entry.keys, platform) : entry.keys
  const rawCommand = 'command' in entry ? entry.command : entry.unbind
  const candidate = rawCommand === null ? null : platformCommand(rawCommand)
  const editorCandidate =
    rawCommand === null ? null : platformCommand(editorPlatformCommandId(rawCommand))
  const command = candidate?.id ?? editorCandidate?.id ?? null
  const local = command ? editorCommandIdFromPlatform(command) : null
  let runtimeEntry = entry
  if (local)
    runtimeEntry = 'command' in entry ? { ...entry, command: local } : { ...entry, unbind: local }
  const context =
    local && entry.source !== 'user' && entry.context
      ? editorPresetContext(entry.context)
      : entry.context
  return {
    entry: {
      ...runtimeEntry,
      source: entry.source ?? 'default',
      context: context ?? 'Workspace',
    },
    chord,
    command,
    context,
    keys: chordKeys(chord, platform),
    source: entry.source ?? 'default',
    upstreamCommandId,
    yieldsToTextEntry,
  }
}

function editorPresetContext(context: string): string {
  if (!/\bEditor\b/u.test(context) || context.includes('>') || /\bEditorWidget\b/u.test(context))
    return context
  // Hosted fields are descendants of Editor; generic document rows stay in its text input.
  return `(${context}) && !EditorWidget`
}

function areaContext(area: string | undefined, command: string): string {
  if (
    area === 'global' &&
    (command === 'workspace.undoSessionAction' || command === 'workspace.redoSessionAction')
  )
    return 'Workspace && !Editor && !Terminal && !FileTree'
  const contexts: Readonly<Record<string, string>> = {
    editor: 'Editor',
    terminal: 'Terminal',
    chat: 'Chat',
    settings: 'Settings',
    'file-tree': 'Sidebar > FileTree',
    git: 'Sidebar > Git',
    search: 'Sidebar > Search',
    dialog: 'Dialog',
    logs: 'Logs',
    problems: 'Problems',
    'command-palette': 'CommandPalette',
  }
  return area ? (contexts[area] ?? 'Workspace') : 'Workspace'
}
