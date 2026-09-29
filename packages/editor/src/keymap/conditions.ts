import type { EditorCommandId } from '../editor/commands'
import { editorCommandDeclaration } from '../editor/commandCatalog'

/**
 * The editor's own keys, plus any a plugin registered for the state it owns (`findVisible`,
 * `suggestWidgetVisible`). A key nobody registered reads as false.
 */
export type EditorKeymapContext = Readonly<Record<string, boolean>> & {
  readonly writable: boolean
  readonly hasSelection: boolean
  readonly tabFocusMode: boolean
  readonly inlineSuggestionVisible: boolean
}
/** A context key, or `!key` for its negation. */
export type EditorKeyCondition = string
export function editorKeyConditionMatches(
  condition: EditorKeyCondition,
  context: EditorKeymapContext,
): boolean {
  if (condition.startsWith('!')) return context[condition.slice(1)] !== true
  return context[condition] === true
}
export function editorCommandMutates(command: EditorCommandId): boolean {
  return editorCommandDeclaration(command).mutates
}
