import type { EditorDisposable } from '../editor/disposables'
import type { ScheduledFrame } from '../editor/scheduleFrame'
import type { WrapAdvance, WrapBreak } from './displayProjectionTypes'
import type { GlyphAdvances } from './glyphAdvances'
import type { HighlightOverlayRange } from './highlightOverlay'
import type { ScrollViewport } from './scrollViewport'
import type { FoldMarkerSource } from './foldMarkerSource'
import type { InlineMap } from '../inlineMap'
import type { EditorGutterContribution, EditorGutterWidthContext } from '../plugins'
import type { SelectionAffinity } from '../selections'
import type { EditorTokenStore } from '../syntax/tokenStore'
import type { BrowserTextMetrics } from './browserMetrics'
import type { FixedRowVirtualizer } from './fixedRowVirtualizer'
import type { SuspiciousCharacterSettings } from './virtualizedTextViewHiddenCharacters'
import type { VirtualizedTextViewModelState } from './virtualizedTextViewModel'
import type {
  EditorCursorLineHighlightOptions,
  HiddenCharactersMode,
  HighlightRegistry,
  MountedVirtualizedTextRow,
  TokenGroup,
  VirtualizedFoldMarker,
  VirtualizedTextViewRowPositioning,
  VirtualizedTextViewScrollMode,
  VirtualizedTextRowDecoration,
  VirtualizedTextHighlightStyle,
} from './virtualizedTextViewTypes'

export type CreateRangeOptions = {
  readonly scrollIntoView?: boolean
}

export type VirtualizedStoredSelection = {
  readonly start: number
  readonly end: number
  readonly head: number
  readonly affinity: SelectionAffinity
}

export type VirtualizedTextSelection = {
  readonly anchorOffset: number
  readonly headOffset: number
  readonly affinity?: SelectionAffinity
}

export type VirtualizedTextHighlightRange = {
  readonly start: number
  readonly end: number
}

export type { VirtualizedTextHighlightStyle } from './virtualizedTextViewTypes'

export type VirtualizedTextHighlightGroup = {
  readonly name: string
  readonly highlight: Highlight
  ranges: readonly VirtualizedTextHighlightRange[]
  style: VirtualizedTextHighlightStyle
  registered: boolean
  signature: string
  paintRanges?: readonly VirtualizedTextHighlightRange[]
  twins?: Map<string, VirtualizedTextHighlightGroup>
}

export type SameLineTokenEdit = {
  readonly rowIndex: number
  readonly editedRowPatchedInPlace: boolean
  readonly kind?: 'same-line' | 'multi-line'
}

export interface VirtualizedTextViewInternal {
  disposed: boolean
  provisional: boolean
  readonly scrollElement: HTMLDivElement
  readonly viewport: ScrollViewport
  readonly contentElement: HTMLDivElement
  readonly inputElement: HTMLElement
  readonly spacer: HTMLDivElement
  readonly gutterElement: HTMLDivElement
  gutterContributions: readonly EditorGutterContribution[]
  readonly gutterWidthProvider: ((context: EditorGutterWidthContext) => number) | null
  /** Configured; the gutter applies it only while it is shown. */
  gutterLeadingInset: number
  readonly caretLayerElement: HTMLDivElement
  readonly caretElement: HTMLDivElement
  readonly secondaryCaretElements: HTMLDivElement[]
  /** A caret render waiting for the next frame because the editor does not hold focus. */
  deferredCaret: ScheduledFrame | null
  readonly styleEl: HTMLStyleElement
  readonly highlightScope: string
  readonly virtualizer: FixedRowVirtualizer
  scrollMode: VirtualizedTextViewScrollMode
  readonly rowPositioning: VirtualizedTextViewRowPositioning
  readonly longLineChunkSize: number
  readonly longLineChunkThreshold: number
  readonly horizontalOverscanColumns: number
  readonly onFoldToggle: ((marker: VirtualizedFoldMarker) => void) | null
  readonly onViewportChange: (() => void) | null
  readonly cursorLineHighlight: Required<EditorCursorLineHighlightOptions>
  readonly rowElements: Map<number, MountedVirtualizedTextRow>
  readonly rowPool: MountedVirtualizedTextRow[]
  readonly highlightRegistry: HighlightRegistry | null
  readonly selectionHighlightName: string
  readonly selectionHighlight: Highlight | null
  readonly rangeHighlightGroups: Map<string, VirtualizedTextHighlightGroup>
  highlightOverlaySnapshot: VirtualizedTextViewModelState['textSnapshot'] | null
  highlightOverlayMask: readonly HighlightOverlayRange[]
  readonly overlayBaseGroups: Map<string, VirtualizedTextHighlightGroup>
  // A range rule depends only on a group's name and style, so a repaint that moves ranges around
  // cannot change the rule set. Counting the changes that *can* — a group added, removed, or
  // restyled — is what keeps `rebuildStyleRules` off the O(groups^2) path a per-keystroke repaint
  // of many groups would otherwise put it on. Worth about 1% of a keystroke at the live group
  // count, which is smaller than it sounds and was once recorded as far larger. The benchmark and
  // correction live with the regression in test/semanticTokenRepaintCost.test.ts.
  rangeHighlightRuleVersion: number
  renderedRangeHighlightRuleVersion: number
  selectionHighlightRegistered: boolean
  model: VirtualizedTextViewModelState
  textRevision: number
  displayProjectionRevision: number
  tokens: EditorTokenStore
  /** The palette changed since the token highlight groups were last matched to it. */
  tokenPaletteDirty: boolean
  foldMarkers: readonly VirtualizedFoldMarker[]
  foldMarkerSource: FoldMarkerSource | null
  rowDecorations: ReadonlyMap<number, VirtualizedTextRowDecoration>
  foldMarkerByStartRow: ReadonlyMap<number, VirtualizedFoldMarker>
  foldMarkerByKey: ReadonlyMap<string, VirtualizedFoldMarker>
  wrapEnabled: boolean
  wrapBreak: WrapBreak
  /** The measured-width wrap in the projection's config, when the face is proportional. */
  wrapAdvance: WrapAdvance | null
  readonly styledRowFaces: Map<
    string,
    { readonly element: HTMLDivElement; readonly observer: EditorDisposable }
  >
  readonly onStyledFaceChange: () => void
  /** The face's glyph advances while it is proportional; null keeps every estimate on columns. */
  glyphs: GlyphAdvances | null
  tabSize: number
  tokenGroups: Map<string, TokenGroup>
  rowTokenSignatures: Map<number, string>
  rowTokenRanges: Map<number, Map<string, readonly AbstractRange[]>>
  tokenProjectionDirtyStartRow: number | null
  nextTokenHighlightSlotId: number
  selectionStart: number | null
  selectionEnd: number | null
  selectionHead: number | null
  selections: readonly VirtualizedStoredSelection[]
  /** The inline map as supplied; model.inlineMap is this with the selection's constructs revealed. */
  inlineMapBase: InlineMap | null
  lastSelectionHighlightSignature: string
  lastRenderedRowsKey: string
  gutterContributionWidths: ReadonlyMap<string, number>
  gutterWidthDirty: boolean
  currentGutterWidth: number
  /** The inset `currentGutterWidth` includes. */
  currentGutterLeadingInset: number
  contentWidth: number
  maxVisualColumnsSeen: number
  lastWidthScanStart: number
  lastWidthScanEnd: number
  sameLineTokenEdit: SameLineTokenEdit | null
  lineHeightOverride: number | null
  rowGap: number
  metrics: BrowserTextMetrics
  /** False when the font's glyph advances differ, which retires calculated row geometry. */
  monospace: boolean
  textMetrics: BrowserTextMetrics | null
  hiddenCharacters: HiddenCharactersMode
  suspiciousCharacters: SuspiciousCharacterSettings
}
