// E033 contract fixtures, compiled against the built declarations. Nothing here runs: each
// `@ts-expect-error` is a shape the boundary must reject, and every other line one it must allow.
import {
  createStringTextSnapshot,
  type TextReadSnapshot,
  type TextSnapshot,
} from '@singapore-editor/core/document'
import type { Editor } from '@singapore-editor/core/editor'
import {
  serializeEditorViewSnapshot,
  type EditorContributionChange,
  type EditorDecorationContributionContext,
  type EditorHighlighterSessionOptions,
  type EditorInjectedTextRowProviderContext,
  type EditorInlineReplacementContext,
  type EditorSelectionRangeContext,
  type EditorViewSnapshot,
} from '@singapore-editor/core/extensions'

declare const editor: Editor
declare const snapshot: EditorViewSnapshot
declare const inline: EditorInlineReplacementContext
declare const injected: EditorInjectedTextRowProviderContext
declare const selectionRange: EditorSelectionRangeContext
declare const change: EditorContributionChange
declare const decorations: EditorDecorationContributionContext
declare const highlighter: EditorHighlighterSessionOptions

export function explicitExtractionCompiles(): readonly string[] {
  const source: TextSnapshot = editor.getTextSnapshot()
  return [
    editor.materializeFullText(),
    source.materializeFullText(),
    serializeEditorViewSnapshot(snapshot).fullText,
    decorations.materializeFullText(),
    highlighter.textSnapshot.materializeFullText(),
  ]
}

export function readTypeAnswersLines(source: TextReadSnapshot): number {
  const range = source.lineRange(source.lineAt(source.length))
  return source.lineCount + source.lineStart(0) + range.end - range.start
}

export function implicitTextIsGone(): void {
  // @ts-expect-error runtime snapshots carry no whole-text getter
  void snapshot.fullText
  // @ts-expect-error full-view JSON is the named serializer, not an implicit toJSON
  void snapshot.toJSON()
  // @ts-expect-error inline replacement contexts carry a read source, not the document text
  void inline.text
  // @ts-expect-error injected-row contexts carry a read source, not the document text
  void injected.text
  // @ts-expect-error selection-range contexts carry a read source, not the document text
  void selectionRange.text
  // @ts-expect-error highlighter sessions receive the source, never a flattened copy
  void highlighter.fullText
}

export function ordinaryReadsCannotFlatten(): void {
  // @ts-expect-error a view snapshot's source is read-only
  void snapshot.textSnapshot.materializeFullText()
  // @ts-expect-error nor does it expose the piece table behind it
  void snapshot.textSnapshot.snapshot
  // @ts-expect-error provider contexts read ranges
  void inline.textSnapshot.materializeFullText()
  // @ts-expect-error a contribution's change keeps its text read-only
  void change.textSnapshot.materializeFullText()
  // @ts-expect-error and keeps the piece table with the document's owners
  void change.snapshot
  // @ts-expect-error including through the transaction that produced it
  void change.transaction
  // @ts-expect-error a contribution context hands out the read type
  void decorations.getTextSnapshot()?.materializeFullText()
}

export function sourcesAreRequired(): void {
  // @ts-expect-error an inline replacement context without its source
  const withoutSource: EditorInlineReplacementContext = { languageId: null, captures: [] }
  // @ts-expect-error a view snapshot's line queries are required, not a fallback
  const withoutLines: Pick<EditorViewSnapshot, 'lineStartsView'> = {}
  void withoutSource
  void withoutLines
}

export function detachedEditsCarryTheirResult(): void {
  const edit = { from: 0, to: 0, text: 'a' }
  // @ts-expect-error the text after the edit is required; the editor no longer rebuilds it
  editor.applyEdit(edit, [])
  editor.applyEdit(edit, [], createStringTextSnapshot('a'))
}
