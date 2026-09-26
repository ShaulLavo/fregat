# Editor commands

Generated from `packages/editor/src/editor/commandCatalog.ts` by `bun run commands:reference`;
edit the catalog, not this file. A plugin adds its own commands through `createPlugin({ commands })`,
each id starting with the plugin name and a dot.

| Id | Title | Category | Changes the document | VS Code |
| --- | --- | --- | --- | --- |
| `undo` | Undo | text-editing | yes | `undo` |
| `redo` | Redo | text-editing | yes | `redo` |
| `jumpBack` | Go back | text-editing | no | `workbench.action.navigateBack` |
| `jumpForward` | Go forward | text-editing | no | `workbench.action.navigateForward` |
| `cursorUndo` | Undo cursor movement | text-editing | no | `cursorUndo` |
| `cursorRedo` | Redo cursor movement | text-editing | no | `cursorRedo` |
| `find` | Find | find | no | `actions.find` |
| `findReplace` | Find and replace | text-editing | no | `editor.action.startFindReplaceAction` |
| `findNext` | Find next | find | no | `editor.action.nextMatchFindAction` |
| `findPrevious` | Find previous | find | no | `editor.action.previousMatchFindAction` |
| `goToDefinition` | Go to definition | lsp-navigation | no | `editor.action.revealDefinition` |
| `editor.action.goToDefinition` | Go to definition | lsp-navigation | no | `editor.action.goToDefinition` |
| `editor.action.goToReferences` | Find references | lsp-navigation | no | `editor.action.goToReferences` |
| `editor.action.peekDefinition` | Peek definition | lsp-navigation | no | `editor.action.peekDefinition` |
| `editor.action.revealDefinitionAside` | Open definition to the side | lsp-navigation | no | `editor.action.revealDefinitionAside` |
| `editor.action.goToImplementation` | Go to implementation | lsp-navigation | no | `editor.action.goToImplementation` |
| `editor.action.goToTypeDefinition` | Go to type definition | lsp-navigation | no | `editor.action.goToTypeDefinition` |
| `editor.action.showHover` | Show hover | lsp-navigation | no | `editor.action.showHover` |
| `editor.action.marker.next` | Next diagnostic | lsp-navigation | no | `editor.action.marker.next` |
| `editor.action.marker.prev` | Previous diagnostic | lsp-navigation | no | `editor.action.marker.prev` |
| `merge-conflict.accept.current` | Merge conflict: accept current | merge-conflict | yes | `merge-conflict.accept.current` |
| `merge-conflict.accept.incoming` | Merge conflict: accept incoming | merge-conflict | yes | `merge-conflict.accept.incoming` |
| `merge-conflict.accept.both` | Merge conflict: accept both | merge-conflict | yes | `merge-conflict.accept.both` |
| `merge-conflict.accept.selection` | Merge conflict: accept selection | merge-conflict | yes | `merge-conflict.accept.selection` |
| `merge-conflict.accept.all-current` | Merge conflict: accept all current | merge-conflict | yes | `merge-conflict.accept.all-current` |
| `merge-conflict.accept.all-incoming` | Merge conflict: accept all incoming | merge-conflict | yes | `merge-conflict.accept.all-incoming` |
| `merge-conflict.accept.all-both` | Merge conflict: accept all both | merge-conflict | yes | `merge-conflict.accept.all-both` |
| `merge-conflict.next` | Merge conflict: next conflict | merge-conflict | no | `merge-conflict.next` |
| `merge-conflict.previous` | Merge conflict: previous conflict | merge-conflict | no | `merge-conflict.previous` |
| `merge-conflict.compare` | Merge conflict: compare current conflict | merge-conflict | no | `merge-conflict.compare` |
| `closeFind` | Close find | find | no | `closeFindWidget` |
| `toggleFindCaseSensitive` | Toggle case sensitive find | find | no | `toggleFindCaseSensitive` |
| `toggleFindWholeWord` | Toggle whole word find | find | no | `toggleFindWholeWord` |
| `toggleFindRegex` | Toggle regex find | find | no | `toggleFindRegex` |
| `toggleFindInSelection` | Toggle find in selection | find | no | `toggleFindInSelection` |
| `togglePreserveCase` | Toggle preserve case | find | no | `togglePreserveCase` |
| `replaceOne` | Replace | text-editing | yes | `editor.action.replaceOne` |
| `replaceAll` | Replace all | text-editing | yes | `editor.action.replaceAll` |
| `selectAllMatches` | Select all matches | multi-cursor | no | `editor.action.selectAllMatches` |
| `selectAll` | Select all | selection | no | `editor.action.selectAll` |
| `editor.action.smartSelect.expand` | Expand selection | selection | no | `editor.action.smartSelect.expand` |
| `editor.action.smartSelect.shrink` | Shrink selection | selection | no | `editor.action.smartSelect.shrink` |
| `addNextOccurrence` | Add next occurrence | multi-cursor | no | `editor.action.addSelectionToNextFindMatch` |
| `clearSecondarySelections` | Clear secondary selections | multi-cursor | no | `removeSecondaryCursors` |
| `editor.action.insertCursorAbove` | Add cursor above | multi-cursor | no | `editor.action.insertCursorAbove` |
| `editor.action.insertCursorBelow` | Add cursor below | multi-cursor | no | `editor.action.insertCursorBelow` |
| `editor.action.selectHighlights` | Select all occurrences | multi-cursor | no | `editor.action.selectHighlights` |
| `editor.action.changeAll` | Change all occurrences | multi-cursor | no | `editor.action.changeAll` |
| `editor.action.jumpToBracket` | Go to bracket | navigation | no | `editor.action.jumpToBracket` |
| `editor.action.toggleWordWrap` | Toggle word wrap | navigation | no | `editor.action.toggleWordWrap` |
| `editor.action.toggleTabFocusMode` | Toggle Tab focus mode | text-editing | no | `editor.action.toggleTabFocusMode` |
| `editor.action.formatDocument` | Format document | lsp-editing | yes | `editor.action.formatDocument` |
| `editor.action.rename` | Rename symbol | lsp-editing | yes | `editor.action.rename` |
| `editor.action.autoFix` | Apply auto fix | lsp-editing | yes | `editor.action.autoFix` |
| `editor.action.inlineSuggest.commit` | Accept inline suggestion | inline-suggest | yes | `editor.action.inlineSuggest.commit` |
| `editor.action.inlineSuggest.acceptNextWord` | Accept next word of inline suggestion | inline-suggest | yes | `editor.action.inlineSuggest.acceptNextWord` |
| `editor.action.triggerSuggest` | Trigger suggest | suggest | no | `editor.action.triggerSuggest` |
| `selectNextSuggestion` | Select next suggestion | suggest | no | `selectNextSuggestion` |
| `selectPrevSuggestion` | Select previous suggestion | suggest | no | `selectPrevSuggestion` |
| `selectNextPageSuggestion` | Select next page of suggestions | suggest | no | `selectNextPageSuggestion` |
| `selectPrevPageSuggestion` | Select previous page of suggestions | suggest | no | `selectPrevPageSuggestion` |
| `acceptSelectedSuggestion` | Accept selected suggestion | suggest | yes | `acceptSelectedSuggestion` |
| `hideSuggestWidget` | Hide suggestions | suggest | no | `hideSuggestWidget` |
| `closeParameterHints` | Close parameter hints | suggest | no | `closeParameterHints` |
| `showNextParameterHint` | Show next parameter hint | suggest | no | `showNextParameterHint` |
| `showPrevParameterHint` | Show previous parameter hint | suggest | no | `showPrevParameterHint` |
| `editor.action.moveSelectionToNextFindMatch` | Move last selection to next find match | multi-cursor | no | `editor.action.moveSelectionToNextFindMatch` |
| `editor.fold` | Fold | folding | no | `editor.fold` |
| `editor.unfold` | Unfold | folding | no | `editor.unfold` |
| `editor.foldRecursively` | Fold recursively | folding | no | `editor.foldRecursively` |
| `editor.unfoldRecursively` | Unfold recursively | folding | no | `editor.unfoldRecursively` |
| `editor.foldAll` | Fold all | folding | no | `editor.foldAll` |
| `editor.unfoldAll` | Unfold all | folding | no | `editor.unfoldAll` |
| `editor.foldLevel1` | Fold level1 | folding | no | `editor.foldLevel1` |
| `editor.foldLevel2` | Fold level2 | folding | no | `editor.foldLevel2` |
| `editor.foldLevel3` | Fold level3 | folding | no | `editor.foldLevel3` |
| `editor.foldLevel4` | Fold level4 | folding | no | `editor.foldLevel4` |
| `editor.foldLevel5` | Fold level5 | folding | no | `editor.foldLevel5` |
| `editor.foldLevel6` | Fold level6 | folding | no | `editor.foldLevel6` |
| `editor.foldLevel7` | Fold level7 | folding | no | `editor.foldLevel7` |
| `editor.createFoldingRangeFromSelection` | Fold selection | folding | no | `editor.createFoldingRangeFromSelection` |
| `editor.removeManualFoldingRanges` | Remove manual folding ranges | folding | no | `editor.removeManualFoldingRanges` |
| `deleteBackward` | Delete backward | text-editing | yes |  |
| `deleteForward` | Delete forward | text-editing | yes |  |
| `deleteWordLeft` | Delete word left | advanced-editing | yes | `deleteWordLeft` |
| `deleteWordRight` | Delete word right | advanced-editing | yes | `deleteWordRight` |
| `deleteWordPartLeft` | Delete word part left | advanced-editing | yes | `deleteWordPartLeft` |
| `deleteWordPartRight` | Delete word part right | advanced-editing | yes | `deleteWordPartRight` |
| `editor.action.commentLine` | Toggle line comment | advanced-editing | yes | `editor.action.commentLine` |
| `editor.action.blockComment` | Toggle block comment | advanced-editing | yes | `editor.action.blockComment` |
| `editor.action.indentLines` | Indent line | advanced-editing | yes | `editor.action.indentLines` |
| `editor.action.outdentLines` | Outdent line | advanced-editing | yes | `editor.action.outdentLines` |
| `editor.action.reindentlines` | Reindent lines | advanced-editing | yes | `editor.action.reindentlines` |
| `editor.action.reindentselectedlines` | Reindent selected lines | advanced-editing | yes | `editor.action.reindentselectedlines` |
| `editor.action.deleteLines` | Delete line | advanced-editing | yes | `editor.action.deleteLines` |
| `editor.action.copyLinesUpAction` | Copy line up | advanced-editing | yes | `editor.action.copyLinesUpAction` |
| `editor.action.copyLinesDownAction` | Copy line down | advanced-editing | yes | `editor.action.copyLinesDownAction` |
| `editor.action.moveLinesUpAction` | Move line up | advanced-editing | yes | `editor.action.moveLinesUpAction` |
| `editor.action.moveLinesDownAction` | Move line down | advanced-editing | yes | `editor.action.moveLinesDownAction` |
| `editor.action.insertLineBefore` | Insert line above | advanced-editing | yes | `editor.action.insertLineBefore` |
| `editor.action.insertLineAfter` | Insert line below | advanced-editing | yes | `editor.action.insertLineAfter` |
| `editor.action.trimTrailingWhitespace` | Trim trailing whitespace | advanced-editing | yes | `editor.action.trimTrailingWhitespace` |
| `editor.action.sortLinesAscending` | Sort lines ascending | advanced-editing | yes | `editor.action.sortLinesAscending` |
| `editor.action.sortLinesDescending` | Sort lines descending | advanced-editing | yes | `editor.action.sortLinesDescending` |
| `editor.action.joinLines` | Join lines | advanced-editing | yes | `editor.action.joinLines` |
| `editor.action.duplicateSelection` | Duplicate selection | advanced-editing | yes | `editor.action.duplicateSelection` |
| `editor.action.transformToUppercase` | Transform to uppercase | advanced-editing | yes | `editor.action.transformToUppercase` |
| `editor.action.transformToLowercase` | Transform to lowercase | advanced-editing | yes | `editor.action.transformToLowercase` |
| `editor.action.transformToTitlecase` | Transform to title case | advanced-editing | yes | `editor.action.transformToTitlecase` |
| `cursorWordPartLeft` | Cursor word part left | navigation | no | `cursorWordPartLeft` |
| `cursorWordPartRight` | Cursor word part right | navigation | no | `cursorWordPartRight` |
| `cursorWordPartLeftSelect` | Cursor word part left select | selection | no | `cursorWordPartLeftSelect` |
| `cursorWordPartRightSelect` | Cursor word part right select | selection | no | `cursorWordPartRightSelect` |
| `indentSelection` | Indent selection | text-editing | yes | `tab` |
| `outdentSelection` | Outdent selection | text-editing | yes | `outdent` |
| `cursorLeft` | Move cursor left | navigation | no | `cursorLeft` |
| `cursorRight` | Move cursor right | navigation | no | `cursorRight` |
| `cursorUp` | Move cursor up | navigation | no | `cursorUp` |
| `cursorDown` | Move cursor down | navigation | no | `cursorDown` |
| `selectLeft` | Select left | selection | no | `cursorLeftSelect` |
| `selectRight` | Select right | selection | no | `cursorRightSelect` |
| `selectUp` | Select up | selection | no | `cursorUpSelect` |
| `selectDown` | Select down | selection | no | `cursorDownSelect` |
| `cursorWordLeft` | Move cursor word left | navigation | no | `cursorWordLeft` |
| `cursorWordRight` | Move cursor word right | navigation | no | `cursorWordRight`, `cursorWordEndRight` |
| `selectWordLeft` | Select word left | selection | no | `cursorWordLeftSelect` |
| `selectWordRight` | Select word right | selection | no | `cursorWordRightSelect`, `cursorWordEndRightSelect` |
| `cursorLineStart` | Move cursor to line start | navigation | no | `cursorHome`, `cursorLineStart` |
| `cursorLineEnd` | Move cursor to line end | navigation | no | `cursorEnd`, `cursorLineEnd` |
| `selectLineStart` | Select to line start | selection | no | `cursorHomeSelect`, `cursorLineStartSelect` |
| `selectLineEnd` | Select to line end | selection | no | `cursorEndSelect`, `cursorLineEndSelect` |
| `cursorPageUp` | Move cursor page up | navigation | no | `cursorPageUp` |
| `cursorPageDown` | Move cursor page down | navigation | no | `cursorPageDown` |
| `selectPageUp` | Select page up | selection | no | `cursorPageUpSelect` |
| `selectPageDown` | Select page down | selection | no | `cursorPageDownSelect` |
| `cursorDocumentStart` | Move cursor to document start | navigation | no | `cursorTop` |
| `cursorDocumentEnd` | Move cursor to document end | navigation | no | `cursorBottom` |
| `selectDocumentStart` | Select to document start | selection | no | `cursorTopSelect` |
| `selectDocumentEnd` | Select to document end | selection | no | `cursorBottomSelect` |
| `cursorColumnSelectLeft` | Cursor column select left | selection | no | `cursorColumnSelectLeft` |
| `cursorColumnSelectRight` | Cursor column select right | selection | no | `cursorColumnSelectRight` |
| `cursorColumnSelectUp` | Cursor column select up | selection | no | `cursorColumnSelectUp` |
| `cursorColumnSelectDown` | Cursor column select down | selection | no | `cursorColumnSelectDown` |
| `cursorColumnSelectPageUp` | Cursor column select page up | selection | no | `cursorColumnSelectPageUp` |
| `cursorColumnSelectPageDown` | Cursor column select page down | selection | no | `cursorColumnSelectPageDown` |
