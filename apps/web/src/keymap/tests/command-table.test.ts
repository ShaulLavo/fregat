import { editorCommandMutates } from '@singapore-editor/core/editor'
import { editorCommandIdFromPlatform } from '@/keymap/editor-keymap'
import { describe } from 'vitest'
import { expect, test as it } from '../../../test/fixtures'

import { platformCommandSpecs } from '@/keymap/command-registry'
import type { CommandUndoCategory, CommandWhen } from '@workspace/client-core/commands/metadata'
import {
  hiddenPaletteCommandIds,
  platformCommand,
  platformCommands,
  type CommandEntry,
} from '@/keymap/table'
import {
  ITEM_POSITIONS,
  selectItemCommandId,
  sidebarPanelCommandId,
  type PlatformCommandId,
} from '@/keymap/types'

const NUMBERED_COMMAND_PATTERN = /^workspace\.(selectItem|sidebarPanel)\d$/

const TEXT_MENU_EDITOR_COMMANDS = [
  'editor.action.goToImplementation',
  'editor.action.goToTypeDefinition',
  'editor.action.peekDefinition',
  'editor.action.revealDefinitionAside',
] as const

const ASYNC_COMMAND_IDS = [
  'workspace.exportTranscript',
  'workspace.undoSessionAction',
  'workspace.redoSessionAction',
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
  'workspace.showWatchSettings',
  'workspace.showUsage',
  'workspace.showMcpServers',
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
  'workspace.nextItem',
  'workspace.previousItem',
  ...ITEM_POSITIONS.map(selectItemCommandId),
  ...ITEM_POSITIONS.map(sidebarPanelCommandId),
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
  'chat.stashPrompt',
  'chat.sendMessage',
  'git.commit',
  'fileTree.rename',
  'terminal.close',
  'terminal.clear',
  'terminal.copy',
  'terminal.paste',
  'workspace.undoSessionAction',
  'workspace.redoSessionAction',
  'workspace.toggleCheckpointChange',
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
  'workspace.cycleMarkdownView',
  'workspace.toggleMarkdownRenderedPane',
  'workspace.showSpellingSuggestions',
  'workspace.addSelectionToChat',
  'workspace.addFileToChat',
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
  'chat.stashPrompt',
  'chat.sendMessage',
  'workspace.exportTranscript',
  'workspace.newSession',
  'workspace.toggleSessionRail',
] satisfies readonly PlatformCommandId[]

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
      expect(['editor', 'workspace', 'diagnostic', 'checkpoint-change']).toContain(command.target)
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
    expect(
      commandIdsWhere(
        (command) => command.target !== 'editor' && command.undoCategory === 'text-edit',
      ),
    ).toEqual(['workspace.historyBack', 'workspace.historyForward'])
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
      if (command.id.startsWith('editor.markdown.')) when.push('editorMarkdown')
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
    expect(commandIdsWithWhen('sessionActionUndoable')).toEqual(['workspace.undoSessionAction'])
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

  it('offers session commands while hiding numbered item and panel commands', () => {
    expect(platformCommandSpecs.map((spec) => spec.id)).toEqual(
      expect.arrayContaining([
        'workspace.findInFileTree',
        'workspace.selectItem1',
        'workspace.sidebarPanel1',
        'workspace.newSession',
        'workspace.revealActiveFileInTree',
      ]),
    )

    expect(hiddenPaletteCommandIds.has('workspace.findInFileTree')).toBe(false)
    expect(hiddenPaletteCommandIds.has('workspace.revealActiveFileInTree')).toBe(false)
    expect(
      platformCommands
        .filter((command) => NUMBERED_COMMAND_PATTERN.test(command.id))
        .every((command) => hiddenPaletteCommandIds.has(command.id)),
    ).toBe(true)
  })
})
