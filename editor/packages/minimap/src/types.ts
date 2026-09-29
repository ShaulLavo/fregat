import type { TextEdit } from '@singapore-editor/core/document'
import type {
  EditorMinimapDecoration as CoreEditorMinimapDecoration,
  EditorMinimapDecorationPosition as CoreEditorMinimapDecorationPosition,
  EditorMinimapSectionHeaderStyle as CoreEditorMinimapSectionHeaderStyle,
} from '@singapore-editor/core/extensions'

export const enum RenderMinimap {
  None = 0,
  Text = 1,
  Blocks = 2,
}

export type MinimapSide = 'left' | 'right'
export type MinimapSize = 'proportional' | 'fill' | 'fit'
export type MinimapSliderVisibility = 'always' | 'mouseover'
export type MinimapAutohide = 'none' | 'mouseover' | 'scroll'
export type MinimapDecorationPosition = CoreEditorMinimapDecorationPosition
export type MinimapSectionHeaderStyle = CoreEditorMinimapSectionHeaderStyle

export type RGBA8 = {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

export type EditorMinimapOptions = {
  readonly enabled?: boolean
  readonly autohide?: MinimapAutohide
  readonly side?: MinimapSide
  readonly size?: MinimapSize
  readonly showSlider?: MinimapSliderVisibility
  readonly renderCharacters?: boolean
  readonly maxColumn?: number
  readonly scale?: number
  readonly showRegionSectionHeaders?: boolean
  readonly showMarkSectionHeaders?: boolean
  readonly markSectionHeaderRegex?: string
  readonly sectionHeaderFontSize?: number
  readonly sectionHeaderLetterSpacing?: number
}

export type ResolvedMinimapOptions = {
  readonly enabled: boolean
  readonly autohide: MinimapAutohide
  readonly side: MinimapSide
  readonly size: MinimapSize
  readonly showSlider: MinimapSliderVisibility
  readonly renderCharacters: boolean
  readonly maxColumn: number
  readonly scale: number
  readonly showRegionSectionHeaders: boolean
  readonly showMarkSectionHeaders: boolean
  readonly markSectionHeaderRegex: string
  readonly sectionHeaderFontSize: number
  readonly sectionHeaderLetterSpacing: number
}

export type EditorMinimapDecoration = CoreEditorMinimapDecoration

export type MinimapToken = {
  readonly start: number
  readonly end: number
  readonly color: RGBA8
}

export type MinimapTokenPatch = {
  readonly start: number
  readonly deleteCount: number
  readonly tokens: readonly MinimapToken[]
}

export type MinimapSelection = {
  readonly startOffset: number
  readonly endOffset: number
}

export type MinimapViewport = {
  readonly scrollTop: number
  readonly scrollRow: number
  readonly scrollLeft: number
  readonly scrollHeight: number
  readonly scrollWidth: number
  readonly clientHeight: number
  readonly clientWidth: number
  readonly minimapHeight: number
  /**
   * The overlay lane the minimap already holds. `clientWidth` is the content box, which
   * excludes it, so layout adds it back: a minimap sized from the space left after itself
   * is a feedback loop, and integer rounding parks it in a one-pixel two-frame cycle.
   */
  readonly reservedWidth: number
  /** Zero-based document-line bounds, end exclusive. */
  readonly visibleStart: number
  readonly visibleEnd: number
}

export type MinimapMetrics = {
  readonly rowHeight: number
  readonly characterWidth: number
  readonly devicePixelRatio: number
}

type MinimapDocumentLineSummary = {
  readonly text: string
  readonly length: number
}

export type MinimapDocumentSummaryPayload = {
  readonly textLength: number
  readonly lineStarts: readonly number[]
  readonly lines: readonly MinimapDocumentLineSummary[]
}

export type MinimapDocumentSummaryPatch = {
  readonly textLength: number
  // Omitted for incremental edits: cloning a full line-start array per
  // keystroke dominates main-thread cost on large documents. The worker
  // splices its own copy from startLine/deleteCount/lines instead.
  readonly lineStarts?: readonly number[]
  readonly startLine: number
  readonly deleteCount: number
  readonly lines: readonly MinimapDocumentLineSummary[]
}

export type MinimapDocumentPayload = MinimapDocumentSummaryPayload & {
  readonly tokens: readonly MinimapToken[]
  readonly selections: readonly MinimapSelection[]
  readonly decorations: readonly EditorMinimapDecoration[]
  readonly externalDecorations?: readonly EditorMinimapDecoration[]
}

export type MinimapDocumentEditPayload = {
  readonly selections: readonly MinimapSelection[]
  readonly summaryPatch: MinimapDocumentSummaryPatch
}

export type MinimapRenderLayout = {
  readonly width: number
  readonly height: number
  readonly canvasInnerWidth: number
  readonly canvasInnerHeight: number
  readonly canvasOuterWidth: number
  readonly canvasOuterHeight: number
  readonly lineHeight: number
  readonly charWidth: number
  readonly scale: number
  readonly isSampling: boolean
  readonly heightIsEditorHeight: boolean
  readonly renderMinimap: RenderMinimap
}

type MinimapWorkerInitRequest = {
  readonly type: 'init'
  readonly options: ResolvedMinimapOptions
  readonly baseStyles: MinimapBaseStyles
  readonly mainCanvas: OffscreenCanvas
  readonly decorationsCanvas: OffscreenCanvas
}

export type MinimapBaseStyles = {
  readonly foreground: RGBA8
  readonly background: RGBA8
  readonly minimapBackground: RGBA8
  readonly foregroundOpacity: number
  readonly selection: RGBA8
  readonly slider: string
  readonly sliderHover: string
  readonly sliderActive: string
  readonly fontFamily: string
}

export type MinimapWorkerRequest =
  | MinimapWorkerInitRequest
  | { readonly type: 'updateBaseStyles'; readonly baseStyles: MinimapBaseStyles }
  | { readonly type: 'openDocument'; readonly document: MinimapDocumentPayload }
  | { readonly type: 'replaceDocument'; readonly document: MinimapDocumentPayload }
  | {
      readonly type: 'applyEdit'
      readonly edit: TextEdit
      readonly document: MinimapDocumentEditPayload
    }
  | {
      readonly type: 'applyEdits'
      readonly edits: readonly TextEdit[]
      readonly document: MinimapDocumentEditPayload
    }
  | { readonly type: 'updateTokens'; readonly tokens: readonly MinimapToken[] }
  | { readonly type: 'updateTokenRange'; readonly patch: MinimapTokenPatch }
  | { readonly type: 'updateSelection'; readonly selections: readonly MinimapSelection[] }
  | { readonly type: 'updateDecorations'; readonly decorations: readonly EditorMinimapDecoration[] }
  | {
      readonly type: 'updateExternalDecorations'
      readonly decorations: readonly EditorMinimapDecoration[]
    }
  | {
      readonly type: 'updateLayout'
      readonly metrics: MinimapMetrics
      readonly viewport: MinimapViewport
    }
  | { readonly type: 'updateViewport'; readonly viewport: MinimapViewport }
  | { readonly type: 'render'; readonly sequence: number }
  | { readonly type: 'dispose' }

export type MinimapWorkerResponse =
  | { readonly type: 'layout'; readonly sequence: number; readonly layout: MinimapRenderLayout }
  | { readonly type: 'disposed' }
  | {
      readonly type: 'rendered'
      readonly sequence: number
      readonly sliderNeeded: boolean
      readonly sliderTop: number
      readonly sliderHeight: number
      readonly shadowVisible: boolean
    }
  | { readonly type: 'error'; readonly sequence?: number; readonly message: string }
