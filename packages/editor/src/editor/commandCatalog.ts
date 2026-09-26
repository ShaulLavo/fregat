/** A group of commands a keymap installs or withholds together. */
export type EditorCommandPack =
  | 'navigation'
  | 'selection'
  | 'find'
  | 'text-editing'
  | 'advanced-editing'
  | 'multi-cursor'
  | 'folding'
  | 'lsp-navigation'
  | 'lsp-editing'
  | 'inline-suggest'
  | 'suggest'

/**
 * What a command is for, as a keymap groups it: the command packs, plus merge conflicts, whose
 * commands have no default key.
 */
export type EditorCommandCategory = EditorCommandPack | 'merge-conflict'

/**
 * One command's facts, known before any editor exists: its id, the name and description a palette,
 * shortcut recorder and reference show, what it is for, whether it changes the document, and the
 * VS Code commands it stands for.
 */
export type EditorCommandDeclaration<Id extends string = string> = {
  readonly id: Id
  readonly title: string
  readonly description?: string
  readonly category: EditorCommandCategory
  /** Changes the document, so a readonly view refuses it. */
  readonly mutates: boolean
  readonly vscodeCommandIds?: readonly string[]
}

function declare<const Id extends string>(
  declaration: EditorCommandDeclaration<Id>,
): EditorCommandDeclaration<Id> {
  return declaration
}

/** Every built-in command, once. The command id union, readonly policy and packs derive from it. */
export const EDITOR_COMMANDS = [
  declare({
    id: 'undo',
    title: 'Undo',
    category: 'text-editing',
    mutates: true,
    vscodeCommandIds: ['undo'],
  }),
  declare({
    id: 'redo',
    title: 'Redo',
    category: 'text-editing',
    mutates: true,
    vscodeCommandIds: ['redo'],
  }),
  declare({
    id: 'jumpBack',
    title: 'Go back',
    category: 'text-editing',
    mutates: false,
    vscodeCommandIds: ['workbench.action.navigateBack'],
  }),
  declare({
    id: 'jumpForward',
    title: 'Go forward',
    category: 'text-editing',
    mutates: false,
    vscodeCommandIds: ['workbench.action.navigateForward'],
  }),
  declare({
    id: 'cursorUndo',
    title: 'Undo cursor movement',
    category: 'text-editing',
    mutates: false,
    vscodeCommandIds: ['cursorUndo'],
  }),
  declare({
    id: 'cursorRedo',
    title: 'Redo cursor movement',
    category: 'text-editing',
    mutates: false,
    vscodeCommandIds: ['cursorRedo'],
  }),
  declare({
    id: 'find',
    title: 'Find',
    category: 'find',
    mutates: false,
    vscodeCommandIds: ['actions.find'],
  }),
  declare({
    id: 'findReplace',
    title: 'Find and replace',
    category: 'text-editing',
    mutates: false,
    vscodeCommandIds: ['editor.action.startFindReplaceAction'],
  }),
  declare({
    id: 'findNext',
    title: 'Find next',
    category: 'find',
    mutates: false,
    vscodeCommandIds: ['editor.action.nextMatchFindAction'],
  }),
  declare({
    id: 'findPrevious',
    title: 'Find previous',
    category: 'find',
    mutates: false,
    vscodeCommandIds: ['editor.action.previousMatchFindAction'],
  }),
  declare({
    id: 'goToDefinition',
    title: 'Go to definition',
    category: 'lsp-navigation',
    mutates: false,
    vscodeCommandIds: ['editor.action.revealDefinition'],
  }),
  declare({
    id: 'editor.action.goToDefinition',
    title: 'Go to definition',
    category: 'lsp-navigation',
    mutates: false,
    vscodeCommandIds: ['editor.action.goToDefinition'],
  }),
  declare({
    id: 'editor.action.goToReferences',
    title: 'Find references',
    category: 'lsp-navigation',
    mutates: false,
    vscodeCommandIds: ['editor.action.goToReferences'],
  }),
  declare({
    id: 'editor.action.peekDefinition',
    title: 'Peek definition',
    category: 'lsp-navigation',
    mutates: false,
    vscodeCommandIds: ['editor.action.peekDefinition'],
  }),
  declare({
    id: 'editor.action.revealDefinitionAside',
    title: 'Open definition to the side',
    category: 'lsp-navigation',
    mutates: false,
    vscodeCommandIds: ['editor.action.revealDefinitionAside'],
  }),
  declare({
    id: 'editor.action.goToImplementation',
    title: 'Go to implementation',
    category: 'lsp-navigation',
    mutates: false,
    vscodeCommandIds: ['editor.action.goToImplementation'],
  }),
  declare({
    id: 'editor.action.goToTypeDefinition',
    title: 'Go to type definition',
    category: 'lsp-navigation',
    mutates: false,
    vscodeCommandIds: ['editor.action.goToTypeDefinition'],
  }),
  declare({
    id: 'editor.action.showHover',
    title: 'Show hover',
    category: 'lsp-navigation',
    mutates: false,
    vscodeCommandIds: ['editor.action.showHover'],
  }),
  declare({
    id: 'editor.action.marker.next',
    title: 'Next diagnostic',
    category: 'lsp-navigation',
    mutates: false,
    vscodeCommandIds: ['editor.action.marker.next'],
  }),
  declare({
    id: 'editor.action.marker.prev',
    title: 'Previous diagnostic',
    category: 'lsp-navigation',
    mutates: false,
    vscodeCommandIds: ['editor.action.marker.prev'],
  }),
  declare({
    id: 'merge-conflict.accept.current',
    title: 'Merge conflict: accept current',
    category: 'merge-conflict',
    mutates: true,
    vscodeCommandIds: ['merge-conflict.accept.current'],
  }),
  declare({
    id: 'merge-conflict.accept.incoming',
    title: 'Merge conflict: accept incoming',
    category: 'merge-conflict',
    mutates: true,
    vscodeCommandIds: ['merge-conflict.accept.incoming'],
  }),
  declare({
    id: 'merge-conflict.accept.both',
    title: 'Merge conflict: accept both',
    category: 'merge-conflict',
    mutates: true,
    vscodeCommandIds: ['merge-conflict.accept.both'],
  }),
  declare({
    id: 'merge-conflict.accept.selection',
    title: 'Merge conflict: accept selection',
    category: 'merge-conflict',
    mutates: true,
    vscodeCommandIds: ['merge-conflict.accept.selection'],
  }),
  declare({
    id: 'merge-conflict.accept.all-current',
    title: 'Merge conflict: accept all current',
    category: 'merge-conflict',
    mutates: true,
    vscodeCommandIds: ['merge-conflict.accept.all-current'],
  }),
  declare({
    id: 'merge-conflict.accept.all-incoming',
    title: 'Merge conflict: accept all incoming',
    category: 'merge-conflict',
    mutates: true,
    vscodeCommandIds: ['merge-conflict.accept.all-incoming'],
  }),
  declare({
    id: 'merge-conflict.accept.all-both',
    title: 'Merge conflict: accept all both',
    category: 'merge-conflict',
    mutates: true,
    vscodeCommandIds: ['merge-conflict.accept.all-both'],
  }),
  declare({
    id: 'merge-conflict.next',
    title: 'Merge conflict: next conflict',
    category: 'merge-conflict',
    mutates: false,
    vscodeCommandIds: ['merge-conflict.next'],
  }),
  declare({
    id: 'merge-conflict.previous',
    title: 'Merge conflict: previous conflict',
    category: 'merge-conflict',
    mutates: false,
    vscodeCommandIds: ['merge-conflict.previous'],
  }),
  declare({
    id: 'merge-conflict.compare',
    title: 'Merge conflict: compare current conflict',
    category: 'merge-conflict',
    mutates: false,
    vscodeCommandIds: ['merge-conflict.compare'],
  }),
  declare({
    id: 'closeFind',
    title: 'Close find',
    category: 'find',
    mutates: false,
    vscodeCommandIds: ['closeFindWidget'],
  }),
  declare({
    id: 'toggleFindCaseSensitive',
    title: 'Toggle case sensitive find',
    category: 'find',
    mutates: false,
    vscodeCommandIds: ['toggleFindCaseSensitive'],
  }),
  declare({
    id: 'toggleFindWholeWord',
    title: 'Toggle whole word find',
    category: 'find',
    mutates: false,
    vscodeCommandIds: ['toggleFindWholeWord'],
  }),
  declare({
    id: 'toggleFindRegex',
    title: 'Toggle regex find',
    category: 'find',
    mutates: false,
    vscodeCommandIds: ['toggleFindRegex'],
  }),
  declare({
    id: 'toggleFindInSelection',
    title: 'Toggle find in selection',
    category: 'find',
    mutates: false,
    vscodeCommandIds: ['toggleFindInSelection'],
  }),
  declare({
    id: 'togglePreserveCase',
    title: 'Toggle preserve case',
    category: 'find',
    mutates: false,
    vscodeCommandIds: ['togglePreserveCase'],
  }),
  declare({
    id: 'replaceOne',
    title: 'Replace',
    category: 'text-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.replaceOne'],
  }),
  declare({
    id: 'replaceAll',
    title: 'Replace all',
    category: 'text-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.replaceAll'],
  }),
  declare({
    id: 'selectAllMatches',
    title: 'Select all matches',
    category: 'multi-cursor',
    mutates: false,
    vscodeCommandIds: ['editor.action.selectAllMatches'],
  }),
  declare({
    id: 'selectAll',
    title: 'Select all',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['editor.action.selectAll'],
  }),
  declare({
    id: 'editor.action.smartSelect.expand',
    title: 'Expand selection',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['editor.action.smartSelect.expand'],
  }),
  declare({
    id: 'editor.action.smartSelect.shrink',
    title: 'Shrink selection',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['editor.action.smartSelect.shrink'],
  }),
  declare({
    id: 'addNextOccurrence',
    title: 'Add next occurrence',
    category: 'multi-cursor',
    mutates: false,
    vscodeCommandIds: ['editor.action.addSelectionToNextFindMatch'],
  }),
  declare({
    id: 'clearSecondarySelections',
    title: 'Clear secondary selections',
    category: 'multi-cursor',
    mutates: false,
    vscodeCommandIds: ['removeSecondaryCursors'],
  }),
  declare({
    id: 'editor.action.insertCursorAbove',
    title: 'Add cursor above',
    category: 'multi-cursor',
    mutates: false,
    vscodeCommandIds: ['editor.action.insertCursorAbove'],
  }),
  declare({
    id: 'editor.action.insertCursorBelow',
    title: 'Add cursor below',
    category: 'multi-cursor',
    mutates: false,
    vscodeCommandIds: ['editor.action.insertCursorBelow'],
  }),
  declare({
    id: 'editor.action.selectHighlights',
    title: 'Select all occurrences',
    category: 'multi-cursor',
    mutates: false,
    vscodeCommandIds: ['editor.action.selectHighlights'],
  }),
  declare({
    id: 'editor.action.changeAll',
    title: 'Change all occurrences',
    category: 'multi-cursor',
    mutates: false,
    vscodeCommandIds: ['editor.action.changeAll'],
  }),
  declare({
    id: 'editor.action.jumpToBracket',
    title: 'Go to bracket',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['editor.action.jumpToBracket'],
  }),
  // Soft wrap decides whether a long line is walked sideways or read down the page, a question for whoever is reading, so it travels with the navigation keys.
  declare({
    id: 'editor.action.toggleWordWrap',
    title: 'Toggle word wrap',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['editor.action.toggleWordWrap'],
  }),
  // Handing Tab back to the page belongs with the keys that took it, so a host cannot offer the trap without the way out.
  declare({
    id: 'editor.action.toggleTabFocusMode',
    title: 'Toggle Tab focus mode',
    category: 'text-editing',
    mutates: false,
    vscodeCommandIds: ['editor.action.toggleTabFocusMode'],
  }),
  declare({
    id: 'editor.action.formatDocument',
    title: 'Format document',
    category: 'lsp-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.formatDocument'],
  }),
  declare({
    id: 'editor.action.rename',
    title: 'Rename symbol',
    category: 'lsp-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.rename'],
  }),
  declare({
    id: 'editor.action.autoFix',
    title: 'Apply auto fix',
    category: 'lsp-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.autoFix'],
  }),
  declare({
    id: 'editor.action.inlineSuggest.commit',
    title: 'Accept inline suggestion',
    category: 'inline-suggest',
    mutates: true,
    vscodeCommandIds: ['editor.action.inlineSuggest.commit'],
  }),
  declare({
    id: 'editor.action.inlineSuggest.acceptNextWord',
    title: 'Accept next word of inline suggestion',
    category: 'inline-suggest',
    mutates: true,
    vscodeCommandIds: ['editor.action.inlineSuggest.acceptNextWord'],
  }),
  declare({
    id: 'editor.action.triggerSuggest',
    title: 'Trigger suggest',
    category: 'suggest',
    mutates: false,
    vscodeCommandIds: ['editor.action.triggerSuggest'],
  }),
  declare({
    id: 'selectNextSuggestion',
    title: 'Select next suggestion',
    category: 'suggest',
    mutates: false,
    vscodeCommandIds: ['selectNextSuggestion'],
  }),
  declare({
    id: 'selectPrevSuggestion',
    title: 'Select previous suggestion',
    category: 'suggest',
    mutates: false,
    vscodeCommandIds: ['selectPrevSuggestion'],
  }),
  declare({
    id: 'selectNextPageSuggestion',
    title: 'Select next page of suggestions',
    category: 'suggest',
    mutates: false,
    vscodeCommandIds: ['selectNextPageSuggestion'],
  }),
  declare({
    id: 'selectPrevPageSuggestion',
    title: 'Select previous page of suggestions',
    category: 'suggest',
    mutates: false,
    vscodeCommandIds: ['selectPrevPageSuggestion'],
  }),
  declare({
    id: 'acceptSelectedSuggestion',
    title: 'Accept selected suggestion',
    category: 'suggest',
    mutates: true,
    vscodeCommandIds: ['acceptSelectedSuggestion'],
  }),
  declare({
    id: 'hideSuggestWidget',
    title: 'Hide suggestions',
    category: 'suggest',
    mutates: false,
    vscodeCommandIds: ['hideSuggestWidget'],
  }),
  declare({
    id: 'closeParameterHints',
    title: 'Close parameter hints',
    category: 'suggest',
    mutates: false,
    vscodeCommandIds: ['closeParameterHints'],
  }),
  declare({
    id: 'showNextParameterHint',
    title: 'Show next parameter hint',
    category: 'suggest',
    mutates: false,
    vscodeCommandIds: ['showNextParameterHint'],
  }),
  declare({
    id: 'showPrevParameterHint',
    title: 'Show previous parameter hint',
    category: 'suggest',
    mutates: false,
    vscodeCommandIds: ['showPrevParameterHint'],
  }),
  declare({
    id: 'editor.action.moveSelectionToNextFindMatch',
    title: 'Move last selection to next find match',
    category: 'multi-cursor',
    mutates: false,
    vscodeCommandIds: ['editor.action.moveSelectionToNextFindMatch'],
  }),
  declare({
    id: 'editor.fold',
    title: 'Fold',
    category: 'folding',
    mutates: false,
    vscodeCommandIds: ['editor.fold'],
  }),
  declare({
    id: 'editor.unfold',
    title: 'Unfold',
    category: 'folding',
    mutates: false,
    vscodeCommandIds: ['editor.unfold'],
  }),
  declare({
    id: 'editor.foldRecursively',
    title: 'Fold recursively',
    category: 'folding',
    mutates: false,
    vscodeCommandIds: ['editor.foldRecursively'],
  }),
  declare({
    id: 'editor.unfoldRecursively',
    title: 'Unfold recursively',
    category: 'folding',
    mutates: false,
    vscodeCommandIds: ['editor.unfoldRecursively'],
  }),
  declare({
    id: 'editor.foldAll',
    title: 'Fold all',
    category: 'folding',
    mutates: false,
    vscodeCommandIds: ['editor.foldAll'],
  }),
  declare({
    id: 'editor.unfoldAll',
    title: 'Unfold all',
    category: 'folding',
    mutates: false,
    vscodeCommandIds: ['editor.unfoldAll'],
  }),
  declare({
    id: 'editor.foldLevel1',
    title: 'Fold level1',
    category: 'folding',
    mutates: false,
    vscodeCommandIds: ['editor.foldLevel1'],
  }),
  declare({
    id: 'editor.foldLevel2',
    title: 'Fold level2',
    category: 'folding',
    mutates: false,
    vscodeCommandIds: ['editor.foldLevel2'],
  }),
  declare({
    id: 'editor.foldLevel3',
    title: 'Fold level3',
    category: 'folding',
    mutates: false,
    vscodeCommandIds: ['editor.foldLevel3'],
  }),
  declare({
    id: 'editor.foldLevel4',
    title: 'Fold level4',
    category: 'folding',
    mutates: false,
    vscodeCommandIds: ['editor.foldLevel4'],
  }),
  declare({
    id: 'editor.foldLevel5',
    title: 'Fold level5',
    category: 'folding',
    mutates: false,
    vscodeCommandIds: ['editor.foldLevel5'],
  }),
  declare({
    id: 'editor.foldLevel6',
    title: 'Fold level6',
    category: 'folding',
    mutates: false,
    vscodeCommandIds: ['editor.foldLevel6'],
  }),
  declare({
    id: 'editor.foldLevel7',
    title: 'Fold level7',
    category: 'folding',
    mutates: false,
    vscodeCommandIds: ['editor.foldLevel7'],
  }),
  declare({
    id: 'editor.createFoldingRangeFromSelection',
    title: 'Fold selection',
    category: 'folding',
    mutates: false,
    vscodeCommandIds: ['editor.createFoldingRangeFromSelection'],
  }),
  declare({
    id: 'editor.removeManualFoldingRanges',
    title: 'Remove manual folding ranges',
    category: 'folding',
    mutates: false,
    vscodeCommandIds: ['editor.removeManualFoldingRanges'],
  }),
  declare({
    id: 'deleteBackward',
    title: 'Delete backward',
    category: 'text-editing',
    mutates: true,
  }),
  declare({
    id: 'deleteForward',
    title: 'Delete forward',
    category: 'text-editing',
    mutates: true,
  }),
  declare({
    id: 'deleteWordLeft',
    title: 'Delete word left',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['deleteWordLeft'],
  }),
  declare({
    id: 'deleteWordRight',
    title: 'Delete word right',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['deleteWordRight'],
  }),
  declare({
    id: 'deleteWordPartLeft',
    title: 'Delete word part left',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['deleteWordPartLeft'],
  }),
  declare({
    id: 'deleteWordPartRight',
    title: 'Delete word part right',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['deleteWordPartRight'],
  }),
  declare({
    id: 'editor.action.commentLine',
    title: 'Toggle line comment',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.commentLine'],
  }),
  declare({
    id: 'editor.action.blockComment',
    title: 'Toggle block comment',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.blockComment'],
  }),
  declare({
    id: 'editor.action.indentLines',
    title: 'Indent line',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.indentLines'],
  }),
  declare({
    id: 'editor.action.outdentLines',
    title: 'Outdent line',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.outdentLines'],
  }),
  declare({
    id: 'editor.action.reindentlines',
    title: 'Reindent lines',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.reindentlines'],
  }),
  declare({
    id: 'editor.action.reindentselectedlines',
    title: 'Reindent selected lines',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.reindentselectedlines'],
  }),
  declare({
    id: 'editor.action.deleteLines',
    title: 'Delete line',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.deleteLines'],
  }),
  declare({
    id: 'editor.action.copyLinesUpAction',
    title: 'Copy line up',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.copyLinesUpAction'],
  }),
  declare({
    id: 'editor.action.copyLinesDownAction',
    title: 'Copy line down',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.copyLinesDownAction'],
  }),
  declare({
    id: 'editor.action.moveLinesUpAction',
    title: 'Move line up',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.moveLinesUpAction'],
  }),
  declare({
    id: 'editor.action.moveLinesDownAction',
    title: 'Move line down',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.moveLinesDownAction'],
  }),
  declare({
    id: 'editor.action.insertLineBefore',
    title: 'Insert line above',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.insertLineBefore'],
  }),
  declare({
    id: 'editor.action.insertLineAfter',
    title: 'Insert line below',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.insertLineAfter'],
  }),
  declare({
    id: 'editor.action.trimTrailingWhitespace',
    title: 'Trim trailing whitespace',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.trimTrailingWhitespace'],
  }),
  declare({
    id: 'editor.action.sortLinesAscending',
    title: 'Sort lines ascending',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.sortLinesAscending'],
  }),
  declare({
    id: 'editor.action.sortLinesDescending',
    title: 'Sort lines descending',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.sortLinesDescending'],
  }),
  declare({
    id: 'editor.action.joinLines',
    title: 'Join lines',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.joinLines'],
  }),
  declare({
    id: 'editor.action.duplicateSelection',
    title: 'Duplicate selection',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.duplicateSelection'],
  }),
  declare({
    id: 'editor.action.transformToUppercase',
    title: 'Transform to uppercase',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.transformToUppercase'],
  }),
  declare({
    id: 'editor.action.transformToLowercase',
    title: 'Transform to lowercase',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.transformToLowercase'],
  }),
  declare({
    id: 'editor.action.transformToTitlecase',
    title: 'Transform to title case',
    category: 'advanced-editing',
    mutates: true,
    vscodeCommandIds: ['editor.action.transformToTitlecase'],
  }),
  declare({
    id: 'cursorWordPartLeft',
    title: 'Cursor word part left',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['cursorWordPartLeft'],
  }),
  declare({
    id: 'cursorWordPartRight',
    title: 'Cursor word part right',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['cursorWordPartRight'],
  }),
  declare({
    id: 'cursorWordPartLeftSelect',
    title: 'Cursor word part left select',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorWordPartLeftSelect'],
  }),
  declare({
    id: 'cursorWordPartRightSelect',
    title: 'Cursor word part right select',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorWordPartRightSelect'],
  }),
  declare({
    id: 'indentSelection',
    title: 'Indent selection',
    category: 'text-editing',
    mutates: true,
    vscodeCommandIds: ['tab'],
  }),
  declare({
    id: 'outdentSelection',
    title: 'Outdent selection',
    category: 'text-editing',
    mutates: true,
    vscodeCommandIds: ['outdent'],
  }),
  declare({
    id: 'cursorLeft',
    title: 'Move cursor left',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['cursorLeft'],
  }),
  declare({
    id: 'cursorRight',
    title: 'Move cursor right',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['cursorRight'],
  }),
  declare({
    id: 'cursorUp',
    title: 'Move cursor up',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['cursorUp'],
  }),
  declare({
    id: 'cursorDown',
    title: 'Move cursor down',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['cursorDown'],
  }),
  declare({
    id: 'selectLeft',
    title: 'Select left',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorLeftSelect'],
  }),
  declare({
    id: 'selectRight',
    title: 'Select right',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorRightSelect'],
  }),
  declare({
    id: 'selectUp',
    title: 'Select up',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorUpSelect'],
  }),
  declare({
    id: 'selectDown',
    title: 'Select down',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorDownSelect'],
  }),
  declare({
    id: 'cursorWordLeft',
    title: 'Move cursor word left',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['cursorWordLeft'],
  }),
  declare({
    id: 'cursorWordRight',
    title: 'Move cursor word right',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['cursorWordRight', 'cursorWordEndRight'],
  }),
  declare({
    id: 'selectWordLeft',
    title: 'Select word left',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorWordLeftSelect'],
  }),
  declare({
    id: 'selectWordRight',
    title: 'Select word right',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorWordRightSelect', 'cursorWordEndRightSelect'],
  }),
  declare({
    id: 'cursorLineStart',
    title: 'Move cursor to line start',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['cursorHome', 'cursorLineStart'],
  }),
  declare({
    id: 'cursorLineEnd',
    title: 'Move cursor to line end',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['cursorEnd', 'cursorLineEnd'],
  }),
  declare({
    id: 'selectLineStart',
    title: 'Select to line start',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorHomeSelect', 'cursorLineStartSelect'],
  }),
  declare({
    id: 'selectLineEnd',
    title: 'Select to line end',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorEndSelect', 'cursorLineEndSelect'],
  }),
  declare({
    id: 'cursorPageUp',
    title: 'Move cursor page up',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['cursorPageUp'],
  }),
  declare({
    id: 'cursorPageDown',
    title: 'Move cursor page down',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['cursorPageDown'],
  }),
  declare({
    id: 'selectPageUp',
    title: 'Select page up',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorPageUpSelect'],
  }),
  declare({
    id: 'selectPageDown',
    title: 'Select page down',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorPageDownSelect'],
  }),
  declare({
    id: 'cursorDocumentStart',
    title: 'Move cursor to document start',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['cursorTop'],
  }),
  declare({
    id: 'cursorDocumentEnd',
    title: 'Move cursor to document end',
    category: 'navigation',
    mutates: false,
    vscodeCommandIds: ['cursorBottom'],
  }),
  declare({
    id: 'selectDocumentStart',
    title: 'Select to document start',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorTopSelect'],
  }),
  declare({
    id: 'selectDocumentEnd',
    title: 'Select to document end',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorBottomSelect'],
  }),
  declare({
    id: 'cursorColumnSelectLeft',
    title: 'Cursor column select left',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorColumnSelectLeft'],
  }),
  declare({
    id: 'cursorColumnSelectRight',
    title: 'Cursor column select right',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorColumnSelectRight'],
  }),
  declare({
    id: 'cursorColumnSelectUp',
    title: 'Cursor column select up',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorColumnSelectUp'],
  }),
  declare({
    id: 'cursorColumnSelectDown',
    title: 'Cursor column select down',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorColumnSelectDown'],
  }),
  declare({
    id: 'cursorColumnSelectPageUp',
    title: 'Cursor column select page up',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorColumnSelectPageUp'],
  }),
  declare({
    id: 'cursorColumnSelectPageDown',
    title: 'Cursor column select page down',
    category: 'selection',
    mutates: false,
    vscodeCommandIds: ['cursorColumnSelectPageDown'],
  }),
] as const

export type EditorCommandId = (typeof EDITOR_COMMANDS)[number]['id']

/** A plugin's own command id: the plugin's name, a dot, then the command's own name. */
export type EditorContributedCommandId = `${string}.${string}`

/** Any command an editor can dispatch: a built-in, or one a plugin contributed. */
export type EditorAnyCommandId = EditorCommandId | EditorContributedCommandId

/** A plugin's own command, declared as data so hosts can list it before any editor exists. */
export type EditorContributedCommandDeclaration = {
  readonly id: EditorContributedCommandId
  readonly title: string
  readonly description?: string
  /** Changes the document, so a readonly view refuses it. */
  readonly mutates: boolean
}

const declarations = new Map<string, EditorCommandDeclaration<EditorCommandId>>(
  EDITOR_COMMANDS.map((declaration) => [declaration.id, declaration]),
)

export function editorCommandDeclaration(
  command: EditorCommandId,
): EditorCommandDeclaration<EditorCommandId> {
  return declarations.get(command)!
}

export function isEditorCommandId(command: string): command is EditorCommandId {
  return declarations.has(command)
}
