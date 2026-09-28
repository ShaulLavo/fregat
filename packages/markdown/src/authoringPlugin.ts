import { createPlugin, type EditorPlugin } from '@singapore-editor/core/extensions'
import { MARKDOWN_AUTHORING_COMMANDS, planMarkdownEdit } from './authoring'
import { Kind } from 'tree-sitter-md'

export function createMarkdownAuthoringPlugin(): EditorPlugin {
  return createPlugin({
    name: 'markdown.authoring',
    view(scope) {
      scope.own(scope.view.requestSyntaxCaptures())
      const isMarkdown = () => scope.view.getSnapshot().languageId === 'markdown'
      scope.own(scope.view.registerKeymapContextKey('markdown', isMarkdown))
      scope.keyParticipant((event, context) => {
        if (
          event.key !== 'Tab' ||
          !isMarkdown() ||
          !context.writable ||
          context.tabFocusMode ||
          context.inlineSuggestionVisible ||
          context.suggestWidgetVisible
        )
          return 'delegate'
        const selection = scope.getSelections()[0]
        if (!selection) return 'delegate'
        const source = scope.editor.getTextSnapshot()
        const line = source.lineRange(source.lineAt(selection.headOffset))
        if (!/^\s*(?:[-+*]|\d+[.)])\s/.test(source.readRange(line.start, line.end)))
          return 'delegate'
        const records = scope.editor.getSyntaxRecords()?.data
        if (insideCodeBlock(records, selection.headOffset)) return 'delegate'
        scope.editor.dispatchCommand(
          event.shiftKey ? 'editor.action.outdentLines' : 'editor.action.indentLines',
          { event },
        )
        return 'consume'
      })
      for (const command of MARKDOWN_AUTHORING_COMMANDS) {
        scope.handle(command, () => {
          const selections = scope.getSelections()
          const selected = selections[0]
          if (
            !isMarkdown() ||
            !scope.editor.getKeymapContext().writable ||
            !selected ||
            selections.length !== 1
          )
            return false
          const edit = planMarkdownEdit(
            scope.editor.getTextSnapshot(),
            {
              anchor: selected.anchorOffset,
              head: selected.headOffset,
            },
            command,
            scope.editor.getSyntaxRecords()?.data,
          )
          if (!edit) return false
          if (edit.edits.length) scope.applyEdits(edit.edits, edit.selection)
          else scope.editor.setSelection(edit.selection.anchor, edit.selection.head)
          scope.view.focusEditor()
          return true
        })
      }
    },
  })
}

function insideCodeBlock(records: Uint32Array | undefined, offset: number): boolean {
  if (!records) return false
  for (let index = 0; index < records.length; index += 4) {
    if (
      records[index + 2] === Kind.CodeBlock &&
      records[index]! <= offset &&
      records[index + 1]! >= offset
    )
      return true
  }
  return false
}
