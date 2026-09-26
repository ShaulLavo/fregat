import {
  bracketJumpTargetOffset,
  findBracketMatchAtCaret,
  type BracketMatch,
} from './editor/bracketMatching'
import { createPlugin, derive, selectionInput, type EditorInput } from './createPlugin'
import type { EditorPlugin, EditorResolvedSelection } from './plugins'
import type { BracketInfo } from './syntax/session'
import type { VirtualizedTextHighlightStyle } from './virtualization'

export const EDITOR_BRACKET_MATCH_PLUGIN_ID = 'editor.bracketMatch'

const DEFAULT_BRACKET_MATCH_STYLE: VirtualizedTextHighlightStyle = {
  backgroundColor: 'rgba(128, 128, 128, 0.28)',
}

export type EditorBracketMatchPluginOptions = {
  /** Paint applied to both brackets of the pair. */
  readonly style?: VirtualizedTextHighlightStyle
}

/**
 * Highlights the bracket pair around the caret and contributes `editor.action.jumpToBracket`.
 *
 * Pairing uses the bracket list from the structural parse rather than a text scan, so brackets
 * inside strings and comments are already excluded. When the parse has not produced brackets for
 * the caret's region yet, nothing is painted — a missing highlight is honest, a wrong one is not.
 */
export function createBracketMatchPlugin(
  options: EditorBracketMatchPluginOptions = {},
): EditorPlugin {
  const style = options.style ?? DEFAULT_BRACKET_MATCH_STYLE
  return createPlugin({
    name: EDITOR_BRACKET_MATCH_PLUGIN_ID,
    view(scope) {
      const name = `${scope.view.highlightPrefix}-bracket-match`
      let painted: BracketMatch | null = null
      const paint = (match: BracketMatch | null) => {
        if (sameMatch(painted, match)) return
        painted = match
        if (!match) {
          scope.view.clearRangeHighlight(name)
          return
        }
        scope.view.setRangeHighlight(
          name,
          [
            { end: match.openOffset + 1, start: match.openOffset },
            { end: match.closeOffset + 1, start: match.closeOffset },
          ],
          style,
        )
      }

      scope.watch(matchInput, paint)
      scope.handle('editor.action.jumpToBracket', () => {
        const caret = caretOffset(scope.read(selectionInput))
        if (caret === null) return false

        const target = bracketJumpTargetOffset(scope.read(bracketsInput), caret)
        if (target === null) return false

        scope.view.setSelection(target, target, 'editor.jumpToBracket', { revealOffset: target })
        return true
      })
      scope.onDispose(() => paint(null))
    },
  })
}

// The parse delivers the bracket list; a new one arrives with content and with tokens.
const bracketsInput: EditorInput<readonly BracketInfo[]> = {
  id: 'brackets',
  kinds: ['content', 'tokens'],
  read: (snapshot) => snapshot.brackets,
}

const matchInput = derive([selectionInput, bracketsInput], (selections, brackets) => {
  const caret = caretOffset(selections)
  return caret === null ? null : findBracketMatchAtCaret(brackets, caret)
})

/**
 * Caret of the primary selection, or null when there is no single caret to match against. A
 * non-empty selection is skipped so that selecting a region does not paint an unrelated pair.
 */
function caretOffset(selections: readonly EditorResolvedSelection[]): number | null {
  const primary = selections[0]
  if (!primary) return null
  if (primary.startOffset !== primary.endOffset) return null

  return primary.headOffset
}

function sameMatch(left: BracketMatch | null, right: BracketMatch | null): boolean {
  if (!left || !right) return left === right

  return left.openOffset === right.openOffset && left.closeOffset === right.closeOffset
}
