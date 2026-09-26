import { appKeyBindingsForPane } from '@/keymap/utils/app-bindings'
import { describe } from 'vitest'
import { parseHotkey } from '@tanstack/hotkeys'

import { expect, test as it } from '@/keymap/../../test/fixtures'
import { binding } from '@/keymap/../../test/factories/key-binding'
import { chordStrokes } from '@workspace/client-core/commands/chord'
import {
  FOCUS_AREAS,
  UNDO_OWNING_PANES,
  type FocusArea,
} from '@workspace/client-core/commands/focus'

import { activeBindings } from '@workspace/client-core/commands/bindings'
import {
  commandKeyBindings,
  keyBindingResolution,
  resolvedPlatformKeyBindings,
} from '@/keymap/active-bindings'
import { commandHotkeyMeta, platformCommandSpec } from '@/keymap/command-registry'
import { defaultPlatformKeyBindings, presetPlatformKeyBindings } from '@/keymap/default-bindings'
import type { PlatformCommandId, PlatformKeyBinding } from '@/keymap/types'

describe('activePlatformKeyBindings', () => {
  it('filters bindings by focused pane', () => {
    const bindings = [
      binding('Mod+1', { command: 'workspace.focusFileTree', pane: 'file-tree' }),
      binding('Mod+2', { command: 'workspace.focusEditor', pane: 'editor' }),
      binding('Mod+P', { command: 'workspace.openFilePicker', pane: 'any' }),
    ]

    expect(commands(activeBindings(bindings, 'editor'))).toEqual([
      'workspace.focusEditor',
      'workspace.openFilePicker',
    ])
  })

  it('prefers focused-pane bindings over global bindings for the same keys', () => {
    const bindings = [
      binding('Mod+P', { command: 'workspace.openFilePicker', pane: 'any' }),
      binding('Mod+P', { command: 'workspace.focusEditor', pane: 'editor' }),
    ]

    expect(commands(activeBindings(bindings, 'editor'))).toEqual([
      'workspace.focusEditor',
      'workspace.openFilePicker',
    ])
  })
})

describe('resolvedPlatformKeyBindings', () => {
  it('replaces every default a command had with the one hotkey the user chose', () => {
    const resolved = resolvedPlatformKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.showCommandPalette': 'Mod+Alt+K' },
      'linux',
    )

    expect(keysFor(resolved, 'workspace.showCommandPalette')).toEqual(['Mod+Alt+K'])
    expect(resolved).toContainEqual(
      expect.objectContaining({
        command: 'workspace.showCommandPalette',
        keys: 'Mod+Alt+K',
        source: 'user',
      }),
    )
  })

  it('keeps the pane and event handling the default was written with', () => {
    const resolved = resolvedPlatformKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.gotoSymbol': 'Mod+Alt+Y' },
      'linux',
    )

    expect(resolved).toContainEqual(
      expect.objectContaining({
        command: 'workspace.gotoSymbol',
        pane: 'any',
        preventDefault: true,
        vscodeCommandId: 'workbench.action.gotoSymbol',
      }),
    )
  })

  it('keeps a keyless editor command scoped to the editor when rebound', () => {
    const resolved = resolvedPlatformKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'editor.editor.action.peekDefinition': 'F1' },
      'linux',
    )

    expect(resolved).toContainEqual(
      expect.objectContaining({
        command: 'editor.editor.action.peekDefinition',
        keys: 'F1',
        pane: 'editor',
      }),
    )
    expect(commands(activeBindings(resolved, 'global'))).toContain('workspace.showCommandPalette')
    expect(commands(activeBindings(resolved, 'editor'))).toContain(
      'editor.editor.action.peekDefinition',
    )
  })

  it('leaves a command unbound when the override is an explicit null', () => {
    const resolved = resolvedPlatformKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.saveFile': null },
      'linux',
    )

    expect(keysFor(resolved, 'workspace.saveFile')).toEqual([])
  })

  it('applies an override for a command only the default table names', () => {
    // The session commands ship a binding without a command-palette spec, so a
    // registry lookup alone would silently drop their overrides.
    const resolved = resolvedPlatformKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.newSession': 'Mod+Alt+Q' },
      'linux',
    )

    expect(keysFor(resolved, 'workspace.newSession')).toEqual(['Mod+Alt+Q'])
  })

  it('ignores an override for a command this build does not have', () => {
    const resolved = resolvedPlatformKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.notACommand': 'Mod+Alt+K' },
      'linux',
    )

    expect(resolved).toEqual(defaultPlatformKeyBindings('linux'))
  })

  it('leaves the default in place when the override is not a hotkey', () => {
    const resolved = resolvedPlatformKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.saveFile': 'Mod+Nonsense' },
      'linux',
    )

    expect(keysFor(resolved, 'workspace.saveFile')).toEqual(['Mod+S'])
  })

  it('drops the binding whose key an override took instead of keeping a dead one', () => {
    const resolved = resolvedPlatformKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.saveFile': 'Mod+B' },
      'linux',
    )

    expect(keysFor(resolved, 'workspace.toggleSidebarVisibility')).toEqual([])
    expect(keysFor(resolved, 'workspace.saveFile')).toEqual(['Mod+B'])
  })

  it('keeps a binding an override only collides with in another pane', () => {
    // Mod+F is Find inside the editor and the editor keeps its own keymap, so a
    // global override of the same chord takes nothing away from it.
    const resolved = resolvedPlatformKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.togglePanel': 'Mod+F' },
      'linux',
    )

    expect(keysFor(resolved, 'editor.find')).toEqual(['Mod+F'])
    expect(keysFor(resolved, 'workspace.togglePanel')).toEqual(['Mod+F'])
  })

  it('keeps only the later of two overrides that name the same key', () => {
    const resolved = resolvedPlatformKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.saveFile': 'Mod+Alt+J', 'workspace.togglePanel': 'Mod+Alt+J' },
      'linux',
    )

    expect(keysFor(resolved, 'workspace.saveFile')).toEqual([])
    expect(keysFor(resolved, 'workspace.togglePanel')).toEqual(['Mod+Alt+J'])
  })

  it('leaves the command with its other default when only one key is taken', () => {
    const resolved = resolvedPlatformKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.togglePanel': 'F1' },
      'linux',
    )

    expect(keysFor(resolved, 'workspace.showCommandPalette')).toEqual(['Mod+Shift+P'])
  })
})

describe('commandKeyBindings', () => {
  it('reports the default binding until the user overrides it', () => {
    expect(commandKeyBindings(defaultPlatformKeyBindings('linux'), {}, 'linux')).toContainEqual({
      command: 'workspace.saveFile',
      defaultKeys: ['Mod+S'],
      effectiveKeys: ['Mod+S'],
      keys: 'Mod+S',
      shadowedBy: null,
      source: 'default',
    })
  })

  it('shows the override in force beside the defaults it replaced', () => {
    const rows = commandKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.showCommandPalette': 'Mod+Alt+K' },
      'linux',
    )

    expect(rows).toContainEqual({
      command: 'workspace.showCommandPalette',
      defaultKeys: ['Mod+Shift+P', 'F1'],
      effectiveKeys: ['Mod+Alt+K'],
      keys: 'Mod+Alt+K',
      shadowedBy: null,
      source: 'user',
    })
  })

  it('lists a command that only the user has bound', () => {
    const rows = commandKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.focusEditor': 'Mod+Alt+E' },
      'linux',
    )

    expect(rows).toContainEqual({
      command: 'workspace.focusEditor',
      defaultKeys: [],
      effectiveKeys: ['Mod+Alt+E'],
      keys: 'Mod+Alt+E',
      shadowedBy: null,
      source: 'user',
    })
  })

  it('reports an unbind as no keys at all', () => {
    const rows = commandKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.saveFile': null },
      'linux',
    )

    expect(rows).toContainEqual({
      command: 'workspace.saveFile',
      defaultKeys: ['Mod+S'],
      effectiveKeys: [],
      keys: null,
      shadowedBy: null,
      source: 'user',
    })
  })

  it('names the command that took the key instead of calling a dead binding live', () => {
    const rows = commandKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.saveFile': 'Mod+B' },
      'linux',
    )

    expect(rows).toContainEqual({
      command: 'workspace.toggleSidebarVisibility',
      defaultKeys: ['Mod+B'],
      effectiveKeys: [],
      keys: 'Mod+B',
      shadowedBy: 'workspace.saveFile',
      source: 'default',
    })
  })

  it('marks the losing override when two of them name the same key', () => {
    const rows = commandKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.saveFile': 'Mod+Alt+J', 'workspace.togglePanel': 'Mod+Alt+J' },
      'linux',
    )

    expect(rows).toContainEqual({
      command: 'workspace.saveFile',
      defaultKeys: ['Mod+S'],
      effectiveKeys: [],
      keys: 'Mod+Alt+J',
      shadowedBy: 'workspace.togglePanel',
      source: 'user',
    })
  })

  it('leaves a command alone when only one of its two defaults is taken', () => {
    const rows = commandKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.togglePanel': 'F1' },
      'linux',
    )

    expect(rows).toContainEqual({
      command: 'workspace.showCommandPalette',
      defaultKeys: ['Mod+Shift+P', 'F1'],
      effectiveKeys: ['Mod+Shift+P'],
      keys: 'Mod+Shift+P',
      shadowedBy: null,
      source: 'default',
    })
  })
})

describe('command registry', () => {
  it('exposes workspace command metadata for hotkey registrations', () => {
    expect(commandHotkeyMeta('workspace.openFilePicker')).toEqual({
      description: 'Open the workspace file picker.',
      name: 'Open file picker',
    })
  })

  it('exposes command palette and quick access commands', () => {
    expect(platformCommandSpec('workspace.showCommandPalette')).toMatchObject({
      category: 'Workspace',
      title: 'Show command palette',
    })
    expect(platformCommandSpec('workspace.showQuickAccess')).toMatchObject({
      category: 'Workspace',
      title: 'Quick Open',
    })
  })

  it('exposes editor command metadata', () => {
    expect(platformCommandSpec('editor.find')).toMatchObject({
      category: 'Editor',
      title: 'Find',
      vscodeCommandIds: ['actions.find'],
    })
    expect(platformCommandSpec('editor.toggleFindInSelection')).toMatchObject({
      category: 'Editor',
      title: 'Toggle find in selection',
      vscodeCommandIds: ['toggleFindInSelection'],
    })
  })

  it('exposes appearance commands for the command palette', () => {
    expect(platformCommandSpec('workspace.selectColorMode')).toMatchObject({
      category: 'Appearance',
      description: 'Choose light or dark mode, or follow the system.',
      title: 'Choose light / dark mode',
    })
    expect(platformCommandSpec('workspace.selectColorTheme')).toMatchObject({
      category: 'Appearance',
      description: 'Choose colors for the editor and code blocks in chat.',
      title: 'Choose code theme',
    })
    expect(platformCommandSpec('workspace.setLightTheme')).toMatchObject({
      category: 'Appearance',
      description: 'Use light mode.',
      title: 'Light mode',
    })
    expect(platformCommandSpec('workspace.setDarkTheme')).toMatchObject({
      category: 'Appearance',
      description: 'Use dark mode.',
      title: 'Dark mode',
    })
    expect(platformCommandSpec('workspace.setSystemTheme')).toMatchObject({
      category: 'Appearance',
      description: 'Follow the system light or dark mode.',
      title: 'Follow system light / dark mode',
    })
    expect(platformCommandSpec('workspace.toggleWallpaper')).toMatchObject({
      category: 'Appearance',
      description: 'Show or hide the background image or video.',
      title: 'Toggle wallpaper',
    })
  })

  it('exposes requested VS Code workspace command aliases', () => {
    for (const [command, vscodeCommandId] of requestedWorkspaceAliases) {
      expect(platformCommandSpec(command)).toMatchObject({
        category: 'Workspace',
        vscodeCommandIds: [vscodeCommandId],
      })
    }
  })

  it('exposes requested VS Code editor command aliases', () => {
    for (const [command, vscodeCommandId] of requestedEditorAliases) {
      expect(platformCommandSpec(command)).toMatchObject({
        category: 'Editor',
        vscodeCommandIds: [vscodeCommandId],
      })
    }
  })

  it('does not expose retired editor command aliases', () => {
    const commandAliases = editorCommandsWithRetiredAliases.flatMap(
      (command) => platformCommandSpec(command)?.vscodeCommandIds ?? [],
    )
    const bindingCommandIds = defaultBindingPlatforms.flatMap((platform) =>
      defaultPlatformKeyBindings(platform).flatMap((binding) =>
        binding.vscodeCommandId ? [binding.vscodeCommandId] : [],
      ),
    )

    for (const alias of retiredEditorCommandAliases) {
      expect(commandAliases).not.toContain(alias)
      expect(bindingCommandIds).not.toContain(alias)
    }
  })
})

describe('defaultPlatformKeyBindings', () => {
  it('uses VS Code command aliases for supported defaults', () => {
    expect(defaultPlatformKeyBindings('linux')).toContainEqual(
      expect.objectContaining({
        command: 'workspace.showCommandPalette',
        keys: 'Mod+Shift+P',
        vscodeCommandId: 'workbench.action.showCommands',
      }),
    )
    expect(defaultPlatformKeyBindings('linux')).toContainEqual(
      expect.objectContaining({
        command: 'workspace.showQuickAccess',
        keys: 'Mod+P',
        vscodeCommandId: 'workbench.action.quickOpen',
      }),
    )
  })

  it('resolves accidental preset duplicates while retaining conditional candidates', () => {
    for (const platform of defaultBindingPlatforms) {
      const defaults = defaultPlatformKeyBindings(platform)
      const resolution = keyBindingResolution(defaults, {}, platform)
      expect(resolution.bindings.length).toBeGreaterThan(0)
      expect(resolution.report.every((entry) => entry.bindingId.length > 0)).toBe(true)
    }
  })

  it('reserves browser-hostile desktop defaults as no-ops', () => {
    expect(defaultPlatformKeyBindings('mac')).toContainEqual(
      expect.objectContaining({
        command: null,
        keys: 'Mod+Alt+Tab',
        preventDefault: true,
        stopPropagation: true,
        vscodeCommandId: 'workbench.action.showAllEditors',
      }),
    )
    expect(defaultPlatformKeyBindings('linux')).toContainEqual(
      expect.objectContaining({
        command: null,
        chord: ['Control+Tab'],
        keys: 'Mod+Tab',
        vscodeCommandId: 'workbench.action.quickOpenPreviousEditor',
      }),
    )
    expect(defaultPlatformKeyBindings('linux')).toContainEqual(
      expect.objectContaining({
        command: null,
        keys: 'Mod+W',
        vscodeCommandId: 'workbench.action.closeActiveEditor',
      }),
    )
    expect(defaultPlatformKeyBindings('linux')).toContainEqual(
      expect.objectContaining({
        command: 'editor.goToDefinition',
        keys: 'F12',
        pane: 'editor',
        vscodeCommandId: 'editor.action.revealDefinition',
      }),
    )
    expect(defaultPlatformKeyBindings('linux', 'vscode')).toContainEqual(
      expect.objectContaining({
        command: 'editor.editor.action.goToReferences',
        keys: 'Shift+F12',
        pane: 'editor',
        vscodeCommandId: 'editor.action.goToReferences',
      }),
    )
  })

  it('uses VS Code platform-specific replace shortcuts', () => {
    expect(defaultPlatformKeyBindings('mac')).toContainEqual(
      expect.objectContaining({
        command: 'editor.findReplace',
        keys: 'Mod+Alt+F',
      }),
    )
    expect(defaultPlatformKeyBindings('linux')).toContainEqual(
      expect.objectContaining({
        command: 'editor.findReplace',
        keys: 'Mod+H',
      }),
    )
  })

  it('gives Mod+1 to the first tab or chat, or to the first editor group in VS Code mode', () => {
    const platform = defaultPlatformKeyBindings('linux')
    const vscode = defaultPlatformKeyBindings('linux', 'vscode')

    expect(keysFor(platform, 'workspace.selectItem1')).toEqual(['Mod+1'])
    expect(keysFor(platform, 'workspace.focusFirstEditorGroup')).toEqual([])
    expect(keysFor(vscode, 'workspace.focusFirstEditorGroup')).toEqual(['Mod+1'])
    expect(keysFor(vscode, 'workspace.selectItem1')).toEqual(['Alt+1', 'Mod+Alt+1'])
    for (const bindings of [platform, vscode]) {
      expect(keysFor(bindings, 'workspace.focusFileTree')).not.toContain('Mod+1')
      expect(bindings.some((binding) => binding.command === null && binding.keys === 'Mod+1')).toBe(
        false,
      )
    }
  })

  it('routes Mod+Z and Mod+Shift+Z to session history in every pane without its own undo', () => {
    const bindings = defaultPlatformKeyBindings('linux')
    const commandsIn = (pane: FocusArea, keys: string) =>
      commands(appKeyBindingsForPane(bindings, pane).filter((binding) => binding.keys === keys))

    for (const command of ['workspace.undoSessionAction', 'workspace.redoSessionAction']) {
      const session = bindings.filter((binding) => binding.command === command)
      expect(session.every((binding) => binding.yieldsToTextEntry)).toBe(true)
    }
    for (const pane of FOCUS_AREAS) {
      const undo = commandsIn(pane, 'Mod+Z')
      const redo = commandsIn(pane, 'Mod+Shift+Z')
      if (UNDO_OWNING_PANES.has(pane)) {
        expect(undo, pane).not.toContain('workspace.undoSessionAction')
        expect(redo, pane).not.toContain('workspace.redoSessionAction')
        continue
      }
      expect(undo, pane).toEqual(['workspace.undoSessionAction'])
      expect(redo, pane).toEqual(['workspace.redoSessionAction'])
    }
    expect(commandsIn('file-tree', 'Mod+Z')).toEqual(['fileTree.undo'])
    expect(commandsIn('editor', 'Mod+Z')).toContain('editor.undo')
  })

  it('binds file-tree focus globally and file filtering only inside the tree', () => {
    const bindings = defaultPlatformKeyBindings('linux')

    expect(keysFor(bindings, 'workspace.focusFileTree')).toEqual(['Mod+Shift+E'])
    expect(keysFor(bindings, 'workspace.findInFileTree')).toEqual(['Mod+F'])
    expect(commands(appKeyBindingsForPane(bindings, 'file-tree'))).toContain(
      'workspace.findInFileTree',
    )
    expect(commands(appKeyBindingsForPane(bindings, 'editor'))).not.toContain(
      'workspace.findInFileTree',
    )
  })

  it('uses VS Code default bindings for implemented edit actions', () => {
    const bindings = defaultPlatformKeyBindings('mac')

    expect(bindings).toContainEqual(
      expect.objectContaining({
        command: 'editor.deleteWordLeft',
        keys: 'Alt+Backspace',
        vscodeCommandId: 'deleteWordLeft',
      }),
    )
    expect(bindings).toContainEqual(
      expect.objectContaining({
        command: 'editor.editor.action.commentLine',
        keys: 'Mod+/',
        vscodeCommandId: 'editor.action.commentLine',
      }),
    )
    expect(bindings).toContainEqual(
      expect.objectContaining({
        command: 'editor.editor.action.selectHighlights',
        keys: 'Mod+Shift+L',
        vscodeCommandId: 'editor.action.selectHighlights',
      }),
    )
  })

  it('uses VS Code platform-specific edit bindings', () => {
    expect(defaultPlatformKeyBindings('linux')).toContainEqual(
      expect.objectContaining({
        command: 'editor.editor.action.copyLinesUpAction',
        keys: 'Mod+Alt+Shift+ArrowUp',
      }),
    )
    expect(defaultPlatformKeyBindings('windows')).toContainEqual(
      expect.objectContaining({
        command: 'editor.editor.action.copyLinesUpAction',
        keys: 'Alt+Shift+ArrowUp',
      }),
    )
    expect(defaultPlatformKeyBindings('linux')).toContainEqual(
      expect.objectContaining({
        command: 'editor.editor.action.insertCursorAbove',
        keys: 'Mod+Shift+ArrowUp',
      }),
    )
  })
})

const requestedWorkspaceAliases = [
  ['workspace.openSearchEditor', 'search.action.openNewEditor'],
  ['workspace.quickOpenPreviousEditor', 'workbench.action.quickOpenPreviousEditor'],
  ['workspace.quickOpenView', 'workbench.action.quickOpenView'],
  ['workspace.gotoSymbol', 'workbench.action.gotoSymbol'],
  ['workspace.showAllEditors', 'workbench.action.showAllEditors'],
  ['workspace.saveFile', 'workbench.action.files.save'],
  ['workspace.saveAllFiles', 'workbench.action.files.saveAll'],
  ['workspace.revertFile', 'workbench.action.files.revert'],
  ['workspace.reopenClosedEditor', 'workbench.action.reopenClosedEditor'],
  ['workspace.toggleSidebarVisibility', 'workbench.action.toggleSidebarVisibility'],
  ['workspace.togglePanel', 'workbench.action.togglePanel'],
  ['workspace.focusFirstEditorGroup', 'workbench.action.focusFirstEditorGroup'],
  ['workspace.focusSecondEditorGroup', 'workbench.action.focusSecondEditorGroup'],
  ['workspace.focusThirdEditorGroup', 'workbench.action.focusThirdEditorGroup'],
] as const satisfies readonly (readonly [PlatformCommandId, string])[]

const requestedEditorAliases = [
  ['editor.editor.action.goToReferences', 'editor.action.goToReferences'],
  ['editor.deleteWordLeft', 'deleteWordLeft'],
  ['editor.deleteWordRight', 'deleteWordRight'],
  ['editor.editor.action.deleteLines', 'editor.action.deleteLines'],
  ['editor.editor.action.copyLinesUpAction', 'editor.action.copyLinesUpAction'],
  ['editor.editor.action.copyLinesDownAction', 'editor.action.copyLinesDownAction'],
  ['editor.editor.action.moveLinesUpAction', 'editor.action.moveLinesUpAction'],
  ['editor.editor.action.moveLinesDownAction', 'editor.action.moveLinesDownAction'],
  ['editor.editor.action.insertLineBefore', 'editor.action.insertLineBefore'],
  ['editor.editor.action.insertLineAfter', 'editor.action.insertLineAfter'],
  ['editor.editor.action.commentLine', 'editor.action.commentLine'],
  ['editor.editor.action.blockComment', 'editor.action.blockComment'],
  ['editor.editor.action.indentLines', 'editor.action.indentLines'],
  ['editor.editor.action.outdentLines', 'editor.action.outdentLines'],
  ['editor.editor.action.insertCursorAbove', 'editor.action.insertCursorAbove'],
  ['editor.editor.action.insertCursorBelow', 'editor.action.insertCursorBelow'],
  ['editor.editor.action.selectHighlights', 'editor.action.selectHighlights'],
  ['editor.editor.action.changeAll', 'editor.action.changeAll'],
  [
    'editor.editor.action.moveSelectionToNextFindMatch',
    'editor.action.moveSelectionToNextFindMatch',
  ],
] as const satisfies readonly (readonly [PlatformCommandId, string])[]

const retiredEditorCommandAliases = ['toggleSearchScope', 'deleteLeft', 'deleteRight'] as const

const editorCommandsWithRetiredAliases = [
  'editor.toggleFindInSelection',
  'editor.deleteBackward',
  'editor.deleteForward',
] as const satisfies readonly PlatformCommandId[]

const defaultBindingPlatforms = ['mac', 'windows', 'linux'] as const

function commands(bindings: readonly PlatformKeyBinding[]) {
  return bindings.map((keyBinding) => keyBinding.command)
}

function keysFor(bindings: readonly PlatformKeyBinding[], command: PlatformCommandId) {
  return bindings.filter((binding) => binding.command === command).map((binding) => binding.keys)
}

it('resolves a two-stroke override without collapsing to its last stroke', () => {
  const resolved = resolvedPlatformKeyBindings(
    defaultPlatformKeyBindings('linux'),
    { 'workspace.showSettings': 'Mod+K Mod+B' },
    'linux',
  )
  const settings = resolved.find((candidate) => candidate.command === 'workspace.showSettings')
  expect(settings?.keys).toBe('Mod+K Mod+B')
  expect(settings?.chord).toHaveLength(2)
})

it.each([
  ['Mod+K Mod+S', 'Mod+K'],
  ['Mod+K', 'Mod+K Mod+S'],
])('reports default %s shadowed by user %s', (defaultKeys, overrideKeys) => {
  const defaults = [binding(defaultKeys, { command: 'workspace.showSettings' }), binding('Mod+S')]
  const overrides = { 'workspace.saveFile': overrideKeys }
  const resolved = resolvedPlatformKeyBindings(defaults, overrides, 'linux')
  expect(commands(resolved)).toEqual(['workspace.saveFile'])
  expect(commandKeyBindings(defaults, overrides, 'linux')).toContainEqual(
    expect.objectContaining({
      command: 'workspace.showSettings',
      shadowedBy: 'workspace.saveFile',
    }),
  )
})

it('reports a duplicate chord override as shadowed by the later override', () => {
  const rows = commandKeyBindings(
    defaultPlatformKeyBindings('linux'),
    {
      'workspace.saveFile': 'Mod+K Mod+V',
      'workspace.togglePanel': 'Mod+K Mod+V',
    },
    'linux',
  )
  expect(rows).toContainEqual(
    expect.objectContaining({ command: 'workspace.saveFile', shadowedBy: 'workspace.togglePanel' }),
  )
})

it('keeps sibling chord overrides in the same pane', () => {
  const resolved = resolvedPlatformKeyBindings(
    defaultPlatformKeyBindings('linux'),
    {
      'workspace.saveFile': 'Mod+K Mod+V',
      'workspace.togglePanel': 'Mod+K Mod+B',
    },
    'linux',
  )
  expect(keysFor(resolved, 'workspace.saveFile')).toEqual(['Mod+K Mod+V'])
  expect(keysFor(resolved, 'workspace.togglePanel')).toEqual(['Mod+K Mod+B'])
})

it('keeps a sibling chord when its conflicting prefix override is shadowed', () => {
  const defaults = defaultPlatformKeyBindings('linux')
  const overrides = {
    'workspace.saveFile': 'Mod+K Mod+V',
    'workspace.toggleSidebarVisibility': 'Mod+K',
    'workspace.togglePanel': 'Mod+K Mod+B',
  }
  const resolved = resolvedPlatformKeyBindings(defaults, overrides, 'linux')

  expect(keysFor(resolved, 'workspace.saveFile')).toEqual(['Mod+K Mod+V'])
  expect(keysFor(resolved, 'workspace.toggleSidebarVisibility')).toEqual([])
  expect(keysFor(resolved, 'workspace.togglePanel')).toEqual(['Mod+K Mod+B'])
  expect(commandKeyBindings(defaults, overrides, 'linux')).toContainEqual(
    expect.objectContaining({ command: 'workspace.saveFile', shadowedBy: null }),
  )
})

it('keeps a default chord when its conflicting prefix override is shadowed', () => {
  const defaults = defaultPlatformKeyBindings('linux')
  const overrides = {
    'workspace.toggleSidebarVisibility': 'Mod+K',
    'workspace.togglePanel': 'Mod+K Mod+B',
  }
  const resolved = resolvedPlatformKeyBindings(defaults, overrides, 'linux')

  expect(keysFor(resolved, 'workspace.showSettings')).toEqual(['Mod+,', 'Mod+K Mod+S'])
  expect(keysFor(resolved, 'workspace.toggleSidebarVisibility')).toEqual([])
  expect(keysFor(resolved, 'workspace.togglePanel')).toEqual(['Mod+K Mod+B'])
})

it.each(defaultBindingPlatforms)('default chord prefixes on %s carry Ctrl or Meta', (platform) => {
  const defaults = defaultPlatformKeyBindings(platform)
  const chords = defaults.filter((candidate) => candidate.chord.length > 1)
  expect(chords.length).toBeGreaterThan(1)
  for (const candidate of chords) {
    const first = chordStrokes(candidate.keys)[0]
    const parsed = parseHotkey(first, platform)
    expect(parsed.ctrl || parsed.meta).toBe(true)
  }
})

it('retains the first settings shortcut while offering the new chord as a second default', () => {
  expect(keysFor(defaultPlatformKeyBindings('linux'), 'workspace.showSettings')).toEqual([
    'Mod+,',
    'Mod+K Mod+S',
  ])
})

it('keeps conditional alternatives in preset and pane order', () => {
  const find = {
    ...binding('Escape', { command: 'editor.closeFind', pane: 'editor' }),
    editorWhen: ['findVisible'] as const,
  }
  const selection = {
    ...binding('Escape', { command: 'editor.clearSecondarySelections', pane: 'editor' }),
    editorWhen: ['!findVisible'] as const,
  }
  const global = binding('Escape', { command: 'workspace.showSettings', pane: 'any' })
  const resolved = keyBindingResolution([global, find, selection], {}, 'linux')
  expect(resolved.bindings).toEqual([global, find, selection])
  expect(activeBindings(resolved.bindings, 'editor')).toEqual([find, selection, global])
  expect(resolved.report).toEqual([])
})

it('reports accidental duplicates even without overrides', () => {
  const first = binding('Mod+J', { command: 'workspace.togglePanel' })
  const second = binding('Mod+J', { command: 'workspace.toggleSidebarVisibility' })
  const resolved = keyBindingResolution([first, second], {}, 'linux')
  expect(resolved.bindings).toEqual([first])
  expect(resolved.report).toEqual([
    expect.objectContaining({
      command: second.command,
      keys: second.keys,
      reason: 'duplicate',
      winner: first.command,
    }),
  ])
})

it('reports partial alias loss without marking the command fully shadowed', () => {
  const defaults = [
    binding('Mod+,', { command: 'workspace.showSettings' }),
    binding('Mod+K Mod+S', { command: 'workspace.showSettings' }),
  ]
  const overrides = { 'workspace.togglePanel': 'Mod+K Mod+S' }
  expect(commandKeyBindings(defaults, overrides, 'linux')).toContainEqual(
    expect.objectContaining({
      command: 'workspace.showSettings',
      effectiveKeys: ['Mod+,'],
      shadowedBy: null,
    }),
  )
  expect(keyBindingResolution(defaults, overrides, 'linux').report).toContainEqual(
    expect.objectContaining({
      command: 'workspace.showSettings',
      keys: 'Mod+K Mod+S',
      reason: 'override',
      winner: 'workspace.togglePanel',
    }),
  )
})

it('reports invalid spelling independently from unknown commands', () => {
  const defaults = [binding('Mod+S', { command: 'workspace.saveFile' })]
  const resolved = keyBindingResolution(
    defaults,
    {
      'workspace.saveFile': 'NotAHotkey',
      'workspace.doesNotExist': 'Mod+J',
    },
    'linux',
  )
  expect(resolved.bindings).toEqual(defaults)
  expect(resolved.report).toEqual([
    expect.objectContaining({ command: 'workspace.saveFile', reason: 'invalid-chord' }),
    expect.objectContaining({ command: 'workspace.doesNotExist', reason: 'unknown-command' }),
  ])
})

it.each(defaultBindingPlatforms)(
  'imports the complete Editor pack in both modes on %s',
  (platform) => {
    const native = presetPlatformKeyBindings(platform, 'default')
    const vscode = presetPlatformKeyBindings(platform, 'vscode')
    expect(
      native.unmapped.every(
        (row) => row.reason === 'Reserved by the browser host without command dispatch.',
      ),
    ).toBe(true)
    expect(vscode.unmapped).toEqual(native.unmapped)
    for (const preset of [native, vscode]) {
      expect(preset.bindings).toContainEqual(
        expect.objectContaining({ command: 'editor.editor.action.toggleTabFocusMode' }),
      )
      expect(preset.bindings).toContainEqual(
        expect.objectContaining({ command: 'editor.goToDefinition', keys: 'F12' }),
      )
      expect(preset.bindings).toContainEqual(
        expect.objectContaining({ command: 'editor.editor.foldAll' }),
      )
    }
  },
)

it.each(defaultBindingPlatforms)(
  'edits with the VS Code pack in Platform mode on %s, except folding on macOS',
  (platform) => {
    const editorRows = (preset: 'default' | 'vscode') =>
      defaultPlatformKeyBindings(platform, preset)
        .filter((row) => row.pane === 'editor' && row.command?.startsWith('editor.'))
        .map((row) => `${row.keys} ${row.command}`)
    const platformRows = editorRows('default')
    const vscodeRows = editorRows('vscode')
    const onlyPlatform = platformRows.filter((row) => !vscodeRows.includes(row))
    const onlyVscode = vscodeRows.filter((row) => !platformRows.includes(row))
    if (platform !== 'mac') {
      expect(onlyPlatform).toEqual([])
      expect(onlyVscode).toEqual([])
      return
    }
    expect(onlyPlatform.toSorted()).toEqual([
      'Mod+K Mod+Shift+[ editor.editor.foldRecursively',
      'Mod+K Mod+Shift+] editor.editor.unfoldRecursively',
      'Mod+K Mod+[ editor.editor.fold',
      'Mod+K Mod+] editor.editor.unfold',
    ])
    expect(onlyVscode.toSorted()).toEqual([
      'Mod+Alt+[ editor.editor.fold',
      'Mod+Alt+] editor.editor.unfold',
      'Mod+K Mod+[ editor.editor.foldRecursively',
      'Mod+K Mod+] editor.editor.unfoldRecursively',
    ])
  },
)

it('prefers an executable binding over a browser reservation in either order', () => {
  const reserved = binding('F12', { command: null, pane: 'editor' })
  const definition = binding('F12', { command: 'editor.goToDefinition', pane: 'editor' })
  for (const defaults of [
    [reserved, definition],
    [definition, reserved],
  ]) {
    const resolved = keyBindingResolution(defaults, {}, 'linux')
    expect(resolved.bindings).toEqual([definition])
    expect(resolved.report).toContainEqual(
      expect.objectContaining({
        command: null,
        keys: 'F12',
        reason: 'reservation-replaced',
        winner: 'editor.goToDefinition',
      }),
    )
  }
})
