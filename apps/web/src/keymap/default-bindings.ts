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
import { chordKeys, parsedChord, type PlatformName } from '@workspace/client-core/commands/chord'
import type { KeybindingPreset } from '@workspace/client-core/commands/metadata'

import { presetRuntimeRows, oursRuntimePatches } from '@/keymap/presets/runtime'
import oursFregat from '@/keymap/presets/ours-fregat.json'
import vscodeApp from '@/keymap/presets/vscode-app.json'
import { editorCommandIdFromPlatform, editorPlatformCommandId } from '@/keymap/editor-keymap'
import { isPlatformCommandId, platformCommand } from '@/keymap/table'
import { ITEM_POSITIONS, selectItemCommandId, type PlatformKeyBinding } from '@/keymap/types'

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
  const shell = shellKeys
    ? terminalShellKeysPack.map((entry) => presetBinding(entry, platform))
    : []
  const appWidgets = applicationBindings.map<PlatformKeyBinding>(
    ({ firesWhileTyping, ...entry }) => ({
      ...presetBinding(entry, platform),
      firesWhileTyping,
    }),
  )
  const widgets = baseEditorKeymap[platform].map((entry) => presetBinding(entry, platform))
  const readOnly = readonlyDiffPack[platform].map((entry) => presetBinding(entry, platform))
  if (preset === 'vscode') {
    const app = vscodeApp.flatMap((row) => applicationBinding(row, platform))
    const editor = vscodePacks.flatMap((pack) =>
      pack[platform].map((entry) => presetBinding(entry, platform)),
    )
    const terminal = terminalDefaultPack[platform].map((entry) => presetBinding(entry, platform))
    return app.concat(appWidgets, widgets, editor, terminal, readOnly, shell)
  }
  const current = presetRuntimeRows.filter(
    (row) => row[1] === (platform === 'mac' ? 'mac' : 'linux'),
  )
  const bindings = current.map(([index, , keys, command, context, upstreamCommand, args]) => {
    const patch =
      preset === 'ours' ? oursRuntimePatches.find((entry) => entry[0] === index) : undefined
    const action = patch?.[1] ?? command
    return presetBinding(
      {
        keys,
        command: action === null ? null : (editorCommandIdFromPlatform(action) ?? action),
        context: patch?.[2] ?? context,
        ...(args === undefined ? {} : { args }),
        source: 'default',
      },
      platform,
      upstreamCommand,
    )
  })
  const fregat = preset === 'ours' ? fregatBindings(platform, bindings) : []
  const cancel = editorCancelRows(platform).map((entry) => presetBinding(entry, platform))
  return appWidgets.concat(widgets, bindings, fregat, cancel, readOnly, shell).map(itemKeyTyping)
}

const ITEM_COMMANDS: ReadonlySet<string> = new Set<string>(ITEM_POSITIONS.map(selectItemCommandId))
  .add('workspace.nextItem')
  .add('workspace.previousItem')

/**
 * Zed's tab keys act in every pane, the terminal and the chat composer included, so the Zed-based
 * layouts fire them while typing. Alt+digit types no character outside macOS; AltGr text and
 * keypad Alt codes still type. The VS Code layout leaves them to the shell, as VS Code does.
 */
function itemKeyTyping(binding: PlatformKeyBinding): PlatformKeyBinding {
  if (!binding.command || !ITEM_COMMANDS.has(binding.command)) return binding
  return { ...binding, firesWhileTyping: true }
}

const EDITOR_CANCEL_COMMANDS: ReadonlySet<string> = new Set([
  'closeFind',
  'closeParameterHints',
  'hideSuggestWidget',
])

/**
 * Zed's Escape (`editor::Cancel`) closes the editor's open widgets: the completion list first,
 * then the signature hint, then find. Fregat has a narrower command for each, so the Zed-based
 * layouts take their Escape rows from the VS Code packs; later rows win ties.
 */
function editorCancelRows(platform: PlatformName) {
  const find: EditorKeymapPack[PlatformName] = vscodeFindPack[platform]
  return find
    .concat(suggestPack[platform])
    .filter(
      (entry) =>
        isEscape(entry.keys) && entry.command !== null && EDITOR_CANCEL_COMMANDS.has(entry.command),
    )
}

function isEscape(keys: KeymapEntry['keys']) {
  if (typeof keys === 'string') return keys === 'Escape'
  if (keys.length !== 1) return false
  const [stroke] = keys
  return (
    typeof stroke === 'object' &&
    stroke.key === 'Escape' &&
    !stroke.alt &&
    !stroke.ctrl &&
    !stroke.mod &&
    !stroke.shift &&
    !stroke.meta
  )
}

type ApplicationRow = (typeof vscodeApp)[number]
type Override = (typeof oursFregat)[number]

/**
 * Fregat's own commands, which Zed has no action for, keep their application keys in `ours`.
 * A key Zed already uses in an overlapping context moves per `ours-fregat.json`.
 */
function fregatBindings(
  platform: PlatformName,
  zedBindings: readonly PlatformKeyBinding[],
): readonly PlatformKeyBinding[] {
  const bound = new Set<string | null>(zedBindings.map(({ command }) => command))
  return vscodeApp.flatMap((row) => {
    if (bound.has(row.command)) return []
    return applicationBinding(row, platform, oursOverride(row, platform))
  })
}

function oursOverride(row: ApplicationRow, platform: PlatformName): Override | undefined {
  return oursFregat.find(
    (entry) =>
      entry.command === row.command &&
      entry.keys === row.keys &&
      (!entry.platforms || entry.platforms.includes(platform)),
  )
}

function applicationBinding(
  row: ApplicationRow,
  platform: PlatformName,
  override?: Override,
): PlatformKeyBinding[] {
  if (row.platforms && !row.platforms.includes(platform)) return []
  if (!isPlatformCommandId(row.command)) return []
  const replacement: { readonly keys?: string; readonly context?: string } =
    override?.replacement ?? {}
  return [
    presetBinding(
      {
        keys: replacement.keys ?? row.keys,
        command: editorCommandIdFromPlatform(row.command) ?? row.command,
        context: replacement.context ?? areaContext(row.pane, row.command),
        source: 'default',
        preventDefault: row.preventDefault,
        stopPropagation: row.stopPropagation,
      },
      platform,
      row.vscodeCommandId,
      row.yieldsToTextEntry,
    ),
  ]
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
