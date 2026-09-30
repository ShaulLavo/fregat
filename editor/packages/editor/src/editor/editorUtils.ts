import type { DocumentSessionChange } from '../documentSession'
import type { EditorViewContributionUpdateKind } from '../plugins'
import type { SelectionAffinity } from '../selections'
import type { EditorSetSelectionOptions } from './selectionReveal'

const SYNTAX_EDIT_DEBOUNCE_MS = 75

// A sustained typist keeps keystrokes closer together than the debounce, which
// would postpone re-tokenizing for as long as they keep typing and leave
// highlighting visibly stale on shifted token positions. This ceiling forces a
// refresh mid-burst; it is well above the debounce so ordinary typing pauses
// still decide when the refresh happens.
export const SYNTAX_REFRESH_MAX_DELAY_MS = 400

export type SessionChangeOptions = {
  readonly syncDomSelection?: boolean
  readonly revealOffset?: number
  /** Present only when revealOffset names the active caret rather than an arbitrary document point. */
  readonly revealAffinity?: SelectionAffinity
  readonly revealBlock?: EditorSetSelectionOptions['revealBlock']
}

export function syntaxRefreshDelay(change: DocumentSessionChange | null): number {
  if (!change || change.edits.length === 0) return 0
  return SYNTAX_EDIT_DEBOUNCE_MS
}

export function viewContributionKindForChange(
  change: DocumentSessionChange,
): EditorViewContributionUpdateKind {
  if (change.kind === 'selection') return 'selection'
  return 'content'
}

export function indentTimingName(direction: 'indent' | 'outdent'): string {
  return direction === 'indent' ? 'input.indent' : 'input.outdent'
}

export function removeArrayItem<T>(items: T[], item: T): void {
  const index = items.indexOf(item)
  if (index === -1) return

  items.splice(index, 1)
}

export function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}
