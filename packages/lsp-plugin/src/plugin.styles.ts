import {
  darkenEditorColor,
  editorColorReference,
  firstEditorColor,
  lightenEditorColor,
  registerEditorColor,
  transparentEditorColor,
  type VirtualizedTextHighlightStyle,
} from '@singapore-editor/core/rendering'

import type { LanguageServerDiagnosticSeverity } from './diagnostics'

/*
 * Every colour this plugin paints with is a registered id, so a host can restyle diagnostics or the
 * navigation affordance through the editor theme instead of forking this file, and the values are
 * enumerable instead of being buried in style literals. Ids that exist only to be derived from are
 * registered as statements; the rest are bound to the value registration hands back, which is what
 * the styles below paint with.
 */

const DEFINITION_LINK = registerEditorColor('lsp.definitionLink', {
  // Blue reads as "activatable" on either canvas, but the same blue cannot: it has to move away from
  // whichever background it sits on to stay legible against the editor's own syntax colouring.
  dark: '#60a5fa',
  light: '#2563eb',
})

// One hue per severity, in the cut a dark canvas starts from, shared by everything that marks that
// severity anywhere. Two marks on the same line disagreeing about the colour of a problem would read
// as two problems.
const DIAGNOSTIC_HUES = {
  error: '#ef4444',
  warning: '#f59e0b',
  information: '#3b82f6',
  hint: '#94a3b8',
} as const satisfies Record<LanguageServerDiagnosticSeverity, string>

const DIAGNOSTIC_ERROR = registerEditorColor('lsp.diagnostic.error', {
  dark: DIAGNOSTIC_HUES.error,
  light: '#dc2626',
})

registerEditorColor('lsp.diagnostic.warning', {
  dark: DIAGNOSTIC_HUES.warning,
  light: '#b45309',
})
registerEditorColor('lsp.diagnostic.information', {
  dark: DIAGNOSTIC_HUES.information,
  light: '#1d4ed8',
})

// A hint is the quietest severity, so it borrows whatever colour the theme already uses for quiet
// furniture and is pulled one step further toward the canvas it sits on.
const DIAGNOSTIC_HINT_BASE = firstEditorColor(
  editorColorReference('gutter.foreground'),
  DIAGNOSTIC_HUES.hint,
)
registerEditorColor('lsp.diagnostic.hint', {
  dark: darkenEditorColor(DIAGNOSTIC_HINT_BASE, 0.2),
  light: lightenEditorColor(DIAGNOSTIC_HINT_BASE, 0.2),
})

// Each wash derives from its own severity colour, so restyling one id moves the range background
// with it, and stays alpha-blended so it composes over any editor background.
const DIAGNOSTIC_ERROR_BACKGROUND = registerEditorColor(
  'lsp.diagnostic.errorBackground',
  transparentEditorColor(editorColorReference('lsp.diagnostic.error'), 0.16),
)

const DIAGNOSTIC_WARNING_BACKGROUND = registerEditorColor(
  'lsp.diagnostic.warningBackground',
  transparentEditorColor(editorColorReference('lsp.diagnostic.warning'), 0.26),
)

const DIAGNOSTIC_INFORMATION_BACKGROUND = registerEditorColor(
  'lsp.diagnostic.informationBackground',
  transparentEditorColor(editorColorReference('lsp.diagnostic.information'), 0.22),
)

const DIAGNOSTIC_HINT_BACKGROUND = registerEditorColor(
  'lsp.diagnostic.hintBackground',
  transparentEditorColor(editorColorReference('lsp.diagnostic.hint'), 0.22),
)

// The stroke has to read as a separate mark on top of the wash it shares a range with, which a
// darker cut of the same red gives without introducing a second colour to keep in sync.
const DIAGNOSTIC_ERROR_UNDERLINE = registerEditorColor(
  'lsp.diagnostic.errorUnderline',
  darkenEditorColor(editorColorReference('lsp.diagnostic.error'), 0.2),
)

/**
 * Highlight style applied to the identifier range under the pointer while the
 * user holds the navigation modifier (Cmd on macOS, Ctrl elsewhere) over a
 * jumpable definition. Renders as a transparent-background token with an
 * underline so the editor's base syntax colouring stays visible and the
 * affordance matches familiar IDE go-to-definition visuals.
 */
export const LINK_HIGHLIGHT_STYLE: VirtualizedTextHighlightStyle = {
  backgroundColor: 'transparent',
  color: DEFINITION_LINK,
  textDecoration: `underline solid ${DEFINITION_LINK}`,
}

/**
 * Per-severity highlight styles applied by the Language Server plugin to the
 * ranges produced by `diagnosticHighlightGroups`. Errors get a translucent
 * background plus a wavy underline so they are unmistakable even on noisy
 * syntax colouring; warnings / information / hints get progressively subtler
 * washes with no underline, following the severity ordering the styling is
 * meant to convey.
 */
export const DIAGNOSTIC_STYLES: Record<
  LanguageServerDiagnosticSeverity,
  VirtualizedTextHighlightStyle
> = {
  error: {
    backgroundColor: DIAGNOSTIC_ERROR_BACKGROUND,
    color: DIAGNOSTIC_ERROR,
    textDecoration: `underline wavy ${DIAGNOSTIC_ERROR_UNDERLINE}`,
    // The only diagnostic style that declares a `color`, and therefore the only one that contends
    // for one. Left implicit it sat at 0 alongside every syntax token highlight, so whether an
    // error's red text survived over a syntax-coloured identifier came down to which style key the
    // document's shared registry had seen first — a function of session history. Declaring it puts
    // the error above the semantic layer and below every find highlight, which is the order the five
    // producers of a `color` are meant to paint in.
    //
    // It carries a background and an underline as well, and find's three styles all carry a
    // background too — so this number has to differ from all of theirs, not just from the one that
    // also declares a colour. Sharing a number with the find match would leave *that* contest to
    // registration order, which is the thing being fixed rather than a different question.
    zIndex: 3,
  },
  warning: { backgroundColor: DIAGNOSTIC_WARNING_BACKGROUND },
  information: { backgroundColor: DIAGNOSTIC_INFORMATION_BACKGROUND },
  hint: { backgroundColor: DIAGNOSTIC_HINT_BACKGROUND },
}

export const UNNECESSARY_DIAGNOSTIC_OPACITY = registerEditorColor(
  'lsp.diagnostic.unnecessaryOpacity',
  {
    dark: '#000a',
    light: '#0007',
  },
)

export const DEPRECATED_DIAGNOSTIC_STYLE: VirtualizedTextHighlightStyle = {
  overlay: { textDecoration: 'line-through' },
}

// Opacity descends with severity, so a line carrying several diagnostics still reads as its worst
// one once the marks overlap.
const DIAGNOSTIC_MARKER_ALPHA = {
  error: 1,
  warning: 0.95,
  information: 0.9,
  hint: 0.85,
} as const satisfies Record<LanguageServerDiagnosticSeverity, number>

/**
 * Minimap marker colour per severity.
 *
 * The one place this plugin ships a colour a theme cannot reach: the minimap paints onto a canvas
 * from a worker, which has no element and no style engine to resolve a registered id against, and a
 * value it cannot parse is silently replaced by the selection colour. Deriving the literal is as
 * close to a registration as a worker gets.
 */
export const DIAGNOSTIC_MARKER_COLORS: Record<LanguageServerDiagnosticSeverity, string> = {
  error: diagnosticMarkerColor('error'),
  warning: diagnosticMarkerColor('warning'),
  information: diagnosticMarkerColor('information'),
  hint: diagnosticMarkerColor('hint'),
}

function diagnosticMarkerColor(severity: LanguageServerDiagnosticSeverity): string {
  const channels = Number.parseInt(DIAGNOSTIC_HUES[severity].slice(1), 16)
  const rgb = [(channels >> 16) & 0xff, (channels >> 8) & 0xff, channels & 0xff].join(', ')
  return `rgba(${rgb}, ${DIAGNOSTIC_MARKER_ALPHA[severity]})`
}
