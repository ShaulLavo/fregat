import type { EditorCommandHandler, EditorDisposable } from '../plugins'
import type { EditorCommandContext, EditorCommandId } from './commands'
import { isEditorCommandId, type EditorAnyCommandId } from './commandCatalog'
import {
  isEditorDocumentSelectionEditCommand,
  type EditorDocumentSelectionEditCommandId,
} from './reindent'
import { isEditorEditActionCommand, type EditorEditActionCommandId } from './editActions'
import { isEditorFoldCommand, type EditorFoldCommandId } from './foldOperations'
import { isEditorInlineSuggestCommand, type EditorInlineSuggestCommandId } from './ghostText'

export type EditorCommandRouterHandlers = {
  history(command: 'undo' | 'redo', context: EditorCommandContext): boolean
  cursorHistory(command: 'undo' | 'redo', context: EditorCommandContext): boolean
  jumpHistory(command: 'back' | 'forward', context: EditorCommandContext): boolean
  delete(direction: 'backward' | 'forward', context: EditorCommandContext): boolean
  indent(direction: 'indent' | 'outdent', context: EditorCommandContext): boolean
  editAction(
    command: EditorEditActionCommandId | EditorDocumentSelectionEditCommandId,
    context: EditorCommandContext,
  ): boolean
  fold(command: EditorFoldCommandId): boolean
  inlineSuggest(command: EditorInlineSuggestCommandId, context: EditorCommandContext): boolean
  selectAll(context: EditorCommandContext): boolean
  smartSelect(direction: 'expand' | 'shrink', context: EditorCommandContext): boolean
  addNextOccurrence(context: EditorCommandContext): boolean
  clearSecondarySelections(context: EditorCommandContext): boolean
  insertCursor(direction: 'above' | 'below', context: EditorCommandContext): boolean
  selectExactOccurrences(
    command: 'editor.action.selectHighlights' | 'editor.action.changeAll',
    context: EditorCommandContext,
  ): boolean
  moveSelectionToNextOccurrence(context: EditorCommandContext): boolean
  toggleWordWrap(context: EditorCommandContext): boolean
  toggleTabFocusMode(context: EditorCommandContext): boolean
  navigation(command: EditorCommandId, context: EditorCommandContext): boolean
}

export class EditorCommandRouter {
  private readonly commandHandlers = new Map<EditorAnyCommandId, EditorCommandHandler>()

  constructor(private readonly handlers: EditorCommandRouterHandlers) {}

  dispatch(command: EditorAnyCommandId, context: EditorCommandContext = {}): boolean {
    const registeredResult = this.runRegisteredCommand(command, context)
    if (registeredResult === true) return true
    // A contributed command has only the handler its plugin registered.
    if (!isEditorCommandId(command)) return registeredResult ?? false
    // Escape spells one intention — put back whatever the last thing was — and arrives here as the
    // find command because that is what claims the key. Collapsing a run of cursors is the other
    // thing it has to be able to undo, and asking whether anything answered for find first is the
    // whole of the order between them: a host that ships no find at all still has the key.
    if (command === 'closeFind') return this.handlers.clearSecondarySelections(context)
    if (registeredResult !== null) return registeredResult

    if (command === 'undo') return this.handlers.history('undo', context)
    if (command === 'redo') return this.handlers.history('redo', context)
    if (command === 'jumpBack') return this.handlers.jumpHistory('back', context)
    if (command === 'jumpForward') return this.handlers.jumpHistory('forward', context)
    if (command === 'cursorUndo') return this.handlers.cursorHistory('undo', context)
    if (command === 'cursorRedo') return this.handlers.cursorHistory('redo', context)
    if (command === 'selectAll') return this.handlers.selectAll(context)
    if (command === 'editor.action.smartSelect.expand') {
      return this.handlers.smartSelect('expand', context)
    }
    if (command === 'editor.action.smartSelect.shrink') {
      return this.handlers.smartSelect('shrink', context)
    }
    if (command === 'addNextOccurrence') return this.handlers.addNextOccurrence(context)
    if (command === 'clearSecondarySelections') {
      return this.handlers.clearSecondarySelections(context)
    }
    if (command === 'editor.action.insertCursorAbove') {
      return this.handlers.insertCursor('above', context)
    }
    if (command === 'editor.action.insertCursorBelow') {
      return this.handlers.insertCursor('below', context)
    }
    if (command === 'editor.action.selectHighlights' || command === 'editor.action.changeAll') {
      return this.handlers.selectExactOccurrences(command, context)
    }
    if (command === 'editor.action.moveSelectionToNextFindMatch') {
      return this.handlers.moveSelectionToNextOccurrence(context)
    }
    if (command === 'editor.action.toggleWordWrap') return this.handlers.toggleWordWrap(context)
    if (command === 'editor.action.toggleTabFocusMode') {
      return this.handlers.toggleTabFocusMode(context)
    }
    if (command === 'deleteBackward') return this.handlers.delete('backward', context)
    if (command === 'deleteForward') return this.handlers.delete('forward', context)
    if (isEditorFoldCommand(command)) return this.handlers.fold(command)
    if (isEditorInlineSuggestCommand(command)) {
      return this.handlers.inlineSuggest(command, context)
    }
    if (isEditorEditActionCommand(command) || isEditorDocumentSelectionEditCommand(command)) {
      return this.handlers.editAction(command, context)
    }
    if (command === 'indentSelection') return this.handlers.indent('indent', context)
    if (command === 'outdentSelection') return this.handlers.indent('outdent', context)

    return this.handlers.navigation(command, context)
  }

  registerCommandHandler(
    command: EditorAnyCommandId,
    handler: EditorCommandHandler,
  ): EditorDisposable {
    if (this.commandHandlers.has(command)) {
      throw new Error(`Editor command already registered: ${command}`)
    }

    this.commandHandlers.set(command, handler)

    return {
      dispose: () => this.unregisterCommandHandler(command, handler),
    }
  }

  private unregisterCommandHandler(
    command: EditorAnyCommandId,
    handler: EditorCommandHandler,
  ): void {
    if (this.commandHandlers.get(command) !== handler) return

    this.commandHandlers.delete(command)
  }

  private runRegisteredCommand(
    command: EditorAnyCommandId,
    context: EditorCommandContext,
  ): boolean | null {
    return this.commandHandlers.get(command)?.(context) ?? null
  }
}
