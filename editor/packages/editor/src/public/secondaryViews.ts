import type { TextReadSnapshot } from '../documentTextSnapshot'
import type {
  EditorLineStartsView,
  EditorResolvedSelection,
  EditorViewSnapshot,
  EditorViewportSnapshot,
  EditorVisibleRowSnapshot,
} from '../plugins'
import type { EditorSyntaxLanguageId } from '../syntax'
import type { EditorTheme } from '../theme'
import type { EditorTokenInput, EditorTokenStore } from '../syntax/tokenStore'
import {
  VirtualizedTextView,
  type BrowserTextMetrics,
  type VirtualizedFoldMarker,
  type VirtualizedTextViewOptions,
} from '../virtualization'

export type EditorSecondaryTextViewOptions = VirtualizedTextViewOptions

/**
 * A read-only view of rows the editor already shows elsewhere, such as a sticky-scroll stack. It
 * stays out of the tab order because everything it repeats is already in the reading order.
 */
export type EditorSecondaryTextView = {
  setText(text: string): void
  setTokens(tokens: EditorTokenInput): void
  setTheme(theme: EditorTheme | null): void
  /** The mirrored view's metrics: its row height and character width together. */
  setTextMetrics(metrics: BrowserTextMetrics): void
  setHeight(height: number): void
  dispose(): void
}

export function createEditorSecondaryTextView(
  container: HTMLElement,
  options: EditorSecondaryTextViewOptions,
): EditorSecondaryTextView {
  const view = new VirtualizedTextView(container, options)
  view.setEditable(false)
  view.scrollElement.tabIndex = -1
  view.inputElement.tabIndex = -1
  return {
    setText: (text) => view.setText(text),
    setTokens: (tokens) => view.setTokens(tokens),
    setTheme: (theme) => view.setTheme(theme),
    setTextMetrics: (metrics) => {
      view.setTextMetrics(metrics)
    },
    setHeight: (height) => {
      view.scrollElement.style.height = `${height}px`
    },
    dispose: () => view.dispose(),
  }
}

export type EditorSecondaryViewTextProjection = {
  readonly snapshot: TextReadSnapshot
  readonly length: number
  readonly lineStarts: readonly number[]
  readonly lineStartsView: EditorLineStartsView
  readonly lineCount: number
}

export type EditorSecondaryViewLineModel = {
  readonly kind: 'visible'
  readonly rows: readonly EditorVisibleRowSnapshot[]
  readonly totalLineCount: number
}

export type EditorSecondaryViewSyntaxColors = {
  readonly languageId: EditorSyntaxLanguageId | null
  readonly theme?: EditorTheme | null
  readonly tokens: EditorTokenStore
}

export type EditorSecondaryViewDecoration = {
  readonly owner: string
  readonly startLineNumber: number
  readonly endLineNumber: number
  readonly kind?: string
  readonly metadata?: unknown
}

export type EditorSecondaryViewFoldSummary = {
  readonly key: string
  readonly startOffset: number
  readonly endOffset: number
  readonly startLineNumber: number
  readonly endLineNumber: number
  readonly collapsed: boolean
}

export type EditorSecondaryViewProjection = {
  readonly documentId: string | null
  readonly textVersion: number
  readonly text: EditorSecondaryViewTextProjection
  readonly viewport: EditorViewportSnapshot
  readonly metrics: BrowserTextMetrics
  readonly visibleLineModel: EditorSecondaryViewLineModel
  readonly syntaxColors: EditorSecondaryViewSyntaxColors
  readonly selections: readonly EditorResolvedSelection[]
  readonly decorations: readonly EditorSecondaryViewDecoration[]
  readonly foldSummaries: readonly EditorSecondaryViewFoldSummary[]
}

export type EditorSecondaryViewProjectionOptions = {
  readonly decorations?: readonly EditorSecondaryViewDecoration[]
}

export function createEditorSecondaryViewProjection(
  snapshot: EditorViewSnapshot,
  options: EditorSecondaryViewProjectionOptions = {},
): EditorSecondaryViewProjection {
  let foldSummaries: readonly EditorSecondaryViewFoldSummary[] | undefined
  return {
    documentId: snapshot.documentId,
    textVersion: snapshot.textVersion,
    text: createTextProjection(snapshot),
    viewport: snapshot.viewport,
    metrics: snapshot.metrics,
    visibleLineModel: {
      kind: 'visible',
      rows: snapshot.visibleRows,
      totalLineCount: snapshot.lineCount,
    },
    syntaxColors: {
      languageId: snapshot.languageId,
      theme: snapshot.theme,
      tokens: snapshot.tokens,
    },
    selections: snapshot.selections,
    decorations: options.decorations ?? [],
    get foldSummaries() {
      foldSummaries ??= snapshot.foldMarkers.map(foldSummaryFromMarker)
      return foldSummaries
    },
  }
}

function createTextProjection(snapshot: EditorViewSnapshot): EditorSecondaryViewTextProjection {
  return {
    snapshot: snapshot.textSnapshot,
    length: snapshot.textSnapshot.length,
    get lineStarts() {
      return snapshot.lineStarts
    },
    lineStartsView: snapshot.lineStartsView,
    lineCount: snapshot.lineCount,
  }
}

function foldSummaryFromMarker(marker: VirtualizedFoldMarker): EditorSecondaryViewFoldSummary {
  return {
    key: marker.key,
    startOffset: marker.startOffset,
    endOffset: marker.endOffset,
    startLineNumber: marker.startRow + 1,
    endLineNumber: marker.endRow + 1,
    collapsed: marker.collapsed,
  }
}
