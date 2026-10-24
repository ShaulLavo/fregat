import {
  EditorDecorationStore,
  type EditorDecorationSpec,
  type EditorDecorationTextSurface,
} from './editor/decorationStore'
import { occurrenceHighlightRanges, type OccurrenceHighlightRange } from './occurrenceHighlights'
import { createPlugin, derive, selectionInput, visibleRowsInput } from './createPlugin'
import type { EditorPlugin } from './plugins'
import type { VirtualizedTextHighlightStyle } from './virtualization'

export const EDITOR_OCCURRENCE_HIGHLIGHT_PLUGIN_ID = 'editor.occurrenceHighlight'

const DEFAULT_OCCURRENCE_STYLE: VirtualizedTextHighlightStyle = {
  backgroundColor: 'rgba(128, 128, 128, 0.18)',
}

/**
 * The whole feature paints through one highlight group, which carries the colour, so there is
 * nothing left for a per-decoration payload to say. Declaring the surface is what puts these in the
 * text index; the shared object is what lets the store recognize an unchanged set.
 */
const OCCURRENCE_TEXT_SURFACE: EditorDecorationTextSurface = {}

export type EditorOccurrenceHighlightPluginOptions = {
  readonly style?: VirtualizedTextHighlightStyle
}

/**
 * Passively highlights every visible occurrence of the word under the caret, the way an editor
 * shows you where a symbol is used without being asked.
 *
 * Distinct from the `selectHighlights`/`changeAll` commands, which put cursors on occurrences; this
 * only paints, and only within the mounted rows.
 */
export function createOccurrenceHighlightPlugin(
  options: EditorOccurrenceHighlightPluginOptions = {},
): EditorPlugin {
  const style = options.style ?? DEFAULT_OCCURRENCE_STYLE
  return createPlugin({
    name: EDITOR_OCCURRENCE_HIGHLIGHT_PLUGIN_ID,
    view(scope) {
      const name = `${scope.view.highlightPrefix}-occurrence-highlight`
      const decorations = new EditorDecorationStore()
      let registered = false
      scope.watch(occurrencesInput, (ranges) => {
        const specs = ranges.map(occurrenceDecorationSpec)
        if (!decorations.replaceOwner(EDITOR_OCCURRENCE_HIGHLIGHT_PLUGIN_ID, specs)) return

        // Empty, not cleared: the view keeps the group's rule for the next word.
        registered = true
        scope.view.setRangeHighlight(name, ranges, style)
      })
      scope.onDispose(() => {
        if (registered) scope.view.clearRangeHighlight(name)
      })
    },
  })
}

/**
 * Occurrences mark words that are already in the document, so neither edge absorbs what is typed
 * against it: a character typed onto the end of a match makes it a different word, not a longer
 * match. That is the store's default, so the spec only has to say where and on which surface.
 */
function occurrenceDecorationSpec(range: OccurrenceHighlightRange): EditorDecorationSpec {
  return {
    owner: EDITOR_OCCURRENCE_HIGHLIGHT_PLUGIN_ID,
    start: range.start,
    end: range.end,
    text: OCCURRENCE_TEXT_SURFACE,
  }
}

// Scrolling changes which rows are mounted, so the rows are an input as much as the caret.
const occurrencesInput = derive(
  [visibleRowsInput, selectionInput],
  (rows, selections): readonly OccurrenceHighlightRange[] => {
    const primary = selections[0]
    if (!primary) return []
    // A dragged selection has its own meaning; only a resting caret asks "where else is this used".
    if (primary.startOffset !== primary.endOffset) return []

    const ranges = occurrenceHighlightRanges(rows, primary.headOffset)
    // A single occurrence is the word the caret is already in — painting it says nothing.
    return ranges.length > 1 ? ranges : []
  },
)
