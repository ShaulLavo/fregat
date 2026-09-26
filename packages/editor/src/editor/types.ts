import type { DocumentSessionChange } from '../documentSession'
import type {
  EditorSyntaxLanguageId,
  EditorSyntaxSession,
  EditorSyntaxSessionOptions,
} from '../syntax/session'
import type {
  EditorInitialHighlightStatus,
  EditorInitialPaintEvent,
  EditorPlugin,
} from '../plugins'
import type { EditorTheme } from '../theme'
import type {
  EditorCursorLineHighlightOptions,
  HiddenCharactersMode,
  VirtualizedTextViewRowPositioning,
  VirtualizedTextViewScrollMode,
} from '../virtualization/virtualizedTextViewTypes'
import type { BrowserTextMetrics } from '../virtualization/browserMetrics'
import type {
  EditorInputKind,
  EditorInputRoute,
  EditorWrapBreak,
} from '../virtualization/virtualizedTextViewTypes'
import type { EditorKeymapOptions } from './keymap'
import type { EditorAutoClosingPair } from './languageConfiguration'
import type { EditorSuspiciousCharactersOptions } from '../unicodeHighlight'
import type { TextEdit } from '../tokens'
import type { EditorTokenInput } from '../syntax/tokenStore'
import type { SelectionAffinity } from '../selections'
import type { EditorPreparedDocument, EditorPreparedTagValue } from './preparedDocument'

/** Minimal interface for the CSS Custom Highlight API registry. */
export interface HighlightRegistry {
  set(name: string, highlight: Highlight): void
  delete(name: string): boolean
}

export type EditorSessionChangeHandler = (change: DocumentSessionChange) => void

export type EditorEditability = 'editable' | 'readonly'

export type EditorDocumentMode = 'session' | 'static'

export type EditorSelectionSyncMode = 'sync' | 'none'

export type EditorScrollMode = VirtualizedTextViewScrollMode

type EditorRowPositioning = VirtualizedTextViewRowPositioning

export type EditorRangeDecoration = {
  readonly className?: string
  readonly end: number
  readonly start: number
  readonly style?: Partial<CSSStyleDeclaration>
  /**
   * Stacking order against other range decorations, highest paints last. Without it the CSS
   * highlight registry falls back to registration order, which reshuffles as groups scroll in
   * and out of the mounted window.
   */
  readonly zIndex?: number
}

export type EditorScrollPosition = {
  readonly top?: number
  readonly left?: number
}

export type EditorSessionOptions = {
  readonly documentId?: string | null
  readonly documentConfigurationTag?: readonly EditorPreparedTagValue[]
  readonly highlighterConfigurationTag?: readonly EditorPreparedTagValue[]
  readonly languageId?: EditorSyntaxLanguageId | null
  readonly onChange?: EditorSessionChangeHandler
  readonly preparedDocument?: EditorPreparedDocument | null
  readonly scrollPosition?: EditorScrollPosition
  readonly structuralConfigurationTag?: readonly EditorPreparedTagValue[]
}

export type EditorSyntaxStatus = 'plain' | 'loading' | 'ready' | 'degraded' | 'error'

export type EditorState = {
  readonly documentId: string | null
  readonly documentMode: EditorDocumentMode
  readonly editability: EditorEditability
  readonly languageId: EditorSyntaxLanguageId | null
  readonly syntaxStatus: EditorSyntaxStatus
  readonly initialHighlightStatus: EditorInitialHighlightStatus
  readonly cursor: {
    readonly row: number
    readonly column: number
  }
  readonly length: number
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly isDirty: boolean
}

export type EditorChangeHandler = (state: EditorState, change: DocumentSessionChange | null) => void

export type EditorOptions = {
  readonly documentKey?: string | null
  readonly snapshot?: string | null
  /** External projections may hold saved paint until their tokens and geometry are ready. */
  readonly presentationReady?: boolean
  readonly onPresentationChange?: (state: 'provisional' | 'live' | 'empty') => void
  readonly defaultText?: string
  readonly documentMode?: EditorDocumentMode
  readonly editability?: EditorEditability
  readonly theme?: EditorTheme
  readonly onChange?: EditorChangeHandler
  readonly onInitialPaint?: (event: EditorInitialPaintEvent) => void
  readonly plugins?: readonly EditorPlugin[]
  readonly keymap?: EditorKeymapOptions
  readonly cursorLineHighlight?: EditorCursorLineHighlightOptions
  readonly hiddenCharacters?: HiddenCharactersMode
  /** In pixels. Popups the editor opens follow it. Unset, the stylesheet decides (13px). */
  readonly fontSize?: number
  /** A CSS `font-family` list. Unset, the stylesheet decides (`monospace`). */
  readonly fontFamily?: string
  /** Row height in pixels, not a ratio; independent of `fontSize`. */
  readonly lineHeight?: number
  readonly rangeDecorations?: readonly EditorRangeDecoration[]
  readonly rowGap?: number
  readonly rowPositioning?: EditorRowPositioning
  /**
   * Moves character-step carets by screen direction; word and subword motion stay logical.
   * Defaults off on Windows and on elsewhere.
   */
  readonly rtlMoveVisually?: boolean
  readonly scrollMode?: EditorScrollMode
  readonly selectionSyncMode?: EditorSelectionSyncMode
  /** Confusable and invisible characters to point out; both families report unless turned off. */
  readonly suspiciousCharacters?: EditorSuspiciousCharactersOptions
  /**
   * Columns a tab character spans, and the indentation width when `detectIndentation` is off or a
   * document gives no sign of its own. Defaults to 4.
   */
  readonly tabSize?: number
  /**
   * Guesses each document's indentation width from its text, falling back to `tabSize`. On by
   * default; turn it off where the text is not a document's own, such as a diff projection.
   */
  readonly detectIndentation?: boolean
  /**
   * Offers fold regions: syntax, indentation, contributed and hand-drawn. On by default; off, the
   * fold commands find nothing to fold, as a diff projection needs.
   */
  readonly folding?: boolean
  /**
   * Hands Tab back to the page instead of indenting with it, for a reader who would otherwise have
   * no key left to leave the editor by. Ctrl+M turns it on and off from inside.
   */
  readonly tabMovesFocus?: boolean
  readonly textMetrics?: BrowserTextMetrics
  /**
   * `'edit-context'` takes typed text through EditContext where the engine has it (Chromium), so
   * IME, autocorrect and dictation edits arrive with their ranges instead of being diffed out of a
   * textarea. Elsewhere, and by default, the textarea.
   */
  readonly inputRoute?: EditorInputRoute
  /** The input's accessible name. Defaults to "Editor input". */
  readonly inputLabel?: string
  readonly inputKind?: EditorInputKind
  /**
   * Leaves room below the last row to scroll it to the top. On by default; a host that sizes itself
   * to its text turns it off.
   */
  readonly scrollPastEnd?: boolean
  /** Soft-wraps long lines to the viewport width instead of scrolling horizontally. */
  readonly wordWrap?: boolean
  /**
   * Where a wrapped row ends: `'character'` (the default) at the column that fills it, `'word'` at
   * the last word boundary, keeping every replacement on one row.
   */
  readonly wordWrapBreak?: EditorWrapBreak
  /** Replaces every language's auto-closing pairs; an empty list turns auto-close off. */
  readonly autoClosingPairs?: readonly EditorAutoClosingPair[]
  /** What typing an opener over a selection wraps it with. Unset, the auto-closing pairs. */
  readonly surroundingPairs?: readonly EditorAutoClosingPair[]
}

export type EditorSetTextOptions = {
  readonly documentMode?: EditorDocumentMode
  readonly languageId?: EditorSyntaxLanguageId | null
  readonly scrollPosition?: EditorScrollPosition
  /** Painted with the text. Without them the text arrives uncoloured until a highlighter answers. */
  readonly tokens?: EditorTokenInput
}

export type EditorOpenDocumentOptions = EditorSetTextOptions & {
  readonly text: string
  readonly documentId?: string
}

export type EditorEditHistoryMode = 'record' | 'skip'

export type EditorEditSelection = {
  readonly anchor: number
  readonly affinity?: SelectionAffinity
  readonly head?: number
}

export type EditorEditOptions = {
  readonly history?: EditorEditHistoryMode
  readonly selection?: EditorEditSelection
}

export type EditorEditInput = TextEdit | readonly TextEdit[]

export type EditorSyntaxSessionFactory = (
  options: EditorSyntaxSessionOptions,
) => EditorSyntaxSession
