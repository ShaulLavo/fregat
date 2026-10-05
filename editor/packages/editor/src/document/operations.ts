import type { DocumentContributionSource, DocumentRead } from '../editor/documentDelivery'
import type { EditorSyntaxSessionOptions } from '../syntax/session'
import type { EditorHighlighterSessionOptions } from '../syntax/highlighter'

type EditorContributionContext = {
  readonly documentId: string
  readonly runtimeSessionId: string
  readonly initialRead: DocumentRead
  readonly source: Pick<DocumentContributionSource, 'read' | 'changesBetween'>
}
export type EditorStructuralOperationContext = EditorContributionContext &
  EditorSyntaxSessionOptions
export type EditorHighlighterOperationContext = EditorContributionContext &
  EditorHighlighterSessionOptions

export type EditorStructuralOperation =
  import('../editor/operationDefinitions').StructuralDefinition
export type EditorHighlighterOperation =
  import('../editor/operationDefinitions').HighlighterDefinition
