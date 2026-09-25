import { editorCommandMutates } from '@singapore-editor/core/keymap'
import { editorCommandIdFromPlatform } from '@/keymap/editor-keymap'
import { describe } from 'vitest'
import { expect, test as it } from '../../../test/fixtures'

import { platformCommandSpecs } from '@/keymap/command-registry'
import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'
import type { CommandUndoCategory, CommandWhen } from '@workspace/client-core/commands/metadata'
import {
  hiddenPaletteCommandIds,
  platformCommand,
  platformCommands,
  type CommandEntry,
} from '@/keymap/table'
import {
  SESSION_JUMP_POSITIONS,
  sessionJumpCommandId,
  type PlatformCommandId,
} from '@/keymap/types'

/** Every hotkey the app claims from the browser without dispatching anything. */
const RESERVED_HOTKEYS = [
  'Control+Tab',
  'Control+Q',
  'Mod+Alt+Tab',
  'Mod+Shift+T',
  'Mod+1',
  'Mod+2',
  'Mod+3',
  'Mod+W',
]
const MAC_ONLY_RESERVED_HOTKEY = 'Mod+Alt+Tab'

const SESSION_COMMAND_PATTERN = /^workspace\.jumpToSession\d$/

const TEXT_MENU_EDITOR_COMMANDS = [
  'editor.editor.action.goToImplementation',
  'editor.editor.action.goToTypeDefinition',
  'editor.editor.action.peekDefinition',
  'editor.editor.action.revealDefinitionAside',
] as const

const ASYNC_COMMAND_IDS = [
  'fileTree.undo',
  'fileTree.redo',
  'workspace.splitEditorRight',
  'workspace.splitEditorDown',
  'workspace.showHistory',
  'workspace.historyBack',
  'workspace.historyForward',
  'workspace.selectAppColors',
  'workspace.selectThemeBundle',
  'workspace.selectWallpaper',
  'workspace.runProjectScript',
  'workspace.switchSession',
  'workspace.goToLine',
  'workspace.showUnicodeSettings',
  'workspace.showFontSettings',
  'workspace.showUsage',
  'workspace.showTransparencySettings',
  'fileTree.newFile',
  'fileTree.newFolder',
  'workspace.undoWorkspaceEdit',
  'workspace.redoWorkspaceEdit',
  'workspace.showQuickAccess',
  'workspace.showCommandPalette',
  'workspace.showSettings',
  'workspace.openSearchEditor',
  'workspace.openThemeStudio',
  'workspace.quickOpenPreviousEditor',
  'workspace.quickOpenView',
  'workspace.gotoSymbol',
  'workspace.showAllEditors',
  'workspace.saveFile',
  'workspace.saveAllFiles',
  'workspace.compareWithSaved',
  'workspace.openFileAtHead',
  'workspace.revertFile',
  'workspace.reopenClosedEditor',
  'workspace.toggleSidebarVisibility',
  'workspace.toggleSessionRail',
  'workspace.togglePanel',
  'workspace.focusFirstEditorGroup',
  'workspace.focusSecondEditorGroup',
  'workspace.focusThirdEditorGroup',
  'workspace.focusEditor',
  'workspace.focusFileTree',
  'workspace.findInFileTree',
  'workspace.revealActiveFileInTree',
  'workspace.focusGit',
  'workspace.focusNextTerminal',
  'workspace.focusPreviousTerminal',
  'workspace.killTerminal',
  'workspace.newTerminal',
  'workspace.copyAddress',
  'workspace.revealChat',
  'workspace.revealTerminal',
  'workspace.newSession',
  'workspace.nextSession',
  'workspace.previousSession',
  'workspace.jumpToSession1',
  'workspace.jumpToSession2',
  'workspace.jumpToSession3',
  'workspace.jumpToSession4',
  'workspace.jumpToSession5',
  'workspace.jumpToSession6',
  'workspace.jumpToSession7',
  'workspace.jumpToSession8',
  'workspace.jumpToSession9',
  'workspace.closeCurrentTab',
  'workspace.newChat',
  'workspace.acceptCommitMessage',
  'workspace.discardCommitMessage',
  'workspace.toggleDiffViewMode',
  'workspace.toggleUiMode',
  'workspace.showChatMode',
  'workspace.showWorkbenchMode',
  'workspace.selectColorMode',
  'workspace.selectColorTheme',
  'workspace.setDarkTheme',
  'workspace.setLightTheme',
  'workspace.setSystemTheme',
  'workspace.toggleWallpaper',
  'wallpaper.next',
] as const satisfies readonly PlatformCommandId[]

const TEXT_EDIT_COMMAND_IDS = [
  'workspace.historyBack',
  'workspace.historyForward',
  'editor.undo',
  'editor.redo',
  'editor.replaceOne',
  'editor.replaceAll',
  'editor.merge-conflict.accept.current',
  'editor.merge-conflict.accept.incoming',
  'editor.merge-conflict.accept.both',
  'editor.merge-conflict.accept.selection',
  'editor.merge-conflict.accept.all-current',
  'editor.merge-conflict.accept.all-incoming',
  'editor.merge-conflict.accept.all-both',
  'editor.deleteWordLeft',
  'editor.deleteWordRight',
  'editor.editor.action.deleteLines',
  'editor.editor.action.copyLinesUpAction',
  'editor.editor.action.copyLinesDownAction',
  'editor.editor.action.moveLinesUpAction',
  'editor.editor.action.moveLinesDownAction',
  'editor.editor.action.insertLineBefore',
  'editor.editor.action.insertLineAfter',
  'editor.editor.action.commentLine',
  'editor.editor.action.blockComment',
  'editor.editor.action.indentLines',
  'editor.editor.action.outdentLines',
  'editor.editor.action.trimTrailingWhitespace',
  'editor.editor.action.sortLinesAscending',
  'editor.editor.action.sortLinesDescending',
  'editor.editor.action.joinLines',
  'editor.editor.action.duplicateSelection',
  'editor.editor.action.transformToUppercase',
  'editor.editor.action.transformToLowercase',
  'editor.editor.action.transformToTitlecase',
  'editor.editor.action.rename',
  'editor.editor.action.formatDocument',
  'editor.deleteBackward',
  'editor.deleteForward',
  'editor.indentSelection',
  'editor.outdentSelection',
  'editor.deleteWordPartLeft',
  'editor.deleteWordPartRight',
  'editor.editor.action.autoFix',
  'editor.editor.action.inlineSuggest.commit',
  'editor.editor.action.inlineSuggest.acceptNextWord',
  'editor.acceptSelectedSuggestion',
  'editor.editor.action.reindentlines',
  'editor.editor.action.reindentselectedlines',
] as const satisfies readonly PlatformCommandId[]

const FILE_OPERATION_COMMAND_IDS = [
  'fileTree.newFile',
  'fileTree.newFolder',
  'fileTree.undo',
  'fileTree.redo',
  'workspace.saveFile',
  'workspace.saveAllFiles',
  'workspace.revertFile',
] as const satisfies readonly PlatformCommandId[]

const WORKSPACE_OPERATION_COMMAND_IDS = [
  'workspace.undoWorkspaceEdit',
  'workspace.redoWorkspaceEdit',
  'workspace.copyAddress',
  'workspace.acceptCommitMessage',
  'workspace.toggleDiffViewMode',
  'workspace.setDarkTheme',
  'workspace.setLightTheme',
  'workspace.setSystemTheme',
  'workspace.toggleWallpaper',
  'wallpaper.next',
  'workspace.newSession',
] as const satisfies readonly PlatformCommandId[]

const FILE_BACKED_COMMAND_IDS = [
  'workspace.goToLine',
  'workspace.gotoSymbol',
  'workspace.compareWithSaved',
  'workspace.showHistory',
  'workspace.historyBack',
  'workspace.historyForward',
  'workspace.openFileAtHead',
  'workspace.revertFile',
  'workspace.revealActiveFileInTree',
  'workspace.acceptCommitMessage',
  'workspace.discardCommitMessage',
] as const satisfies readonly PlatformCommandId[]

const TAB_OPEN_COMMAND_IDS = [
  'workspace.splitEditorRight',
  'workspace.splitEditorDown',
  'workspace.moveTabToGroup',
  'workspace.quickOpenPreviousEditor',
  'workspace.focusFirstEditorGroup',
  'workspace.focusSecondEditorGroup',
  'workspace.focusThirdEditorGroup',
  'workspace.focusEditor',
  'workspace.closeCurrentTab',
] as const satisfies readonly PlatformCommandId[]

const CHAT_MODE_COMMAND_IDS = [
  'workspace.newSession',
  'workspace.nextSession',
  'workspace.previousSession',
  'workspace.toggleSessionRail',
  ...SESSION_JUMP_POSITIONS.map(sessionJumpCommandId),
] satisfies readonly PlatformCommandId[]

function reservedBindings(platform: 'linux' | 'mac' | 'windows') {
  return defaultPlatformKeyBindings(platform).filter((binding) => binding.command === null)
}

function commandIdsWhere(predicate: (command: CommandEntry) => boolean) {
  return platformCommands
    .filter(predicate)
    .map((command) => command.id)
    .toSorted()
}

function expectedCommandIds(ids: readonly PlatformCommandId[]) {
  return ids.toSorted()
}

function commandIdsWithUndoCategory(category: CommandUndoCategory) {
  return commandIdsWhere((command) => command.undoCategory === category)
}

function commandIdsWithWhen(condition: CommandWhen) {
  return commandIdsWhere((command) => command.when.includes(condition))
}

describe('command table', () => {
  it('names every command exactly once', () => {
    const ids = platformCommands.map((command) => command.id)

    // `platformCommand` looks up through a Map, so a duplicated id would
    // silently win and the loser's `run` would be unreachable.
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has complete execution metadata on all rows', () => {
    for (const command of platformCommands) {
      expect(['async', 'sync']).toContain(command.execution)
      expect(['editor', 'workspace']).toContain(command.target)
      expect(['file-operation', 'text-edit', 'view-only', 'workspace-operation']).toContain(
        command.undoCategory,
      )
      expect(Array.isArray(command.when)).toBe(true)
    }
  })

  it('keeps the exact async settlement boundary', () => {
    expect(commandIdsWhere((command) => command.execution === 'async')).toEqual(
      expectedCommandIds(ASYNC_COMMAND_IDS),
    )
  })

  it('keeps non-default undo ownership on the intended commands', () => {
    expect(commandIdsWithUndoCategory('text-edit')).toEqual(
      expectedCommandIds(TEXT_EDIT_COMMAND_IDS),
    )
    expect(commandIdsWithUndoCategory('file-operation')).toEqual(
      expectedCommandIds(FILE_OPERATION_COMMAND_IDS),
    )
    expect(commandIdsWithUndoCategory('workspace-operation')).toEqual(
      expectedCommandIds(WORKSPACE_OPERATION_COMMAND_IDS),
    )
  })

  it('derives editor writability only from text-edit ownership', () => {
    for (const command of platformCommands) {
      if (command.target !== 'editor') continue

      const editorId = editorCommandIdFromPlatform(command.id)
      expect(editorId).not.toBeNull()
      const mutates = editorId !== null && editorCommandMutates(editorId)
      expect(command.undoCategory).toBe(mutates ? 'text-edit' : 'view-only')
      const when = mutates ? ['editorTarget', 'editorWritable'] : ['editorTarget']
      expect({ id: command.id, when: command.when }).toEqual({
        id: command.id,
        when,
      })
    }
  })

  it('keeps the narrow workspace guards on their intended commands', () => {
    expect(commandIdsWithWhen('fileBackedTab')).toEqual(expectedCommandIds(FILE_BACKED_COMMAND_IDS))
    expect(commandIdsWithWhen('saveableTab')).toEqual(['workspace.saveFile'])
    expect(commandIdsWithWhen('tabOpen')).toEqual(expectedCommandIds(TAB_OPEN_COMMAND_IDS))
    expect(commandIdsWithWhen('chatMode')).toEqual(expectedCommandIds(CHAT_MODE_COMMAND_IDS))
    expect(commandIdsWithWhen('workspaceEditUndoable')).toEqual(['workspace.undoWorkspaceEdit'])
    expect(commandIdsWithWhen('workspaceEditRedoable')).toEqual(['workspace.redoWorkspaceEdit'])
    expect(commandIdsWithWhen('fileOperationUndoable')).toEqual(['fileTree.undo'])
    expect(commandIdsWithWhen('fileOperationRedoable')).toEqual(['fileTree.redo'])
  })

  it('registers the four hidden Editor commands exposed by the text menu', () => {
    for (const id of TEXT_MENU_EDITOR_COMMANDS) {
      expect(platformCommand(id)).toMatchObject({
        execution: 'sync',
        hiddenInPalette: true,
        target: 'editor',
        undoCategory: 'view-only',
        when: ['editorTarget'],
      })
    }
  })

  it('keeps the browser-hostile chords reserved', () => {
    const mac = reservedBindings('mac')
    expect(mac).toHaveLength(8)
    expect(mac.map((binding) => binding.chord[0])).toEqual(RESERVED_HOTKEYS)

    for (const binding of mac) {
      expect(binding.preventDefault).toBe(true)
      expect(binding.stopPropagation).toBe(true)
    }

    const withoutMacOnly = RESERVED_HOTKEYS.filter((chord) => chord !== MAC_ONLY_RESERVED_HOTKEY)
    expect(reservedBindings('linux').map((binding) => binding.chord[0])).toEqual(withoutMacOnly)
    expect(reservedBindings('windows').map((binding) => binding.chord[0])).toEqual(withoutMacOnly)
  })

  it('offers session commands while hiding numbered session jumps', () => {
    expect(platformCommandSpecs.map((spec) => spec.id)).toEqual(
      expect.arrayContaining([
        'workspace.findInFileTree',
        'workspace.jumpToSession1',
        'workspace.newSession',
        'workspace.revealActiveFileInTree',
      ]),
    )

    expect(hiddenPaletteCommandIds.has('workspace.findInFileTree')).toBe(false)
    expect(hiddenPaletteCommandIds.has('workspace.revealActiveFileInTree')).toBe(false)
    expect(
      platformCommands
        .filter((command) => SESSION_COMMAND_PATTERN.test(command.id))
        .every((command) => hiddenPaletteCommandIds.has(command.id)),
    ).toBe(true)
  })
})
