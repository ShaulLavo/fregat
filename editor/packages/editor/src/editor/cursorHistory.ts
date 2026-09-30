import type { EditorSelectionRange } from '../plugins'

// Deep enough to cover a run of jumps — an occurrence sweep, a definition
// lookup, a stray jump to the top of the file — and shallow enough that the
// entries stay a convenience rather than a retained copy of every caret the
// session ever had.
const MAX_CURSOR_HISTORY_DEPTH = 50

export type CursorHistoryEntry = {
  readonly selections: readonly EditorSelectionRange[]
  readonly lastAddedIndex: number
  readonly scrollTop: number
  readonly scrollLeft: number
}

/**
 * Where the carets have been, recorded apart from the document's own history.
 *
 * Retracing a jump and taking back an edit are different intents, and a user
 * asking for one must never be handed the other — so this stack holds no edits
 * and the caller drops it whole the moment the text changes. Offsets recorded
 * against text that has since moved would put the carets somewhere that no
 * longer means anything, and no partial rescue of them beats starting over.
 *
 * Scroll travels with each entry because the position a jump was made from is
 * as much where the reader was looking as where the caret sat; restoring only
 * the caret leaves them somewhere they never were.
 */
export class CursorHistory {
  private readonly undoStack: CursorHistoryEntry[] = []
  private readonly redoStack: CursorHistoryEntry[] = []

  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
  }

  record(previous: CursorHistoryEntry): void {
    // A move that ended where the previous one started is a place already on the
    // stack; keeping it would spend a step of history to go nowhere.
    if (sameCursorSelections(this.undoStack.at(-1), previous)) return

    this.push(this.undoStack, previous)
    // Going back is only offered along the path already walked, and a fresh move
    // is a different path.
    this.redoStack.length = 0
  }

  undo(current: CursorHistoryEntry): CursorHistoryEntry | null {
    const entry = this.undoStack.pop()
    if (!entry) return null

    this.push(this.redoStack, current)
    return entry
  }

  redo(current: CursorHistoryEntry): CursorHistoryEntry | null {
    const entry = this.redoStack.pop()
    if (!entry) return null

    this.push(this.undoStack, current)
    return entry
  }

  private push(stack: CursorHistoryEntry[], entry: CursorHistoryEntry): void {
    stack.push(entry)
    if (stack.length > MAX_CURSOR_HISTORY_DEPTH) stack.shift()
  }
}

export function sameCursorSelections(
  a: CursorHistoryEntry | undefined,
  b: CursorHistoryEntry,
): boolean {
  if (!a) return false
  if (a.selections.length !== b.selections.length) return false
  if (a.lastAddedIndex !== b.lastAddedIndex) return false

  return a.selections.every((selection, index) => {
    const other = b.selections[index]
    if (!other) return false
    return (
      selection.anchor === other.anchor &&
      selection.head === other.head &&
      (selection.affinity ?? 'after') === (other.affinity ?? 'after')
    )
  })
}
