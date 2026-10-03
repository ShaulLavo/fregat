import {
  createPlugin,
  type EditorPlugin,
  type EditorViewScope,
} from '@singapore-editor/core/extensions'
import {
  MARKDOWN_AUTHORING_COMMANDS,
  planMarkdownEdit,
  requiresMarkdownRecords,
  type MarkdownAuthoringCommand,
} from './authoring'
import { Kind } from 'tree-sitter-md'

export function createMarkdownAuthoringPlugin(): EditorPlugin {
  return createPlugin({
    name: 'markdown.authoring',
    view(scope) {
      scope.own(scope.view.requestSyntaxCaptures())
      const isMarkdown = () => scope.view.getSnapshot().languageId === 'markdown'
      scope.own(scope.view.registerKeymapContextKey('markdown', isMarkdown))
      for (const [command, target] of [
        ['markdown.indentListItem', 'editor.action.indentLines'],
        ['markdown.outdentListItem', 'editor.action.outdentLines'],
      ] as const) {
        scope.handle(command, (context) => {
          if (!isMarkdown()) return false
          const selection = scope.getSelections()[0]
          if (!selection) return false
          const source = scope.editor.getTextSnapshot()
          const line = source.lineRange(source.lineAt(selection.headOffset))
          if (!/^\s*(?:[-+*]|\d+[.)])\s/.test(source.readRange(line.start, line.end))) return false
          if (insideCodeBlock(scope.editor.getSyntaxRecords()?.data, selection.headOffset))
            return false
          return scope.editor.dispatchCommand(target, context)
        })
      }
      installAuthoringCommands(scope, isMarkdown)
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

function installAuthoringCommands(scope: EditorViewScope, isMarkdown: () => boolean): void {
  type Pending = {
    command: MarkdownAuthoringCommand
    source: ReturnType<typeof scope.editor.getTextSnapshot>
    documentId: string | null
    anchor: number
    head: number
  }
  let pending: Pending | null = null
  let disposed = false
  const matches = (request: Pending): boolean => {
    const selected = scope.getSelections()[0]
    return (
      !disposed &&
      isMarkdown() &&
      scope.editor.getKeymapContext().writable &&
      scope.view.getSnapshot().documentId === request.documentId &&
      scope.editor.getTextSnapshot() === request.source &&
      scope.getSelections().length === 1 &&
      selected?.anchorOffset === request.anchor &&
      selected.headOffset === request.head
    )
  }
  const apply = (request: Pending): boolean => {
    if (!matches(request)) return false
    const edit = planMarkdownEdit(
      request.source,
      request,
      request.command,
      scope.editor.getSyntaxRecords()?.data,
    )
    if (!edit) return false
    if (edit.edits.length) scope.applyEdits(edit.edits, edit.selection)
    else scope.editor.setSelection(edit.selection.anchor, edit.selection.head)
    return true
  }
  scope.watch(
    {
      id: 'markdown.authoring.readiness',
      kinds: ['tokens', 'content', 'selection'],
      read: (snapshot) => ({ snapshot, records: scope.editor.getSyntaxRecords() }),
    },
    () => {
      if (!pending) return
      if (!matches(pending)) {
        pending = null
        return
      }
      // @justification Applies after the contribution pass so the edit never runs inside a view
      // update; the pending request, disposal and document are rechecked when it runs.
      queueMicrotask(() => {
        const request = pending
        if (!request || disposed) return
        if (!scope.editor.getSyntaxRecords() && scope.editor.getTextSnapshot() === request.source)
          return
        pending = null
        apply(request)
      })
    },
  )
  scope.onDispose(() => {
    disposed = true
    pending = null
  })
  for (const command of MARKDOWN_AUTHORING_COMMANDS) {
    scope.handle(command, () => {
      const selected = scope.getSelections()[0]
      if (
        !isMarkdown() ||
        !scope.editor.getKeymapContext().writable ||
        !selected ||
        scope.getSelections().length !== 1
      )
        return false
      pending = null
      const request: Pending = {
        command,
        source: scope.editor.getTextSnapshot(),
        documentId: scope.view.getSnapshot().documentId,
        anchor: selected.anchorOffset,
        head: selected.headOffset,
      }
      if (requiresMarkdownRecords(command) && !scope.editor.getSyntaxRecords()) {
        pending = request
        scope.view.focusEditor()
        return true
      }
      const handled = apply(request)
      if (handled) scope.view.focusEditor()
      return handled
    })
  }
}
