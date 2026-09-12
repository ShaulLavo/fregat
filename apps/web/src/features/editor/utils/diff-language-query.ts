import type {
  DiffFilePosition,
  DiffFileSide,
  DiffPositionMap,
} from '@/features/editor/utils/diff-position-map'

export type DiffQueryTarget =
  /** Safe to ask a language server about: this side's document, at this position in it. */
  | { readonly kind: 'ask'; readonly side: DiffFileSide; readonly position: DiffFilePosition }
  /**
   * Nothing to ask about here.
   *
   * `reason` exists so a refusal can be logged as the specific one it is. Three very different
   * situations collapsed into one silent no-op before, and telling them apart from outside was
   * impossible: this row is not a line of either text, this side has no document, and this side's
   * document is no longer the text we are pointing at.
   */
  | { readonly kind: 'unavailable'; readonly reason: DiffQueryRefusal }

type DiffQueryRefusal = 'not-a-file-line' | 'side-not-open' | 'text-moved'

/**
 * Whether a side's document still holds the text this map was built from.
 *
 * `ready` for a side the diff opened under a name of its own — a phantom sibling nothing else can
 * write to, so it cannot drift. `drifted` for the new side when it shares the file's real uri with
 * an editor that has since been typed into: our proxy forwards a joining or editing client's text
 * to the backend, so the server's copy is now that editor's, and every line below their edit is off
 * by however many lines it added. The server would answer, confidently, about the wrong code.
 */
export type DiffSideState = 'ready' | 'drifted'

/**
 * Whether a point in a diff may become a language-server question, and where.
 *
 * The diff opens both of its texts as documents of its own, so the copy the server holds for a side
 * is normally the text this map was built from. That is a stronger guarantee than this gate used to
 * make: it previously borrowed some editor's document, which was correct but refused whenever no
 * editor happened to have the file open — the normal case while reading a diff.
 *
 * Two things are still worth refusing. A row may be no line of either text: placeholders,
 * separators and rows the projection blanked. And the one document the diff does not exclusively
 * own — the new side, when it shares the file's real uri — can drift out from under it. The drift
 * check is the one VS Code raised and dropped as racy (microsoft/vscode#34034); the raciness
 * objection was to doing it ONCE at load. Done per request there is no window: either the texts are
 * equal at the moment of asking, or we do not ask.
 */
export function diffQueryTargetAt({
  map,
  offset,
  sides,
}: {
  readonly map: DiffPositionMap
  readonly offset: number
  /** State per side. A side with no document is absent rather than present and unusable. */
  readonly sides: ReadonlyMap<DiffFileSide, DiffSideState>
}): DiffQueryTarget {
  const lookup = map.lookupAt(offset)
  if (lookup.kind !== 'file') return { kind: 'unavailable', reason: 'not-a-file-line' }

  const state = sides.get(lookup.side)
  if (!state) return { kind: 'unavailable', reason: 'side-not-open' }
  if (state === 'drifted') return { kind: 'unavailable', reason: 'text-moved' }

  return { kind: 'ask', position: lookup.position, side: lookup.side }
}
