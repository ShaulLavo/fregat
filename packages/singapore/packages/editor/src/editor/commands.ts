/**
 * The nesting depths that get a command, and with it a key, of their own. Seven is where one more
 * costs a chord and buys nothing: a region deeper than this is reached by folding what encloses it,
 * not by naming its depth.
 */
export const EDITOR_FOLD_LEVELS = [1, 2, 3, 4, 5, 6, 7] as const

export type EditorFoldLevel = (typeof EDITOR_FOLD_LEVELS)[number]

export type { EditorCommandId } from './commandCatalog'

export type EditorCommandContext = {
  readonly event?: KeyboardEvent
}
