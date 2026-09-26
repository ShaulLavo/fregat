import type { EditorCommandId } from '@singapore-editor/core/editor'
import { EDITOR_COMMANDS, editorCommandDeclaration } from '@singapore-editor/core/keymap'
import { defineEditorMetadata, type CommandKeyDefault } from './metadata'

// The Editor declares each command's name, what it is for and whether it changes the document;
// what stays here is Platform's policy: which commands the palette leaves out, and terminal keys.
const hiddenInPalette = new Set<EditorCommandId>([
  'editor.action.goToImplementation',
  'editor.action.goToTypeDefinition',
  'editor.action.peekDefinition',
  'editor.action.revealDefinitionAside',
  'closeFind',
  'toggleFindCaseSensitive',
  'toggleFindWholeWord',
  'toggleFindRegex',
  'toggleFindInSelection',
  'togglePreserveCase',
  'replaceOne',
  'replaceAll',
  'selectAllMatches',
  'clearSecondarySelections',
  'deleteWordLeft',
  'deleteWordRight',
  'cursorWordPartLeft',
  'cursorWordPartRight',
  'deleteBackward',
  'deleteForward',
  'indentSelection',
  'outdentSelection',
  'cursorLeft',
  'cursorRight',
  'cursorUp',
  'cursorDown',
  'selectLeft',
  'selectRight',
  'selectUp',
  'selectDown',
  'cursorWordLeft',
  'cursorWordRight',
  'selectWordLeft',
  'selectWordRight',
  'cursorLineStart',
  'cursorLineEnd',
  'selectLineStart',
  'selectLineEnd',
  'cursorPageUp',
  'cursorPageDown',
  'selectPageUp',
  'selectPageDown',
  'cursorDocumentStart',
  'cursorDocumentEnd',
  'selectDocumentStart',
  'selectDocumentEnd',
  'editor.action.goToDefinition',
  'editor.action.inlineSuggest.commit',
  'editor.action.inlineSuggest.acceptNextWord',
  'deleteWordPartLeft',
  'deleteWordPartRight',
  'cursorWordPartLeftSelect',
  'cursorWordPartRightSelect',
  'cursorColumnSelectLeft',
  'cursorColumnSelectRight',
  'cursorColumnSelectUp',
  'cursorColumnSelectDown',
  'cursorColumnSelectPageUp',
  'cursorColumnSelectPageDown',
  'selectNextSuggestion',
  'selectPrevSuggestion',
  'selectNextPageSuggestion',
  'selectPrevPageSuggestion',
  'acceptSelectedSuggestion',
  'hideSuggestWidget',
  'closeParameterHints',
  'showNextParameterHint',
  'showPrevParameterHint',
])

const terminalKeys: Partial<Record<EditorCommandId, readonly CommandKeyDefault[]>> = {
  find: [{ chord: ['Control+F'], platforms: ['tui'] }],
  findNext: [{ chord: ['F3'], platforms: ['tui'] }],
  findPrevious: [{ chord: ['Shift+F3'], platforms: ['tui'] }],
  goToDefinition: [{ chord: ['F12'], platforms: ['tui'] }],
  'editor.action.showHover': [{ chord: ['Control+K', 'H'], platforms: ['tui'] }],
}

function metadataFor<const Id extends EditorCommandId>(id: Id) {
  const declaration = editorCommandDeclaration(id)
  return defineEditorMetadata({
    id,
    title: declaration.title,
    ...(declaration.description ? { description: declaration.description } : {}),
    undoCategory: declaration.mutates ? 'text-edit' : 'view-only',
    ...(declaration.vscodeCommandIds ? { vscodeCommandIds: declaration.vscodeCommandIds } : {}),
    ...(terminalKeys[id] ? { keys: terminalKeys[id] } : {}),
    ...(hiddenInPalette.has(id) ? { hiddenInPalette: true } : {}),
  })
}

type EditorCommandMetadataTable = {
  readonly [Id in EditorCommandId]: ReturnType<typeof metadataFor<Id>>
}

export const editorCommandMetadata = Object.fromEntries(
  EDITOR_COMMANDS.map((declaration) => [declaration.id, metadataFor(declaration.id)]),
) as EditorCommandMetadataTable
