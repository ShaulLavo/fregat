import {
  registerEditorColor,
  type VirtualizedTextHighlightStyle,
} from '@singapore-editor/core/rendering'

// Blue keeps a spelling mark apart from a red error on the same word.
const MISSPELLED = registerEditorColor('spellcheck.misspelled', {
  dark: '#38bdf8',
  light: '#0284c7',
})

/**
 * An overlay, because WebKit draws a highlight's wavy line only when the highlight also sets a text
 * colour, and the overlay paints each token's own colour back with it.
 */
export const SPELLING_STYLE: VirtualizedTextHighlightStyle = {
  overlay: { textDecoration: `underline wavy ${MISSPELLED}` },
}
