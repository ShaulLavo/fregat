import type { DisplayRow, InjectedTextRow, InlineRow } from '../displayTransforms'
import type { TextSnapshot } from '../documentTextSnapshot'
import type { FoldMap } from '../foldMap'
import type { InlineMap } from '../inlineMap'
import type { PieceTableEdit } from '@singapore-editor/textbuffer'

export type DisplayProjectionConfig = {
  readonly foldMap: FoldMap | null
  readonly inlineMap: InlineMap | null
  readonly injectedTextRows: readonly InjectedTextRow[]
  readonly wrapColumn: number | null
  /** Where a wrapped row may end. Defaults to `'character'`. */
  readonly wrapBreak?: WrapBreak
  /**
   * Wrap by measured width instead of columns, for a proportional face. `wrapColumn` still says wrap
   * is on, and bounds how much of a line one uniform row may hold.
   */
  readonly wrapAdvance?: WrapAdvance | null
  readonly tabSize: number
}

/** A row's width in CSS pixels, safety margin already taken off, and each code point's advance. */
export type WrapAdvance = {
  readonly width: number
  readonly advance: (codePoint: number) => number
  /** The table `advance` reads, so a face change is visible by identity. */
  readonly glyphs?: object
}

/** `'character'` ends a row at the column that fills it; `'word'` at the last word boundary. */
export type WrapBreak = 'character' | 'word'

export type DisplayProjectionInput = DisplayProjectionConfig & {
  readonly textSnapshot: TextSnapshot
}
export type DisplayProjectionTransition = {
  readonly before: TextSnapshot
  readonly after: TextSnapshot
  readonly edits: readonly PieceTableEdit[]
}

type WithoutText<T> = T extends unknown ? Omit<T, 'text' | 'sourceText' | 'measurements'> : never
export type DisplayRowMetrics = WithoutText<DisplayRow> & {
  readonly textLength: number
  readonly sourceLength: number
}

export type WrapSummary =
  | {
      readonly kind: 'uniform'
      readonly length: number
      readonly width: number
      readonly rows: number
    }
  | {
      readonly kind: 'indexed'
      readonly length: number
      readonly ends: Uint32Array
      readonly rows: number
    }

export type InlineTextPart = {
  readonly start: number
  readonly end: number
  readonly sourceStart: number
  readonly replacement: string | null
}

export type InlineSummary = {
  readonly mapping: InlineRow
  readonly parts: readonly InlineTextPart[]
}

export type InjectedSummary = { readonly input: InjectedTextRow; readonly wrap: WrapSummary }
export type WrappedEntry = {
  readonly kind: 'wrapped'
  readonly sourceLines: number
  readonly rows: number
  readonly prefixes: Uint32Array
  readonly width: number
  /** Explicit row ends for the lines whose rows are not `width` apart: tabs, or word breaks. */
  readonly breaks: { readonly offsets: Uint32Array; readonly ends: Uint32Array } | null
}

export type ProjectionEntry =
  | WrappedEntry
  | {
      readonly kind: 'run'
      readonly sourceLines: number
      readonly rows: number
      readonly hidden: boolean
    }
  | {
      readonly kind: 'line'
      readonly sourceLines: 1
      readonly rows: number
      readonly inline: InlineSummary | null
      readonly wrap: WrapSummary
      readonly before: readonly InjectedSummary[]
      readonly after: readonly InjectedSummary[]
    }

export type ProjectionCounters = {
  sourceBytesRead: number
  materializedRows: number
  materializedTextBytes: number
  indexEntriesTouched: number
  summaryLinesMeasured: number
}
