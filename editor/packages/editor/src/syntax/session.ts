import type { DocumentSessionChange } from '../documentSession'
import type { DocumentTextSnapshot } from '../documentTextSnapshot'
import type { PieceTableSnapshot } from '@singapore-editor/textbuffer'
import type { TextEdit } from '../tokens'
import type { EditorTokenInput } from './tokenStore'
import type { DocumentRead } from '../editor/documentDelivery'
import type { DocumentWorkerReadReference } from '../document/workerReader'
import type { EditorStructuralOperation } from '../document/operations'

export type EditorSyntaxLanguageId = string

export type EditorSyntaxCapture = {
  readonly startIndex: number
  readonly endIndex: number
  readonly captureName: string
  readonly languageId?: EditorSyntaxLanguageId
}

export type FoldRange = {
  readonly startIndex: number
  readonly endIndex: number
  readonly startLine: number
  readonly endLine: number
  readonly type: string
  readonly languageId?: EditorSyntaxLanguageId
}

export type BracketInfo = {
  readonly index: number
  readonly char: string
  readonly depth: number
}

export type EditorSyntaxError = {
  readonly startIndex: number
  readonly endIndex: number
  readonly message: string
  readonly isMissing: boolean
}

export type EditorSyntaxInjection = {
  readonly parentLanguageId: EditorSyntaxLanguageId
  readonly languageId: EditorSyntaxLanguageId
  readonly startIndex: number
  readonly endIndex: number
}

export type EditorSyntaxRange = {
  readonly startIndex: number
  readonly endIndex: number
}

export type EditorSyntaxSnapshotTag = {
  readonly documentId: string | null
  readonly length: number | null
  readonly version: number
}

export type EditorSyntaxMode = 'full' | 'range' | 'none'

export type EditorSyntaxLanguageConfiguration = {
  readonly includeCaptures: boolean
  readonly includeHighlights: boolean
  readonly languageId: EditorSyntaxLanguageId | null
  readonly mode: EditorSyntaxMode
}

export type EditorSyntaxEditSummary = {
  readonly edits: readonly TextEdit[]
  readonly kind: DocumentSessionChange['kind']
}

export type EditorSyntaxServiceRequest = {
  readonly editSummary: EditorSyntaxEditSummary | null
  readonly language: EditorSyntaxLanguageConfiguration
  readonly requestedRanges: readonly EditorSyntaxRange[]
  readonly snapshot: PieceTableSnapshot
  readonly snapshotTag: EditorSyntaxSnapshotTag
  readonly textSnapshot: DocumentTextSnapshot
}

type EditorSyntaxCancellation = {
  readonly kind: 'cancelled'
  readonly coveredRange: EditorSyntaxRange
  readonly reason: 'budget' | 'superseded'
  readonly elapsedMs: number
  readonly budgetMs: number
  readonly timings?: readonly { readonly name: string; readonly durationMs: number }[]
}

export type EditorSyntaxAnalysis =
  | { readonly kind: 'full'; readonly coveredRange: EditorSyntaxRange }
  | {
      readonly kind: 'partial'
      readonly coveredRange: EditorSyntaxRange
      readonly background?: EditorSyntaxCancellation
    }
  | EditorSyntaxCancellation

export type EditorSyntaxProjectionTag = {
  readonly source?: Pick<DocumentWorkerReadReference, 'identity' | 'point'>
  readonly analysis?: EditorSyntaxAnalysis
  readonly language: EditorSyntaxLanguageConfiguration
  readonly requestedRanges: readonly EditorSyntaxRange[]
  readonly snapshot: EditorSyntaxSnapshotTag
}

export type EditorSyntaxDegradedState =
  | {
      readonly kind: 'language-unavailable'
      readonly message?: string
    }
  | {
      readonly kind: 'provider-unavailable'
      readonly message?: string
    }
  | {
      readonly kind: 'range-unavailable'
      readonly message?: string
    }
  | {
      readonly kind: 'request-failed'
      readonly message: string
    }
  | {
      readonly kind: 'optional-phase-failed'
      readonly phase: string
      readonly message: string
    }
  | {
      readonly kind: 'injection-failed'
      readonly phase: string
      readonly message: string
    }

export type EditorSyntaxRecords = {
  readonly languageId: EditorSyntaxLanguageId
  readonly data: Uint32Array
}

export type EditorSyntaxResult = {
  readonly records?: EditorSyntaxRecords
  readonly captures: readonly EditorSyntaxCapture[]
  readonly folds: readonly FoldRange[]
  readonly brackets: readonly BracketInfo[]
  readonly errors: readonly EditorSyntaxError[]
  readonly injections: readonly EditorSyntaxInjection[]
  readonly degraded: EditorSyntaxDegradedState | null
  readonly projection: EditorSyntaxProjectionTag
  /** A provider that builds tokens by hand may return them as objects. */
  readonly tokens: EditorTokenInput
}

export type EditorSyntaxResultOptions = {
  readonly degraded?: EditorSyntaxDegradedState | null
  readonly language?: Partial<EditorSyntaxLanguageConfiguration>
  readonly requestedRanges?: readonly EditorSyntaxRange[]
  readonly snapshot?: Partial<EditorSyntaxSnapshotTag>
}

export type EditorSyntaxSessionOptions = {
  readonly languageId: EditorSyntaxLanguageId | null
  readonly includeHighlights?: boolean
  readonly includeCaptures?: boolean
  readonly syntaxMode?: 'full' | 'range'
}

let nextRuntimeSessionId = 1

export function createEditorRuntimeSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const id = nextRuntimeSessionId
  nextRuntimeSessionId += 1
  return `editor-runtime-${id}`
}

export type EditorSyntaxFoldingSupport = 'pending' | 'supported' | 'unsupported'

export type EditorSyntaxSession = {
  readonly foldingSupport: EditorSyntaxFoldingSupport
  refresh(textSnapshot: DocumentTextSnapshot): Promise<EditorSyntaxResult>
  applyChange(change: DocumentSessionChange): Promise<EditorSyntaxResult>
  canQueryRange?(): boolean
  queryRange?(range: EditorSyntaxRange): Promise<EditorSyntaxResult>
  getResult(): EditorSyntaxResult
  getTokens(): EditorTokenInput
  getSnapshotVersion(): number
  dispose(): void
}

export type EditorSyntaxRuntime = Omit<
  EditorSyntaxSession,
  'refresh' | 'applyChange' | 'queryRange'
> & {
  subscribeResults?(listener: (read: DocumentRead, result: EditorSyntaxResult) => void): () => void
  analyze(read: DocumentRead, signal: AbortSignal): Promise<EditorSyntaxResult>
  queryRange?(range: EditorSyntaxRange, signal: AbortSignal): Promise<EditorSyntaxResult>
}

export type EditorSyntaxProvider = {
  readonly operation: EditorStructuralOperation
}

export const createEditorSyntaxSession = (): EditorSyntaxSession => createEmptySyntaxSession()

export const createEmptySyntaxSession = (): EditorSyntaxSession => ({
  foldingSupport: 'unsupported',
  refresh: async () => createEmptySyntaxResult(),
  applyChange: async () => createEmptySyntaxResult(),
  getResult: () => createEmptySyntaxResult(),
  getTokens: () => [],
  getSnapshotVersion: () => 0,
  dispose: () => undefined,
})

export const createSyntaxSnapshotTag = (
  snapshot: Partial<EditorSyntaxSnapshotTag> = {},
): EditorSyntaxSnapshotTag => ({
  documentId: snapshot.documentId ?? null,
  length: snapshot.length ?? null,
  version: snapshot.version ?? 0,
})

export const createSyntaxLanguageConfiguration = (
  language: Partial<EditorSyntaxLanguageConfiguration> = {},
): EditorSyntaxLanguageConfiguration => ({
  includeCaptures: language.includeCaptures ?? false,
  includeHighlights: language.includeHighlights ?? false,
  languageId: language.languageId ?? null,
  mode: language.mode ?? 'none',
})

export const createSyntaxProjectionTag = (
  options: EditorSyntaxResultOptions = {},
): EditorSyntaxProjectionTag => ({
  language: createSyntaxLanguageConfiguration(options.language),
  requestedRanges: options.requestedRanges ?? [],
  snapshot: createSyntaxSnapshotTag(options.snapshot),
})

export const createEmptySyntaxResult = (
  options: EditorSyntaxResultOptions = {},
): EditorSyntaxResult => ({
  captures: [],
  degraded: options.degraded ?? null,
  folds: [],
  brackets: [],
  errors: [],
  injections: [],
  projection: createSyntaxProjectionTag(options),
  tokens: [],
})

export function syntaxResultCoversRange(
  result: EditorSyntaxResult,
  range?: EditorSyntaxRange | null,
): boolean {
  const analysis = result.projection.analysis
  if (analysis?.kind === 'cancelled' || result.degraded?.kind === 'range-unavailable') return false
  if (!range || !analysis) return true
  return (
    analysis.coveredRange.startIndex <= range.startIndex &&
    analysis.coveredRange.endIndex >= range.endIndex
  )
}

export const isEditorSyntaxLanguage = (
  languageId: string | null | undefined,
): languageId is EditorSyntaxLanguageId => {
  if (!languageId) return false
  return languageId.trim().length > 0
}

/**
 * The languages covering an offset, innermost first, ending with the host language.
 *
 * A chain rather than a single answer because a grammar the parser injects is not always a language
 * anything downstream has rules for: markdown's inline layer is a grammar of its own with no comments
 * and no brackets, and answering it alone would trade the host's rules for nothing. Callers walk
 * outward until a layer can answer them.
 *
 * The narrowest span comes first because injected spans nest — a fenced block holding a template
 * literal — and an enclosing span is that same offset's outer layer, which is the order the walk
 * wants. Spans end where the host resumes, so the end is exclusive.
 */
export const injectedLanguageIdsAtOffset = (
  injections: readonly EditorSyntaxInjection[],
  offset: number,
  hostLanguageId: EditorSyntaxLanguageId | null,
): readonly EditorSyntaxLanguageId[] => {
  const covering = injections
    .filter((injection) => offset >= injection.startIndex && offset < injection.endIndex)
    .toSorted(
      (left, right) => left.endIndex - left.startIndex - (right.endIndex - right.startIndex),
    )
    .map((injection) => injection.languageId)

  return hostLanguageId ? [...covering, hostLanguageId] : covering
}
